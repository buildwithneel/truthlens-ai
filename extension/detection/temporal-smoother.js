/**
 * TruthLens AI – Temporal Probability Smoother (Developer 2)
 *
 * Applies Exponential Moving Average (EMA) smoothing to raw deepfake probability scores.
 * Reduces jitter and high-frequency flicker across consecutive video frames.
 *
 * Algorithm:
 *   first value : smoothed = raw
 *   subsequent  : smoothed = alpha * raw + (1 - alpha) * previousSmoothed
 */

'use strict';

export class TemporalSmoother {
  /**
   * @param {object} [options]
   * @param {number} [options.alpha=0.25] - Smoothing factor in range (0, 1]. Higher = more responsive, lower = smoother.
   */
  constructor(options = {}) {
    const alphaVal = options.alpha ?? 0.25;
    if (typeof alphaVal !== 'number' || !Number.isFinite(alphaVal) || alphaVal <= 0 || alphaVal > 1) {
      throw new Error(`TemporalSmoother: alpha must be a finite number in range (0, 1]. Got: ${alphaVal}`);
    }
    this.alpha = alphaVal;
    this.value = null;
  }

  /**
   * Input validation: accepts finite numbers in range [0, 1].
   * Throws a clear validation error for invalid inputs (null, undefined, NaN, Infinity, < 0, > 1).
   *
   * @param {number} probability - Raw probability score
   * @returns {{ rawProbability: number, smoothedProbability: number }}
   */
  update(probability) {
    if (
      typeof probability !== 'number' ||
      !Number.isFinite(probability) ||
      probability < 0 ||
      probability > 1
    ) {
      throw new Error(`TemporalSmoother: probability must be a finite number between 0 and 1. Got: ${probability}`);
    }

    const raw = probability;

    if (this.value === null) {
      this.value = raw;
    } else {
      this.value = this.alpha * raw + (1 - this.alpha) * this.value;
    }

    const smoothed = parseFloat(this.value.toFixed(6));

    return {
      rawProbability: raw,
      smoothedProbability: smoothed,
    };
  }

  /**
   * Resets internal smoothed state to null.
   */
  reset() {
    this.value = null;
  }

  /**
   * Returns current smoothed probability value, or null if uninitialized.
   * @returns {number|null}
   */
  getValue() {
    return this.value !== null ? parseFloat(this.value.toFixed(6)) : null;
  }
}

/**
 * Lightweight test suite for TemporalSmoother.
 * Verifies all 6 required test scenarios.
 */
export function runTemporalSmootherTests() {
  const results = [];
  const logTest = (name, passed, info = '') => {
    results.push({ name, passed, info });
    console.log(`[TemporalSmoother Test] ${passed ? '✓ PASS' : '✗ FAIL'} - ${name} ${info}`);
  };

  try {
    // Test 1: First value
    const s1 = new TemporalSmoother({ alpha: 0.25 });
    const res1 = s1.update(0.80);
    logTest('1. First value initialization', res1.rawProbability === 0.80 && res1.smoothedProbability === 0.80);

    // Test 2: Stable values
    const res2 = s1.update(0.80);
    logTest('2. Stable values processing', res2.smoothedProbability === 0.80);

    // Test 3: Sudden spike
    const res3 = s1.update(1.00); // 0.25*1.0 + 0.75*0.8 = 0.25 + 0.6 = 0.85
    logTest('3. Sudden spike handling', res3.smoothedProbability === 0.85);

    // Test 4: Sudden drop
    const res4 = s1.update(0.20); // 0.25*0.2 + 0.75*0.85 = 0.05 + 0.6375 = 0.6875
    logTest('4. Sudden drop handling', res4.smoothedProbability === 0.6875);

    // Test 5: Reset
    s1.reset();
    const isResetValueNull = s1.getValue() === null;
    const res5 = s1.update(0.40);
    logTest('5. Reset functionality', isResetValueNull && res5.smoothedProbability === 0.40);

    // Test 6: Invalid values handling
    let invalidCount = 0;
    const invalidInputs = [null, undefined, NaN, Infinity, -0.1, 1.1, '0.5'];
    for (const input of invalidInputs) {
      try {
        s1.update(input);
      } catch (err) {
        invalidCount++;
      }
    }
    logTest('6. Invalid values validation', invalidCount === invalidInputs.length, `(${invalidCount}/${invalidInputs.length} caught)`);

    return results.every(r => r.passed);
  } catch (err) {
    console.error('[TemporalSmoother Test] Unexpected test error:', err);
    return false;
  }
}

if (typeof window !== 'undefined') {
  window.TemporalSmootherClass = TemporalSmoother;
  window.runTemporalSmootherTests = runTemporalSmootherTests;
}
