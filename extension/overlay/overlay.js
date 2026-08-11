/**
 * TruthLens AI – Overlay
 *
 * Injects a small floating HUD into the page that shows:
 *   • TRUTHLENS AI  (branding)
 *   • Risk level badge  (LOW / SUSPICIOUS / HIGH)
 *   • Risk percentage
 *   • FPS
 *   • Latency
 *
 * Design constraints:
 *  ✔ Plain CSS – no React, no Tailwind.
 *  ✔ Lightweight – no third-party libraries.
 *  ✔ Non-intrusive – positioned to avoid face area and video controls.
 *  ✔ Dynamically updates via update().
 *  ✔ Fully removable via remove().
 */

'use strict';

const TLOverlay = (() => {
  const OVERLAY_ID = 'tl-overlay-root';

  let _root = null;
  let _els  = {};  // References to inner elements for fast updates.

  // ── Build DOM ─────────────────────────────────────────────────────────────

  function _buildOverlay() {
    const root = document.createElement('div');
    root.id           = OVERLAY_ID;
    root.className    = 'tl-overlay';
    root.setAttribute('aria-label', 'TruthLens AI status overlay');

    root.innerHTML = `
      <div class="tl-header">
        <span class="tl-logo">TRUTHLENS AI</span>
        <button class="tl-close" id="tl-close-btn" title="Hide overlay" aria-label="Close overlay">✕</button>
      </div>
      <div class="tl-badge" id="tl-badge">LOW RISK</div>
      <div class="tl-metrics">
        <div class="tl-metric">
          <span class="tl-metric-label">Risk</span>
          <span class="tl-metric-value" id="tl-risk">--%</span>
        </div>
        <div class="tl-metric">
          <span class="tl-metric-label">FPS</span>
          <span class="tl-metric-value" id="tl-fps">--</span>
        </div>
        <div class="tl-metric">
          <span class="tl-metric-label">Latency</span>
          <span class="tl-metric-value" id="tl-latency">-- ms</span>
        </div>
      </div>
      <div class="tl-mock-notice">⚠ Mock inference – not real detection</div>
    `;

    return root;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Inject the overlay into the page. Safe to call multiple times. */
  function inject() {
    if (document.getElementById(OVERLAY_ID)) {
      TLLogger.debug('TLOverlay', 'inject() – overlay already present.');
      return;
    }

    _root = _buildOverlay();
    document.body.appendChild(_root);

    // Cache element references.
    _els = {
      badge:   document.getElementById('tl-badge'),
      risk:    document.getElementById('tl-risk'),
      fps:     document.getElementById('tl-fps'),
      latency: document.getElementById('tl-latency'),
    };

    // Close button.
    document.getElementById('tl-close-btn').addEventListener('click', () => {
      remove();
      TLLogger.info('TLOverlay', 'Overlay closed by user.');
    });

    TLLogger.info('TLOverlay', 'Overlay injected.');
  }

  /**
   * Update the overlay with the latest data.
   *
   * @param {object} opts
   * @param {number} [opts.riskPercent]  – 0–100
   * @param {string} [opts.status]       – 'LOW' | 'SUSPICIOUS' | 'HIGH' | 'UNKNOWN'
   * @param {number} [opts.fps]
   * @param {number} [opts.latencyMs]
   */
  function update({ riskPercent, status, fps, latencyMs } = {}) {
    if (!_root || !document.contains(_root)) return;

    if (status != null) {
      _els.badge.textContent = `${status} RISK`;
      _els.badge.dataset.status = status;
    }
    if (riskPercent != null) {
      _els.risk.textContent = `${riskPercent}%`;
    }
    if (fps != null) {
      _els.fps.textContent = fps;
    }
    if (latencyMs != null) {
      _els.latency.textContent = `${latencyMs} ms`;
    }
  }

  /** Remove the overlay from the DOM. */
  function remove() {
    const el = document.getElementById(OVERLAY_ID);
    if (el) el.remove();
    _root = null;
    _els  = {};
    TLLogger.info('TLOverlay', 'Overlay removed.');
  }

  /** Returns true if the overlay is currently in the DOM. */
  function isVisible() {
    return !!document.getElementById(OVERLAY_ID);
  }

  return { inject, update, remove, isVisible };
})();

window.TLOverlay = TLOverlay;
