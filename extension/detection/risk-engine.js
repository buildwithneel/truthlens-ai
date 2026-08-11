/**
 * TruthLens AI – Risk Engine (Developer 2)
 *
 * Evaluates deepfake probability scores into normalized risk results:
 *   SAFE (< 0.35)
 *   SUSPICIOUS (0.35 <= prob < 0.65)
 *   HIGH_RISK (>= 0.65)
 *
 * IMPORTANT: These thresholds are DEVELOPMENT DEFAULTS ONLY and are NOT
 * validated deepfake detection thresholds. Accuracy is not claimed.
 */

'use strict';

export class RiskEngine {
  /**
   * @param {object} [options]
   * @param {number} [options.safeThreshold=0.35]
   * @param {number} [options.suspiciousThreshold=0.65]
   */
  constructor(options = {}) {
    this.safeThreshold       = options.safeThreshold       ?? 0.35;
    this.suspiciousThreshold = options.suspiciousThreshold ?? 0.65;
  }

  /**
   * Evaluate a probability score and return normalized risk result.
   *
   * @param {number} probability - Deepfake probability float [0.0 - 1.0]
   * @param {object} [options={}] - Additional evaluation parameters
   * @param {number|null} [options.confidence=null] - Model confidence score (null if not provided by model)
   * @param {'LIVE_MODEL'|'TEST'|'UNKNOWN'} [options.source='UNKNOWN'] - Prediction origin source tag
   * @returns {{ probability: number, label: 'SAFE'|'SUSPICIOUS'|'HIGH_RISK', confidence: number|null, source: string, timestamp: number }}
   */
  evaluate(probability, options = {}) {
    if (
      typeof probability !== 'number' ||
      !Number.isFinite(probability) ||
      probability < 0 ||
      probability > 1
    ) {
      throw new Error(`RiskEngine: probability must be a finite number between 0 and 1. Got: ${probability}`);
    }

    const prob = parseFloat(probability.toFixed(4));

    let label;
    if (prob < this.safeThreshold) {
      label = 'SAFE';
    } else if (prob < this.suspiciousThreshold) {
      label = 'SUSPICIOUS';
    } else {
      label = 'HIGH_RISK';
    }

    const confVal = (typeof options.confidence === 'number' && Number.isFinite(options.confidence))
      ? parseFloat(Math.min(1.0, Math.max(0.0, options.confidence)).toFixed(4))
      : null;

    const sourceVal = typeof options === 'string' ? options : (options.source ?? 'UNKNOWN');

    return {
      probability: prob,
      label,
      confidence: confVal,
      source: sourceVal,
      timestamp: Date.now(),
    };
  }

  /**
   * Reset risk engine state.
   */
  reset() {}

  getThresholds() {
    return { safeThreshold: this.safeThreshold, suspiciousThreshold: this.suspiciousThreshold };
  }
}

// Alias for backwards compatibility with TLRiskEngine call-sites if needed
export class TLRiskEngine extends RiskEngine {
  constructor(options = {}) {
    super({
      safeThreshold: options.lowThreshold ?? options.safeThreshold ?? 0.35,
      suspiciousThreshold: options.highThreshold ?? options.suspiciousThreshold ?? 0.65,
    });
  }

  evaluate(probability, confidence = null, source = 'TEST') {
    if (typeof probability !== 'number' || !Number.isFinite(probability)) {
      return null;
    }
    const opts = (typeof confidence === 'object' && confidence !== null)
      ? confidence
      : { confidence: typeof confidence === 'number' ? confidence : null, source: typeof source === 'string' ? source : 'TEST' };
    return super.evaluate(probability, opts);
  }
}

if (typeof window !== 'undefined') {
  window.RiskEngineClass   = RiskEngine;
  window.TLRiskEngineClass = TLRiskEngine;
}
