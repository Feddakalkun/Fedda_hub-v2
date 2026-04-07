"""
Fedda Hub v2 — Backend Server (FastAPI)
Minimal, clean starting point. Runs on port 8000.
Handles: health, ComfyUI proxy-status, hardware stats, file management, settings.
Additional services (audio, lora, video) will be added as needed.
"""
import os
import json
import subprocess
import sys
from pathlib import Path
from typing import Optional, Dict, Any

# Ensure backend directory is in sys.path for module imports
backend_dir = os.path.dirname(os.path.abspath(__file__))
if backend_dir not in sys.path:
    sys.path.append(backend_dir)

import requests
import uvicorn
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

# ─────────────────────────────────────────────
# App & CORS
# ─────────────────────────────────────────────
app = FastAPI(title="Fedda Hub v2 Backend", version="0.2.0")

CORS_ORIGINS = os.environ.get(
    "CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────
ROOT_DIR = Path(__file__).parent.parent
CONFIG_DIR = ROOT_DIR / "config"
COMFY_DIR = ROOT_DIR / "ComfyUI"
SETTINGS_PATH = CONFIG_DIR / "runtime_settings.json"
OUTPUT_DIR = COMFY_DIR / "output"

COMFY_URL = os.environ.get("COMFY_URL", "http://127.0.0.1:8199")

# ─────────────────────────────────────────────
# Settings helpers
# ─────────────────────────────────────────────
def load_settings() -> dict:
    try:
        return json.loads(SETTINGS_PATH.read_text(encoding="utf-8")) if SETTINGS_PATH.exists() else {}
    except Exception:
        return {}


def save_settings(data: dict) -> None:
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# ─────────────────────────────────────────────
# Health & Status
# ─────────────────────────────────────────────
@app.get("/health")
async def health():
    """Health check."""
    return {"status": "ok", "version": "0.2.0"}


@app.get("/api/system/comfy-status")
async def comfy_status():
    """Check whether local ComfyUI API is reachable."""
    try:
        resp = requests.get(f"{COMFY_URL}/system_stats", timeout=1.5)
        return {"success": True, "online": resp.ok, "status_code": resp.status_code}
    except Exception as e:
        return {"success": True, "online": False, "error": str(e)}


@app.get("/api/hardware/stats")
async def hardware_stats():
    """GPU hardware stats via nvidia-smi."""
    try:
        cmd = [
            "nvidia-smi",
            "--query-gpu=temperature.gpu,utilization.gpu,gpu_name,memory.used,memory.total",
            "--format=csv,noheader,nounits",
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        parts = [x.strip() for x in result.stdout.strip().split(",")]
        temp, util, name, mem_used, mem_total = parts
        return {
            "gpu": {
                "name": name,
                "temperature": int(temp),
                "utilization": int(util),
                "memory": {
                    "used": int(mem_used),
                    "total": int(mem_total),
                    "percentage": round(int(mem_used) / int(mem_total) * 100, 1),
                },
            },
            "status": "ok",
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


# ─────────────────────────────────────────────
# Settings
# ─────────────────────────────────────────────
class CivitaiKeyRequest(BaseModel):
    api_key: str


@app.post("/api/settings/civitai-key")
async def set_civitai_key(req: CivitaiKeyRequest):
    try:
        data = load_settings()
        data["civitai_api_key"] = req.api_key.strip()
        save_settings(data)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/settings/civitai-key/status")
async def get_civitai_key_status():
    try:
        data = load_settings()
        has_key = bool((data.get("civitai_api_key") or "").strip())
        return {"success": True, "configured": has_key}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────
# File Management (ComfyUI output)
# ─────────────────────────────────────────────
@app.get("/api/files/list")
async def list_files(folder: str = "output", limit: int = 200):
    """List ComfyUI output files."""
    try:
        target = (COMFY_DIR / folder).resolve()
        if not target.exists():
            return {"success": True, "files": []}
        files = []
        for f in sorted(target.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True)[:limit]:
            if f.is_file():
                files.append({
                    "name": f.name,
                    "path": str(f),
                    "size": f.stat().st_size,
                    "modified": f.stat().st_mtime,
                })
        return {"success": True, "files": files}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class DeleteRequest(BaseModel):
    path: str


@app.post("/api/files/delete")
async def delete_file(req: DeleteRequest):
    """Delete a file from ComfyUI output."""
    try:
        target = Path(req.path).resolve()
        comfy_resolved = COMFY_DIR.resolve()
        if not str(target).startswith(str(comfy_resolved)):
            raise HTTPException(status_code=403, detail="Access denied: path outside ComfyUI dir")
        if target.exists():
            target.unlink()
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────
# ComfyUI proxy helpers
# ─────────────────────────────────────────────
@app.post("/api/comfy/refresh-models")
async def refresh_models():
    """Tell ComfyUI to refresh its model list."""
    try:
        resp = requests.post(f"{COMFY_URL}/api/models/refresh", timeout=5)
        return {"success": resp.ok}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ─────────────────────────────────────────────
# Ollama — Prompt Assistant & Image Captioning
# ─────────────────────────────────────────────
OLLAMA_URL = "http://localhost:11434"

OLLAMA_SYSTEM_PROMPTS: Dict[str, str] = {
    "zimage": (
        "You are an expert prompt engineer for Z-Image Turbo, a photorealistic portrait AI model. "
        "Write a vivid, detailed portrait prompt. Include: subject appearance (facial features, expression, hair, "
        "skin tone), clothing and styling, lighting (direction, quality, color temperature — golden hour, dramatic "
        "side-light, soft studio, etc.), camera feel (85mm portrait, shallow depth of field), composition "
        "(close-up, bust, three-quarter), environment/background, and overall mood. "
        "Rules: under 120 words, avoid vague words like 'beautiful' — be specific and cinematic. "
        "Output ONLY the prompt text, nothing else."
    ),
    "ltx-flf": (
        "You are an expert at writing motion prompts for LTX Video 2.3, which generates cinematic video between "
        "two keyframes. Write a prompt describing camera movement and scene motion. Include: camera movement "
        "(slow dolly push, orbital pan, crane rise, handheld drift), subject motion (subtle breathing, head turn, "
        "reaching gesture, hair in wind), atmospheric motion (light shifting, particles, shadow movement), "
        "cinematic style (film grain, anamorphic lens, color grade). "
        "Rules: under 80 words, focus on MOTION and TRANSITION — not static appearance. "
        "Output ONLY the prompt text, nothing else."
    ),
    "ltx-lipsync": (
        "You are writing motion prompts for LTX Video 2.3 lipsync — a portrait photograph comes alive and speaks. "
        "Write a prompt describing video quality and character energy. Include: speaking energy and emotion "
        "(passionate, calm, intense, joyful, authoritative), subtle facial micro-expressions and eye movement, "
        "natural head movement and breathing, background atmosphere and depth, overall video quality style. "
        "Rules: under 70 words, focus on FACIAL ANIMATION and natural human presence. "
        "Output ONLY the prompt text, nothing else."
    ),
    "wan-scene": (
        "You are writing scene transformation prompts for WAN 2.2 AI video generation. "
        "Write a vivid scene as a video generation prompt. Include: visual style or cinematic aesthetic, "
        "primary action or motion, lighting mood and color palette, atmospheric quality. "
        "Rules: under 60 words, be specific and visual, no meta-commentary. "
        "Output ONLY the prompt text, nothing else."
    ),
}


def _get_ollama_text_model() -> Optional[str]:
    """Pick the best available Ollama text model."""
    try:
        resp = requests.get(f"{OLLAMA_URL}/api/tags", timeout=3)
        if not resp.ok:
            return None
        models = [m["name"] for m in resp.json().get("models", [])]
        priority = ["llama3.2", "llama3.1", "llama3", "mistral", "gemma3", "gemma2",
                    "phi4", "phi3", "qwen2.5", "qwen2", "gemma"]
        for p in priority:
            for m in models:
                if p in m.lower() and "vision" not in m.lower() and "embed" not in m.lower():
                    return m
        # Fallback: any non-vision, non-embed model
        for m in models:
            if "vision" not in m.lower() and "embed" not in m.lower():
                return m
        return models[0] if models else None
    except Exception:
        return None


def _get_ollama_vision_model() -> Optional[str]:
    """Pick the best available Ollama vision model."""
    try:
        resp = requests.get(f"{OLLAMA_URL}/api/tags", timeout=3)
        if not resp.ok:
            return None
        models = [m["name"] for m in resp.json().get("models", [])]
        for p in ["llava", "minicpm", "qwen2.5-vl", "qwen2-vl", "moondream", "vision"]:
            for m in models:
                if p in m.lower():
                    return m
        return None
    except Exception:
        return None


@app.get("/api/ollama/models")
async def get_ollama_all_models():
    """List all available Ollama models and best text model."""
    try:
        resp = requests.get(f"{OLLAMA_URL}/api/tags", timeout=3)
        if not resp.ok:
            return {"success": False, "models": [], "text_model": None, "vision_model": None}
        models = [m["name"] for m in resp.json().get("models", [])]
        return {
            "success": True,
            "models": models,
            "text_model": _get_ollama_text_model(),
            "vision_model": _get_ollama_vision_model(),
        }
    except Exception:
        return {"success": False, "models": [], "text_model": None, "vision_model": None}


class OllamaPromptRequest(BaseModel):
    context: str = "zimage"
    mode: str = "enhance"       # "enhance" | "inspire"
    current_prompt: str = ""


@app.post("/api/ollama/prompt")
async def ollama_generate_prompt(req: OllamaPromptRequest):
    """Generate or enhance a prompt using Ollama. Returns SSE stream of tokens."""
    model = _get_ollama_text_model()
    if not model:
        raise HTTPException(status_code=503, detail="No Ollama text model available. Pull a model with: ollama pull llama3.2")

    system = OLLAMA_SYSTEM_PROMPTS.get(req.context, OLLAMA_SYSTEM_PROMPTS["zimage"])

    if req.mode == "enhance" and req.current_prompt.strip():
        user_msg = f"Enhance and rewrite this prompt to be more detailed and cinematic:\n\n{req.current_prompt}"
    else:
        user_msg = "Write a creative, detailed, cinematic prompt. Be inspired and unexpected."

    payload = {
        "model": model,
        "system": system,
        "prompt": user_msg,
        "stream": True,
        "options": {"temperature": 0.85, "num_predict": 250},
    }

    def generate():
        try:
            r = requests.post(f"{OLLAMA_URL}/api/generate", json=payload, stream=True, timeout=60)
            for line in r.iter_lines():
                if not line:
                    continue
                data = json.loads(line)
                token = data.get("response", "")
                if token:
                    yield f"data: {json.dumps({'token': token})}\n\n"
                if data.get("done"):
                    yield "data: [DONE]\n\n"
                    return
        except Exception as exc:
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/ollama/caption")
async def ollama_caption_image(file: UploadFile = File(...)):
    """Caption an uploaded image using an Ollama vision model."""
    import base64

    model = _get_ollama_vision_model()
    if not model:
        raise HTTPException(
            status_code=503,
            detail="No vision model available. Install one with: ollama pull llava or ollama pull minicpm-v"
        )

    img_bytes = await file.read()
    img_b64 = base64.b64encode(img_bytes).decode()

    payload = {
        "model": model,
        "prompt": (
            "Describe this image as a detailed AI generation prompt. Write it as instructions to recreate the image, "
            "not a description of it. Include: subject, appearance details, lighting, composition, mood, style, "
            "background. Under 100 words. Output ONLY the prompt text."
        ),
        "images": [img_b64],
        "stream": False,
        "options": {"temperature": 0.7, "num_predict": 180},
    }

    try:
        r = requests.post(f"{OLLAMA_URL}/api/generate", json=payload, timeout=90)
        r.raise_for_status()
        caption = r.json().get("response", "").strip()
        return {"success": True, "caption": caption, "model": model}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Caption failed: {exc}")


@app.get("/api/ollama/vision-models")
async def get_ollama_vision_models():
    """List available Ollama vision models."""
    try:
        resp = requests.get("http://localhost:11434/api/tags", timeout=3)
        if not resp.ok:
            return {"success": False, "models": []}
        data = resp.json()
        vision_models = [
            m["name"]
            for m in data.get("models", [])
            if any(k in m["name"].lower() for k in ["llava", "vision", "minicpm", "qwen"])
        ]
        return {"success": True, "models": vision_models}
    except Exception:
        return {"success": False, "models": []}


# ─────────────────────────────────────────────
# Workflow & Generation
# ─────────────────────────────────────────────
from workflow_service import workflow_service
from model_downloader import model_downloader
from lora_service import lora_service
import threading
from typing import Dict, Any

class GenerateRequest(BaseModel):
    workflow_id: str
    params: Dict[str, Any]

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload a video or image to ComfyUI's input directory."""
    try:
        content = await file.read()
        resp = requests.post(
            f"{COMFY_URL}/upload/image",
            files={"image": (file.filename, content, file.content_type or "application/octet-stream")},
            timeout=120,
        )
        resp.raise_for_status()
        data = resp.json()
        return {"success": True, "filename": data.get("name", file.filename)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/workflow/list")
async def list_workflows():
    """List available high-level workflows from the mapping."""
    try:
        mapping = workflow_service.load_mapping()
        return {
            "success": True,
            "workflows": [
                {"id": k, "name": v["name"], "description": v.get("description", "")}
                for k, v in mapping.items()
            ]
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.get("/api/workflow/node-map/{workflow_id}")
async def get_workflow_node_map(workflow_id: str):
    """Return nodeId -> {name, classType} map for a workflow (used to show human-readable node names during execution)."""
    try:
        mappings = workflow_service.load_mapping()
        if workflow_id not in mappings:
            raise HTTPException(status_code=404, detail=f"Unknown workflow '{workflow_id}'")
        mapping = mappings[workflow_id]
        path = workflow_service.get_workflow_path(mapping.get("filename", ""))
        if not path:
            raise HTTPException(status_code=404, detail="Workflow file not found")
        with open(path, "r", encoding="utf-8") as f:
            workflow = json.load(f)
        node_map = {}
        for node_id, node in workflow.items():
            if not isinstance(node, dict):
                continue
            class_type = node.get("class_type", "Unknown")
            title = node.get("_meta", {}).get("title") or class_type
            node_map[node_id] = {"name": title, "classType": class_type}
        return {"success": True, "node_map": node_map}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/generate")
async def generate(req: GenerateRequest):
    """
    Core generation endpoint.
    Loads workflow, injects params, and sends to ComfyUI.
    """
    try:
        # 1. Prepare ComfyUI API payload
        payload = workflow_service.prepare_payload(req.workflow_id, req.params)
        if not payload:
            raise HTTPException(status_code=400, detail=f"Failed to prepare workflow '{req.workflow_id}'")

        # 2. Submit to ComfyUI — use the browser's clientId so WS messages route back correctly
        client_id = req.params.get("client_id", "fedda_hub_v2")
        comfy_payload = {"prompt": payload, "client_id": client_id}
        resp = requests.post(f"{COMFY_URL}/prompt", json=comfy_payload, timeout=5)
        
        if not resp.ok:
            error_text = resp.text
            try:
                error_data = resp.json()
                error_msg = error_data.get("error", {}).get("message", "ComfyUI API error")
            except:
                error_msg = error_text
            raise HTTPException(status_code=resp.status_code, detail=error_msg)
            
        return {
            "success": True, 
            "prompt_id": resp.json().get("prompt_id"),
            "message": "Generation started"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/generate/status/{prompt_id}")
async def get_generation_status(prompt_id: str):
    """Check status of a specific generation job. Returns all output files."""
    try:
        # Check history first
        resp = requests.get(f"{COMFY_URL}/history/{prompt_id}", timeout=2)
        if resp.ok:
            data = resp.json()
            if prompt_id in data:
                history = data[prompt_id]
                outputs = history.get("outputs", {})
                images = []
                videos = []
                for node_id, output in outputs.items():
                    # Still images
                    for img in output.get("images", []):
                        images.append({
                            "filename": img["filename"],
                            "subfolder": img.get("subfolder", ""),
                            "type": img.get("type", "output")
                        })
                    # VHS_VideoCombine outputs as 'gifs' (mp4/webp)
                    for vid in output.get("gifs", []):
                        videos.append({
                            "filename": vid["filename"],
                            "subfolder": vid.get("subfolder", ""),
                            "type": vid.get("type", "output")
                        })
                    # Some nodes output 'videos'
                    for vid in output.get("videos", []):
                        videos.append({
                            "filename": vid["filename"],
                            "subfolder": vid.get("subfolder", ""),
                            "type": vid.get("type", "output")
                        })
                return {"success": True, "status": "completed", "images": images, "videos": videos}

        # Check queue
        q_resp = requests.get(f"{COMFY_URL}/queue", timeout=2)
        if q_resp.ok:
            q_data = q_resp.json()
            running = q_data.get("queue_running", [])
            pending = q_data.get("queue_pending", [])
            if any(j[1] == prompt_id for j in running):
                return {"success": True, "status": "running", "images": [], "videos": []}
            if any(j[1] == prompt_id for j in pending):
                return {"success": True, "status": "pending", "images": [], "videos": []}

        return {"success": True, "status": "not_found", "images": [], "videos": []}
    except Exception as e:
        return {"success": False, "error": str(e)}

# ─────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────
@app.post("/api/models/sync-hf")
async def sync_models(repo: str, subfolder: str = "custom"):
    return model_downloader.sync_hf_repo(repo, subfolder)

@app.get("/api/models/status/{filename}")
async def get_download_status(filename: str):
    return model_downloader.get_progress(filename)


# ─────────────────────────────────────────────
# LoRA Library
# ─────────────────────────────────────────────

@app.get("/api/lora/list")
async def lora_list(prefix: str = ""):
    """List installed LoRA paths. Optional ?prefix= filters by subfolder (e.g. zimage_turbo)."""
    loras = lora_service.list_lora_names()
    if prefix:
        norm = prefix.replace("\\", "/").lower().rstrip("/") + "/"
        loras = [l for l in loras if l.replace("\\", "/").lower().startswith(norm)]
    return {"success": True, "loras": loras}


@app.get("/api/lora/installed")
async def lora_installed():
    """Return all installed LoRA files with path + size."""
    return {"success": True, "installed": lora_service.get_installed()}


@app.get("/api/lora/download-status/{filename}")
async def lora_download_status(filename: str):
    return lora_service.get_download_status(filename)


@app.get("/api/lora/pack/{pack_key}/status")
async def pack_status(pack_key: str):
    return lora_service.get_pack_status(pack_key)


@app.get("/api/lora/pack/{pack_key}/catalog")
async def pack_catalog(pack_key: str, limit: int = 1000):
    return lora_service.get_pack_catalog(pack_key, limit)


class SingleDownloadRequest(BaseModel):
    filename: str

@app.post("/api/lora/pack/{pack_key}/sync")
async def pack_sync(pack_key: str):
    return lora_service.sync_pack(pack_key)


@app.post("/api/lora/pack/{pack_key}/download")
async def pack_download_single(pack_key: str, req: SingleDownloadRequest):
    return lora_service.download_single(pack_key, req.filename)


class InstallFreeRequest(BaseModel):
    filename: str

@app.post("/api/lora/install-free")
async def install_free_lora(req: InstallFreeRequest):
    return lora_service.install_free_lora(req.filename)


@app.post("/api/lora/install-all-free")
async def install_all_free():
    return lora_service.install_all_free()


class ImportUrlRequest(BaseModel):
    url: str
    hf_token: Optional[str] = None

@app.post("/api/lora/import-url")
async def lora_import_url(req: ImportUrlRequest):
    return lora_service.import_from_url(req.url, req.hf_token)


@app.get("/api/lora/import-status/{job_id}")
async def lora_import_status(job_id: str):
    return lora_service.get_import_status(job_id)


if __name__ == "__main__":
    print("[Fedda Hub v2] Starting backend on port 8000...")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
