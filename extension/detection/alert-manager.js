/**
 * TruthLens AI – Alert Manager (Developer 2)
 *
 * Manages visual and audio warning alerts based on risk engine evaluations.
 * Completely independent of DOM manipulation and camera hardware.
 *
 * Audio Alert Rules:
 *  - Uses Web Audio API synthesised tones (no external audio files, no mic permission).
 *  - Respects browser autoplay policy: audio is only active after enableAudio() call.
 *  - Enforces a 5-second cooldown between audio warning alerts to prevent frame-level beeping.
 *  - Fails gracefully if Web Audio API is unavailable or blocked by the browser.
 */

'use strict';

export class AlertManager {
  /**
   * @param {object} [options]
   * @param {number} [options.cooldownMs=5000] - Minimum milliseconds between consecutive audio alerts
   */
  constructor(options = {}) {
    this.cooldownMs    = options.cooldownMs ?? 5000;
    this.lastAlertTime = 0;
    this.lastLabel     = 'NO_FACE';
    this.audioEnabled  = false;
    this._audioCtx     = null;
  }

  /**
   * Enable audio warning alerts (must be called after explicit user interaction).
   */
  enableAudio() {
    this.audioEnabled = true;
    if (typeof window !== 'undefined') {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx && !this._audioCtx) {
          this._audioCtx = new AudioCtx();
        }
        if (this._audioCtx && this._audioCtx.state === 'suspended') {
          this._audioCtx.resume().catch(() => {});
        }
      } catch (_) {
        // Safe fallback
      }
    }
    return true;
  }

  /**
   * Disable audio warning alerts.
   */
  disableAudio() {
    this.audioEnabled = false;
    return false;
  }

  /**
   * Evaluate deepfake risk result and return alert decisions.
   *
   * @param {object|string|null} result - DeepfakeResult object or status string
   * @returns {{ visualAlert: boolean, audioAlert: boolean, reason: string }}
   */
  evaluate(result) {
    const label = (result && typeof result === 'object')
      ? (result.label ?? 'UNKNOWN')
      : (typeof result === 'string' ? result : 'NO_FACE');

    const now = Date.now();

    if (label === 'SAFE' || label === 'NO_FACE') {
      this.lastLabel = label;
      return {
        visualAlert: false,
        audioAlert: false,
        reason: label,
      };
    }

    if (label === 'SUSPICIOUS') {
      this.lastLabel = label;
      return {
        visualAlert: true,
        audioAlert: false,
        reason: 'SUSPICIOUS',
      };
    }

    if (label === 'HIGH_RISK') {
      let audioTriggered = false;
      let reason = 'HIGH_RISK';

      if (!this.audioEnabled) {
        reason = 'HIGH_RISK_AUDIO_DISABLED';
      } else if (now - this.lastAlertTime < this.cooldownMs) {
        reason = 'HIGH_RISK_COOLDOWN';
      } else {
        // Cooldown passed & audio enabled → attempt Web Audio alert beep
        audioTriggered = this._playBeep();
        if (audioTriggered) {
          this.lastAlertTime = now;
          reason = 'HIGH_RISK_AUDIO_TRIGGERED';
        } else {
          reason = 'HIGH_RISK_AUDIO_FAILED';
        }
      }

      this.lastLabel = label;
      return {
        visualAlert: true,
        audioAlert: audioTriggered,
        reason,
      };
    }

    // Default fallback for UNKNOWN or unspecified states
    this.lastLabel = label;
    return {
      visualAlert: false,
      audioAlert: false,
      reason: `UNKNOWN_STATE (${label})`,
    };
  }

  /**
   * Reset alert state and cooldown timers.
   */
  reset() {
    this.lastAlertTime = 0;
    this.lastLabel     = 'NO_FACE';
  }

  /**
   * Private helper to synthesize a warning tone using Web Audio API.
   * @private
   * @returns {boolean} True if tone successfully scheduled
   */
  _playBeep() {
    if (!this.audioEnabled || typeof window === 'undefined') return false;

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return false;

      if (!this._audioCtx) {
        this._audioCtx = new AudioCtx();
      }

      if (this._audioCtx.state === 'suspended') {
        this._audioCtx.resume().catch(() => {});
      }

      const osc  = this._audioCtx.createOscillator();
      const gain = this._audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, this._audioCtx.currentTime); // 880Hz warning tone

      gain.gain.setValueAtTime(0.15, this._audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this._audioCtx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(this._audioCtx.destination);

      osc.start();
      osc.stop(this._audioCtx.currentTime + 0.35);

      return true;
    } catch (err) {
      // Fail gracefully without interrupting detection loop
      return false;
    }
  }
}

if (typeof window !== 'undefined') {
  window.AlertManagerClass = AlertManager;
}
