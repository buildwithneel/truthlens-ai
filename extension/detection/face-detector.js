/**
 * TruthLens AI – Face Detector  (Sprint 4 – MediaPipe FaceDetector)
 *
 * Uses:  @mediapipe/tasks-vision  (FaceDetector + FilesetResolver)
 * Bundled LOCALLY in extension/lib/ to avoid Chrome Extension CSP issues.
 *
 * ROOT CAUSE of the "loading…" bug:
 *   Chrome Extension MV3 CSP is  `script-src 'self' 'wasm-unsafe-eval'`
 *   The old code used  `import('https://cdn.jsdelivr.net/...')`  which is
 *   a remote URL — NOT 'self' — so the dynamic import() promise HANGS
 *   silently without ever resolving or rejecting, leaving the UI stuck
 *   at "loading…" forever.
 *
 * Fix:
 *   1. vision_bundle.mjs is now in extension/lib/ (static import, 'self').
 *   2. WASM glue JS + binary are in extension/lib/wasm/ ('self').
 *      MediaPipe loads the glue JS via a <script> tag — if src is
 *      chrome-extension://…/lib/wasm/..., CSP allows it ('self').
 *   3. The model .tflite is fetched from Google Storage CDN via fetch().
 *      fetch() is not restricted by script-src CSP.
 *
 * Pipeline position:
 *   VideoSource → FaceDetector → [Future: InferenceProvider → RiskEngine]
 *
 * Public API
 * ──────────
 *   const fd = new TLFaceDetector();
 *   await fd.initialize();                        // loads WASM + model
 *   const result = fd.detect(videoEl, timestamp);  // sync, VIDEO mode
 *   fd.dispose();                                  // releases detector
 *
 * What this module does NOT do:
 *   - Does NOT call getUserMedia.
 *   - Does NOT draw anything (caller is responsible for rendering).
 *   - Does NOT run inference / deepfake classification.
 *   - Does NOT upload frames.
 */

// ── Local imports ───────────────────────────────────────────────────────────
// Static import from the locally bundled copy.
// This is 'self' under MV3 CSP → allowed.
import {
  FaceDetector as MPFaceDetector,
  FilesetResolver,
} from '../lib/vision_bundle.mjs';

// ── Constants ───────────────────────────────────────────────────────────────

const LOG = '[TruthLens]';

/**
 * WASM path — points to the LOCAL copy inside the extension.
 * FilesetResolver will load  vision_wasm_internal.js  and
 * vision_wasm_internal.wasm  from this directory via a <script> tag
 * and fetch() respectively.  Both are 'self' URLs → CSP-safe.
 *
 * chrome.runtime.getURL() produces: chrome-extension://<id>/lib/wasm
 */
const WASM_LOCAL_PATH = chrome.runtime.getURL('lib/wasm');

/** Model is fetched via fetch() — not script-loaded — so CDN is CSP-safe. */
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/' +
  'blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

/** Initialization timeout — catch silent hangs like the CDN import bug. */
const INIT_TIMEOUT_MS = 30_000;

// ─── Class ──────────────────────────────────────────────────────────────────

