/**
 * TruthLens AI – Camera Detector & Face Crop Pipeline  (Sprint 6)
 *
 * Context: chrome-extension:// page (type="module" script).
 *
 * Architecture:
 *   VideoSource → FaceDetector → FaceCropper → Debug Preview
 */

'use strict';

import { TLFaceDetector } from '../detection/face-detector.js';
import { TLFaceCropper }  from '../detection/face-cropper.js';
import { TLRiskEngine }   from '../detection/risk-engine.js';
import { TLRiskOverlay }  from '../ui/risk-overlay.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const LOG = '[TruthLens]';

const TARGET_DET_FPS = 15;
const MIN_DET_INTERVAL_MS = 1000 / TARGET_DET_FPS; // ~66.6ms
const FPS_WINDOW_MS = 1000;

// ─── Element references ───────────────────────────────────────────────────────

const elVideo        = document.getElementById('det-video');
const elCanvas       = document.getElementById('det-canvas');
const elPlaceholder  = document.getElementById('det-placeholder');
const elFpsBadge     = document.getElementById('det-fps-badge');
const elFaceLabel    = document.getElementById('det-face-label');

// Main summary cards
const elResolution   = document.getElementById('det-resolution');
const elFpsDisplay   = document.getElementById('det-fps-display');
const elDetFps       = document.getElementById('det-det-fps');
const elLatency      = document.getElementById('det-latency');
const elCropLatency  = document.getElementById('det-crop-latency');
const elFaceCount    = document.getElementById('det-face-count');
const elScheduler    = document.getElementById('det-scheduler');
const elTrackLabel   = document.getElementById('det-track-label');
const elModelStatus  = document.getElementById('det-model-status');

// Deepfake Analysis cards
const elDfStatus     = document.getElementById('det-df-status');
const elDfProb       = document.getElementById('det-df-prob');
const elDfConf       = document.getElementById('det-df-conf');
const elDfRisk       = document.getElementById('det-df-risk');
const elDfFps        = document.getElementById('det-df-fps');
const elDfLatency    = document.getElementById('det-df-latency');
const elDfSource     = document.getElementById('det-df-source');
const elAnalysisBadge= document.getElementById('det-analysis-badge');

// Demo Test Controls
const elBtnTestSafe       = document.getElementById('btn-test-safe');
const elBtnTestSuspicious = document.getElementById('btn-test-suspicious');
const elBtnTestHigh       = document.getElementById('btn-test-high');
const elBtnTestReset      = document.getElementById('btn-test-reset');

// Face Cropper Debug Preview elements
const elCropSection     = document.getElementById('det-crop-section');
const elCropCanvas      = document.getElementById('det-crop-canvas');
const elCropPlaceholder = document.getElementById('det-crop-placeholder');
const elCropOutputSize  = document.getElementById('crop-output-size');
const elCropSourceRect  = document.getElementById('crop-source-rect');
const elCropLatencyVal  = document.getElementById('crop-latency-val');
const _cropCtx          = elCropCanvas ? elCropCanvas.getContext('2d') : null;

// Hardware notice banner
const elHwNotice     = document.getElementById('det-hw-notice');
const elHwNoticeText = document.getElementById('det-hw-notice-text');

// Performance Diagnostics Section cards
const elDiagReqFps       = document.getElementById('diag-req-fps');
const elDiagActualCamFps = document.getElementById('diag-actual-cam-fps');
const elDiagCapMinFps    = document.getElementById('diag-cap-min-fps');
const elDiagCapMaxFps    = document.getElementById('diag-cap-max-fps');

const elDiagCamFps       = document.getElementById('diag-cam-fps');
const elDiagProcFps      = document.getElementById('diag-proc-fps');
const elDiagDetFps       = document.getElementById('diag-det-fps');
const elDiagDetLatency   = document.getElementById('diag-det-latency');
const elDiagCropLatency  = document.getElementById('diag-crop-latency');
const elDiagTotalTime    = document.getElementById('diag-total-time');
const elDiagWaitTime     = document.getElementById('diag-wait-time');
const elDiagDropped      = document.getElementById('diag-dropped-frames');
const elDiagTargetFps    = document.getElementById('diag-target-fps');

// Camera Track & Playback Quality cards
const elCamSettingsFps   = document.getElementById('cam-settings-fps');
const elCamAvgInterval   = document.getElementById('cam-avg-interval');
const elCamMinMaxInterval= document.getElementById('cam-minmax-interval');
const elCamReadyState    = document.getElementById('cam-ready-state');
const elCamVideoDims     = document.getElementById('cam-video-dims');
const elCamTotalFrames   = document.getElementById('cam-total-frames');
const elCamDroppedCorrupt= document.getElementById('cam-dropped-corrupt');
const elCamDeviceId      = document.getElementById('cam-device-id');

// Deep Diagnostics section
const elBtnDeepDiag      = document.getElementById('det-btn-deep-diag');
const elDeepResults      = document.getElementById('det-deep-results');
const elDiagLog          = document.getElementById('det-diag-log');

// Status & controls
const elStatusDot    = document.getElementById('det-status-dot');
const elStatusText   = document.getElementById('det-status-text');
const elErrorPanel   = document.getElementById('det-error-panel');
const elErrorTitle   = document.getElementById('det-error-title');
const elErrorBody    = document.getElementById('det-error-body');
const elErrorHint    = document.getElementById('det-error-hint');
const elBtnStart     = document.getElementById('det-btn-start');
const elBtnStop      = document.getElementById('det-btn-stop');

// ─── Canvas context ───────────────────────────────────────────────────────────

const _ctx = elCanvas.getContext('2d');

// ─── State ────────────────────────────────────────────────────────────────────

let _stream       = null;
let _running      = false;
let _schedHandle  = null;
let _useRvfc      = false;

