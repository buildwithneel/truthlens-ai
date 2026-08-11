/**
 * TruthLens AI – Service Worker (Manifest V3 background)
 *
 * Responsibilities:
 *  1. Lifecycle events (install / update).
 *  2. Manage the Offscreen Document (create on START, close on STOP).
 *  3. Route messages between popup, offscreen document, and content scripts.
 *  4. Persist extension state (protectionEnabled, metrics) via chrome.storage.local.
 *
 * Message routing map:
 *
 *   popup → SW:
 *     START_PROTECTION  → create offscreen → START_PIPELINE → content START_PROTECTION
 *     STOP_PROTECTION   → STOP_PIPELINE → close offscreen  → content STOP_PROTECTION
 *     GET_STATE         → return chrome.storage.local snapshot
 *
 *   offscreen → SW:
 *     UPDATE_METRICS    → persist to storage → forward RENDER_METRICS to content script
 *     PIPELINE_ERROR    → reset state, close offscreen, notify content to remove overlay
 *
 * What this file does NOT do:
 *  - Does NOT call getUserMedia().
 *  - Does NOT access the DOM or video streams.
 *  - Does NOT communicate with any remote server.
 */

'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────

const OFFSCREEN_URL = 'offscreen/offscreen.html';

const DEFAULT_STATE = {
  protectionEnabled: false,
  lastRisk:          null,
  lastStatus:        'UNKNOWN',
  fps:               null,
  latency:           null,
  activeTabId:       null,
};

// ─── Install / Update ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.local.set(DEFAULT_STATE);
    console.log('[TruthLens] Extension installed – default state written.');
  } else if (details.reason === 'update') {
    const existing = await chrome.storage.local.get(null);
    const merged   = { ...DEFAULT_STATE, ...existing };
    await chrome.storage.local.set(merged);
    console.log('[TruthLens] Extension updated – state merged.');
  }

  // On install/update, ensure no stale offscreen document is lingering.
  await _safeCloseOffscreen();
  await chrome.storage.local.set({ protectionEnabled: false, activeTabId: null });
});

// ─── Offscreen Document helpers ───────────────────────────────────────────────

/**
 * Returns true if our offscreen document is currently open.
 * Uses chrome.runtime.getContexts (Chrome 116+).
 */
async function _hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  return contexts.length > 0;
}

/**
 * Create the offscreen document if it is not already open.
 * The USER_MEDIA reason tells Chrome that this document will call getUserMedia(),
 * which is what triggers the standard camera permission prompt for the extension.
 */
async function _ensureOffscreen() {
  if (await _hasOffscreen()) {
    console.log('[TruthLens SW] Offscreen already open – reusing.');
    return;
  }
  await chrome.offscreen.createDocument({
    url:           OFFSCREEN_URL,
    reasons:       [chrome.offscreen.Reason.USER_MEDIA],
    justification: 'Camera access for the TruthLens deepfake detection pipeline.',
  });
  console.log('[TruthLens SW] Offscreen document created.');
}

/**
 * Close the offscreen document if it is open.
 * Errors are swallowed – calling close when there's nothing to close is harmless.
 */
async function _safeCloseOffscreen() {
  try {
    if (await _hasOffscreen()) {
      await chrome.offscreen.closeDocument();
      console.log('[TruthLens SW] Offscreen document closed.');
    }
  } catch (err) {
    console.warn('[TruthLens SW] closeDocument() failed (may be harmless):', err.message);
  }
}

// ─── Message Router ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => {
      console.error('[TruthLens SW] Message handler error:', err);
      sendResponse({ ok: false, error: err.message });
    });
  return true; // keep channel open for async response
});

