/**
 * TruthLens AI – Session Metrics Tracker (Developer 2)
 *
 * Tracks real-time processing statistics, detection/inference latencies,
 * risk classification counts, and P95 latency distributions over a session lifecycle.
 */

'use strict';

export class SessionMetrics {
  constructor() {
    this.reset();
  }

  /**
   * Start or restart a metrics tracking session.
   */
  start() {
    this.reset();
    this.startTime  = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.isTracking = true;
  }

  /**
   * Record a processed video frame.
   */
  recordFrame() {
    this.framesProcessed++;
  }

  /**
   * Record a dropped video frame.
   */
  recordDroppedFrame() {
    this.framesDropped++;
  }

  /**
   * Record a detected face event.
   */
  recordFaceDetected() {
    this.facesDetected++;
  }

  /**
   * Record deepfake model inference execution latency in milliseconds.
   * @param {number} latencyMs
   */
  recordInference(latencyMs) {
    if (typeof latencyMs === 'number' && Number.isFinite(latencyMs) && latencyMs >= 0) {
      this.modelInferences++;
      this.inferenceLatencies.push(parseFloat(latencyMs.toFixed(2)));
    }
  }

  /**
   * Record face detector execution latency in milliseconds.
   * @param {number} latencyMs
   */
  recordDetection(latencyMs) {
    if (typeof latencyMs === 'number' && Number.isFinite(latencyMs) && latencyMs >= 0) {
      this.detectionLatencies.push(parseFloat(latencyMs.toFixed(2)));
    }
  }

  /**
   * Record risk evaluation result count.
   * @param {'SAFE'|'SUSPICIOUS'|'HIGH_RISK'|string} label
   */
  recordRisk(label) {
    if (label === 'SAFE') {
      this.safeCount++;
    } else if (label === 'SUSPICIOUS') {
      this.suspiciousCount++;
    } else if (label === 'HIGH_RISK') {
      this.highRiskCount++;
    }
  }

  /**
   * Reset all counters, timestamps, and latency arrays.
   */
  reset() {
    this.framesProcessed    = 0;
    this.framesDropped      = 0;
    this.facesDetected      = 0;
    this.modelInferences    = 0;
    this.inferenceLatencies = [];
    this.detectionLatencies = [];
    this.safeCount          = 0;
    this.suspiciousCount    = 0;
    this.highRiskCount      = 0;
    this.startTime          = null;
    this.isTracking         = false;
  }

  /**
   * Calculate and return a detailed session metrics snapshot.
   *
   * @returns {{
   *   elapsedMs: number,
   *   currentFPS: number|null,
   *   averageInferenceLatency: number|null,
   *   p95InferenceLatency: number|null,
   *   averageDetectionLatency: number|null,
   *   framesProcessed: number,
   *   framesDropped: number,
   *   facesDetected: number,
   *   modelInferences: number,
   *   safeCount: number,
   *   suspiciousCount: number,
   *   highRiskCount: number,
   *   startTime: number|null
   * }}
   */
  getSnapshot() {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const elapsedMs = (this.startTime !== null && this.isTracking)
      ? Math.max(0, Math.round(now - this.startTime))
      : 0;

    let currentFPS = null;
    if (elapsedMs > 0 && this.framesProcessed > 0) {
      currentFPS = parseFloat((this.framesProcessed / (elapsedMs / 1000)).toFixed(1));
    }

    let averageInferenceLatency = null;
    let p95InferenceLatency     = null;
    if (this.inferenceLatencies.length > 0) {
      const sum = this.inferenceLatencies.reduce((acc, v) => acc + v, 0);
      averageInferenceLatency = parseFloat((sum / this.inferenceLatencies.length).toFixed(2));
      p95InferenceLatency     = this._calculatePercentile(this.inferenceLatencies, 0.95);
    }

    let averageDetectionLatency = null;
    if (this.detectionLatencies.length > 0) {
      const sum = this.detectionLatencies.reduce((acc, v) => acc + v, 0);
      averageDetectionLatency = parseFloat((sum / this.detectionLatencies.length).toFixed(2));
    }

    return {
      elapsedMs,
      currentFPS,
      averageInferenceLatency,
      p95InferenceLatency,
      averageDetectionLatency,
      framesProcessed:    this.framesProcessed,
      framesDropped:      this.framesDropped,
      facesDetected:      this.facesDetected,
      modelInferences:    this.modelInferences,
      safeCount:          this.safeCount,
      suspiciousCount:    this.suspiciousCount,
      highRiskCount:      this.highRiskCount,
      startTime:          this.startTime,
    };
  }

  /**
   * Lightweight percentile calculation (nearest-rank method).
   *
   * @private
   * @param {number[]} values - Array of numeric measurements
   * @param {number} percentile - Target percentile in range [0, 1] (e.g. 0.95)
   * @returns {number|null}
   */
  _calculatePercentile(values, percentile) {
    if (!values || values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentile * sorted.length) - 1));
    return parseFloat(sorted[idx].toFixed(2));
  }
}

if (typeof window !== 'undefined') {
  window.SessionMetricsClass = SessionMetrics;
}
