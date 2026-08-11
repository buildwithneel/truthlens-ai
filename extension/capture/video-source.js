/**
 * TruthLens AI – Video Source  (Sprint 3 – Webcam Pipeline)
 *
 * Responsibilities:
 *  1. Request webcam access via navigator.mediaDevices.getUserMedia().
 *  2. Feed the stream into a programmatically-created HTMLVideoElement.
 *  3. Schedule per-frame callbacks at a configurable target FPS using
 *     requestVideoFrameCallback (preferred) or requestAnimationFrame (fallback).
 *  4. Track actual processed FPS (not browser render FPS).
 *  5. Expose a clean public API: start / stop / pause / resume / getVideoElement / isRunning.
 *  6. Release all camera tracks on stop so the OS camera indicator turns off.
 *
 * Pipeline position:
 *   [Webcam] → HTMLVideoElement → FrameScheduler → onFrame(callback)
 *                                                        ↓
 *                                              FaceDetector (next sprint)
 *
 * DOES NOT:
 *  - Perform face detection.
 *  - Perform ML inference.
 *  - Upload or transmit frame data.
 *  - Touch the DOM (the video element is kept off-screen in memory).
 *  - Interact with the overlay or popup directly.
 *
 * Browser notes:
 *  - requestVideoFrameCallback (rVFC) is supported in Chrome 83+, Edge 83+.
 *    It fires in sync with the video's own decode cadence, giving more accurate
 *    per-frame timing than RAF.  We use RAF as a universal fallback.
 *  - getUserMedia requires a secure context (HTTPS or localhost).
 *    Extensions run in a privileged context, so this always works.
 *  - Calling getUserMedia in a content script is fine in MV3; the permission
 *    prompt is shown to the user once per origin pair.
 *  - Stopping all MediaStreamTrack instances is required to release the camera
 *    hardware (and turn off the OS camera indicator light).
 */

'use strict';

