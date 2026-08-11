/**
 * TruthLens AI – Risk Overlay Component (Sprint 7)
 *
 * Renders the real-time deepfake risk overlay over the active video stream.
 * Supports non-destructive in-place DOM updates for zero per-frame DOM thrashing.
 */

'use strict';

export class TLRiskOverlay {
  /**
   * @param {HTMLElement|string} container - Parent element or query selector
   */
  constructor(container) {
    this.container = typeof container === 'string'
      ? document.querySelector(container)
      : container;

    this.overlayEl   = null;
    this.badgeEl     = null;
    this.statusEl    = null;
    this.detailsEl   = null;
    this.probEl      = null;
    this.confEl      = null;
    this.demoTagEl   = null;

    this._init();
  }

  _init() {
    if (!this.container) return;

    // Check if overlay element is already present in DOM
    let existing = this.container.querySelector('.tl-risk-overlay');
    if (existing) {
      this.overlayEl = existing;
    } else {
      this.overlayEl = document.createElement('div');
      this.overlayEl.className = 'tl-risk-overlay hidden';
      this.overlayEl.innerHTML = `
        <div class="tl-risk-badge" id="tl-risk-badge">
          <span class="tl-risk-demo-tag hidden" id="tl-risk-demo-tag">DEMO / TEST MODE</span>
          <span class="tl-risk-status" id="tl-risk-status">WAITING FOR MODEL</span>
          <span class="tl-risk-sub hidden" id="tl-risk-sub">Simulated result — not model output</span>
          <div class="tl-risk-details" id="tl-risk-details">
            <span class="tl-risk-metric">Manipulation probability: <strong id="tl-risk-prob">--%</strong></span>
            <span class="tl-risk-metric">Confidence: <strong id="tl-risk-conf">--%</strong></span>
          </div>
        </div>
      `;
      this.container.appendChild(this.overlayEl);
    }

    this.badgeEl   = this.overlayEl.querySelector('#tl-risk-badge');
    this.statusEl  = this.overlayEl.querySelector('#tl-risk-status');
    this.subEl     = this.overlayEl.querySelector('#tl-risk-sub');
    this.detailsEl = this.overlayEl.querySelector('#tl-risk-details');
    this.probEl    = this.overlayEl.querySelector('#tl-risk-prob');
    this.confEl    = this.overlayEl.querySelector('#tl-risk-conf');
    this.demoTagEl = this.overlayEl.querySelector('#tl-risk-demo-tag');
  }

  /**
   * Update the overlay state in-place without DOM reconstruction.
   *
   * @param {object|string|null} result - DeepfakeResult object, status string, or null
   * @param {boolean} [isDemo=false] - Whether this update is a developer manual test value
   * @param {boolean} [isRealModel=false] - Whether a real model generated this prediction
   */
  update(result, isDemo = false, isRealModel = false) {
    if (!this.overlayEl) return;

    // Toggle demo tag badge and subtitle
    if (isDemo) {
      if (this.demoTagEl) this.demoTagEl.classList.remove('hidden');
      if (this.subEl) {
        this.subEl.textContent = 'Simulated result — not model output';
        this.subEl.classList.remove('hidden');
      }
      this.overlayEl.classList.add('is-demo');
    } else {
      if (this.demoTagEl) this.demoTagEl.classList.add('hidden');
      if (this.subEl) this.subEl.classList.add('hidden');
      this.overlayEl.classList.remove('is-demo');
    }

    if (result === 'NO_FACE') {
      this.overlayEl.classList.remove('hidden');
      if (this.badgeEl) this.badgeEl.className = 'tl-risk-badge state-no-face';
      if (this.statusEl) this.statusEl.textContent = 'No face detected';
      if (this.detailsEl) this.detailsEl.style.display = 'none';
      return;
    }

    if (result === 'MODEL_LOADING') {
      this.overlayEl.classList.remove('hidden');
      if (this.badgeEl) this.badgeEl.className = 'tl-risk-badge state-loading';
      if (this.statusEl) this.statusEl.textContent = 'Loading AI Model…';
      if (this.detailsEl) this.detailsEl.style.display = 'none';
      return;
    }

    if (result === 'MODEL_ERROR') {
      this.overlayEl.classList.remove('hidden');
      if (this.badgeEl) this.badgeEl.className = 'tl-risk-badge state-error';
      if (this.statusEl) this.statusEl.textContent = '⚠️ Model Error';
      if (this.detailsEl) this.detailsEl.style.display = 'none';
      return;
    }

    if (!result || typeof result !== 'object') {
      // WAITING FOR MODEL / Null result
      this.overlayEl.classList.add('hidden');
      return;
    }

    const { probability, label, confidence } = result;

    this.overlayEl.classList.remove('hidden');
    if (this.detailsEl) this.detailsEl.style.display = 'flex';

    const probPct = Math.round(probability * 100);
    const confPct = Math.round(confidence * 100);

    if (this.probEl) this.probEl.textContent = `${probPct}%`;
    if (this.confEl) this.confEl.textContent = `${confPct}%`;

    switch (label) {
      case 'SAFE':
        if (this.badgeEl) this.badgeEl.className = 'tl-risk-badge state-safe';
        if (this.statusEl) this.statusEl.textContent = '✓ LIVE / LOW RISK';
        break;

      case 'SUSPICIOUS':
        if (this.badgeEl) this.badgeEl.className = 'tl-risk-badge state-suspicious';
        if (this.statusEl) this.statusEl.textContent = '⚠ SUSPICIOUS';
        break;

      case 'HIGH_RISK':
        if (this.badgeEl) this.badgeEl.className = 'tl-risk-badge state-high-risk';
        if (this.statusEl) this.statusEl.textContent = '⚠ POSSIBLE DEEPFAKE';
        break;

      default:
        if (this.badgeEl) this.badgeEl.className = 'tl-risk-badge state-unknown';
        if (this.statusEl) this.statusEl.textContent = 'WAITING FOR MODEL';
        break;
    }
  }

  hide() {
    if (this.overlayEl) this.overlayEl.classList.add('hidden');
  }
}

if (typeof window !== 'undefined') {
  window.TLRiskOverlayClass = TLRiskOverlay;
}
