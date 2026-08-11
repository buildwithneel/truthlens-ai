/**
 * TruthLens AI – Face Cropper Module  (Sprint 6)
 *
 * Architecture:
 *   VideoSource → FaceDetector → FaceCropper → [Future: InferenceProvider]
 *
 * Responsibilities:
 *   1. Accepts HTMLVideoElement and normalized face bounding box { originX, originY, width, height }.
 *   2. Converts normalized coordinates [0, 1] to video pixel coordinates [0, videoWidth/Height].
 *   3. Adds configurable padding (default 20%) around the face (forehead, chin, cheeks).
 *   4. Clamps the crop rectangle strictly within video boundaries [0, videoWidth/Height].
 *   5. Draws the cropped face region onto ONE reusable offscreen canvas.
 *   6. Resizes the crop to configurable target dimensions (default 224 x 224).
 *   7. Measures crop latency in milliseconds (< 2 ms target).
 *
 * Strict Rules:
 *   - Uses ONE offscreen HTMLCanvasElement created in constructor. NO new canvas per frame.
 *   - NO base64 conversion.
 *   - NO Blob allocations per frame.
 *   - NO network requests / server uploads.
 *   - Reuses internal output objects to eliminate garbage collection pressure.
 */

'use strict';

const LOG = '[TruthLens]';

export class TLFaceCropper {
  /**
   * @param {object} [options]
   * @param {number} [options.targetWidth=224]   - Target output width in pixels for model input
   * @param {number} [options.targetHeight=224]  - Target output height in pixels for model input
   * @param {number} [options.padding=0.20]      - Expansion padding (0.20 = 20% extra around box)
   * @param {boolean} [options.debug=true]       - Enable debug preview mode
   */
  constructor(options = {}) {
    this._targetWidth  = options.targetWidth  ?? 224;
    this._targetHeight = options.targetHeight ?? 224;
    this._padding      = options.padding      ?? 0.20;
    this._debug        = options.debug        ?? true;

    // ONE reusable offscreen canvas created once for crop output
    this._canvas = document.createElement('canvas');
    this._canvas.width  = this._targetWidth;
    this._canvas.height = this._targetHeight;

    // 2D rendering context for the offscreen canvas (imageSmoothing enabled for quality resize)
    this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });
    this._ctx.imageSmoothingEnabled = true;
    this._ctx.imageSmoothingQuality = 'medium';

    // Reusable result object to avoid per-frame allocations
    this._result = {
      canvas: this._canvas,
      width: this._targetWidth,
      height: this._targetHeight,
      sourceRect: { x: 0, y: 0, width: 0, height: 0 },
      timestamp: 0,
      latencyMs: 0,
    };

    console.log(`${LOG} FaceCropper initialized (target: ${this._targetWidth}x${this._targetHeight}, padding: ${Math.round(this._padding * 100)}%)`);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Crop a detected face from an HTMLVideoElement and scale to target size.
   *
   * @param {HTMLVideoElement} videoEl - Live video element with active stream
   * @param {object} boundingBox       - Normalized bounding box { originX, originY, width, height }
   * @returns {object|null} { canvas, width, height, sourceRect, timestamp, latencyMs } or null if invalid
   */
  crop(videoEl, boundingBox) {
    const t0 = performance.now();

    // 1. Guard: video must have active pixel data
    if (!videoEl || videoEl.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return null;
    }

    const videoW = videoEl.videoWidth;
    const videoH = videoEl.videoHeight;

    if (videoW <= 0 || videoH <= 0) {
      return null;
    }

    // 2. Guard: valid bounding box required
    if (
      !boundingBox ||
      typeof boundingBox.originX !== 'number' ||
      typeof boundingBox.originY !== 'number' ||
      typeof boundingBox.width !== 'number' ||
      typeof boundingBox.height !== 'number' ||
      isNaN(boundingBox.originX) || isNaN(boundingBox.originY) ||
      isNaN(boundingBox.width) || isNaN(boundingBox.height) ||
      boundingBox.width <= 0 || boundingBox.height <= 0
    ) {
      return null;
    }

    // 3. Convert normalized [0, 1] coordinates → raw video pixels
    const rawX = boundingBox.originX * videoW;
    const rawY = boundingBox.originY * videoH;
    const rawW = boundingBox.width   * videoW;
    const rawH = boundingBox.height  * videoH;

    // 4. Calculate 20% expansion padding (adds space for forehead, chin, & cheeks)
    const padX = rawW * this._padding;
    const padY = rawH * this._padding;

    // 5. Compute padded crop rect & clamp strictly to video boundaries
    const cropX = Math.max(0, Math.floor(rawX - padX));
    const cropY = Math.max(0, Math.floor(rawY - padY));
    const cropW = Math.min(videoW - cropX, Math.ceil(rawW + (padX * 2)));
    const cropH = Math.min(videoH - cropY, Math.ceil(rawH + (padY * 2)));

    // 6. Guard: zero-width or zero-height crop
    if (cropW <= 0 || cropH <= 0) {
      return null;
    }

    // 7. Draw cropped face region from video onto offscreen canvas (auto-scales to 224x224)
    this._ctx.drawImage(
      videoEl,
      cropX, cropY, cropW, cropH,
      0, 0, this._targetWidth, this._targetHeight
    );

    const latencyMs = parseFloat((performance.now() - t0).toFixed(2));

    // 8. Populate reusable output object
    this._result.sourceRect.x      = cropX;
    this._result.sourceRect.y      = cropY;
    this._result.sourceRect.width  = cropW;
    this._result.sourceRect.height = cropH;
    this._result.timestamp         = t0;
    this._result.latencyMs         = latencyMs;

    return this._result;
  }

  // ── Configuration Accessors ──────────────────────────────────────────────

  setPadding(padding) {
    if (typeof padding === 'number' && padding >= 0 && padding <= 1.0) {
      this._padding = padding;
    }
  }

  setTargetSize(width, height) {
    if (width > 0 && height > 0) {
      this._targetWidth   = width;
      this._targetHeight  = height;
      this._canvas.width  = width;
      this._canvas.height = height;
      this._ctx.imageSmoothingEnabled = true;
      this._ctx.imageSmoothingQuality = 'medium';
      this._result.width  = width;
      this._result.height = height;
    }
  }

  setDebug(enabled) {
    this._debug = Boolean(enabled);
  }

  get isDebug() {
    return this._debug;
  }

  get canvas() {
    return this._canvas;
  }
}
