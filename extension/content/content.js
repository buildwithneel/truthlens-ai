/**
 * TruthLens AI – Content Script (Orchestrator)
 *
 * This is the main pipeline coordinator injected into every page.
 *
 * Execution order (guaranteed by manifest injection order):
 *   1. utils/logger.js         → window.TLLogger
 *   2. risk/risk-engine.js     → window.RiskEngine
 *   3. inference/inference-provider.js → window.InferenceProvider
 *   4. detection/face-detector.js → window.FaceDetector
 *   5. capture/video-source.js  → window.VideoSource
 *   6. overlay/overlay.js       → window.TLOverlay
 *   7. content/content.js       ← this file
 *
 * Pipeline:
 *   VideoSource → FaceDetector → FaceCrop → InferenceProvider → RiskEngine → Overlay
 *
 * What this file does NOT do:
 *  - Does NOT implement Google Meet-specific logic (future sprint).
 *  - Does NOT upload frames to any server.
 *  - Does NOT load any ML model directly.
 */

'use strict';

// ─── State ───────────────────────────────────────────────────────────────────

let _protectionEnabled = false;

// Throttle inference to avoid hammering the provider on every animation frame.
// We run inference at most once every INFERENCE_INTERVAL_MS.
const INFERENCE_INTERVAL_MS = 500;
let _lastInferenceTime = 0;

// ─── Pipeline ────────────────────────────────────────────────────────────────

/**
 * Called by VideoSource on every animation frame.
 * @param {HTMLVideoElement} videoEl
 * @param {number} fps
 */
async function onFrame(videoEl, fps) {
  if (!_protectionEnabled) return;

  const now = performance.now();
  if (now - _lastInferenceTime < INFERENCE_INTERVAL_MS) return;
  _lastInferenceTime = now;

  // 1. Face Detection
  let faces;
  try {
    faces = await FaceDetector.detect(videoEl);
  } catch (err) {
    TLLogger.error('ContentScript', 'FaceDetector.detect() error:', err);
    return;
  }

  if (!faces || faces.length === 0) {
    TLLogger.debug('ContentScript', 'No faces detected this frame.');
    return;
  }

  // 2. Inference (use first detected face crop for now)
  const face = faces[0];
  let inferenceResult;
  const inferenceStart = performance.now();
  try {
    inferenceResult = await InferenceProvider.predict(face.imageData);
  } catch (err) {
    TLLogger.error('ContentScript', 'InferenceProvider.predict() error:', err);
    return;
  }
  const latencyMs = Math.round(performance.now() - inferenceStart);

  // 3. Risk classification
  const riskResult = RiskEngine.evaluate(inferenceResult);

  TLLogger.debug('ContentScript', 'Pipeline result:', riskResult, `| fps=${fps} | latency=${latencyMs}ms`);

  // 4. Update overlay
  TLOverlay.update({
    riskPercent: riskResult.riskPercent,
    status:      riskResult.status,
    fps,
    latencyMs,
  });

  // 5. Persist metrics in background (for popup to read)
  chrome.runtime.sendMessage({
    action: 'UPDATE_METRICS',
    payload: {
      risk:      riskResult.risk,
      status:    riskResult.status,
      fps,
      latency:   latencyMs,
    },
  }).catch(() => {
    // Service worker may be sleeping – ignore.
  });
}

// ─── Protection lifecycle ─────────────────────────────────────────────────────

function startProtection() {
  if (_protectionEnabled) return;
  _protectionEnabled = true;
  TLOverlay.inject();
  VideoSource.start(onFrame);
  TLLogger.info('ContentScript', 'Protection STARTED. Provider:', InferenceProvider.activeInfo());
}

function stopProtection() {
  if (!_protectionEnabled) return;
  _protectionEnabled = false;
  VideoSource.stop();
  TLOverlay.remove();
  FaceDetector.dispose();
  TLLogger.info('ContentScript', 'Protection STOPPED.');
}

// ─── Message listener (from service worker / popup) ───────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  const { action } = message;
  TLLogger.debug('ContentScript', 'Received message:', action);

  switch (action) {
    case 'START_PROTECTION':
      startProtection();
      break;

    case 'STOP_PROTECTION':
      stopProtection();
      break;

    default:
      // Ignore unknown messages.
      break;
  }
});

// ─── Boot: sync with persisted state ─────────────────────────────────────────

(async function boot() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'GET_STATE' });
    if (response?.ok && response.state?.protectionEnabled) {
      TLLogger.info('ContentScript', 'Restoring protection from persisted state.');
      startProtection();
    }
  } catch (err) {
    // Extension context may not be ready – safe to ignore.
    TLLogger.warn('ContentScript', 'Boot state check failed (may be harmless):', err.message);
  }
})();

TLLogger.info('ContentScript', 'Content script loaded.', { url: location.href });