async function handleMessage(message, sender) {
  const { action, payload, source } = message;

  switch (action) {

    // ── START_PROTECTION (from popup) ─────────────────────────────────────
    case 'START_PROTECTION': {
      // 1. Find and persist the active tab (we'll forward metrics to it).
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tab?.id ?? null;

      await chrome.storage.local.set({ protectionEnabled: true, activeTabId: tabId });

      // 2. Create the offscreen document (this hosts getUserMedia).
      await _ensureOffscreen();

      // 3. Tell the offscreen document to start the pipeline.
      //    The offscreen message listener checks target === 'offscreen'.
      await chrome.runtime.sendMessage({
        action: 'START_PIPELINE',
        target: 'offscreen',
      }).catch((err) => {
        console.warn('[TruthLens SW] Could not reach offscreen for START_PIPELINE:', err.message);
      });

      // 4. Tell the content script to show the overlay.
      if (tabId != null) {
        await chrome.tabs.sendMessage(tabId, { action: 'START_PROTECTION' })
          .catch((err) => {
            console.warn('[TruthLens SW] Could not reach content script:', err.message);
          });
      }

      return { ok: true };
    }

    // ── STOP_PROTECTION (from popup) ──────────────────────────────────────
    case 'STOP_PROTECTION': {
      await chrome.storage.local.set({ protectionEnabled: false });

      // 1. Tell offscreen to stop the pipeline (releases camera tracks).
      if (await _hasOffscreen()) {
        await chrome.runtime.sendMessage({
          action: 'STOP_PIPELINE',
          target: 'offscreen',
        }).catch(() => {});

        // 2. Close the offscreen document (frees the hidden page).
        await _safeCloseOffscreen();
      }

      // 3. Tell the content script to remove the overlay.
      await _forwardToStoredTab({ action: 'STOP_PROTECTION' });

      return { ok: true };
    }

    // ── GET_STATE (from popup) ────────────────────────────────────────────
    case 'GET_STATE': {
      const state = await chrome.storage.local.get(null);
      return { ok: true, state };
    }

    // ── UPDATE_METRICS (from offscreen document) ──────────────────────────
    case 'UPDATE_METRICS': {
      if (!payload) return { ok: true };

      // Persist for popup polling.
      await chrome.storage.local.set({
        lastRisk:   payload.risk        ?? null,
        lastStatus: payload.status      ?? 'UNKNOWN',
        fps:        payload.fps         ?? null,
        latency:    payload.latencyMs   ?? payload.latency ?? null,
      });

      // Forward to the content script as RENDER_METRICS so the overlay updates.
      await _forwardToStoredTab({
        action:  'RENDER_METRICS',
        payload: {
          riskPercent: payload.riskPercent
                         ?? (payload.risk != null ? Math.round(payload.risk * 100) : null),
          status:      payload.status   ?? 'UNKNOWN',
          fps:         payload.fps      ?? 0,
          latencyMs:   payload.latencyMs ?? payload.latency ?? 0,
        },
      });

      return { ok: true };
    }

    // ── PIPELINE_ERROR (from offscreen – e.g. camera denied) ─────────────
    case 'PIPELINE_ERROR': {
      console.error('[TruthLens SW] Pipeline error from offscreen:', payload?.error);
      await chrome.storage.local.set({ protectionEnabled: false });
      await _safeCloseOffscreen();
      // Ask content script to remove the overlay.
      await _forwardToStoredTab({ action: 'STOP_PROTECTION' });
      return { ok: true };
    }

    default:
      console.warn('[TruthLens SW] Unknown action:', action);
      return { ok: false, error: `Unknown action: ${action}` };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Send a message to the content script in the stored active tab.
 * Reads activeTabId from storage so this still works after a SW restart.
 * Errors are swallowed – the tab may have been closed.
 */
async function _forwardToStoredTab(message) {
  try {
    const { activeTabId } = await chrome.storage.local.get('activeTabId');
    if (activeTabId == null) return;
    await chrome.tabs.sendMessage(activeTabId, message);
  } catch (err) {
    console.warn('[TruthLens SW] Could not forward to tab:', err.message);
  }
}
