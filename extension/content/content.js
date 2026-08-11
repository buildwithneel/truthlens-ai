/**
 * TruthLens AI – Content Script (Overlay Renderer)
 *
 * Sprint 4 role: this script is now ONLY responsible for the page overlay.
 * The full detection pipeline (getUserMedia, VideoSource, FaceDetector,
 * InferenceProvider, RiskEngine) runs in the Offscreen Document.
 *
 * Execution order (manifest injection):
 *   1. utils/logger.js    → window.TLLogger
 *   2. overlay/overlay.js → window.TLOverlay
 *   3. content/content.js ← this file
 *
 * Message protocol (inbound from service worker via chrome.tabs.sendMessage):
 *
 *   START_PROTECTION  → inject overlay, show "STARTING" state
 *   STOP_PROTECTION   → remove overlay
 *   RENDER_METRICS    → update overlay with latest risk/fps/latency data
 *
 * What this file does NOT do:
 *  - Does NOT call getUserMedia() or VideoSource.
 *  - Does NOT run face detection or inference.
 *  - Does NOT communicate with the offscreen document directly.
 *  - Does NOT implement Google Meet logic (future sprint).
 *  - Does NOT upload anything.
 */

'use strict';

// ─── State ───────────────────────────────────────────────────────────────────

/** True while the overlay is active (protection is ON). */
let _protectionEnabled = false;

// ─── Protection lifecycle ─────────────────────────────────────────────────────

/**
 * Show the overlay. Called when the service worker confirms the pipeline
 * has been started (offscreen document created, camera requested).
 */
function startProtection() {
  if (_protectionEnabled) return;
  _protectionEnabled = true;

  TLOverlay.inject();
  // Show a "waiting for camera" state until the first RENDER_METRICS arrives.
  TLOverlay.update({ status: 'STARTING', fps: '--', latencyMs: '--' });

  TLLogger.info('ContentScript', 'Overlay injected. Waiting for pipeline metrics...');
}

/**
 * Remove the overlay. Called when the service worker signals protection is off
 * (either user clicked Stop, or camera was denied, or an error occurred).
 */
function stopProtection() {
  if (!_protectionEnabled) return;
  _protectionEnabled = false;

  TLOverlay.remove();
  TLLogger.info('ContentScript', 'Overlay removed. Protection stopped.');
}

// ─── Message listener (from service worker → chrome.tabs.sendMessage) ─────────

chrome.runtime.onMessage.addListener((message) => {
  const { action, payload } = message;
  TLLogger.debug('ContentScript', 'Received message:', action);

  switch (action) {

    case 'START_PROTECTION':
      startProtection();
      break;

    case 'STOP_PROTECTION':
      stopProtection();
      break;

    case 'RENDER_METRICS':
      // Forwarded by service worker from offscreen's UPDATE_METRICS.
      // Update the overlay with the latest detection results.
      if (_protectionEnabled && payload) {
        TLOverlay.update({
          riskPercent: payload.riskPercent,
          status:      payload.status,
          fps:         payload.fps,
          latencyMs:   payload.latencyMs,
        });
      }
      break;

    default:
      // Silently ignore messages intended for other listeners.
      break;
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
// We do NOT auto-restore protection on page load.
// The offscreen pipeline is not running after a browser restart,
// so restoring the overlay without a live pipeline would be misleading.
// The user clicks "Start Protection" explicitly.

TLLogger.info('ContentScript', 'Content script loaded.', { url: location.href });
