/**
 * TruthLens AI – Service Worker (Manifest V3 background)
 *
 * Responsibilities:
 *  - Listens for install / update lifecycle events.
 *  - Acts as a message router between the popup and content scripts.
 *  - Persists extension state (protection on/off) via chrome.storage.local.
 *
 * What this file does NOT do:
 *  - It does NOT perform any ML inference.
 *  - It does NOT access the webcam or video streams.
 *  - It does NOT communicate with any remote server.
 */

'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_STATE = {
  protectionEnabled: false,
  lastRisk: null,
  lastStatus: 'UNKNOWN',
  fps: null,
  latency: null,
};

// ─── Install / Update ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.local.set(DEFAULT_STATE);
    console.log('[TruthLens] Extension installed – default state written.');
  } else if (details.reason === 'update') {
    // Merge new defaults without overwriting existing user state.
    const existing = await chrome.storage.local.get(null);
    const merged = { ...DEFAULT_STATE, ...existing };
    await chrome.storage.local.set(merged);
    console.log('[TruthLens] Extension updated – state merged.');
  }
});

// ─── Message Router ──────────────────────────────────────────────────────────

/**
 * Central message handler.
 *
 * Accepted actions (from popup or content script):
 *
 *   { action: 'START_PROTECTION' }
 *     → Stores protectionEnabled=true, forwards command to the active tab's
 *       content script, responds with { ok: true }.
 *
 *   { action: 'STOP_PROTECTION' }
 *     → Stores protectionEnabled=false, forwards command to the active tab's
 *       content script, responds with { ok: true }.
 *
 *   { action: 'GET_STATE' }
 *     → Returns the current state from chrome.storage.local.
 *
 *   { action: 'UPDATE_METRICS', payload: { risk, status, fps, latency } }
 *     → Written by the content script; persists live metrics so the popup
 *       can read them without being open.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => {
      console.error('[TruthLens SW] Message handler error:', err);
      sendResponse({ ok: false, error: err.message });
    });

  // Return true to indicate we will call sendResponse asynchronously.
  return true;
});

async function handleMessage(message, sender) {
  const { action, payload } = message;

  switch (action) {
    case 'START_PROTECTION': {
      await chrome.storage.local.set({ protectionEnabled: true });
      await forwardToActiveTab({ action: 'START_PROTECTION' });
      return { ok: true };
    }

    case 'STOP_PROTECTION': {
      await chrome.storage.local.set({ protectionEnabled: false });
      await forwardToActiveTab({ action: 'STOP_PROTECTION' });
      return { ok: true };
    }

    case 'GET_STATE': {
      const state = await chrome.storage.local.get(null);
      return { ok: true, state };
    }

    case 'UPDATE_METRICS': {
      if (payload) {
        await chrome.storage.local.set({
          lastRisk:   payload.risk   ?? null,
          lastStatus: payload.status ?? 'UNKNOWN',
          fps:        payload.fps    ?? null,
          latency:    payload.latency ?? null,
        });
      }
      return { ok: true };
    }

    default:
      console.warn('[TruthLens SW] Unknown action:', action);
      return { ok: false, error: `Unknown action: ${action}` };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Sends a message to the content script running in the currently active tab.
 * Fails silently if no content script is injected (e.g. chrome:// pages).
 */
async function forwardToActiveTab(message) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null) return;
    await chrome.tabs.sendMessage(tab.id, message);
  } catch (err) {
    // Content script may not be injected on this page – that is fine.
    console.warn('[TruthLens SW] Could not forward to tab:', err.message);
  }
}
