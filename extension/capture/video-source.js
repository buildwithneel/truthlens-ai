/**
 * TruthLens AI – Video Source
 *
 * Responsible for:
 *  1. Finding video elements on the current page.
 *  2. Providing a ticker (requestAnimationFrame loop) that fires once per
 *     frame so downstream stages (FaceDetector → Inference → RiskEngine)
 *     can process video.
 *  3. Reporting FPS to the overlay / popup.
 *
 * CURRENT STATE: Architecture stub.
 *   Webcam capture and MediaStream integration will be added in the next
 *   sprint. The ticker is functional and will call the registered callback
 *   with the <video> element on each frame.
 *
 * Pipeline position:
 *   VideoSource → FaceDetector → InferenceProvider → RiskEngine → Overlay
 *
 * DO NOT:
 *  - Upload any frame data to a server.
 *  - Access getUserMedia() here (that is a separate capture module, TBD).
 */

'use strict';

const VideoSource = (() => {
  let _rafId        = null;
  let _videoEl      = null;
  let _onFrameCb    = null;
  let _running      = false;

  // FPS tracking
  let _frameCount   = 0;
  let _fpsWindowStart = performance.now();
  let _currentFps  = 0;

  const FPS_WINDOW_MS = 1000; // recalculate FPS every second

  // ── Video element discovery ───────────────────────────────────────────────

  /**
   * Finds the "best" video element on the page to monitor.
   * Heuristic: largest playing <video> by resolution.
   *
   * Returns null if no suitable element is found.
   * @returns {HTMLVideoElement|null}
   */
  function findBestVideoElement() {
    const videos = Array.from(document.querySelectorAll('video'));
    if (videos.length === 0) return null;

    const candidates = videos.filter(
      (v) => !v.paused && v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    );

    if (candidates.length === 0) {
      // Fall back to any video element that has dimensions.
      const withDims = videos.filter((v) => v.videoWidth > 0);
      return withDims.length ? withDims[0] : null;
    }

    // Pick the largest by pixel count.
    return candidates.reduce((best, v) =>
      v.videoWidth * v.videoHeight > best.videoWidth * best.videoHeight ? v : best
    );
  }

  // ── RAF loop ──────────────────────────────────────────────────────────────

  function _tick(timestamp) {
    if (!_running) return;

    // Reattach video if it was removed from DOM.
    if (!_videoEl || !document.contains(_videoEl)) {
      _videoEl = findBestVideoElement();
      if (!_videoEl) {
        TLLogger.debug('VideoSource', 'No video found this frame – waiting...');
        _rafId = requestAnimationFrame(_tick);
        return;
      }
      TLLogger.info('VideoSource', 'Attached to video element:', _videoEl);
    }

    // FPS calculation.
    _frameCount++;
    const elapsed = timestamp - _fpsWindowStart;
    if (elapsed >= FPS_WINDOW_MS) {
      _currentFps    = Math.round((_frameCount / elapsed) * 1000);
      _frameCount    = 0;
      _fpsWindowStart = timestamp;
      TLLogger.debug('VideoSource', `FPS: ${_currentFps}`);
    }

    // Fire the registered callback with the video element.
    if (typeof _onFrameCb === 'function') {
      _onFrameCb(_videoEl, _currentFps);
    }

    _rafId = requestAnimationFrame(_tick);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Start the frame-capture loop.
   *
   * @param {function(HTMLVideoElement, number): void} onFrame
   *   Called every animation frame with the current video element and FPS.
   */
  function start(onFrame) {
    if (_running) {
      TLLogger.warn('VideoSource', 'start() called while already running.');
      return;
    }
    _onFrameCb      = onFrame;
    _running        = true;
    _fpsWindowStart = performance.now();
    _frameCount     = 0;
    _videoEl        = findBestVideoElement();

    TLLogger.info('VideoSource', 'Frame loop started.', _videoEl ? 'Video found.' : 'No video yet – will retry.');
    _rafId = requestAnimationFrame(_tick);
  }

  /**
   * Stop the frame-capture loop and release references.
   */
  function stop() {
    if (!_running) return;
    _running = false;
    if (_rafId != null) {
      cancelAnimationFrame(_rafId);
      _rafId = null;
    }
    _videoEl   = null;
    _onFrameCb = null;
    TLLogger.info('VideoSource', 'Frame loop stopped.');
  }

  /** Returns the most recently computed FPS. */
  function getFps() { return _currentFps; }

  /** Returns the currently attached video element (or null). */
  function getVideoElement() { return _videoEl; }

  /** Returns whether the loop is active. */
  function isRunning() { return _running; }

  return { start, stop, getFps, getVideoElement, isRunning, findBestVideoElement };
})();

window.VideoSource = VideoSource;