export class TLFaceDetector {
  constructor() {
    /** @type {import('@mediapipe/tasks-vision').FaceDetector|null} */
    this._detector = null;

    /** True once initialize() has completed successfully. */
    this._ready = false;

    /** Monotonically increasing timestamp guard for VIDEO mode. */
    this._lastTs = -1;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Load the MediaPipe WASM runtime and BlazeFace short-range model.
   * Call once before the first detect().
   *
   * Every substep is logged so hangs can be diagnosed.
   */
  async initialize() {
    console.log(`${LOG} Starting detector initialization`);

    // Wrap in a timeout so we catch silent hangs (like the CSP bug).
    const work = this._doInitialize();
    const timeout = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Initialization timed out after ${INIT_TIMEOUT_MS / 1000}s`)),
        INIT_TIMEOUT_MS,
      ),
    );

    try {
      await Promise.race([work, timeout]);
    } catch (err) {
      console.error(`${LOG} FACE DETECTOR ERROR`);
      console.error(`${LOG}   name:    ${err.name}`);
      console.error(`${LOG}   message: ${err.message}`);
      console.error(`${LOG}   stack:   ${err.stack ?? '(none)'}`);
      throw err;
    }
  }

  /** Internal init — separated so the timeout wrapper is clean. */
  async _doInitialize() {
    // ── 1. Resolve WASM binaries ──────────────────────────────────────────
    console.log(`${LOG} Loading MediaPipe dependency`);
    console.log(`${LOG}   WASM path: ${WASM_LOCAL_PATH}`);

    let vision;
    try {
      vision = await FilesetResolver.forVisionTasks(WASM_LOCAL_PATH);
    } catch (err) {
      throw new Error(`WASM resolution failed: ${err.message}`);
    }

    console.log(`${LOG} MediaPipe dependency loaded`);

    // ── 2. Create FaceDetector in VIDEO mode ──────────────────────────────
    console.log(`${LOG} Creating FaceDetector`);
    console.log(`${LOG}   Model URL: ${MODEL_URL}`);

    try {
      this._detector = await MPFaceDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
          delegate: 'GPU',  // auto-falls back to CPU
        },
        runningMode: 'VIDEO',
        minDetectionConfidence: 0.5,
        minSuppressionThreshold: 0.3,
      });
    } catch (err) {
      throw new Error(`FaceDetector creation failed: ${err.message}`);
    }

    console.log(`${LOG} FaceDetector created`);

    this._ready = true;
    this._lastTs = -1;

    console.log(`${LOG} FaceDetector ready`);
    console.log(`${LOG} Face detector initialized`);
  }

  /**
   * Detect faces in a single video frame.
   *
   * Synchronous — MediaPipe VIDEO mode WASM runs on the main thread.
   * Call inside your rVFC / RAF tick.
   *
   * @param  {HTMLVideoElement} videoEl
   * @param  {number}           timestamp  performance.now()
   * @returns {{ timestamp, faceCount, latencyMs, faces[] }}
   */
  detect(videoEl, timestamp) {
    if (!this._ready || !this._detector) {
      return { timestamp, faceCount: 0, latencyMs: 0, faces: [] };
    }

    if (!videoEl || videoEl.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return { timestamp, faceCount: 0, latencyMs: 0, faces: [] };
    }

    // Timestamps must be strictly increasing for VIDEO mode.
    const ts = Math.max(timestamp, this._lastTs + 1);
    this._lastTs = ts;

    const t0 = performance.now();

    let rawResult;
    try {
      rawResult = this._detector.detectForVideo(videoEl, ts);
    } catch (err) {
      console.warn(`${LOG} detectForVideo error:`, err.message);
      return { timestamp, faceCount: 0, latencyMs: 0, faces: [] };
    }

    const latencyMs = parseFloat((performance.now() - t0).toFixed(1));

    // Map MediaPipe result → our canonical shape.
    // rawResult.detections[i].boundingBox has pixel coordinates
    // relative to the video's natural width/height.
    const videoW = videoEl.videoWidth;
    const videoH = videoEl.videoHeight;

    const faces = (rawResult.detections ?? []).map((det) => {
      const bb = det.boundingBox ?? {};
      return {
        boundingBox: {
          // Normalised [0, 1] so callers are resolution-independent.
          originX: (bb.originX ?? 0) / videoW,
          originY: (bb.originY ?? 0) / videoH,
          width:   (bb.width   ?? 0) / videoW,
          height:  (bb.height  ?? 0) / videoH,
        },
        score: det.categories?.[0]?.score ?? 0,
      };
    });

    const faceCount = faces.length;

    if (faceCount > 0) {
      console.log(`${LOG} Face detected`);
      console.log(`${LOG} Faces: ${faceCount}`);
      console.log(`${LOG} Detection latency: ${latencyMs} ms`);
    }

    return { timestamp, faceCount, latencyMs, faces };
  }

  /**
   * Release the MediaPipe detector and reset state.
   */
  dispose() {
    if (this._detector) {
      try { this._detector.close(); } catch (_) { /* ignore */ }
      this._detector = null;
    }
    this._ready = false;
    this._lastTs = -1;
    console.log(`${LOG} Face detector disposed`);
  }

  /** Whether initialize() has completed successfully. */
  get isReady() { return this._ready; }
}
