/**
 * TruthLens AI – Inference Provider
 *
 * This module is the ABSTRACTION LAYER between the pipeline and the
 * actual deepfake detection model.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  Pipeline usage:                                                        │
 * │    const result = await InferenceProvider.predict(faceImageData);       │
 * │                                                                         │
 * │  The pipeline NEVER imports a concrete provider directly.               │
 * │  Swap providers by calling InferenceProvider.use(newProvider).          │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Available providers
 * ───────────────────
 *  MockInferenceProvider   ← active now (prototype phase)
 *  ONNXInferenceProvider   ← TODO: Developer 1 will supply truthlens.onnx;
 *                             Developer 2 will wire it in here.
 *
 * IMPORTANT: MockInferenceProvider does NOT perform real deepfake detection.
 * All scores are randomly generated for UI/pipeline testing ONLY.
 */

'use strict';

// ─── MockInferenceProvider ──────────────────────────────────────────────────

/**
 * Mock provider – no model loaded, returns plausible-looking random output.
 *
 * Output shape (matches the contract that ONNXInferenceProvider must follow):
 * {
 *   risk:         number,   // float in [0, 1]
 *   status:       string,   // "LOW" | "SUSPICIOUS" | "HIGH"  (rough hint only)
 *   modelVersion: string,   // identifier for the provider
 *   latencyMs:    number,   // simulated latency in milliseconds
 * }
 *
 * ⚠️  NOT real deepfake detection. Scores are random.
 */
const MockInferenceProvider = (() => {
  const MODEL_VERSION = 'mock-v0';

  /**
   * Simulates inference on a face image.
   *
   * @param {ImageData|HTMLCanvasElement|null} _faceImage  – ignored by mock
   * @returns {Promise<InferenceResult>}
   */
  async function predict(_faceImage) {
    // Simulate variable model latency (20–80 ms).
    const simulatedLatencyMs = 20 + Math.random() * 60;
    await _sleep(simulatedLatencyMs);

    // Random risk score – NOT a real prediction.
    const risk = parseFloat(Math.random().toFixed(4));

    // Derive a rough status label (RiskEngine will do the authoritative one).
    let status;
    if (risk < 0.35)      status = 'LOW';
    else if (risk < 0.65) status = 'SUSPICIOUS';
    else                  status = 'HIGH';

    TLLogger.debug('MockInferenceProvider', `predict() → risk=${risk}, status=${status}`);

    return {
      risk,
      status,
      modelVersion: MODEL_VERSION,
      latencyMs:    Math.round(simulatedLatencyMs),
    };
  }

  /** Returns metadata about this provider. */
  function info() {
    return {
      name: 'MockInferenceProvider',
      version: MODEL_VERSION,
      description: 'Random mock scores – prototype only, no real detection.',
      isReal: false,
    };
  }

  async function _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  return { predict, info };
})();

// ─── ONNXInferenceProvider (stub – wired by Developer 2 once model arrives) ─

/**
 * Stub for the real ONNX-based provider.
 *
 * Developer 1 will export truthlens.onnx.
 * Developer 2 will:
 *   1. Load it via onnxruntime-web.
 *   2. Implement predict() to run a real inference session.
 *   3. Call InferenceProvider.use(ONNXInferenceProvider) to activate it.
 *
 * The stub exists so the shape is documented and the switch-over is a
 * one-liner, not a refactor.
 */
const ONNXInferenceProvider = (() => {
  const MODEL_VERSION = 'onnx-v0';
  let _session = null;

  /**
   * Load the ONNX model.  Must be called before predict().
   * @param {string} modelUrl  – chrome.runtime.getURL('models/truthlens.onnx')
   */
  async function load(modelUrl) {
    // TODO: Developer 2 – implement once onnxruntime-web is bundled.
    // Example:
    //   const ort = window.ort;  // loaded via <script> in manifest web_accessible_resources
    //   _session = await ort.InferenceSession.create(modelUrl);
    TLLogger.warn('ONNXInferenceProvider', 'load() stub – model not yet integrated.');
    throw new Error('ONNXInferenceProvider.load() is not yet implemented.');
  }

  /**
   * Run inference on a face crop.
   * @param {ImageData|HTMLCanvasElement} faceImage
   * @returns {Promise<InferenceResult>}
   */
  async function predict(faceImage) {
    if (!_session) throw new Error('ONNXInferenceProvider: call load() first.');
    // TODO: Developer 2 – preprocess faceImage → Float32Array tensor, run session.
    throw new Error('ONNXInferenceProvider.predict() is not yet implemented.');
  }

  function info() {
    return {
      name: 'ONNXInferenceProvider',
      version: MODEL_VERSION,
      description: 'Real ONNX inference using truthlens.onnx (Developer 1 model).',
      isReal: true,
    };
  }

  return { load, predict, info };
})();

// ─── InferenceProvider (active facade) ─────────────────────────────────────

/**
 * The single object the pipeline interacts with.
 *
 * Default: MockInferenceProvider.
 * Switch:  InferenceProvider.use(ONNXInferenceProvider)
 */
const InferenceProvider = (() => {
  let _active = MockInferenceProvider;

  /**
   * Replace the active provider.
   * @param {object} provider  – must expose { predict, info }
   */
  function use(provider) {
    if (typeof provider?.predict !== 'function') {
      throw new TypeError('InferenceProvider.use(): provider must expose predict().');
    }
    _active = provider;
    TLLogger.info('InferenceProvider', 'Provider switched to:', provider.info?.()?.name ?? 'unknown');
  }

  /**
   * Run inference on a face image (delegates to the active provider).
   *
   * @param {ImageData|HTMLCanvasElement|null} faceImage
   * @returns {Promise<InferenceResult>}
   */
  async function predict(faceImage) {
    return _active.predict(faceImage);
  }

  /** Returns metadata about the currently active provider. */
  function activeInfo() {
    return _active.info?.() ?? { name: 'unknown' };
  }

  return { use, predict, activeInfo };
})();

// ── Exports ──────────────────────────────────────────────────────────────────
window.InferenceProvider     = InferenceProvider;
window.MockInferenceProvider = MockInferenceProvider;
window.ONNXInferenceProvider = ONNXInferenceProvider;