const _riskEngine  = new TLRiskEngine();
let _riskOverlay = null;
let _isDemoMode  = false;

// Hardware settings & capabilities
let _requestedFps       = 30;
let _requestedWidth     = 640;
let _requestedHeight    = 480;
let _hardwareMinFps     = 'N/A';
let _hardwareMaxFps     = 'N/A';
let _hardwareSettings   = null;
let _hardwareCapabilities = null;

// Unique Frame Interval Tracking
const MAX_INTERVAL_SAMPLES = 60;
let _frameTimestamps     = [];
let _avgIntervalMs       = 0;
let _minIntervalMs       = 0;
let _maxIntervalMs       = 0;

// Real-time metrics
let _camWindowStart     = 0;
let _camFrameCount      = 0;
let _camFps             = 0;

let _procWindowStart    = 0;
let _procFrameCount     = 0;
let _procFps            = 0;

let _detWindowStart     = 0;
let _detFrameCount      = 0;
let _detFps             = 0;

let _lastFrameArrivalTs = 0;
let _frameWaitTimeMs    = 0;
let _lastDetLatencyMs   = 0;
let _lastCropLatencyMs  = 0;
let _lastTotalTimeMs    = 0;

let _totalDroppedFrames = 0;
let _lastPresentedFrame = -1;
let _lastMediaTime      = -1;
let _lastDetTs          = 0;

// Face detector & Face cropper instances
let _faceDetector = null;
let _faceCropper  = null;

// Deep diagnostic running flag
let _isDeepDiagnosing = false;

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg, ...a)    { console.log(`${LOG} ${msg}`, ...a); }
function warn(msg, ...a)   { console.warn(`${LOG} ${msg}`, ...a); }
function logErr(msg, ...a) { console.error(`${LOG} ${msg}`, ...a); }

