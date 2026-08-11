/**
 * TruthLens AI – Risk Engine
 *
 * Converts a raw inference result (produced by InferenceProvider.predict())
 * into a human-readable risk level: LOW | SUSPICIOUS | HIGH.
 *
 * IMPORTANT: These thresholds are NOT scientifically validated.
 * They are placeholder values for the prototype phase.
 * Developer 1 will calibrate thresholds once the real model is trained.
 *
 * Pipeline position:
 *   InferenceProvider → RiskEngine → Overlay / Popup
 */

'use strict';

const RiskEngine = (() => {
  // ── Configurable thresholds (tweak without touching call-sites) ─────────
  const THRESHOLDS = {
    /**
     * risk score  < LOW_MAX   → status = "LOW"
     * risk score  < HIGH_MIN  → status = "SUSPICIOUS"
     * risk score >= HIGH_MIN  → status = "HIGH"
     *
     * All values are in the range [0, 1].
     * NOTE: These are PROTOTYPE placeholders, not validated cut-offs.
     */
    LOW_MAX:  0.35,
    HIGH_MIN: 0.65,
  };

  // ── Status constants ────────────────────────────────────────────────────
  const STATUS = {
    LOW:        'LOW',
    SUSPICIOUS: 'SUSPICIOUS',
    HIGH:       'HIGH',
    UNKNOWN:    'UNKNOWN',
  };

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Converts a raw inference result into a RiskResult.
   *
   * @param {object} inferenceResult
   *   Expected shape: { risk: number, status: string, modelVersion: string }
   *   `risk` must be in [0, 1].
   *
   * @returns {RiskResult}
   *   {
   *     risk:         number,   // 0–1, forwarded from inference
   *     riskPercent:  number,   // 0–100, rounded integer
   *     status:       string,   // LOW | SUSPICIOUS | HIGH | UNKNOWN
   *     modelVersion: string,
   *   }
   */
  function evaluate(inferenceResult) {
    if (!inferenceResult || typeof inferenceResult.risk !== 'number') {
      TLLogger.warn('RiskEngine', 'evaluate() called with invalid result:', inferenceResult);
      return {
        risk:         0,
        riskPercent:  0,
        status:       STATUS.UNKNOWN,
        modelVersion: inferenceResult?.modelVersion ?? 'unknown',
      };
    }

    const { risk, modelVersion } = inferenceResult;
    const clamped = Math.min(1, Math.max(0, risk));

    let status;
    if (clamped < THRESHOLDS.LOW_MAX) {
      status = STATUS.LOW;
    } else if (clamped < THRESHOLDS.HIGH_MIN) {
      status = STATUS.SUSPICIOUS;
    } else {
      status = STATUS.HIGH;
    }

    TLLogger.debug('RiskEngine', `risk=${clamped.toFixed(3)} → ${status}`);

    return {
      risk:         clamped,
      riskPercent:  Math.round(clamped * 100),
      status,
      modelVersion: modelVersion ?? 'unknown',
    };
  }

  /**
   * Update thresholds at runtime (e.g. loaded from chrome.storage).
   * Caller is responsible for validating values.
   *
   * @param {{ lowMax?: number, highMin?: number }} opts
   */
  function setThresholds({ lowMax, highMin } = {}) {
    if (typeof lowMax === 'number')  THRESHOLDS.LOW_MAX  = lowMax;
    if (typeof highMin === 'number') THRESHOLDS.HIGH_MIN = highMin;
    TLLogger.info('RiskEngine', 'Thresholds updated:', { ...THRESHOLDS });
  }

  /** Returns a shallow copy of the current thresholds. */
  function getThresholds() {
    return { ...THRESHOLDS };
  }

  return { evaluate, setThresholds, getThresholds, STATUS };
})();

window.RiskEngine = RiskEngine;
