/**
 * TruthLens AI – Popup Script
 *
 * Responsibilities:
 *  1. Read current state from the service worker on open.
 *  2. Update the UI to reflect that state.
 *  3. Send START_PROTECTION / STOP_PROTECTION messages to the service worker.
 *  4. Poll for live metrics while the popup is open.
 *
 * No direct ML calls. No video access.
 */

'use strict';

// ─── Element refs ─────────────────────────────────────────────────────────────
const elPill        = document.getElementById('tl-protection-pill');
const elRiskPct     = document.getElementById('tl-risk-pct');
const elStatusText  = document.getElementById('tl-status-text');
const elFps         = document.getElementById('tl-fps');
const elLatency     = document.getElementById('tl-latency');
const elBtnStart    = document.getElementById('btn-start');
const elBtnStop     = document.getElementById('btn-stop');
const elBtnDetector = document.getElementById('btn-detector');
const elVersion     = document.getElementById('tl-provider-version');

// ─── UI helpers ───────────────────────────────────────────────────────────────

function applyState(state) {
  const on = !!state.protectionEnabled;

  elPill.textContent       = on ? 'ON' : 'OFF';
  elPill.dataset.on        = on;
  elBtnStart.disabled      = on;
  elBtnStop.disabled       = !on;

  const risk     = state.lastRisk   != null ? `${Math.round(state.lastRisk * 100)}%` : '--%';
  const status   = state.lastStatus ?? '--';
  const fps      = state.fps        != null ? state.fps    : '--';
  const latency  = state.latency    != null ? `${state.latency} ms` : '--';

  elRiskPct.textContent           = risk;
  elStatusText.textContent        = status;
  elStatusText.dataset.status     = status;
  elFps.textContent               = fps;
  elLatency.textContent           = latency;
}

// ─── Service worker communication ────────────────────────────────────────────

async function sendAction(action) {
  try {
    const resp = await chrome.runtime.sendMessage({ action });
    return resp;
  } catch (err) {
    console.error('[TruthLens Popup] sendAction error:', err);
    return null;
  }
}

async function fetchState() {
  const resp = await sendAction('GET_STATE');
  if (resp?.ok && resp.state) {
    applyState(resp.state);
    // Show provider version if available.
    if (resp.state.modelVersion) {
      elVersion.textContent = resp.state.modelVersion;
    }
  }
}

// ─── Button handlers ──────────────────────────────────────────────────────────

elBtnStart.addEventListener('click', async () => {
  elBtnStart.disabled = true;
  await sendAction('START_PROTECTION');
  await fetchState();
});

elBtnStop.addEventListener('click', async () => {
  elBtnStop.disabled = true;
  await sendAction('STOP_PROTECTION');
  await fetchState();
});

// ── Open Detector ─────────────────────────────────────────────────────────────
// Opens detector.html as a full extension tab.
// getUserMedia() works there because the page runs at chrome-extension:// origin.
elBtnDetector.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('detector/detector.html') });
  window.close(); // close the popup so it doesn't linger
});

// ─── Live metrics polling ─────────────────────────────────────────────────────
// Poll every second while popup is open to show fresh FPS / latency.
const _pollInterval = setInterval(fetchState, 1000);

window.addEventListener('unload', () => clearInterval(_pollInterval));

// ─── Boot ─────────────────────────────────────────────────────────────────────
fetchState();
