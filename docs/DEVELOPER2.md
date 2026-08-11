# TruthLens AI – Developer 2 Notes

> **Role**: Developer 2 – Browser Extension / UI / Pipeline  
> **Scope**: Chrome Extension, overlays, video pipeline, face detection integration, ONNX wiring  
> **Status**: Sprint 1 – Architecture scaffolding complete

---

## Repository Layout

```
truthlens-ai/
├── extension/                    ← Chrome Extension root (load this folder)
│   ├── manifest.json             ← Manifest V3 definition
│   ├── icons/                    ← 16×16, 48×48, 128×128 PNGs
│   ├── background/
│   │   └── service-worker.js     ← MV3 service worker (state + message router)
│   ├── content/
│   │   └── content.js            ← Pipeline orchestrator (injected into pages)
│   ├── popup/
│   │   ├── popup.html            ← Extension popup UI
│   │   ├── popup.css
│   │   └── popup.js              ← Popup controller (talks to SW via messages)
│   ├── overlay/
│   │   ├── overlay.js            ← Floating HUD injected into page
│   │   └── overlay.css
│   ├── capture/
│   │   └── video-source.js       ← RAF frame loop + video discovery
│   ├── detection/
│   │   └── face-detector.js      ← Face detection stub (MediaPipe TBD)
│   ├── inference/
│   │   └── inference-provider.js ← Inference abstraction layer
│   ├── risk/
│   │   └── risk-engine.js        ← Score → LOW/SUSPICIOUS/HIGH classifier
│   └── utils/
│       └── logger.js             ← TLLogger global
└── docs/
    └── DEVELOPER2.md             ← This file
```

---

## Pipeline Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   BROWSER PAGE (content script)          │
│                                                         │
│  ┌──────────────┐    ┌─────────────────┐               │
│  │  VideoSource  │───▶│  FaceDetector   │               │
│  │  (RAF loop)   │    │  (stub → MP)    │               │
│  └──────────────┘    └────────┬────────┘               │
│                               │ FaceCrop (ImageData)    │
│                      ┌────────▼────────┐               │
│                      │InferenceProvider│               │
│                      │  ┌───────────┐  │               │
│                      │  │  Mock ✓   │  │  ← active now │
│                      │  │  ONNX  □  │  │  ← TBD        │
│                      │  └───────────┘  │               │
│                      └────────┬────────┘               │
│                               │ InferenceResult         │
│                      ┌────────▼────────┐               │
│                      │   RiskEngine    │               │
│                      │ LOW/SUSP/HIGH   │               │
│                      └────────┬────────┘               │
│                               │ RiskResult              │
│              ┌────────────────▼────────────────┐       │
│              │          TLOverlay (HUD)          │       │
│              └───────────────────────────────────┘       │
└─────────────────────────────────────────────────────────┘

         ▲                                           ▲
         │  chrome.runtime.sendMessage               │
         ▼                                           ▼
┌──────────────────┐                     ┌──────────────────┐
│  Service Worker  │◀────────────────────│     Popup UI      │
│  (state store)   │                     │  (START/STOP btn) │
└──────────────────┘                     └──────────────────┘
```

---

## How to Load the Extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle, top-right)
3. Click **Load unpacked**
4. Select the `extension/` folder inside this repository
5. The TruthLens AI icon will appear in the toolbar

> To reload after code changes: click the **↺ refresh** icon on the extension card.

---

## Inference Provider Abstraction

The pipeline **never** imports a concrete model directly.  
All inference calls go through the facade:

```js
// Switch to mock (default):
InferenceProvider.use(MockInferenceProvider);

// Switch to ONNX (once Developer 1's model is ready):
await ONNXInferenceProvider.load(chrome.runtime.getURL('models/truthlens.onnx'));
InferenceProvider.use(ONNXInferenceProvider);
```

The `predict()` contract:
```js
// Input:  ImageData | HTMLCanvasElement | null
// Output: { risk: float [0–1], status: string, modelVersion: string, latencyMs: number }
const result = await InferenceProvider.predict(faceImageData);
```

---

## Risk Engine Thresholds

| Score range | Status      |
|-------------|-------------|
| `< 0.35`    | LOW         |
| `0.35–0.65` | SUSPICIOUS  |
| `≥ 0.65`    | HIGH        |

> ⚠️ **NOT scientifically validated.** Prototype placeholders only.  
> Developer 1 will provide calibrated thresholds after model evaluation.

To update at runtime:
```js
RiskEngine.setThresholds({ lowMax: 0.30, highMin: 0.70 });
```

---

## What Is Mocked (Sprint 1)

| Component          | Status            | Notes                                     |
|--------------------|-------------------|-------------------------------------------|
| Inference          | ✅ Mock active    | Random scores; NOT real detection         |
| Face detection     | ✅ Stub (full frame) | Returns full frame; MediaPipe TBD      |
| Video source       | ✅ Functional RAF | Finds `<video>` on page; webcam TBD       |
| Overlay            | ✅ Functional     | Injects, updates, removes cleanly         |
| Popup              | ✅ Functional     | Start/Stop/metrics display                |
| ONNX inference     | ⬜ Stub only      | Wires in after Developer 1 exports model  |
| MediaPipe faces    | ⬜ Next sprint    | `FaceDetector.detect()` stub ready        |
| Google Meet        | ⬜ Future sprint  | Architecture clean; no MG-specific code   |
| Backend / server   | ❌ Not planned    | All inference runs client-side            |

---

## Permissions Used

```json
"permissions": ["storage", "activeTab"]
```

- `storage` – persist protection on/off state and metrics across popup open/close
- `activeTab` – forward START/STOP commands to the current tab's content script

No `tabs`, `<all_urls>` host permissions, `webRequest`, `camera`, or `microphone` permissions are requested.

---

## Next Sprint Checklist (Developer 2)

- [ ] Integrate MediaPipe FaceMesh into `face-detector.js`
- [ ] Implement `getUserMedia` / `MediaStream` capture in `video-source.js`
- [ ] Wire `ONNXInferenceProvider.load()` once `truthlens.onnx` is available
- [ ] Add visual alert (flash border) on HIGH risk
- [ ] Add audio alert on HIGH risk (Web Audio API ping)
- [ ] Implement FPS throttling controls in popup
- [ ] Google Meet-specific video element targeting
- [ ] Accessibility: ARIA live regions on overlay updates

---

## Notes for Developer 1

When your ONNX model is exported, provide:

1. `truthlens.onnx` – place in `extension/models/`
2. Input tensor spec: shape, dtype, normalization used
3. Output tensor spec: index of deepfake probability
4. Recommended inference threshold calibration

Developer 2 will then implement `ONNXInferenceProvider.load()` and `predict()` and flip the active provider with one line.