function diagLog(text) {
  if (elDiagLog) {
    elDiagLog.textContent += text + '\n';
    elDiagLog.scrollTop = elDiagLog.scrollHeight;
  }
  console.log(`${LOG} [DIAG] ${text}`);
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function safeSetText(el, text) {
  if (el) el.textContent = text;
}

export function validateDetectorDOM() {
  const elements = [
    { id: 'det-video',        el: elVideo,        required: true },
    { id: 'det-btn-start',    el: elBtnStart,    required: true },
    { id: 'det-btn-stop',     el: elBtnStop,     required: true },
    { id: 'det-status-text',  el: elStatusText,  required: true },
    { id: 'det-resolution',   el: elResolution,   required: true },
    { id: 'det-fps-display',  el: elFpsDisplay,  required: true },
    { id: 'det-det-fps',      el: elDetFps,      required: true },
    { id: 'det-latency',      el: elLatency,      required: true },
    { id: 'det-crop-latency', el: elCropLatency, required: true },
    { id: 'det-face-count',   el: elFaceCount,   required: true },
    { id: 'det-model-status', el: elModelStatus, required: true },
    { id: 'det-scheduler',    el: elScheduler,    required: true },
    { id: 'det-track-label',  el: elTrackLabel,  required: true },
    { id: 'diag-target-fps',  el: elDiagTargetFps, required: false },
    { id: 'det-crop-canvas',  el: elCropCanvas,  required: false },
    { id: 'crop-source-rect', el: elCropSourceRect, required: false },
    { id: 'crop-output-size', el: elCropOutputSize, required: false }
  ];

  const missingRequired = [];
  const missingOptional = [];

  for (const item of elements) {
    if (!item.el) {
      if (item.required) {
        missingRequired.push(`#${item.id}`);
      } else {
        missingOptional.push(`#${item.id}`);
      }
    }
  }

  if (missingOptional.length > 0) {
    warn(`DOM validation warning: missing optional elements ${missingOptional.join(', ')}`);
  }

  if (missingRequired.length === 0) {
    log('DOM validation passed');
    return true;
  } else {
    warn(`DOM validation failed: missing ${missingRequired.join(', ')}`);
    return false;
  }
}

function setStatus(state, text) {
  if (elStatusDot)  elStatusDot.className    = `det-status-dot ${state}`;
  safeSetText(elStatusText, text);
}

function showError(title, body, hint = '') {
  if (elErrorPanel) elErrorPanel.hidden      = false;
  safeSetText(elErrorTitle, title);
  safeSetText(elErrorBody,  body);
  safeSetText(elErrorHint,  hint);
}

function clearError() {
  if (elErrorPanel) elErrorPanel.hidden      = true;
  safeSetText(elErrorTitle, '');
  safeSetText(elErrorBody,  '');
  safeSetText(elErrorHint,  '');
}

function resetStats() {
  elResolution.textContent = '--';
  elFpsDisplay.textContent = '--';
  elDetFps.textContent     = '--';
  elLatency.textContent    = '--';
  elCropLatency.textContent= '--';
  elFaceCount.textContent  = '--';
  elScheduler.textContent  = '--';
  elFpsBadge.textContent   = '-- FPS';

  elDiagReqFps.textContent       = String(_requestedFps);
  elDiagActualCamFps.textContent = '-- FPS';
  elDiagCapMinFps.textContent    = String(_hardwareMinFps);
  elDiagCapMaxFps.textContent    = String(_hardwareMaxFps);

  elDiagCamFps.textContent     = '-- FPS';
  elDiagProcFps.textContent    = '-- FPS';
  elDiagDetFps.textContent     = '-- FPS';
  elDiagDetLatency.textContent = '-- ms';
  elDiagCropLatency.textContent= '-- ms';
  elDiagTotalTime.textContent  = '-- ms';
  elDiagWaitTime.textContent   = '-- ms';
  elDiagDropped.textContent    = '0';
  elDiagTargetFps.textContent  = `${TARGET_DET_FPS}`;

  elCamSettingsFps.textContent    = '--';
  elCamAvgInterval.textContent    = '-- ms';
  elCamMinMaxInterval.textContent = '-- / -- ms';
  elCamReadyState.textContent     = '--';
  elCamVideoDims.textContent      = '--';
  elCamTotalFrames.textContent    = '--';
  elCamDroppedCorrupt.textContent = '-- / --';
  elCamDeviceId.textContent       = '--';

  elHwNotice.hidden = true;
  _resetCropDebugPreview();
}

function updateHwNotice() {
  if (_camFps > 0 && _camFps < 14) {
    elHwNotice.hidden = false;
    elHwNoticeText.textContent = `Camera hardware/browser currently provides ~${_camFps.toFixed(1)} FPS`;
  } else {
    elHwNotice.hidden = true;
  }
}

// ─── Face Cropper Debug Preview Renderer ─────────────────────────────────────

function _drawCropDebugPreview(cropResult) {
  if (!cropResult || !cropResult.canvas) return;

  // Copy 224x224 offscreen crop canvas to the visible preview canvas element
  _cropCtx.clearRect(0, 0, elCropCanvas.width, elCropCanvas.height);
  _cropCtx.drawImage(cropResult.canvas, 0, 0, elCropCanvas.width, elCropCanvas.height);

  elCropPlaceholder.classList.add('hidden');
  const sr = cropResult.sourceRect;
  elCropSourceRect.textContent = `${sr.x}, ${sr.y} (${sr.width} × ${sr.height} px)`;
  elCropLatencyVal.textContent = `${cropResult.latencyMs} ms`;
}

function _resetCropDebugPreview() {
  _cropCtx.clearRect(0, 0, elCropCanvas.width, elCropCanvas.height);
  elCropPlaceholder.classList.remove('hidden');
  elCropSourceRect.textContent = '--';
  elCropLatencyVal.textContent = '-- ms';
}

// ─── Canvas overlay helpers ───────────────────────────────────────────────────

function _syncCanvasSize() {
  const rect = elVideo.getBoundingClientRect();
  const dpr  = window.devicePixelRatio || 1;
  const w    = Math.round(rect.width  * dpr);
  const h    = Math.round(rect.height * dpr);
  if (elCanvas.width !== w || elCanvas.height !== h) {
    elCanvas.width  = w;
    elCanvas.height = h;
    _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function _coverTransform() {
  const dpr  = window.devicePixelRatio || 1;
  const cw   = elCanvas.width  / dpr;
  const ch   = elCanvas.height / dpr;
  const vw   = elVideo.videoWidth;
  const vh   = elVideo.videoHeight;

  if (vw === 0 || vh === 0) return { scale: 1, offsetX: 0, offsetY: 0 };

  const scaleX = cw / vw;
  const scaleY = ch / vh;
  const scale  = Math.max(scaleX, scaleY);

  return {
    scale,
    offsetX: (cw - vw * scale) / 2,
    offsetY: (ch - vh * scale) / 2,
  };
}

function _drawFaces(faces) {
  const dpr = window.devicePixelRatio || 1;
  const cw  = elCanvas.width  / dpr;
  const ch  = elCanvas.height / dpr;

  _ctx.clearRect(0, 0, cw, ch);

  if (!faces || faces.length === 0) return;

  const { scale, offsetX, offsetY } = _coverTransform();
  const vw = elVideo.videoWidth;
  const vh = elVideo.videoHeight;

  for (const face of faces) {
    const bb = face.boundingBox;

    let x = bb.originX * vw * scale + offsetX;
    let y = bb.originY * vh * scale + offsetY;
    let w = bb.width   * vw * scale;
    let h = bb.height  * vh * scale;

    if (x < 0) { w += x; x = 0; }
    if (y < 0) { h += y; y = 0; }
    w = Math.min(w, cw - x);
    h = Math.min(h, ch - y);
    if (w <= 0 || h <= 0) continue;

    const color = face.score > 0.8 ? '#38bdf8' : '#818cf8';
    _ctx.strokeStyle = color;
    _ctx.lineWidth   = 2.5;
    _ctx.lineJoin    = 'round';
    _ctx.shadowColor = `${color}99`;
    _ctx.shadowBlur  = 10;
    _ctx.strokeRect(x, y, w, h);
    _ctx.shadowBlur  = 0;

    const label = `${Math.round(face.score * 100)}%`;
    _ctx.font         = 'bold 12px "Inter", system-ui, sans-serif';
    _ctx.textBaseline = 'bottom';
    const pad  = 4;
    const tw   = _ctx.measureText(label).width + pad * 2;
    const th   = 18;
    const lx   = x;
    const ly   = y > th ? y : y + h;

    _ctx.fillStyle = 'rgba(0,0,0,0.6)';
    _ctx.fillRect(lx, ly - th, tw, th);
    _ctx.fillStyle = '#e2e8f0';
    _ctx.fillText(label, lx + pad, ly - 3);
  }
}

function _updateFaceLabel(count) {
  let text, state;
  if (count === 0) {
    text  = 'No face detected';
    state = 'none';
  } else if (count === 1) {
    text  = 'Face detected';
    state = 'one';
  } else {
    text  = `Multiple faces detected (${count})`;
    state = 'multiple';
  }
  elFaceLabel.textContent   = text;
  elFaceLabel.dataset.state = state;
  elFaceLabel.classList.add('active');
}

// ─── Playback Quality & Interval Stat Helpers ─────────────────────────────────

function _updatePlaybackQuality() {
  if (typeof elVideo.getVideoPlaybackQuality === 'function') {
    const q = elVideo.getVideoPlaybackQuality();
    elCamTotalFrames.textContent    = String(q.totalVideoFrames);
    elCamDroppedCorrupt.textContent = `${q.droppedVideoFrames} / ${q.corruptedVideoFrames}`;
  } else {
    elCamTotalFrames.textContent    = 'N/A';
    elCamDroppedCorrupt.textContent = 'N/A';
  }

  elCamReadyState.textContent = `${elVideo.readyState} (HAVE_ENOUGH_DATA)`;
  elCamVideoDims.textContent  = `${elVideo.videoWidth} x ${elVideo.videoHeight}`;
}

function _recordFrameInterval(now) {
  _frameTimestamps.push(now);
  if (_frameTimestamps.length > MAX_INTERVAL_SAMPLES) {
    _frameTimestamps.shift();
  }

  if (_frameTimestamps.length >= 2) {
    const intervals = [];
    for (let i = 1; i < _frameTimestamps.length; i++) {
      intervals.push(_frameTimestamps[i] - _frameTimestamps[i - 1]);
    }
    const sum = intervals.reduce((a, b) => a + b, 0);
    _avgIntervalMs = parseFloat((sum / intervals.length).toFixed(1));
    _minIntervalMs = parseFloat(Math.min(...intervals).toFixed(1));
    _maxIntervalMs = parseFloat(Math.max(...intervals).toFixed(1));

    elCamAvgInterval.textContent    = `${_avgIntervalMs} ms`;
    elCamMinMaxInterval.textContent = `${_minIntervalMs} / ${_maxIntervalMs} ms`;
  }
}

// ─── Pipeline Tick Loop (VideoSource → FaceDetector → FaceCropper) ─────────────

function _tick(now, rvfcMeta) {
  if (!_running) return;

  const tStart = performance.now();

  if (_lastFrameArrivalTs > 0) {
    _frameWaitTimeMs = parseFloat((now - _lastFrameArrivalTs).toFixed(1));
  }
  _lastFrameArrivalTs = now;

  _procFrameCount++;
  const procElapsed = now - _procWindowStart;
  if (procElapsed >= FPS_WINDOW_MS) {
    _procFps        = parseFloat((_procFrameCount / procElapsed * 1000).toFixed(1));
    _procFrameCount = 0;
    _procWindowStart= now;
    elDiagProcFps.textContent = `${_procFps} FPS`;
  }

  if (rvfcMeta) {
    _camFrameCount++;
    const camElapsed = now - _camWindowStart;
    if (camElapsed >= FPS_WINDOW_MS) {
      _camFps        = parseFloat((_camFrameCount / camElapsed * 1000).toFixed(1));
      _camFrameCount = 0;
      _camWindowStart= now;

      elFpsBadge.textContent         = `${_camFps} FPS`;
      elFpsDisplay.textContent       = `${_camFps} FPS`;
      elDiagCamFps.textContent       = `${_camFps} FPS`;
      elDiagActualCamFps.textContent = `${_camFps} FPS`;

      updateHwNotice();
    }

    if (typeof rvfcMeta.presentedFrames === 'number') {
      if (_lastPresentedFrame >= 0) {
        const delta = rvfcMeta.presentedFrames - _lastPresentedFrame;
        if (delta > 1) {
          _totalDroppedFrames += (delta - 1);
        }
      }
      _lastPresentedFrame = rvfcMeta.presentedFrames;
    }
  } else {
    _camFrameCount++;
    const camElapsed = now - _camWindowStart;
    if (camElapsed >= FPS_WINDOW_MS) {
      _camFps        = parseFloat((_camFrameCount / camElapsed * 1000).toFixed(1));
      _camFrameCount = 0;
      _camWindowStart= now;

      elFpsBadge.textContent         = `${_camFps} FPS`;
      elFpsDisplay.textContent       = `${_camFps} FPS`;
      elDiagCamFps.textContent       = `${_camFps} FPS`;
      elDiagActualCamFps.textContent = `${_camFps} FPS`;

      updateHwNotice();
    }
  }

  elDiagDropped.textContent = String(_totalDroppedFrames);
  _updatePlaybackQuality();

  if (elVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    _rearm();
    return;
  }

  const currentMediaTime = rvfcMeta?.mediaTime ?? elVideo.currentTime;
  const isNewFrame = (currentMediaTime !== _lastMediaTime);

  if (isNewFrame) {
    _recordFrameInterval(now);
  }

  // ── PIPELINE INTEGRATION: FaceDetector → FaceCropper ───────────────────
  if (_faceDetector?.isReady && isNewFrame && (now - _lastDetTs >= MIN_DET_INTERVAL_MS)) {
    _lastDetTs     = now;
    _lastMediaTime = currentMediaTime;

    // 1. Run Face Detector
    const detResult = _faceDetector.detect(elVideo, now);
    _lastDetLatencyMs = detResult.latencyMs;

    _detFrameCount++;
    const detElapsed = now - _detWindowStart;
    if (detElapsed >= FPS_WINDOW_MS) {
      _detFps         = parseFloat((_detFrameCount / detElapsed * 1000).toFixed(1));
      _detFrameCount  = 0;
      _detWindowStart = now;
      elDetFps.textContent     = `${_detFps} FPS`;
      elDiagDetFps.textContent = `${_detFps} FPS`;
    }

    // Draw main camera canvas bounding box overlay
    _syncCanvasSize();
    _drawFaces(detResult.faces);
    _updateFaceLabel(detResult.faceCount);

    // 3. Update Risk Overlay (if not in manual demo test mode)
    if (!_isDemoMode && _riskOverlay) {
      if (detResult.faceCount === 0) {
        _riskOverlay.update('NO_FACE');
      } else {
        _riskOverlay.update(null); // WAITING FOR MODEL
      }
    }

    // 2. Run Face Cropper if face detected
    if (detResult.faceCount > 0 && detResult.faces[0] && _faceCropper) {
      const primaryFace = detResult.faces[0];
      const cropResult  = _faceCropper.crop(elVideo, primaryFace.boundingBox);

      if (cropResult) {
        _lastCropLatencyMs = cropResult.latencyMs;
        elCropLatency.textContent     = `${_lastCropLatencyMs} ms`;
        elDiagCropLatency.textContent = `${_lastCropLatencyMs} ms`;

        // Render debug preview if debug mode enabled
        if (_faceCropper.isDebug) {
          _drawCropDebugPreview(cropResult);
        }
      } else {
        _resetCropDebugPreview();
      }
    } else {
      _resetCropDebugPreview();
    }

    elLatency.textContent        = _lastDetLatencyMs > 0 ? `${_lastDetLatencyMs} ms` : '--';
    elFaceCount.textContent      = String(detResult.faceCount);
    elDiagDetLatency.textContent = _lastDetLatencyMs > 0 ? `${_lastDetLatencyMs} ms` : '--';
  }

  _lastTotalTimeMs = parseFloat((performance.now() - tStart).toFixed(1));
  elDiagTotalTime.textContent = `${_lastTotalTimeMs} ms`;
  elDiagWaitTime.textContent  = `${_frameWaitTimeMs} ms`;

  _rearm();
}

function _rearm() {
  if (!_running) return;
  if (_useRvfc) {
    _schedHandle = elVideo.requestVideoFrameCallback(_rvfcAdapter);
  } else {
    _schedHandle = requestAnimationFrame(_rafAdapter);
  }
}

function _rvfcAdapter(now, meta) {
  _schedHandle = null;
  _tick(now, meta);
}

function _rafAdapter(now) {
  _schedHandle = null;
  _tick(now, null);
}

function _cancelScheduler() {
  if (_schedHandle == null) return;
  if (_useRvfc && elVideo) {
    elVideo.cancelVideoFrameCallback(_schedHandle);
  } else {
    cancelAnimationFrame(_schedHandle);
  }
  _schedHandle = null;
}

function updateSchedulerUI(schedulerText, targetFpsValue) {
  safeSetText(elScheduler, schedulerText);
  safeSetText(elDiagTargetFps, targetFpsValue);
}

function _startScheduler() {
  _useRvfc = typeof elVideo?.requestVideoFrameCallback === 'function';

  log(_useRvfc
    ? 'Scheduler: requestVideoFrameCallback (native)'
    : 'Scheduler: requestAnimationFrame (fallback)');

  try {
    updateSchedulerUI(_useRvfc ? 'rVFC (native)' : 'RAF (fallback)', `${TARGET_DET_FPS}`);
  } catch (uiErr) {
    warn('Scheduler UI update warning:', uiErr);
  }

  const now = performance.now();
  _camWindowStart   = now;
  _camFrameCount    = 0;

  _procWindowStart  = now;
  _procFrameCount   = 0;

  _detWindowStart   = now;
  _detFrameCount    = 0;

  _lastFrameArrivalTs = 0;
  _lastDetTs          = 0;
  _lastMediaTime      = -1;
  _lastPresentedFrame = -1;
  _totalDroppedFrames = 0;
  _frameTimestamps    = [];

  _running = true;
  _rearm();
}

// ─── Face Detector & Cropper Initialisation ────────────────────────────────────

async function _initPipelineModules() {
  elModelStatus.textContent = 'loading…';
  elModelStatus.style.color = '';
  log('Starting pipeline modules initialization');

  _riskOverlay = new TLRiskOverlay('#det-video-shell');

  // Initialize Face Cropper (224x224, 20% padding, debug mode true)
  _faceCropper = new TLFaceCropper({
    targetWidth:  224,
    targetHeight: 224,
    padding:      0.20,
    debug:        true
  });

  try {
    _faceDetector = new TLFaceDetector();
    await _faceDetector.initialize();

    elModelStatus.textContent = '✓ READY';
    elModelStatus.style.color = '#4ade80';
    log('Pipeline modules initialized — status: READY');
  } catch (err) {
    logErr('PIPELINE INIT ERROR:', err.message);
    _faceDetector = null;
    elModelStatus.textContent = `✗ ERROR: ${err.message}`;
    elModelStatus.style.color = '#f87171';
    showError('Pipeline Init Failed', err.message, 'Check console for details.');
  }
}

// ─── Camera Lifecycle & Hardware Inspection ──────────────────────────────────

async function startCamera(customWidth = 640, customHeight = 480, customFps = 30, customMinFps = 15, isExact = false) {
  validateDetectorDOM();
  clearError();
  if (elBtnStart) elBtnStart.disabled = true;
  setStatus('ready', 'Requesting camera stream…');

  _requestedWidth  = customWidth;
  _requestedHeight = customHeight;
  _requestedFps    = customFps;
  safeSetText(elDiagReqFps, String(customFps));

  const videoConstraint = isExact
    ? { width: customWidth, height: customHeight, frameRate: { exact: customFps } }
    : { width: { ideal: customWidth }, height: { ideal: customHeight }, frameRate: { ideal: customFps, min: customMinFps } };

  const constraints = { video: videoConstraint, audio: false };

  log(`Requesting getUserMedia: ${JSON.stringify(constraints)}`);

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    if (elBtnStart) elBtnStart.disabled = false;
    _handleGetUserMediaError(e);
    throw e;
  }

  log('Camera permission granted');
  _stream = stream;

  if (elVideo) {
    elVideo.autoplay    = true;
    elVideo.playsInline = true;
    elVideo.muted       = true;
    elVideo.srcObject   = stream;
  }

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Video metadata timeout.')), 8000);
    if (elVideo) {
      elVideo.addEventListener('loadedmetadata', () => {
        clearTimeout(timer); resolve();
      }, { once: true });
      elVideo.addEventListener('error', (ev) => {
        clearTimeout(timer); reject(new Error(`Video element error: ${ev.message}`));
      }, { once: true });
    } else {
      clearTimeout(timer);
      reject(new Error('Video element #det-video is missing.'));
    }
  });

  const w = elVideo.videoWidth;
  const h = elVideo.videoHeight;

  log(`Camera stream active: ${w}x${h}`);

  try {
    const vTrack = stream.getVideoTracks()[0];
    if (vTrack) {
      _hardwareSettings     = vTrack.getSettings();
      _hardwareCapabilities = typeof vTrack.getCapabilities === 'function' ? vTrack.getCapabilities() : {};

      _hardwareMinFps = _hardwareCapabilities.frameRate?.min ?? _hardwareSettings.frameRate ?? 'N/A';
      _hardwareMaxFps = _hardwareCapabilities.frameRate?.max ?? _hardwareSettings.frameRate ?? 'N/A';

      safeSetText(elTrackLabel, vTrack.label || '(unnamed)');
      safeSetText(elDiagCapMinFps, String(_hardwareMinFps));
      safeSetText(elDiagCapMaxFps, String(_hardwareMaxFps));
      safeSetText(elCamSettingsFps, `${_hardwareSettings.frameRate ?? 'N/A'} FPS`);
      safeSetText(elCamDeviceId, (_hardwareSettings.deviceId ?? 'default').substring(0, 12) + '…');

      vTrack.addEventListener('ended', () => {
        warn('Camera track ended unexpectedly.');
        stopCamera('Camera disconnected unexpectedly.');
      });
    }

    safeSetText(elResolution, `${w} × ${h}`);
    if (elVideo) elVideo.classList.add('active');
    if (elCanvas) elCanvas.classList.add('active');
    if (elPlaceholder) elPlaceholder.classList.add('hidden');
    if (elFpsBadge) elFpsBadge.classList.add('active');

    setTimeout(_syncCanvasSize, 50);

    setStatus('running', `Camera active — ${w}×${h}`);
    if (elBtnStart) elBtnStart.disabled = true;
    if (elBtnStop) elBtnStop.disabled  = false;
  } catch (uiErr) {
    warn('UI update encountered an error but camera stream is active:', uiErr);
  }

  _startScheduler();
}

