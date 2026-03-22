# CLAUDE HANDOFF - 2026-03-22 (FEDDA LTX PROJECT)

## Quick Context
- User is building FEDDA AI Studio with ComfyUI + React frontend + FastAPI backend.
- Primary pain point: LTX Image-to-Video (I2V) speed, consistency, motion quality, and stability on Windows + RTX 3090.
- Two working folders:
  - CLEAN (source of truth / git): `H:\Final\060326\comfyuifeddafrontclean`
  - TEST (runtime user executes): `H:\Final\060326\comfyuifeddafront`
- Repo: `https://github.com/Feddakalkun/comfyuifeddafront` (branch `main`)

## Important Workflow Rule
1. Edit in CLEAN.
2. Commit + push from CLEAN.
3. Copy changed files to TEST for immediate verification.
4. User runs from TEST.

## What Was Already Done Before This Session
- Sidebar hierarchy for Video section (LTX/WAN groupings).
- Added LTX I2V / T2V tabs.
- Added missing custom nodes in config/scripts:
  - ComfyMath (CM_FloatToInt)
  - RES4LYF (ClownSampler_Beta)
- Fixed model metadata in backend `REQUIRED_MODELS`:
  - sizes switched to GiB logic (matching bytes/1024^3 checks)
  - Gemma text encoder URL switched to ungated source.
- Separated update flow:
  - `run.bat` no longer auto-updates
  - `update.bat` created
  - fixed `scripts/update_code.ps1` so ComfyMath is NOT deleted as legacy folder.

## Critical Bugs Diagnosed in This Session
1. Blank/quick runs with no output were often workflow runtime errors, not frontend.
2. Many node schema mismatches in `ltx23-single-stage-api.json` (older schema vs current ComfyUI).
3. LoRA path issue on Windows (`/` vs `\\`) caused "Value not in list".
4. Removed/renamed node issues (`LTXAVTextEncoderLoader` vs `LTXVGemmaCLIPModelLoader`) across versions.
5. ResizeImageMaskNode DynamicCombo V3 was incompatible with API-style workflow payload; replaced path.
6. ComfyUI core had to be updated in TEST to include LTXAV 2.3 support commit.
7. Recent hard crash: `Windows fatal exception: access violation` in `nodes_lt_audio.py` around `comfy.sd.load_clip`.

## Files Changed In This Session (Uncommitted state before final commit)
- `backend/server.py`
- `frontend/public/workflows/ltx23-single-stage-api.json`
- `frontend/src/components/video/LtxI2vTab.tsx`
- `frontend/src/components/video/LtxT2vTab.tsx`
- `frontend/src/config/api.ts`
- `frontend/src/pages/VideoPage.tsx`

## Detailed Functional Changes Added This Session

### A) I2V UX + Quality/Resolution Improvements (`LtxI2vTab.tsx`)
- Auto-detect source image dimensions.
- Auto compute output resolution preserving orientation (portrait remains portrait) with 32-multiple snapping.
- Added Render Plan panel displaying:
  - source dimensions
  - orientation
  - output resolution
  - frames + fps
  - steps
  - long edge
  - pass mode
  - seed mode
- Revised quality presets to meaningful speed tiers:
  - Fast: lower long-edge/steps/fps
  - Balanced: middle
  - Quality: highest

### B) Prompt Intelligence (Image Analysis)
- New backend endpoint: `POST /api/video/analyze-image-prompt`
  - accepts uploaded image + selected vision model
  - calls local Ollama `/api/chat` with image
  - returns structured `description` + `suggestions[]`
  - now robust parsing (handles JSON, fenced JSON, noisy prose fallback)
- New backend endpoint: `GET /api/ollama/vision-models`
  - fetches installed Ollama models from `/api/tags`
  - filters for likely vision-capable names.
- Frontend I2V now has:
  - model dropdown for vision model selection
  - Analyze Image button
  - image description panel
  - clickable prompt suggestions.

### C) Output Separation + Preview Scoping
- I2V and T2V now use distinct output prefixes.
- Video preview logic in `VideoPage.tsx` filters outputs by expected prefix per active tab to reduce cross-tab confusion.

### D) Speed and Consistency P0 Tuning
- Removed auto `freeMemory()` call before every run in I2V/T2V (model cold-reload caused long pre-GPU delays).
- Preset-driven fps introduced:
  - Fast lower fps
  - Balanced medium
  - Quality 24 fps
- Frame count now derived from selected fps (`duration * fps + 1`).
- Added seed lock strategy in I2V:
  - `Seed Lock ON/OFF`
  - sticky seed behavior for repeatability
  - randomize seed button.

### E) Motion Quality P0
- Added subject-motion prioritization toggle in I2V.
- Injects motion-oriented positive prompt suffix (subject movement emphasis).
- Injects anti-zoom anti-static extensions into negative prompt.

### F) Fast Mode Runtime Cut
- For Fast preset in both I2V and T2V:
  - route save output to distilled branch (`['4819',0]`)
  - skip expensive refine-path dependency for the main output.

### G) Crash Mitigation Toggle
- Access violation pointed to CLIP load inside `LTXAVTextEncoderLoader` path.
- Added `Safe Mode CPU Loader` toggle:
  - OFF by default for speed (`device=default`)
  - ON for stability fallback (`device=cpu`).
- Workflow default set back to `device: default` to avoid permanent slowdown.

## Perplexity Research Artifacts
- First response file:
  - `H:\Final\060326\comfyuifeddafront\logs\perplexity\answer.md`
- Second (better, more primary-source constrained) response file:
  - `H:\Final\060326\comfyuifeddafront\logs\perplexity\answer2.md`

### What answer2 clarified
- "LTX 2.1/2.2" are not cleanly separate official model cards in Lightricks HF collection; official anchors are LTX-Video, LTX-2, LTX-2.3.
- Provides primary-source-grounded "known good" parameter references from official cards/code.

## Current User Concerns (still open)
1. 4-second clip still feels too slow.
2. Subject motion still often weak (camera/background drift dominates).
3. Output variability between runs despite short clips.
4. Intermittent ComfyUI stability concerns on Windows.

## Suggested Next Work (for Claude)
1. Measure real runtime breakdown from logs (load vs sample vs decode) and surface in UI.
2. Add explicit preset profiles that mirror official known-good templates (LTX-Video distilled vs LTX-2 two-stage).
3. Add guided motion controls:
   - integrate IC-LoRA toggles in UI (pose/motion-track) when model assets available.
4. Add strict reproducibility mode:
   - lock full config hash (seed, scheduler, sigmas, frames, fps, loras, checkpoint).
5. Add optional first/last-frame workflow route if verified from primary source for target model graph.
6. Add benchmark card in UI for expected duration by preset on RTX 3090.

## Note About Restart Requirements
- Backend endpoints for analyze/prompt suggestions require backend restart after sync.
- Frontend changes require hard refresh (`Ctrl+Shift+R`).
- ComfyUI crash mitigation toggle can be switched without code changes once UI is loaded.

## Most Recent User Request
- User asked to hand off to Claude with full detail and push to GitHub.
- User is currently testing a new run.

