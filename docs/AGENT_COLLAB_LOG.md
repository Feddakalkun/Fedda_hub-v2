# AGENT COLLABORATION LOG

---

## [2026-04-01 19:16 Europe/Oslo] Claude — Session start / LTX T2V fix

### Goal
Fix LTX T2V "no output, no error" bug. Establish protocol compliance and log structure.

### Root cause identified
`ComfyUI-LTXVideo` custom node was outdated — architecture definition mismatch:
- Node expected `scale_shift_table` shape `[6, 4096]`
- `ltx-2.3-22b-dev.safetensors` (22B model) has `[9, 4096]`
- RuntimeError in `comfy/model_base.py:317` during `load_state_dict`

### Files changed
- `H:\Final\060326\comfyuifeddafront\scripts\update_logic.ps1` — Added `$CriticalNodes` block that force-updates `ComfyUI-LTXVideo`, `RES4LYF`, `ComfyUI-KJNodes` on every `update.bat` run (bypasses `$NeedNodeUpdate` weekly throttle)
- `H:\Final\060326\comfyuifeddafrontclean\scripts\update_logic.ps1` — Identical content (already synced, confirmed via diff)

### Verification
- `Verified`: Both repos have identical `update_logic.ps1` with fix
- `Pending validation`: User needs to run `update.bat` then `run.bat` to apply fix

### Other changes this session (in install folder only)
- `frontend/src/components/video/LipsyncTab.tsx`: steps default 4→14 — **reverted by user/linter back to 4**
- `frontend/src/services/comfyService.ts`: onError callback added — **reverted by user/linter**
- `frontend/src/contexts/ComfyExecutionContext.tsx`: onError handler — **reverted by user/linter**

### Observation: repo state
- Install folder (`comfyuifeddafront`) is AHEAD of clean repo in LtxT2vTab.tsx (copilot + GGUF), VideoPage.tsx (error panel, VRAM free)
- Clean repo has unstaged Codex changes in LoRADownloader, SettingsPage, lora_service.py, Sidebar, install.ps1
- **Assumption**: These should be committed and synced to install

### Open issues
- LipsyncTab steps=4 (was reverted — possibly intentional, needs clarification)
- Copilot prompt and GGUF features in install's LtxT2vTab not yet ported to clean repo
- VideoPage improvements in install not yet in clean repo

### Next step for next agent
Commit Codex's unstaged changes, then sync install's LtxT2vTab/VideoPage improvements into clean repo.

---

## [2026-04-01 19:35 Europe/Oslo] Claude — Repo sync + verification

### Goal
Bring clean repo to parity with install. Commit Codex's unstaged changes.

### What happened
- Ran `git add -A && git commit` in clean repo → `16ed738` (WIP backup)
- Committed Codex's changes: LoRADownloader, SettingsPage, Sidebar, lora_service.py, install.ps1, all docs
- Attempted PowerShell copy of 23 files install→clean. After copy, `git status` showed no changes.
- Root cause: differences were CRLF/LF only. Content was already identical. Confirmed via `diff` with `tr -d '\r'`.

### Verification
- **VERIFIED**: `npm run build` passes (1940 modules, no TS errors)
- **VERIFIED**: backend syntax OK (lora_service.py, social_service.py)
- **VERIFIED**: clean repo content = install repo content (line endings aside)
- **VERIFIED**: Both repos have `$CriticalNodes` fix in update_logic.ps1

### Files effectively in clean repo now (via WIP backup commit)
- `backend/lora_service.py` — Codex LoRA pack rewrite
- `frontend/src/components/LoRADownloader.tsx` — Codex UX rewrite  
- `frontend/src/components/ModelDownloader.tsx` — minor additions
- `frontend/src/components/layout/Sidebar.tsx` — LoRA Library removed
- `frontend/src/pages/SettingsPage.tsx` — LoRA Models tab + more model groups
- `scripts/install.ps1` — additions
- `frontend/src/pages/VideoPage.tsx` — error panel, VRAM free on done/error
- `frontend/src/components/video/LtxT2vTab.tsx` — copilot prompt integration, GGUF backend selector
- + 15 other files synced

### Open
- LTX T2V: PENDING user running `update.bat`
- UI menu review: next task

---

## [2026-04-01 19:55 Europe/Oslo] Claude — Z-Image Generate fixes

### Goal
Fix 3 issues in Z-Image Generate tab per user review.

### Changes
1. **PromptInput.tsx** — Removed `Library` button + `PromptLibrary` import/state/JSX. Added `loraNames?: string[]` prop. Enhance prompt now prefixes LLM input with active character LoRA names to preserve character identity.
2. **GenerateTab.tsx** — Passes `selectedLoras.map(l => l.name)` as `loraNames` to PromptInput.
3. **ImagePage.tsx** — Added `collapsible` + `collapseKey="image_preview_collapsed"` to WorkbenchShell. Gallery panel now toggles; left pane expands to full width when hidden.

### Verification
- **VERIFIED**: `tsc --noEmit` passes, no type errors
- **VERIFIED**: Files synced to install folder
- **VERIFIED**: Committed `3aa6aed`
- **PENDING VALIDATION**: Runtime behavior (LoRA context in enhance prompt, gallery collapse toggle)

### Note on LoRA
The LoRA IS being injected into the workflow correctly (node 126, Power Lora Loader). The enhance prompt issue was the LLM not knowing the character — now fixed by passing character name as context prefix.

### Next
Continue menu review: HQ Image tab.