function stopCamera(reason) {
  if (!_stream && !_running) return;
  log('Stopping camera...');

  _running = false;
  _cancelScheduler();

  elVideo.pause();
  elVideo.srcObject = null;

  if (_stream) {
    _stream.getTracks().forEach((track) => {
      track.stop();
      log(`Track stopped: kind=${track.kind} label="${track.label}"`);
    });
    _stream = null;
  }

  {
    const dpr = window.devicePixelRatio || 1;
    _ctx.clearRect(0, 0, elCanvas.width / dpr, elCanvas.height / dpr);
  }

  if (_faceDetector) {
    _faceDetector.dispose();
    _faceDetector = null;
    elModelStatus.textContent = '--';
    elModelStatus.style.color = '';
  }

  elVideo.classList.remove('active');
  elCanvas.classList.remove('active');
  elPlaceholder.classList.remove('hidden');
  elFpsBadge.classList.remove('active');
  elFaceLabel.classList.remove('active');

  resetStats();
  setStatus('stopped', reason ?? 'Camera stopped — tracks released.');

  elBtnStart.disabled = false;
  elBtnStop.disabled  = true;

  log('Camera stopped. Tracks released.');
}

// ─── Deep Capture Diagnostics & Case Determination Runner ────────────────────

async function runDeepDiagnostics() {
  if (_isDeepDiagnosing) return;
  _isDeepDiagnosing = true;

  elBtnDeepDiag.disabled = true;
  elBtnDeepDiag.textContent = '🔬 Running Deep Diagnostics…';
  elDeepResults.hidden = false;
  if (elDiagLog) elDiagLog.textContent = '';

  diagLog('================================================================');
  diagLog('  TRUTHLENS AI — DEEP CAPTURE & FPS DIAGNOSTIC SUITE');
  diagLog('================================================================\n');

  if (!_stream || !_running) {
    diagLog('Starting camera stream with ideal 30 FPS constraints…');
    await startCamera(640, 480, 30, 15);
    await new Promise((res) => setTimeout(res, 2000));
  }

  const settings = _hardwareSettings ?? {};
  const caps     = _hardwareCapabilities ?? {};

  diagLog(`videoTrack.getSettings():`);
  diagLog(`  deviceId:    ${settings.deviceId}`);
  diagLog(`  groupId:     ${settings.groupId}`);
  diagLog(`  width:       ${settings.width}`);
  diagLog(`  height:      ${settings.height}`);
  diagLog(`  aspectRatio: ${settings.aspectRatio}`);
  diagLog(`  frameRate:   ${settings.frameRate} FPS`);
  diagLog(`  facingMode:  ${settings.facingMode}`);
  diagLog(`  resizeMode:  ${settings.resizeMode}`);
  diagLog(`  latency:     ${settings.latency ?? 'N/A'}`);

  diagLog(`\nvideoTrack.getCapabilities().frameRate:`);
  diagLog(`  min: ${caps.frameRate?.min ?? 'N/A'}, max: ${caps.frameRate?.max ?? 'N/A'}`);

  diagLog(`\nVideo Element State:`);
  diagLog(`  readyState:  ${elVideo.readyState}`);
  diagLog(`  videoWidth:  ${elVideo.videoWidth}`);
  diagLog(`  videoHeight: ${elVideo.videoHeight}`);
  diagLog(`  currentTime: ${elVideo.currentTime}`);

  if (typeof elVideo.getVideoPlaybackQuality === 'function') {
    const q = elVideo.getVideoPlaybackQuality();
    diagLog(`\ngetVideoPlaybackQuality():`);
    diagLog(`  totalVideoFrames:    ${q.totalVideoFrames}`);
    diagLog(`  droppedVideoFrames:  ${q.droppedVideoFrames}`);
    diagLog(`  corruptedVideoFrames:${q.corruptedVideoFrames}`);
  }

  diagLog('\n--- STEP 2: INDEPENDENT rVFC vs rAF 5-SECOND TEST (NO ML) ---');
  diagLog('Pausing ML detector during test…');

  let rvfcCallbacks = 0;
  let rvfcUniqueFrames = 0;
  let lastRvfcMediaTime = -1;

  const testRvfcHandler = (now, meta) => {
    rvfcCallbacks++;
    if (meta.mediaTime !== lastRvfcMediaTime) {
      rvfcUniqueFrames++;
      lastRvfcMediaTime = meta.mediaTime;
    }
    if (_useRvfc && elVideo) {
      elVideo.requestVideoFrameCallback(testRvfcHandler);
    }
  };

  _cancelScheduler();
  _running = false;

  if (typeof elVideo.requestVideoFrameCallback === 'function') {
    elVideo.requestVideoFrameCallback(testRvfcHandler);
  }

  await new Promise((res) => setTimeout(res, 5000));
  _cancelScheduler();

  const rvfcCallbackRate = parseFloat((rvfcCallbacks / 5).toFixed(1));
  const rvfcUniqueRate   = parseFloat((rvfcUniqueFrames / 5).toFixed(1));

  diagLog(`rVFC Results over 5 seconds:`);
  diagLog(`  rVFC Callback Rate:    ${rvfcCallbackRate} callbacks/sec`);
  diagLog(`  rVFC Unique Frame Rate: ${rvfcUniqueRate} unique frames/sec`);

  let rafCallbacks = 0;
  let rafUniqueFrames = 0;
  let lastRafTime = -1;
  let rafHandle = null;

  const testRafHandler = () => {
    rafCallbacks++;
    if (elVideo.currentTime !== lastRafTime) {
      rafUniqueFrames++;
      lastRafTime = elVideo.currentTime;
    }
    rafHandle = requestAnimationFrame(testRafHandler);
  };

  rafHandle = requestAnimationFrame(testRafHandler);
  await new Promise((res) => setTimeout(res, 5000));
  cancelAnimationFrame(rafHandle);

  const rafCallbackRate = parseFloat((rafCallbacks / 5).toFixed(1));
  const rafUniqueRate   = parseFloat((rafUniqueFrames / 5).toFixed(1));

  diagLog(`rAF Results over 5 seconds:`);
  diagLog(`  rAF Callback Rate:     ${rafCallbackRate} callbacks/sec`);
  diagLog(`  rAF Unique Frame Rate:  ${rafUniqueRate} unique frames/sec`);

  _startScheduler();

  diagLog('\n--- STEP 3: CONSTRAINT EXPERIMENTS ---');

  diagLog('\n[Exp 1] Constraints: { frameRate: { ideal: 30, min: 1 } }');
  try {
    stopCamera('Diagnostic Exp 1');
    await new Promise((res) => setTimeout(res, 500));
    await startCamera(640, 480, 30, 1, false);
    await new Promise((res) => setTimeout(res, 2000));
    diagLog(`  Negotiated Track FPS: ${_hardwareSettings?.frameRate ?? 'N/A'}`);
    diagLog(`  Measured Unique FPS:  ${_camFps} FPS`);
  } catch (err) {
    diagLog(`  Exp 1 Failed: ${err.message}`);
  }

  diagLog('\n[Exp 2] Constraints: { frameRate: { exact: 30 } } (Diagnostic Only)');
  try {
    stopCamera('Diagnostic Exp 2');
    await new Promise((res) => setTimeout(res, 500));
    await startCamera(640, 480, 30, 30, true);
    await new Promise((res) => setTimeout(res, 2000));
    diagLog(`  Negotiated Track FPS: ${_hardwareSettings?.frameRate ?? 'N/A'}`);
    diagLog(`  Measured Unique FPS:  ${_camFps} FPS`);
  } catch (err) {
    diagLog(`  Exp 2 Failed (OverconstrainedError / Browser Reject):`);
    diagLog(`    Error Name:    ${err.name}`);
    diagLog(`    Error Message: ${err.message}`);
    diagLog(`    Constraint:    ${err.constraint ?? 'N/A'}`);
  }

  diagLog('\n[Exp 3] Constraints: { frameRate: { ideal: 60, min: 1 } }');
  try {
    stopCamera('Diagnostic Exp 3');
    await new Promise((res) => setTimeout(res, 500));
    await startCamera(640, 480, 60, 1, false);
    await new Promise((res) => setTimeout(res, 2000));
    diagLog(`  Negotiated Track FPS: ${_hardwareSettings?.frameRate ?? 'N/A'}`);
    diagLog(`  Measured Unique FPS:  ${_camFps} FPS`);
  } catch (err) {
    diagLog(`  Exp 3 Failed: ${err.message}`);
  }

  stopCamera('Restoring default camera stream');
  await new Promise((res) => setTimeout(res, 500));
  await startCamera(640, 480, 30, 15, false);

  diagLog('\n================================================================');
  diagLog('  FINAL DIAGNOSTIC CASE DETERMINATION');
  diagLog('================================================================');

  let determinedCase = '';
  let caseDescription = '';

  const trackFps = _hardwareSettings?.frameRate ?? 0;
  const measuredUniqueFps = rvfcUniqueRate;

  if (rvfcCallbackRate >= 25 && measuredUniqueFps >= 14.5) {
    determinedCase = 'CASE A';
    caseDescription = 'Camera actually delivers >=15 FPS, scheduler operating normally.';
  } else if (trackFps >= 15 && measuredUniqueFps < 14.5 && (rvfcCallbackRate >= 25 || rafCallbackRate >= 50)) {
    determinedCase = 'CASE D';
    caseDescription = 'Browser/OS/driver hardware throttling. Track settings report 30 FPS and callbacks fire at 30-60 FPS, but physical USB webcam sensor auto-exposure drops unique frame updates to ~10 FPS (97ms per unique frame).';
  } else if (trackFps < 14.5) {
    determinedCase = 'CASE C';
    caseDescription = 'Camera track settings themselves negotiate ~10 FPS despite capability max 30.';
  } else {
    determinedCase = 'CASE B';
    caseDescription = 'Camera track settings say >=15 FPS but video playback delivers ~10 unique frames/sec.';
  }

  diagLog(`DETERMINED RESULT: [ ${determinedCase} ]`);
  diagLog(`DESCRIPTION: ${caseDescription}`);
  diagLog('================================================================');

  _isDeepDiagnosing = false;
  elBtnDeepDiag.disabled = false;
  elBtnDeepDiag.textContent = '🔬 Run Deep Diagnostics & Constraint Experiments';
}

