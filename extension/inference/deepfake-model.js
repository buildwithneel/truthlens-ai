/**
 * TruthLens AI – Deepfake Model Adapter (Developer 2)
 *
 * Abstract adapter interface for ONNX runtime model integration.
 * Real ONNX inference session loading and execution will be wired
 * when Developer 1 exports truthlens.onnx and supplies tensor specifications.
 */

'use strict';

/**
 * Model configuration specification.
 * Values default to null/safe fallbacks to avoid guessing model contracts.
 */
export const MODEL_CONFIG = {
  modelPath: null,
  inputName: null,
  inputWidth: 224,
  inputHeight: 224,
  inputType: 'float32',
  colorFormat: null,
  normalization: null,
  outputName: null,
  outputInterpretation: null,
};

/**
 * Model status states:
 *  - 'NOT_LOADED' : Initial state before load()
 *  - 'LOADING'    : Model fetch/ONNX session creation in progress
 *  - 'READY'      : ONNX session active, ready for predict()
 *  - 'ERROR'      : Load or session initialization failure
 */
export class DeepfakeModel {
  /**
   * @param {object} [config={}] - Model configuration override
   */
  constructor(config = {}) {
    this.config  = { ...MODEL_CONFIG, ...config };
    this.status  = 'NOT_LOADED';
    this.session = null;
    this.error   = null;
  }

  /**
   * Placeholder load method for ONNX model initialization.
   * Sets appropriate status states without loading fake data or downloading unverified models.
   *
   * @async
   * @returns {Promise<void>}
   */
  async load() {
    if (this.status === 'LOADING' || this.status === 'READY') {
      return;
    }

    this.status = 'LOADING';
    this.error  = null;

    try {
      if (!this.config.modelPath) {
        // Model URL / path pending from Developer 1
        this.status = 'NOT_LOADED';
        return;
      }

      // Future ONNX Runtime Web loading logic:
      // const ort = window.ort;
      // this.session = await ort.InferenceSession.create(this.config.modelPath);
      this.status = 'READY';
    } catch (err) {
      this.status = 'ERROR';
      this.error  = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  /**
   * Run inference on a 224x224 face crop HTMLCanvasElement or ImageData.
   * Throws a clear error if predict() is called before the model is READY.
   *
   * @async
   * @param {HTMLCanvasElement|ImageData} faceCanvas - 224x224 crop image
   * @returns {Promise<{ probability: number, rawOutput: any, latencyMs: number }>}
   */
  async predict(faceCanvas) {
    if (!this.isReady()) {
      throw new Error('Deepfake model is not loaded');
    }

    if (!faceCanvas) {
      throw new Error('predict() requires a valid face crop element');
    }

    // Real ONNX tensor conversion & session run will be implemented here
    // when Developer 1 specifies input tensor names and normalization constants.
    throw new Error('DeepfakeModel.predict() real inference is pending model integration from Developer 1.');
  }

  /**
   * Returns true if status is 'READY'.
   * @returns {boolean}
   */
  isReady() {
    return this.status === 'READY';
  }

  /**
   * Returns current status state string ('NOT_LOADED' | 'LOADING' | 'READY' | 'ERROR').
   * @returns {string}
   */
  getStatus() {
    return this.status;
  }

  /**
   * Returns error message if status is 'ERROR', or null.
   * @returns {string|null}
   */
  getError() {
    return this.error;
  }
}

if (typeof window !== 'undefined') {
  window.DeepfakeModelClass = DeepfakeModel;
  window.MODEL_CONFIG_OBJ   = MODEL_CONFIG;
}
