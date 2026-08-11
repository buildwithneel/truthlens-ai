/**
 * TruthLens AI – Face Detector
 *
 * Responsible for:
 *  1. Detecting faces in a video frame (HTMLVideoElement or ImageBitmap).
 *  2. Returning the crop region(s) as ImageData for the inference layer.
 *
 * CURRENT STATE: Stub implementation.
 *   Real face detection (e.g. MediaPipe FaceMesh) will be integrated
 *   in a later sprint. For now the detector returns a full-frame crop
 *   so the pipeline can be tested end-to-end.
 *
 * Pipeline position:
 *   VideoSource → FaceDetector → FaceCrop → InferenceProvider
 *
 * DO NOT:
 *  - Load any ML model here.
 *  - Upload frames to a server.
 *  - Block the main thread with synchronous heavy work.
 */

'use strict';

const FaceDetector = (() => {
  // Scratch canvas reused across frames to avoid GC pressure.
  let _canvas = null;
  let _ctx    = null;

  /**
   * Ensure the reusable canvas matches the given dimensions.
   * @param {number} w
   * @param {number} h
   */
  function _ensureCanvas(w, h) {
    if (!_canvas) {
      _canvas = document.createElement('canvas');
      _ctx    = _canvas.getContext('2d');
    }
    if (_canvas.width !== w || _canvas.height !== h) {
      _canvas.width  = w;
      _canvas.height = h;
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Detect faces in the given video element and return cropped ImageData
   * objects for each detected face.
   *
   * @param {HTMLVideoElement} videoEl
   * @returns {Promise<FaceDetectionResult[]>}
   *   Each result: { imageData: ImageData, boundingBox: DOMRect }
   *
   * STUB: Returns the full frame as a single "face" until MediaPipe is wired.
   */
  async function detect(videoEl) {
    if (!videoEl || videoEl.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      TLLogger.debug('FaceDetector', 'detect() – video not ready, skipping frame.');
      return [];
    }

    const { videoWidth: w, videoHeight: h } = videoEl;
    if (w === 0 || h === 0) return [];

    _ensureCanvas(w, h);
    _ctx.drawImage(videoEl, 0, 0, w, h);

    // ── TODO: Replace with real face-detection (MediaPipe, etc.) ──────────
    // When MediaPipe is integrated:
    //   1. Run the face landmark model on the canvas.
    //   2. For each detected face, extract the bounding box.
    //   3. Use _ctx.getImageData(x, y, fw, fh) to crop each face.
    //   4. Return one result per face.
    // ──────────────────────────────────────────────────────────────────────

    // Stub: return full frame.
    const imageData = _ctx.getImageData(0, 0, w, h);

    TLLogger.debug('FaceDetector', `detect() stub – returning full frame ${w}×${h}`);

    return [
      {
        imageData,
        boundingBox: new DOMRect(0, 0, w, h),
        isMockBoundingBox: true, // flag so overlay knows not to draw a tight box
      },
    ];
  }

  /**
   * Release resources.  Call when protection is stopped.
   */
  function dispose() {
    _canvas = null;
    _ctx    = null;
    TLLogger.debug('FaceDetector', 'dispose() – canvas released.');
  }

  /** Returns static metadata about the detector backend. */
  function info() {
    return {
      name: 'FaceDetector',
      backend: 'stub-full-frame',
      note: 'MediaPipe integration pending.',
    };
  }

  return { detect, dispose, info };
})();

window.FaceDetector = FaceDetector;