// ─── Error Handling ───────────────────────────────────────────────────────────

function _handleGetUserMediaError(e) {
  logErr('getUserMedia failed:', e.name, e.message);
  setStatus('error', `Error: ${e.name}`);

  let title, body, hint;
  switch (e.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      title = 'NotAllowedError — Camera Permission Denied';
      body  = 'The user or browser policy blocked camera access.';
      hint  = 'Click the camera icon in Chrome address bar and choose "Allow".';
      break;
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      title = 'NotFoundError — No Camera Found';
      body  = 'No camera device was found on this machine.';
      hint  = 'Connect a webcam and try again.';
      break;
    case 'NotReadableError':
    case 'TrackStartError':
      title = 'NotReadableError — Camera In Use';
      body  = 'The camera is currently used by another application.';
      hint  = 'Close Zoom, Teams, OBS, etc., and try again.';
      break;
    case 'OverconstrainedError':
      title = 'OverconstrainedError — Constraint Rejected';
      body  = `Camera rejected constraint: ${e.constraint ?? 'unspecified'}.`;
      hint  = 'The camera hardware does not support the exact requested constraint.';
      break;
    default:
      title = `${e.name} — Unexpected Error`;
      body  = e.message || 'An unknown error occurred.';
      hint  = 'Check DevTools console for details.';
  }
  showError(title, body, hint);
}