const VideoSource = (() => {

  // ─── Configuration ────────────────────────────────────────────────────────

  /** Maximum frames we will process per second.  Stays constant after init
   *  unless changed via setTargetFPS().  Lower = less CPU, higher = more
   *  responsive.  A content-script frame rate above ~30 is rarely useful. */
  let _targetFPS = 15;

  /** Minimum milliseconds that must elapse between two processed frames.
   *  Derived from _targetFPS; recalculated whenever targetFPS changes. */
  let _minFrameIntervalMs = 1000 / _targetFPS;

  // ─── State ────────────────────────────────────────────────────────────────

  /**
   * Lifecycle states:
   *  'idle'    – not started
   *  'starting'– getUserMedia pending
   *  'running' – stream active, scheduler firing
   *  'paused'  – scheduler suspended but stream kept alive
   *  'stopped' – stream released, video detached
   */
  let _state = 'idle';

  /** The live MediaStream from getUserMedia. */
  let _stream = null;

  /** Off-screen HTMLVideoElement that renders the camera stream. */
  let _videoEl = null;

  /** The registered per-frame callback.  Signature:
   *    function({ video, timestamp, width, height, fps, avgFps }): void
   */
  let _onFrameCb = null;

  // ─── Frame scheduler state ────────────────────────────────────────────────

  /** rVFC handle (returned by video.requestVideoFrameCallback). */
  let _rvfcHandle = null;

  /** RAF handle (returned by requestAnimationFrame). Used as fallback. */
  let _rafHandle = null;

  /** true when rVFC is available on this browser. */
  let _useRvfc = false;

  /** DOMHighResTimeStamp of the last frame we actually processed. */
  let _lastProcessedTs = 0;

  // ─── FPS tracking ─────────────────────────────────────────────────────────

  /** Number of frames processed in the current measurement window. */
  let _processedCount = 0;

  /** performance.now() at the start of the current FPS window. */
  let _fpsWindowStart = 0;

  /** Reported FPS after the most recent completed window (1 s window). */
  let _currentFps = 0;

  /** Running sum of all per-window FPS measurements (for average). */
  let _fpsSum = 0;

  /** Number of completed FPS windows (for average). */
  let _fpsWindowCount = 0;

  /** FPS recalculation window length in milliseconds. */
  const FPS_WINDOW_MS = 1000;

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Build the off-screen video element.
   * We do not append it to the page DOM – keeping it in memory is enough.
   * width/height=0 avoids any layout contribution if it somehow gets added.
   */
  function _createVideoElement() {
    const v        = document.createElement('video');
    v.autoplay     = true;
    v.playsInline  = true;
    v.muted        = true;
    // Prevent accidental layout impact if element is ever attached to DOM.
    v.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
    return v;
  }

  /**
   * Stop all tracks on the active MediaStream and null it out.
   * This is what turns off the OS camera indicator light.
   */
  function _releaseStream() {
    if (!_stream) return;
    _stream.getTracks().forEach((track) => {
      track.stop();
      TLLogger.debug('VideoSource', `Track stopped: kind=${track.kind} label="${track.label}"`);
    });
    _stream = null;
  }

  /** Cancel whichever scheduler handle is active. */
  function _cancelScheduler() {
    if (_rvfcHandle != null && _videoEl) {
      // cancelVideoFrameCallback exists if requestVideoFrameCallback does.
      _videoEl.cancelVideoFrameCallback(_rvfcHandle);
      _rvfcHandle = null;
    }
    if (_rafHandle != null) {
      cancelAnimationFrame(_rafHandle);
      _rafHandle = null;
    }
  }

  /**
   * Update the _currentFps gauge.
   * Called on every processed frame; resets the window every FPS_WINDOW_MS.
   *
   * @param {number} nowMs  – performance.now() at time of this processed frame
   */
  function _updateFpsStats(nowMs) {
    _processedCount++;
    const elapsed = nowMs - _fpsWindowStart;

    if (elapsed >= FPS_WINDOW_MS) {
      // Completed a full measurement window.
      _currentFps = parseFloat((_processedCount / elapsed * 1000).toFixed(1));

      // Update rolling average.
      _fpsSum         += _currentFps;
      _fpsWindowCount += 1;

      TLLogger.info('VideoSource', `FPS: ${_currentFps}`);

      // Reset for the next window.
      _processedCount = 0;
      _fpsWindowStart = nowMs;
    }
  }

  // ─── Frame scheduler ──────────────────────────────────────────────────────

  /**
   * Core per-frame handler.  Called by either rVFC or RAF.
   *
   * @param {DOMHighResTimeStamp} timestamp
   *   rVFC: timestamp from VideoFrameCallbackMetadata.mediaTime (converted to ms)
   *   RAF:  timestamp from requestAnimationFrame callback arg
   * @param {VideoFrameCallbackMetadata|null} rvfcMeta
   *   Non-null only when called from rVFC.  Contains presentedFrames etc.
   */
  function _onSchedulerTick(timestamp, rvfcMeta) {
    // If we were stopped/paused between scheduling this and firing, bail out.
    if (_state !== 'running') return;

    const nowMs = performance.now();

    // ── Throttle to targetFPS ───────────────────────────────────────────────
    // For rVFC we still throttle: even if the camera is at 30 fps we may only
    // want to process at 15.  For RAF the tab render rate may be 60+.
    if (nowMs - _lastProcessedTs < _minFrameIntervalMs) {
      // Re-arm scheduler without processing this frame.
      _scheduleNext();
      return;
    }
    _lastProcessedTs = nowMs;

    // ── Guard: video must have data ─────────────────────────────────────────
    if (!_videoEl || _videoEl.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      _scheduleNext();
      return;
    }

    const width  = _videoEl.videoWidth;
    const height = _videoEl.videoHeight;

    if (width === 0 || height === 0) {
      _scheduleNext();
      return;
    }

    // ── FPS accounting ──────────────────────────────────────────────────────
    _updateFpsStats(nowMs);

    // ── Fire the registered callback ────────────────────────────────────────
    if (typeof _onFrameCb === 'function') {
      try {
        _onFrameCb({
          video:     _videoEl,
          timestamp: nowMs,       // consistent DOMHighResTimeStamp in ms
          width,
          height,
          fps:       _currentFps,
          avgFps:    _fpsWindowCount > 0
                       ? parseFloat((_fpsSum / _fpsWindowCount).toFixed(1))
                       : _currentFps,
        });
      } catch (err) {
        TLLogger.error('VideoSource', 'onFrame callback threw an error:', err);
      }
    }

    _scheduleNext();
  }

  /**
   * Register the next scheduler tick using rVFC or RAF.
   * All scheduling goes through this single function to avoid double-arming.
   */
  function _scheduleNext() {
    if (_state !== 'running') return;

    if (_useRvfc && _videoEl) {
      // requestVideoFrameCallback fires once, then must be re-registered.
      _rvfcHandle = _videoEl.requestVideoFrameCallback(_rvfcTick);
    } else {
      _rafHandle = requestAnimationFrame(_rafTick);
    }
  }

  // Adapters that normalise arguments before calling _onSchedulerTick.

  function _rvfcTick(now, metadata) {
    // `now` from rVFC is the same high-res timestamp as RAF, in ms.
    _rvfcHandle = null;   // handle consumed
    _onSchedulerTick(now, metadata);
  }

  function _rafTick(timestamp) {
    _rafHandle = null;    // handle consumed
    _onSchedulerTick(timestamp, null);
  }

  /** Start the scheduler from a clean slate. */
  function _startScheduler() {
    // Detect rVFC support.
    _useRvfc = (typeof _videoEl?.requestVideoFrameCallback === 'function');
    TLLogger.info('VideoSource', `Scheduler: using ${_useRvfc ? 'requestVideoFrameCallback' : 'requestAnimationFrame (fallback)'}`);

    // Reset FPS state.
    _processedCount = 0;
    _fpsWindowStart = performance.now();
    _currentFps     = 0;
    _fpsSum         = 0;
    _fpsWindowCount = 0;
    _lastProcessedTs = 0;

    _scheduleNext();
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Set the target processing frame rate.
   * May be called before or after start().
   *
   * @param {number} fps – e.g. 15.  Must be > 0.
   */
  function setTargetFPS(fps) {
    if (typeof fps !== 'number' || fps <= 0) {
      TLLogger.warn('VideoSource', 'setTargetFPS: invalid value, ignoring:', fps);
      return;
    }
    _targetFPS          = fps;
    _minFrameIntervalMs = 1000 / fps;
    TLLogger.info('VideoSource', `Target FPS set to ${fps} (min interval ${_minFrameIntervalMs.toFixed(1)} ms)`);
  }

  /**
   * Start the webcam pipeline.
   *
   * 1. Calls getUserMedia({ video: true, audio: false }).
   * 2. Creates a hidden HTMLVideoElement and attaches the stream.
   * 3. Starts the frame scheduler.
   *
   * @param {function} onFrame
   *   Callback receiving: { video, timestamp, width, height, fps, avgFps }
   *
   * @param {object} [videoConstraints]
   *   Optional MediaTrackConstraints for the video track.
   *   Defaults to { facingMode: 'user' } (front camera).
   *   Caller may pass e.g. { width: 1280, height: 720, facingMode: 'user' }.
   *
   * @returns {Promise<void>}
   *   Resolves once the camera is live and the scheduler has started.
   *   Rejects if the user denies camera access or no camera is found.
   */
  async function start(onFrame, videoConstraints) {
    if (_state === 'running' || _state === 'paused') {
      TLLogger.warn('VideoSource', `start() called while state="${_state}" – ignoring.`);
      return;
    }
    if (_state === 'starting') {
      TLLogger.warn('VideoSource', 'start() called while already starting – ignoring.');
      return;
    }

    if (typeof onFrame !== 'function') {
      throw new TypeError('VideoSource.start(): onFrame callback is required.');
    }

    // ── Guard: browser API availability ────────────────────────────────────
    if (!navigator?.mediaDevices?.getUserMedia) {
      const err = new Error(
        'navigator.mediaDevices.getUserMedia is not available. ' +
        'This browser does not support webcam access, or the page is ' +
        'not in a secure context (HTTPS / extension).'
      );
      TLLogger.error('VideoSource', err.message);
      throw err;
    }

    _state     = 'starting';
    _onFrameCb = onFrame;

    TLLogger.info('VideoSource', 'Requesting camera access...');

    // ── getUserMedia ────────────────────────────────────────────────────────
    // We request video only. Audio is explicitly false – we never record audio.
    // The video constraints merge caller-supplied values with a sensible default.
    const constraints = {
      video: {
        facingMode: 'user',   // front camera
        width:     { ideal: 640 },
        height:    { ideal: 480 },
        frameRate: { ideal: 30, min: 15 },
        ...( videoConstraints ?? {} ),
      },
      audio: false,           // never request audio
    };

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      _state = 'idle';

      // Provide developer-friendly error messages for common failure modes.
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        TLLogger.error('VideoSource', 'Camera permission denied by user.');
        throw new Error('Camera permission denied. The user must allow camera access.');
      }
      if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        TLLogger.error('VideoSource', 'No camera device found on this machine.');
        throw new Error('No camera found. Please connect a camera and try again.');
      }
      if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        TLLogger.error('VideoSource', 'Camera is in use by another application.');
        throw new Error('Camera is busy (used by another application).');
      }
      if (err.name === 'OverconstrainedError') {
        TLLogger.error('VideoSource', 'Camera constraints could not be satisfied:', err.constraint);
        throw new Error(`Camera cannot satisfy requested constraints (${err.constraint}).`);
      }
      // Generic fallback.
      TLLogger.error('VideoSource', 'getUserMedia failed:', err);
      throw err;
    }

    _stream = stream;

    // Log the actual track capabilities.
    const vTrack = stream.getVideoTracks()[0];
    if (vTrack) {
      const settings = vTrack.getSettings();
      TLLogger.info('VideoSource', `Camera track: "${vTrack.label}" | ${settings.width}×${settings.height} @ ${settings.frameRate ?? '?'} fps`);

      // Listen for the track ending unexpectedly (e.g. camera unplugged,
      // OS revokes access, another tab steals the stream).
      vTrack.addEventListener('ended', () => {
        TLLogger.warn('VideoSource', 'Camera track ended unexpectedly – stopping pipeline.');
        stop();
      });
    }

    // ── Create video element ────────────────────────────────────────────────
    _videoEl        = _createVideoElement();
    _videoEl.srcObject = _stream;

    // Wait for the video to have enough data to report dimensions.
    // 'loadedmetadata' fires once width/height are known.
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Video element timed out waiting for camera stream.'));
      }, 8000);

      _videoEl.addEventListener('loadedmetadata', () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });

      _videoEl.addEventListener('error', (e) => {
        clearTimeout(timeout);
        reject(new Error(`Video element error: ${e.message}`));
      }, { once: true });
    });

    TLLogger.info('VideoSource', `Camera started | ${_videoEl.videoWidth}×${_videoEl.videoHeight}`);

    // ── Start scheduler ────────────────────────────────────────────────────
    _state = 'running';
    _startScheduler();

    TLLogger.info('VideoSource', `Frame scheduler started | target ${_targetFPS} FPS`);
  }

  /**
   * Stop the pipeline completely.
   *
   * - Cancels the scheduler.
   * - Stops all MediaStream tracks (releases camera hardware).
   * - Detaches the stream from the video element.
   * - Nulls all references.
   */
  function stop() {
    if (_state === 'idle' || _state === 'stopped') {
      TLLogger.debug('VideoSource', `stop() called while state="${_state}" – nothing to do.`);
      return;
    }

    TLLogger.info('VideoSource', 'Stopping...');

    _state = 'stopped';

    // 1. Cancel scheduler.
    _cancelScheduler();

    // 2. Detach stream from video element.
    if (_videoEl) {
      _videoEl.pause();
      _videoEl.srcObject = null;
      _videoEl = null;
    }

    // 3. Stop all camera tracks – this releases the OS camera resource.
    _releaseStream();

    // 4. Clear callback and reset to idle.
    _onFrameCb = null;
    _state     = 'idle';

    TLLogger.info('VideoSource', 'Camera tracks released. Pipeline stopped.');
  }

  /**
   * Pause frame processing.
   * The camera stream stays active (no OS camera indicator change), but the
   * scheduler stops firing the callback.  Cheaper than stop()+start() if the
   * user wants a brief pause.
   */
  function pause() {
    if (_state !== 'running') {
      TLLogger.warn('VideoSource', `pause() called while state="${_state}" – ignoring.`);
      return;
    }
    _cancelScheduler();
    _state = 'paused';
    TLLogger.info('VideoSource', 'Frame scheduler paused (camera stream still active).');
  }

  /**
   * Resume processing after a pause().
   * No-op if not currently paused.
   */
  function resume() {
    if (_state !== 'paused') {
      TLLogger.warn('VideoSource', `resume() called while state="${_state}" – ignoring.`);
      return;
    }
    _state = 'running';
    // Reset the FPS window so the first reported value is fresh.
    _fpsWindowStart = performance.now();
    _processedCount = 0;
    _scheduleNext();
    TLLogger.info('VideoSource', 'Frame scheduler resumed.');
  }

  /**
   * Returns the off-screen HTMLVideoElement, or null if not started.
   * Downstream modules (FaceDetector, canvas drawImage) use this.
   * @returns {HTMLVideoElement|null}
   */
  function getVideoElement() {
    return _videoEl;
  }

  /**
   * Returns true if the pipeline is in 'running' state.
   * Returns false for idle, starting, paused, stopped.
   */
  function isRunning() {
    return _state === 'running';
  }

  /**
   * Returns an object with current FPS metrics.
   * @returns {{ currentFps: number, avgFps: number, targetFps: number }}
   */
  function getFpsStats() {
    return {
      currentFps: _currentFps,
      avgFps:     _fpsWindowCount > 0
                    ? parseFloat((_fpsSum / _fpsWindowCount).toFixed(1))
                    : _currentFps,
      targetFps:  _targetFPS,
    };
  }

  /** Returns the current lifecycle state string. */
  function getState() { return _state; }

  // ─── Export ───────────────────────────────────────────────────────────────

  return {
    // Core lifecycle
    start,
    stop,
    pause,
    resume,

    // Accessors
    getVideoElement,
    isRunning,
    getState,
    getFpsStats,

    // Configuration
    setTargetFPS,
  };
})();

window.VideoSource = VideoSource;
