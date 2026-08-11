/**
 * TruthLens AI – Offscreen Document Orchestrator
 *
 * Context: chrome-extension:// page (hidden, never shown to user).
 * This is the ONLY place in the extension that calls getUserMedia().
 *
 * Available globals (loaded by offscreen.html script tags, in order):
 *   TLLogger, RiskEngine, InferenceProvider, FaceDetector, VideoSource
 *
 * Pipeline this file runs:
 *   VideoSource.start()
 *       ↓  onFrame({ video, timestamp, width, height, fps })
 *   FaceDetector.detect(video)
 *       ↓  face crops (ImageData)
 *   InferenceProvider.predict(imageData)
 *       ↓  { risk, status, modelVersion, latencyMs }
 *   RiskEngine.evaluate(inferenceResult)
 *       ↓  { risk, riskPercent, status }
 *   chrome.runtime.sendMessage(UPDATE_METRICS → service worker)
 *
 * Message protocol (target field prevents cross-listener confusion):
 *
 *   INBOUND  (from service worker):
 *     { action: 'START_PIPELINE', target: 'offscreen' }
 *     { action: 'STOP_PIPELINE',  target: 'offscreen' }
 *
 *   OUTBOUND (to service worker):
 *     { action: 'UPDATE_METRICS', source: 'offscreen',
 *       payload: { risk, riskPercent, status, fps, latencyMs } }
 */

'use strict';

// ─── Inference throttle ───────────────────────────────────────────────────────
// VideoSource fires at targetFPS (15 fps by default).
// We don't need to run inference on every frame – 2 Hz is sufficient for
// the prototype and keeps the mock latency from blocking the frame loop.
const INFERENCE_INTERVAL_MS = 500;
let _lastInferenceTime = 0;

// ─── Frame handler (core pipeline) ───────────────────────────────────────────

/**
 * Called by VideoSource on every scheduled frame.
 * Runs the full detection pipeline and posts results to the service worker.
 *
 * @param {{ video: HTMLVideoElement, timestamp: number,
 *            width: number, height: number, fps: number, avgFps: number }} frame
 */
async function onFrame({ video, timestamp, width, height, fps, avgFps }) {
  const now = performance.now();
  if (now - _lastInferenceTime < INFERENCE_INTERVAL_MS) return;
  _lastInferenceTime = now;

  // ── 1. Face Detection ────────────────────────────────────────────────────
  let faces;
  try {
    faces = await FaceDetector.detect(video);
  } catch (err) {
    TLLogger.error('Offscreen', 'FaceDetector.detect() error:', err);
    return;
  }

  if (!faces || faces.length === 0) {
    TLLogger.debug('Offscreen', 'No faces detected – forwarding FPS only.');
    // Still forward FPS so the overlay stays live.
    _sendMetrics({ fps, riskPercent: null, status: 'SCANNING', latencyMs: 0 });
    return;
  }

  // ── 2. Inference ─────────────────────────────────────────────────────────
  const face = faces[0];
  let inferenceResult;
  const t0 = performance.now();
  try {
    inferenceResult = await InferenceProvider.predict(face.imageData);
  } catch (err) {
    TLLogger.error('Offscreen', 'InferenceProvider.predict() error:', err);
    return;
  }
  const latencyMs = Math.round(performance.now() - t0);

  // ── 3. Risk classification ────────────────────────────────────────────────
  const riskResult = RiskEngine.evaluate(inferenceResult);

  TLLogger.debug(
    'Offscreen',
    `Pipeline | risk=${riskResult.riskPercent}% status=${riskResult.status}` +
    ` fps=${fps} latency=${latencyMs}ms frame=${width}×${height}`
  );

  // ── 4. Send metrics to service worker ─────────────────────────────────────
  _sendMetrics({
    risk:        riskResult.risk,
    riskPercent: riskResult.riskPercent,
    status:      riskResult.status,
    fps,
    latencyMs,
  });
}

/**
 * Posts a metric payload to the service worker.
 * Uses fire-and-forget – the SW may be briefly asleep; errors are ignored.
 * @param {object} payload
 */
function _sendMetrics(payload) {
  chrome.runtime.sendMessage({
    action:  'UPDATE_METRICS',
    source:  'offscreen',
    payload,
  }).catch(() => {
    // SW waking up or tab closed – safe to ignore.
  });
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

async function startPipeline() {
  if (VideoSource.isRunning()) {
    TLLogger.warn('Offscreen', 'startPipeline() called but pipeline already running.');
    return;
  }
  TLLogger.info('Offscreen', 'Starting pipeline...');
  try {
    // getUserMedia is called inside VideoSource.start().
    // Because this page is a chrome-extension:// document, Chrome will show
    // the standard camera permission prompt attached to the extension.
    await VideoSource.start(onFrame);
    TLLogger.info('Offscreen', 'Pipeline running.');
  } catch (err) {
    TLLogger.error('Offscreen', 'Pipeline failed to start:', err.message);
    // Notify service worker of the failure so it can reset state.
    chrome.runtime.sendMessage({
      action:  'PIPELINE_ERROR',
      source:  'offscreen',
      payload: { error: err.message },
    }).catch(() => {});
  }
}

function stopPipeline() {
  TLLogger.info('Offscreen', 'Stopping pipeline...');
  VideoSource.stop();
  FaceDetector.dispose();
  TLLogger.info('Offscreen', 'Pipeline stopped.');
}

// ─── Message listener ─────────────────────────────────────────────────────────

/**
 * Listen for commands from the service worker.
 * The `target: 'offscreen'` field is checked first so this listener
 * silently ignores any message not intended for this context.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Ignore messages not addressed to this context.
  if (message.target !== 'offscreen') return false;

  const { action } = message;
  TLLogger.debug('Offscreen', 'Received message:', action);

  switch (action) {
    case 'START_PIPELINE':
      startPipeline()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true; // keep channel open for async response

    case 'STOP_PIPELINE':
      stopPipeline();
      sendResponse({ ok: true });
      return false;

    default:
      TLLogger.warn('Offscreen', 'Unknown action:', action);
      sendResponse({ ok: false, error: `Unknown action: ${action}` });
      return false;
  }
});

// ─── Boot log ─────────────────────────────────────────────────────────────────
TLLogger.info('Offscreen', 'Offscreen document ready. Waiting for START_PIPELINE.');