// ─── Event Listeners & Window Hooks ───────────────────────────────────────────

window.addEventListener('resize', () => { if (_running) _syncCanvasSize(); });

elBtnStart.addEventListener('click', () => {
  startCamera(640, 480, 30, 15, false).catch((e) => {
    logErr('startCamera() threw unexpectedly:', e);
    setStatus('error', 'Unexpected error — see console.');
  });
});

elBtnStop.addEventListener('click', () => { stopCamera(); });

elBtnDeepDiag.addEventListener('click', () => {
  runDeepDiagnostics().catch((e) => {
    logErr('runDeepDiagnostics() threw error:', e);
  });
});

// ─── Development Test Controls (Risk Overlay Demo Mode) ─────────────────────

function applyTestRisk(prob) {
  _isDemoMode = true;
  const result = _riskEngine.evaluate(prob, 0.95);
  if (_riskOverlay) {
    _riskOverlay.update(result, true);
  }

  safeSetText(elDfStatus, result.label);
  safeSetText(elDfProb, `${Math.round(result.probability * 100)}%`);
  safeSetText(elDfConf, `${Math.round(result.confidence * 100)}%`);
  safeSetText(elDfRisk, result.label);
  safeSetText(elDfFps, 'N/A (DEMO)');
  safeSetText(elDfLatency, 'N/A (DEMO)');
  safeSetText(elDfSource, 'TEST / SIMULATED');

  if (elAnalysisBadge) {
    elAnalysisBadge.textContent = `DEMO / TEST MODE (${result.label})`;
    elAnalysisBadge.style.background = 'rgba(250,204,21,0.15)';
    elAnalysisBadge.style.color = '#facc15';
    elAnalysisBadge.style.borderColor = 'rgba(250,204,21,0.3)';
  }
}

