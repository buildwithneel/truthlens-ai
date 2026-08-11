/**
 * TruthLens AI – Risk Engine (Sprint 7)
 *
 * Converts deepfake probability scores into canonical risk evaluation results:
 *   SAFE (< 0.35)
 *   SUSPICIOUS (0.35 <= prob < 0.65)
 *   HIGH_RISK (>= 0.65)
 *
 * NOTE: These are temporary UI thresholds only for developer calibration.
 */

'use strict';

export class TLRiskEngine {
  /**
   * @param {object} [options]
   * @param {number} [options.lowThreshold=0.35]
   * @param {number} [options.highThreshold=0.65]
   */
  constructor(options = {}) {
    this.lowThreshold  = options.lowThreshold  ?? 0.35;
    this.highThreshold = options.highThreshold ?? 0.65;
  }

  /**
   * Evaluate a model output probability score.
   *
   * @param {number} probability - Deepfake probability float [0.0 - 1.0]
   * @param {number} [confidence=1.0] - Model confidence float [0.0 - 1.0]
   * @returns {{ probability: number, label: 'SAFE'|'SUSPICIOUS'|'HIGH_RISK', confidence: number, timestamp: number }|null}
   */
  evaluate(probability, confidence = 1.0) {
    if (typeof probability !== 'number' || isNaN(probability)) {
      return null;
    }

    const prob = Math.min(1.0, Math.max(0.0, probability));
    const conf = Math.min(1.0, Math.max(0.0, confidence));

    let label;
    if (prob < this.lowThreshold) {
      label = 'SAFE';
    } else if (prob < this.highThreshold) {
      label = 'SUSPICIOUS';
    } else {
      label = 'HIGH_RISK';
    }

    return {
      probability: parseFloat(prob.toFixed(4)),
      label,
      confidence:  parseFloat(conf.toFixed(4)),
      timestamp:   Date.now(),
    };
  }

  getThresholds() {
    return { lowThreshold: this.lowThreshold, highThreshold: this.highThreshold };
  }
}

if (typeof window !== 'undefined') {
  window.TLRiskEngineClass = TLRiskEngine;
}