function resetTestRisk() {
  _isDemoMode = false;
  if (_riskOverlay) {
    _riskOverlay.update(null, false);
  }

  safeSetText(elDfStatus, 'WAITING FOR MODEL');
  safeSetText(elDfProb, '--');
  safeSetText(elDfConf, '--');
  safeSetText(elDfRisk, '--');
  safeSetText(elDfFps, '--');
  safeSetText(elDfLatency, '--');
  safeSetText(elDfSource, '--');

  if (elAnalysisBadge) {
    elAnalysisBadge.textContent = 'WAITING FOR MODEL';
    elAnalysisBadge.style.background = 'rgba(255,255,255,0.06)';
    elAnalysisBadge.style.color = 'var(--text-dim)';
    elAnalysisBadge.style.borderColor = 'var(--border)';
  }
}

if (elBtnTestSafe)       elBtnTestSafe.addEventListener('click', () => applyTestRisk(0.15));
if (elBtnTestSuspicious) elBtnTestSuspicious.addEventListener('click', () => applyTestRisk(0.50));
if (elBtnTestHigh)       elBtnTestHigh.addEventListener('click', () => applyTestRisk(0.90));
if (elBtnTestReset)      elBtnTestReset.addEventListener('click', resetTestRisk);

// ─── Boot ─────────────────────────────────────────────────────────────────────

log('Detector page loaded');
validateDetectorDOM();

if (!navigator?.mediaDevices?.getUserMedia) {
  warn('navigator.mediaDevices.getUserMedia is not available.');
  showError(
    'API Unavailable',
    'navigator.mediaDevices.getUserMedia is not available.',
    'Ensure you are running Chrome 55+.'
  );
  elBtnStart.disabled = true;
}

_initPipelineModules();
