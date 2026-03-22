"""
Simple FastAPI server for audio transcription
Runs on port 8000
"""
import sys
import threading
import requests
import base64
import re
from pathlib import Path

# Add backend directory to Python path
sys.path.insert(0, str(Path(__file__).parent))

from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import uvicorn
from audio_service import transcribe_audio, save_temp_audio, cleanup_temp_audio, text_to_speech, get_available_voices, unload_audio_models
from lipsync_service import generate_lipsync
from lora_service import start_lora_download, get_download_status, refresh_comfy_models, sync_premium_folder, get_installed_premium_loras
try:
    import tiktok_service
except ImportError as e:
    print(f"[WARNING] TikTok service not available: {e}")
    tiktok_service = None
from typing import Optional
from pydantic import BaseModel
import json
import urllib.request
import urllib.error
import subprocess
import shutil

app = FastAPI()

# Register voice streaming WebSocket (/ws/voice)
try:
    from voice_streaming import register_voice_websocket
    register_voice_websocket(app)
    print("[OK] Voice streaming WebSocket registered at /ws/voice")
except Exception as e:
    print(f"[WARN] Voice streaming not available: {e}")

# CORS for frontend  configurable via env var for Docker/RunPod
import os
CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174").split(",")
# Base URL prefix for ComfyUI view URLs returned to frontend
# Desktop: "http://127.0.0.1:8199" (direct), Docker: "/comfy" (Nginx proxy)
COMFY_VIEW_BASE = os.environ.get("COMFY_VIEW_BASE", "http://127.0.0.1:8199")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/audio/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    """
    Transcribe audio using ComfyUI Whisper workflow
   
    Args:
        audio: Audio file (webm, mp3, wav, etc.)
    
    Returns:
        JSON with transcribed text
    """
    temp_path = None
    try:
        # Save uploaded file
        audio_data = await audio.read()
        temp_path = save_temp_audio(audio_data, audio.filename or "recording.webm")
        
        # Transcribe
        text = transcribe_audio(temp_path)
        
        return {"text": text, "success": True}
        
    except Exception as e:
        print(f"[ERROR] Transcription error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    
    finally:
        # Cleanup temp file
        if temp_path:
            cleanup_temp_audio(temp_path)


# Request models
class TTSRequest(BaseModel):
    text: str
    voice_style: str = "female, clear voice"


@app.post("/api/audio/tts")
async def generate_speech(request: TTSRequest):
    """
    Generate speech from text using ComfyUI Qwen TTS workflow
    
    Args:
        text: Text to convert to speech
        voice_style: Voice style description
    
    Returns:
        Audio file
    """
    try:
        # Generate TTS
        audio_path = text_to_speech(request.text, request.voice_style)
        
        # Return audio file with correct media type
        ext = audio_path.suffix.lower()
        media_types = {".wav": "audio/wav", ".mp3": "audio/mpeg", ".flac": "audio/flac"}
        media_type = media_types.get(ext, "audio/wav")
        return FileResponse(
            path=str(audio_path),
            media_type=media_type,
            filename=f"tts_{audio_path.name}"
        )
        
    except Exception as e:
        print(f"[ERROR] TTS error: {e}")
        raise HTTPException(status_code=500, detail=str(e))



@app.get("/api/audio/voices")
async def list_voices():
    """Return available TTS voices for the frontend dropdown."""
    return {"voices": get_available_voices(), "success": True}


@app.post("/api/audio/unload")
async def unload_audio():
    """Unload all audio/TTS/STT models from VRAM to free memory for image generation."""
    unload_audio_models()
    return {"success": True, "message": "Audio models unloaded from VRAM"}


class AudioReferenceRequest(BaseModel):
    url: str


@app.post("/api/audio/reference-info")
async def get_audio_reference_info(req: AudioReferenceRequest):
    """
    Analyze a YouTube track reference URL and return metadata that can guide ACE prompts.
    """
    url = req.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="Reference URL is required")

    if not ("youtube.com" in url or "youtu.be" in url):
        raise HTTPException(status_code=400, detail="Only YouTube URLs are supported right now")

    try:
        cmd = [
            "yt-dlp",
            "--dump-single-json",
            "--no-playlist",
            "--skip-download",
            url,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=45)
        if result.returncode != 0:
            stderr = (result.stderr or "").strip()
            raise HTTPException(status_code=500, detail=stderr or "yt-dlp failed to analyze URL")

        data = json.loads(result.stdout)
        title = data.get("title") or ""
        uploader = data.get("uploader") or data.get("channel") or ""
        duration = data.get("duration") or 0
        description = data.get("description") or ""
        tags = data.get("tags") or []
        categories = data.get("categories") or []

        # Keep payload compact for the frontend and LLM context.
        description_preview = description[:1000]
        tag_preview = tags[:20] if isinstance(tags, list) else []
        category_preview = categories[:8] if isinstance(categories, list) else []

        return {
            "success": True,
            "title": title,
            "uploader": uploader,
            "duration_seconds": duration,
            "description": description_preview,
            "tags": tag_preview,
            "categories": category_preview,
            "webpage_url": data.get("webpage_url") or url,
        }
    except HTTPException:
        raise
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="yt-dlp is not installed on backend")
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse yt-dlp metadata response")
    except Exception as e:
        print(f"Audio reference analyze error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/video/lipsync")
async def generate_lipsync_video(
    image: UploadFile = File(...),
    audio: UploadFile = File(...),
    resolution: int = Form(512),
    seed: int = Form(-1),
    prompt: str = Form("woman talking"),
    steps: int = Form(15)
):
    """
    Generate LipSync video from Image + Audio
    """
    image_path = None
    audio_path = None
    try:
        # Save temp files
        image_data = await image.read()
        audio_data = await audio.read()
        
        # Allow png/jpg extensions
        img_ext = Path(image.filename).suffix if image.filename else ".png"
        aud_ext = Path(audio.filename).suffix if audio.filename else ".wav"
        
        image_path = save_temp_audio(image_data, f"temp_face{img_ext}")
        audio_path = save_temp_audio(audio_data, f"temp_voice{aud_ext}")
        
        # Generate
        video_path = generate_lipsync(
            image_path=image_path,
            audio_path=audio_path,
            resolution=resolution,
            seed=seed,
            steps=steps,
            prompt=prompt
        )
        
        return FileResponse(
            path=str(video_path),
            media_type="video/mp4",
            filename=video_path.name
        )
        
    except Exception as e:
        print(f"[ERROR] LipSync error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/hardware/stats")
async def get_hardware_stats():
    """
    Get hardware statistics like GPU temperature using nvidia-smi.
    """
    try:
        # Run nvidia-smi to get temp and memory
        # Format: temperature.gpu, utilization.gpu, name
        cmd = ["nvidia-smi", "--query-gpu=temperature.gpu,utilization.gpu,gpu_name,memory.used,memory.total", "--format=csv,noheader,nounits"]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        
        lines = result.stdout.strip().split("\n")
        if not lines:
            return {"error": "No GPU data found"}
            
        # Parse the first GPU
        temp, util, name, mem_used, mem_total = [x.strip() for x in lines[0].split(",")]
        
        return {
            "gpu": {
                "name": name,
                "temperature": int(temp),
                "utilization": int(util),
                "memory": {
                    "used": int(mem_used),
                    "total": int(mem_total),
                    "percentage": round((int(mem_used) / int(mem_total)) * 100, 1)
                }
            },
            "status": "ok"
        }
    except Exception as e:
        # Fallback if no NVIDIA GPU or command fails
        print(f"[ERROR] GPU Stats Error: {e}")
        return {"status": "error", "message": "NVIDIA GPU not detected or driver error"}

@app.get("/api/system/node-install-status")
async def node_install_status():
    """
    RunPod node-install progress for first boot optimization.
    Safe outside RunPod: returns marker existence and optional bg log tail.
    """
    workspace = Path("/workspace")
    core_marker = workspace / ".nodes_core_installed"
    full_marker = workspace / ".nodes_full_installed"
    bg_log = Path("/var/log/node_install_bg.log")

    tail = []
    if bg_log.exists():
        try:
            lines = bg_log.read_text(encoding="utf-8", errors="ignore").splitlines()
            tail = lines[-20:]
        except Exception:
            tail = []

    phase = "pending"
    if core_marker.exists() and not full_marker.exists():
        phase = "core_ready_full_installing"
    elif full_marker.exists():
        phase = "completed"

    return {
        "success": True,
        "phase": phase,
        "core_installed": core_marker.exists(),
        "full_installed": full_marker.exists(),
        "bg_log_tail": tail,
    }

@app.get("/health")
async def health():
    """Health check endpoint"""
    return {"status": "ok"}


# === PREMIUM LORA DOWNLOADS ===

class LoraInstallRequest(BaseModel):
    url: str
    filename: str

@app.post("/api/lora/install")
async def install_lora(req: LoraInstallRequest):
    """
    Start downloading a LoRA in the background.
    """
    try:
        # Prevent path traversal attacks by validating filename
        if ".." in req.filename or "/" in req.filename or "\\" in req.filename:
             raise HTTPException(status_code=400, detail="Invalid filename")
        
        result = start_lora_download(req.url, req.filename)
        return result
    except Exception as e:
        print(f"[ERROR] LoRA Install trigger error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/lora/download-status/{filename}")
async def get_lora_status(filename: str):
    """
    Check the current status/progress of a specific download.
    """
    return get_download_status(filename)


@app.post("/api/lora/sync-premium")
async def sync_premium_loras():
    """
    Download ALL premium LoRAs from Google Drive folder.
    Skips already-installed files.
    """
    try:
        result = sync_premium_folder()
        return result
    except Exception as e:
        print(f"[ERROR] Sync premium error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/lora/installed")
async def list_installed_loras():
    """
    Check which premium LoRAs are installed on disk.
    Returns { filename: size_mb } for each installed LoRA.
    """
    try:
        installed = get_installed_premium_loras()
        return {"success": True, "installed": installed}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/comfy/refresh-models")
async def manual_refresh_models():
    """
    Manually trigger a refresh of ComfyUI models.
    """
    success = refresh_comfy_models()
    if success:
        return {"success": True, "message": "Models refreshed"}
    else:
        return {"success": False, "error": "ComfyUI not ready or refresh failed"}


# === RUNPOD CLOUD INTEGRATION ===

class RunPodFileDesc(BaseModel):
    filename: str
    subfolder: str = ""
    type: str = "output"

class RunPodAnimateRequest(BaseModel):
    files: list[RunPodFileDesc]
    runpod_url: str
    runpod_token: str = ""

@app.post("/api/runpod/animate")
async def trigger_runpod_animation(req: RunPodAnimateRequest):
    """
    Sends selected files to a RunPod endpoint to generate a Wan2.1 video loop
    """
    try:
        import copy
        comfy_dir = Path(__file__).parent.parent / "ComfyUI"
        
        # 1. Resolve local file paths
        local_files = []
        for fdesc in req.files:
            base_dir = comfy_dir / fdesc.type
            if fdesc.subfolder:
                fpath = base_dir / fdesc.subfolder / fdesc.filename
            else:
                fpath = base_dir / fdesc.filename
            if fpath.exists():
                local_files.append(fpath)
                
        if not local_files:
            raise HTTPException(status_code=400, detail="No valid files selected on disk.")
            
        # 2. Upload images to RunPod
        upload_url = req.runpod_url.replace("/prompt", "/upload/image")
        remote_filenames = []
        
        headers = {}
        if req.runpod_token:
            headers["Authorization"] = f"Bearer {req.runpod_token}"
            
        print(f"[INFO] Uploading {len(local_files)} images to RunPod...")
        for fpath in local_files:
            with open(fpath, 'rb') as f:
                res = requests.post(upload_url, headers=headers, files={'image': (fpath.name, f, 'image/png')})
                res.raise_for_status()
                remote_name = res.json().get("name")
                if remote_name:
                    remote_filenames.append(remote_name)
                    
        if not remote_filenames:
            raise HTTPException(status_code=500, detail="Failed to upload any images to RunPod.")
            
        # 3. Load Workflow
        workflow_path = Path(__file__).parent / "workflows" / "videos" / "final_runpod_prompt.json"
        if not workflow_path.exists():
            raise HTTPException(status_code=500, detail="RunPod workflow JSON not found on server.")
            
        with open(workflow_path, "r", encoding="utf-8") as wf_file:
            wf = json.load(wf_file)
            
        # 4. Inject Images (Auto-Loop if we have fewer images than LoadImage nodes)
        load_image_nodes = [n_id for n_id, data in wf.items() if isinstance(data, dict) and data.get("class_type") == "LoadImage"]
        load_image_nodes.sort()
        
        for i, node_id in enumerate(load_image_nodes):
            if i < 6:
                safe_index = i % len(remote_filenames)
                wf[node_id]["inputs"]["image"] = remote_filenames[safe_index]
                
        # (Optional) Inject default RunPod limits or tokens here. Let's send it!
        payload = {"prompt": wf}
        
        print(f"[INFO] Sending job to {req.runpod_url}")
        req_kwargs = {
            "json": payload,
            "headers": {
                "Content-Type": "application/json"
            }
        }
        if req.runpod_token:
            req_kwargs["headers"]["Authorization"] = f"Bearer {req.runpod_token}"
            
        job_res = requests.post(req.runpod_url, **req_kwargs)
        job_res.raise_for_status()
        
        job_data = job_res.json()
        return {"success": True, "prompt_id": job_data.get("prompt_id", "UNKNOWN")}

    except requests.exceptions.HTTPError as he:
        print(f"RunPod HTTP Error: {he.response.text}")
        raise HTTPException(status_code=he.response.status_code, detail=f"RunPod Endpoint Error: {he.response.text}")
    except Exception as e:
        print(f"[ERROR] RunPod Integration Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class RunPodStatusRequest(BaseModel):
    prompt_id: str
    runpod_url: str
    runpod_token: str = ""

@app.post("/api/runpod/status")
async def check_runpod_status(req: RunPodStatusRequest):
    """
    Proxy status check to RunPod ComfyUI instance.
    Checks /history/{prompt_id} for job completion and output files.
    Also checks /queue for position info.
    """
    try:
        base_url = req.runpod_url.replace("/prompt", "")
        headers = {}
        if req.runpod_token:
            headers["Authorization"] = f"Bearer {req.runpod_token}"

        # Check history for completed job
        history_url = f"{base_url}/history/{req.prompt_id}"
        history_res = requests.get(history_url, headers=headers, timeout=10)

        if history_res.status_code == 200:
            history_data = history_res.json()

            if req.prompt_id in history_data:
                job = history_data[req.prompt_id]
                status_info = job.get("status", {})
                completed = status_info.get("completed", False)
                status_msg = status_info.get("status_str", "unknown")

                # Extract output files if completed
                output_files = []
                if job.get("outputs"):
                    for node_output in job["outputs"].values():
                        for key in ["images", "gifs", "videos"]:
                            if node_output.get(key):
                                for f in node_output[key]:
                                    output_files.append({
                                        "filename": f.get("filename", ""),
                                        "subfolder": f.get("subfolder", ""),
                                        "type": f.get("type", "output"),
                                        "preview_url": f"{base_url}/view?filename={f.get('filename', '')}&subfolder={f.get('subfolder', '')}&type={f.get('type', 'output')}"
                                    })

                return {
                    "status": "completed" if completed else status_msg,
                    "completed": completed,
                    "outputs": output_files,
                    "prompt_id": req.prompt_id
                }

        # Not in history yet - check queue position
        queue_url = f"{base_url}/queue"
        try:
            queue_res = requests.get(queue_url, headers=headers, timeout=5)
            if queue_res.status_code == 200:
                queue_data = queue_res.json()
                running = queue_data.get("queue_running", [])
                pending = queue_data.get("queue_pending", [])

                # Check if currently running
                for item in running:
                    if len(item) > 1 and item[1] == req.prompt_id:
                        return {"status": "processing", "completed": False, "outputs": [], "prompt_id": req.prompt_id}

                # Check queue position
                for idx, item in enumerate(pending):
                    if len(item) > 1 and item[1] == req.prompt_id:
                        return {"status": f"queued (position {idx + 1})", "completed": False, "outputs": [], "prompt_id": req.prompt_id}
        except Exception:
            pass  # Queue check is best-effort

        return {"status": "pending", "completed": False, "outputs": [], "prompt_id": req.prompt_id}

    except requests.exceptions.Timeout:
        return {"status": "pod_loading", "completed": False, "outputs": [], "prompt_id": req.prompt_id}
    except Exception as e:
        print(f"[ERROR] RunPod Status Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class RunPodDownloadRequest(BaseModel):
    runpod_url: str
    runpod_token: str = ""
    filename: str
    subfolder: str = ""
    file_type: str = "output"

@app.post("/api/runpod/download")
async def download_runpod_output(req: RunPodDownloadRequest):
    """
    Download a completed file from RunPod and save it locally to ComfyUI output.
    """
    try:
        base_url = req.runpod_url.replace("/prompt", "")
        headers = {}
        if req.runpod_token:
            headers["Authorization"] = f"Bearer {req.runpod_token}"

        view_url = f"{base_url}/view?filename={req.filename}&subfolder={req.subfolder}&type={req.file_type}"
        download_res = requests.get(view_url, headers=headers, timeout=120, stream=True)
        download_res.raise_for_status()

        # Save to local ComfyUI output
        comfy_output = Path(__file__).parent.parent / "ComfyUI" / "output" / "runpod"
        comfy_output.mkdir(parents=True, exist_ok=True)

        local_path = comfy_output / req.filename
        with open(local_path, 'wb') as f:
            for chunk in download_res.iter_content(chunk_size=8192):
                f.write(chunk)

        print(f"[INFO] Downloaded from RunPod: {req.filename} -> {local_path}")
        return {
            "success": True,
            "local_path": str(local_path),
            "url": f"{COMFY_VIEW_BASE}/view?filename={req.filename}&subfolder=runpod&type=output"
        }

    except Exception as e:
        print(f"[ERROR] RunPod Download Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# === FILE MANAGEMENT ENDPOINTS ===

@app.get("/api/files/list")
async def list_output_files():
    """
    List all media files in ComfyUI output directory by scanning filesystem
    Returns files with their metadata
    """
    try:
        comfy_output = Path(__file__).parent.parent / "ComfyUI" / "output"
        files_list = []
        
        # Scan all files recursively
        for file_path in comfy_output.rglob("*"):
            if file_path.is_file() and file_path.suffix.lower() in ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm', '.flac', '.wav', '.mp3', '.ogg', '.m4a', '.aac']:
                # Get relative path from output directory
                rel_path = file_path.relative_to(comfy_output)
                
                # Extract subfolder and model info
                subfolder = str(rel_path.parent).replace('\\', '/')
                parts = subfolder.split('/')
                model = parts[0] if len(parts) > 0 and parts[0] != '.' else 'unknown'
                date_folder = parts[1] if len(parts) > 1 else 'unknown'
                
                # Get file stats
                stat = file_path.stat()
                
                files_list.append({
                    "filename": file_path.name,
                    "subfolder": subfolder,
                    "type": "output",
                    "model": model,
                    "dateFolder": date_folder,
                    "size": stat.st_size,
                    "modified": stat.st_mtime,
                    "url": f"{COMFY_VIEW_BASE}/view?filename={file_path.name}&subfolder={subfolder}&type=output"
                })
        
        # Sort by modified time (newest first)
        files_list.sort(key=lambda x: x["modified"], reverse=True)
        
        return {
            "success": True,
            "count": len(files_list),
            "files": files_list
        }
        
    except Exception as e:
        print(f"[ERROR] List files error: {e}")
        raise HTTPException(status_code=500, detail=str(e))



class DeleteFileRequest(BaseModel):
    filename: str
    subfolder: str = ""
    type: str = "output"  # 'output', 'input', or 'temp'

@app.post("/api/files/delete")
async def delete_file(request: DeleteFileRequest):
    """
    Delete a file from ComfyUI output directory
    
    Args:
        filename: Name of file to delete
        subfolder: Subfolder within output (e.g., "z-image/2026-02-07")
        type: 'output', 'input', or 'temp'
    
    Returns:
        Success message
    """
    try:
        # Construct full path
        comfy_dir = Path(__file__).parent.parent / "ComfyUI"
        base_dir = comfy_dir / request.type
        
        if request.subfolder:
            file_path = base_dir / request.subfolder / request.filename
        else:
            file_path = base_dir / request.filename
        
        # Security check - ensure path is within ComfyUI directory
        if not str(file_path.resolve()).startswith(str(comfy_dir.resolve())):
            raise HTTPException(status_code=403, detail="Access denied")
        
        # Delete file
        if file_path.exists():
            file_path.unlink()
            print(f"[OK] Deleted: {file_path}")
            return {"success": True, "message": f"Deleted {request.filename}"}
        else:
            raise HTTPException(status_code=404, detail="File not found")
            
    except HTTPException:
        raise  # Re-raise HTTPExceptions as-is
    except Exception as e:
        print(f"[ERROR] Delete error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/files/cleanup")
async def cleanup_orphaned_files():
    """
    Clean up orphaned files in output directory that are not in ComfyUI history
    Returns list of deleted files
    """
    try:
        import requests
        
        # Get ComfyUI history
        history_response = requests.get("http://127.0.0.1:8199/history")
        history = history_response.json()
        
        # Extract all valid filenames from history
        valid_files = set()
        for prompt_data in history.values():
            if prompt_data.get("outputs"):
                for output in prompt_data["outputs"].values():
                    if output.get("images"):
                        for img in output["images"]:
                            valid_files.add(img["filename"])
                    if output.get("gifs"):
                        for gif in output["gifs"]:
                            valid_files.add(gif["filename"])
                    if output.get("videos"):
                        for vid in output["videos"]:
                            valid_files.add(vid["filename"])
        
        # Scan output directory
        comfy_output = Path(__file__).parent.parent / "ComfyUI" / "output"
        deleted_files = []
        
        for file_path in comfy_output.rglob("*"):
            if file_path.is_file() and file_path.suffix in ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4']:
                if file_path.name not in valid_files:
                    file_path.unlink()
                    deleted_files.append(str(file_path.relative_to(comfy_output)))
                    print(f"[OK] Cleaned up: {file_path.name}")
        
        return {
            "success": True,
            "deleted_count": len(deleted_files),
            "deleted_files": deleted_files
        }
        
    except Exception as e:
        print(f"[ERROR] Cleanup error: {e}")
        raise HTTPException(status_code=500, detail=str(e))



@app.get("/api/lora/descriptions")
async def get_lora_descriptions():
    """
    Scan LoRA folders for description.txt files.
    Returns a map of { "lora_relative_path.safetensors": "description text" }
    Keys match the format returned by ComfyUI's object_info API.
    """
    try:
        loras_dir = Path(__file__).parent.parent / "ComfyUI" / "models" / "loras"
        descriptions = {}

        for desc_file in loras_dir.rglob("description.txt"):
            text = desc_file.read_text(encoding="utf-8").strip()
            if not text:
                continue

            # Find all .safetensors files in the same directory
            for safetensor in desc_file.parent.glob("*.safetensors"):
                # Key = relative path from loras dir, using backslashes (Windows ComfyUI format)
                rel_path = str(safetensor.relative_to(loras_dir))
                descriptions[rel_path] = text

        return {"success": True, "descriptions": descriptions}

    except Exception as e:
        print(f"Error scanning LoRA descriptions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# === PROMPT LIBRARY ENDPOINTS ===

PROMPT_LIBRARY_PATH = Path(__file__).parent.parent / "config" / "prompt_library.json"

@app.get("/api/prompts/library")
async def get_prompt_library():
    """
    Serve the harvested prompt library JSON.
    Returns all prompts with metadata (title, positive, negative, characters, category, source).
    """
    try:
        if not PROMPT_LIBRARY_PATH.exists():
            return {"success": False, "error": "Prompt library not found. Run the harvester first.", "prompts": [], "total_prompts": 0}
        data = json.loads(PROMPT_LIBRARY_PATH.read_text(encoding="utf-8"))
        return {"success": True, **data}
    except Exception as e:
        print(f"Error reading prompt library: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/prompts/harvest")
async def run_harvester():
    """
    Re-run the prompt harvester script to refresh the library.
    This scans all generate_*.py files and rebuilds prompt_library.json.
    """
    try:
        harvester_path = Path(__file__).parent / "prompt_harvester.py"
        if not harvester_path.exists():
            raise HTTPException(status_code=404, detail="Harvester script not found")
        result = subprocess.run(
            [sys.executable, str(harvester_path)],
            capture_output=True, text=True, timeout=120
        )
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=result.stderr or "Harvester failed")
        # Read updated library
        data = json.loads(PROMPT_LIBRARY_PATH.read_text(encoding="utf-8"))
        return {"success": True, "total_prompts": data.get("total_prompts", 0), "message": "Prompt library refreshed!"}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Harvester timed out after 120s")
    except Exception as e:
        print(f"Harvest error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# === WILDCARD ENDPOINTS ===

WILDCARDS_DIR = Path(__file__).parent.parent / "config" / "wildcards"

@app.get("/api/wildcards/list")
async def list_wildcards():
    """
    List all .txt wildcard files in the ComfyUI/wildcards folder.
    Returns names and a small preview of content.
    """
    try:
        if not WILDCARDS_DIR.exists():
            WILDCARDS_DIR.mkdir(parents=True, exist_ok=True)
            return {"success": True, "wildcards": []}
            
        wildcards = []
        for f in WILDCARDS_DIR.glob("*.txt"):
            lines = f.read_text(encoding="utf-8").splitlines()
            lines = [l.strip() for l in lines if l.strip()]
            wildcards.append({
                "name": f.stem,
                "count": len(lines),
                "preview": lines[:5]
            })
            
        return {"success": True, "wildcards": wildcards}
    except Exception as e:
        print(f"Error listing wildcards: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/wildcards/expand")
async def expand_wildcards(text: str):
    """
    Takes a prompt string and replaces any __wildcard__ tags with random lines
    from the corresponding text files in ComfyUI/wildcards.
    """
    try:
        import re
        import random
        
        def replace_tag(match):
            wildcard_name = match.group(1)
            fpath = WILDCARDS_DIR / f"{wildcard_name}.txt"
            if fpath.exists():
                lines = fpath.read_text(encoding="utf-8").splitlines()
                lines = [l.strip() for l in lines if l.strip()]
                if lines:
                    return random.choice(lines)
            return match.group(0) # Return original if not found
            
        expanded = re.sub(r"__(.*?)__", replace_tag, text)
        return {"success": True, "original": text, "expanded": expanded}
    except Exception as e:
        print(f"Wildcard expansion error: {e}")
        return {"success": False, "error": str(e), "expanded": text}


# === MODEL MANAGER ===

COMFY_MODELS_DIR = Path(__file__).parent.parent / "ComfyUI" / "models"

REQUIRED_MODELS = {
    "z-image": [
        {
            "id": "unet",
            "name": "z_image_turbo_bf16.safetensors",
            "url": "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors",
            "path": "diffusion_models/z_image_turbo_bf16.safetensors",
            "size_gb": 11.5
        },
        {
            "id": "clip",
            "name": "qwen_3_4b.safetensors",
            "url": "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors",
            "path": "clip/qwen_3_4b.safetensors",
            "size_gb": 7.5
        },
        {
            "id": "vae",
            "name": "z-image-vae.safetensors",
            "url": "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors",
            "path": "vae/z-image-vae.safetensors",
            "size_gb": 0.312
        },
        {
            "id": "controlnet",
            "name": "Z-Image-Turbo-Fun-Controlnet-Union.safetensors",
            "url": "https://huggingface.co/alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union/resolve/main/Z-Image-Turbo-Fun-Controlnet-Union.safetensors",
            "path": "model_patches/Z-Image-Turbo-Fun-Controlnet-Union.safetensors",
            "size_gb": 2.89
        },
        {
            "id": "depth",
            "name": "lotus-depth-g-v2-0-disparity.safetensors",
            "url": "https://huggingface.co/jingheya/lotus-depth-g-v2-0-disparity/resolve/main/unet/diffusion_pytorch_model.safetensors",
            "path": "diffusion_models/lotus-depth-g-v2-0-disparity.safetensors",
            "size_gb": 3.23
        },
        {
            "id": "sd-vae",
            "name": "vae-ft-mse-840000-ema-pruned.safetensors",
            "url": "https://huggingface.co/stabilityai/sd-vae-ft-mse-original/resolve/main/vae-ft-mse-840000-ema-pruned.safetensors",
            "path": "vae/vae-ft-mse-840000-ema-pruned.safetensors",
            "size_gb": 0.319
        },
        {
            "id": "face-detect",
            "name": "face_yolov8m.pt",
            "url": "https://huggingface.co/Bingsu/adetailer/resolve/main/face_yolov8m.pt",
            "path": "ultralytics/bbox/face_yolov8m.pt",
            "size_gb": 0.048
        },
        {
            "id": "sam",
            "name": "sam_vit_b_01ec64.pth",
            "url": "https://huggingface.co/scenario-labs/sam_vit/resolve/main/sam_vit_b_01ec64.pth",
            "path": "sams/sam_vit_b_01ec64.pth",
            "size_gb": 0.349
        }
        ],
    "ace-step": [
        {
            "id": "ace-unet",
            "name": "acestep_v1.5_turbo.safetensors",
            "url": "https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/split_files/diffusion_models/acestep_v1.5_turbo.safetensors",
            "path": "diffusion_models/acestep_v1.5_turbo.safetensors",
            "size_gb": 4.46
        },
        {
            "id": "ace-clip-small",
            "name": "qwen_0.6b_ace15.safetensors",
            "url": "https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/split_files/text_encoders/qwen_0.6b_ace15.safetensors",
            "path": "text_encoders/qwen_0.6b_ace15.safetensors",
            "size_gb": 1.11
        },{
            "id": "ace-vae",
            "name": "ace_1.5_vae.safetensors",
            "url": "https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/split_files/vae/ace_1.5_vae.safetensors",
            "path": "vae/ace_1.5_vae.safetensors",
            "size_gb": 0.314
        }
    ],
    "qwen-angle": [
        {
            "id": "qwen-unet",
            "name": "Qwen-Image-Edit-2511-FP8_e4m3fn.safetensors",
            "url": "https://huggingface.co/1038lab/Qwen-Image-Edit-2511-FP8/resolve/main/Qwen-Image-Edit-2511-FP8_e4m3fn.safetensors",
            "path": "diffusion_models/Qwen-Image-Edit-2511-FP8_e4m3fn.safetensors",
            "size_gb": 19.03
        },
        {
            "id": "qwen-clip",
            "name": "qwen_2.5_vl_7b_fp8_scaled.safetensors",
            "url": "https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors",
            "path": "text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors",
            "size_gb": 8.74
        },
        {
            "id": "qwen-vae",
            "name": "qwen_image_vae.safetensors",
            "url": "https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors",
            "path": "vae/qwen_image_vae.safetensors",
            "size_gb": 0.242
        },
        {
            "id": "qwen-angle-lora",
            "name": "qwen-image-edit-2511-multiple-angles-lora.safetensors",
            "url": "https://huggingface.co/fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA/resolve/main/qwen-image-edit-2511-multiple-angles-lora.safetensors",
            "path": "loras/qwen-image-edit-2511-multiple-angles-lora.safetensors",
            "size_gb": 0.281
        },
        {
            "id": "qwen-lightning-lora",
            "name": "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
            "url": "https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning/resolve/main/Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
            "path": "loras/Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
            "size_gb": 0.810
        }
    ],
    "lipsync": [
        {
            "id": "wan-infinite-unet",
            "name": "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
            "url": "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
            "path": "diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
            "size_gb": 13.32
        },
        {
            "id": "wan-high-unet",
            "name": "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors",
            "url": "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors",
            "path": "diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors",
            "size_gb": 13.32
        },
        {
            "id": "ltx-lipsync",
            "name": "ltx-2-19b-dev-fp8.safetensors",
            "url": "https://huggingface.co/Lightricks/LTX-2/resolve/main/ltx-2-19b-dev-fp8.safetensors",
            "path": "checkpoints/ltx-2-19b-dev-fp8.safetensors",
            "size_gb": 19.3
        }
    ]
}

# Scene Builder uses the same WAN models as Lipsync
REQUIRED_MODELS["scene-builder"] = REQUIRED_MODELS["lipsync"]

# LTX-2.3 (22B) - Image-to-Video and Text-to-Video share the same model set
# No FP8 variants exist yet for 2.3 - full BF16 checkpoints
# Audio VAE is embedded in the checkpoint - no separate VAE needed
# Uses Comfy-Org single-file Gemma-3 repack (not the 5-shard Google version)
# LoRA paths use ltxv/ltx2/ subfolder as expected by official workflows
REQUIRED_MODELS["ltx-i2v"] = [
    {
        "id": "ltx23-checkpoint-dev",
        "name": "ltx-2.3-22b-dev.safetensors",
        "url": "https://huggingface.co/Lightricks/LTX-2.3/resolve/main/ltx-2.3-22b-dev.safetensors",
        "path": "checkpoints/ltx-2.3-22b-dev.safetensors",
        "size_gb": 43.0
    },
    {
        "id": "ltx23-gemma3-text-encoder",
        "name": "comfy_gemma_3_12B_it.safetensors",
        "url": "https://huggingface.co/Comfy-Org/ltx-2/resolve/main/split_files/text_encoders/gemma_3_12B_it.safetensors",
        "path": "text_encoders/comfy_gemma_3_12B_it.safetensors",
        "size_gb": 22.71
    },
    {
        "id": "ltx23-distilled-lora",
        "name": "ltx-2.3-22b-distilled-lora-384.safetensors",
        "url": "https://huggingface.co/Lightricks/LTX-2.3/resolve/main/ltx-2.3-22b-distilled-lora-384.safetensors",
        "path": "loras/ltxv/ltx2/ltx-2.3-22b-distilled-lora-384.safetensors",
        "size_gb": 7.1
    },
    {
        "id": "ltx23-spatial-upscaler",
        "name": "ltx-2.3-spatial-upscaler-x2-1.0.safetensors",
        "url": "https://huggingface.co/Lightricks/LTX-2.3/resolve/main/ltx-2.3-spatial-upscaler-x2-1.0.safetensors",
        "path": "latent_upscale_models/ltx-2.3-spatial-upscaler-x2-1.0.safetensors",
        "size_gb": 0.93
    },
    {
        "id": "ltx23-temporal-upscaler",
        "name": "ltx-2.3-temporal-upscaler-x2-1.0.safetensors",
        "url": "https://huggingface.co/Lightricks/LTX-2.3/resolve/main/ltx-2.3-temporal-upscaler-x2-1.0.safetensors",
        "path": "latent_upscale_models/ltx-2.3-temporal-upscaler-x2-1.0.safetensors",
        "size_gb": 0.25
    }
]

# T2V uses the same models as I2V
REQUIRED_MODELS["ltx-t2v"] = REQUIRED_MODELS["ltx-i2v"]

download_progress = {} # { model_id: { downloaded: 0, total: 0, status: 'idle' } }

def start_download(model_info, hf_token=None):
    """Download a model using curl (fast, resume-capable) with file-size progress tracking."""
    import time
    model_id = model_info['id']
    target_path = COMFY_MODELS_DIR / model_info['path']
    target_path.parent.mkdir(parents=True, exist_ok=True)

    total_bytes = int(model_info.get('size_gb', 0) * 1024**3)
    download_progress[model_id] = {"status": "downloading", "downloaded": 0, "total": total_bytes, "name": model_info['name'], "speed": 0, "eta": 0}

    try:
        # Build curl command with optional Hugging Face token
        curl_cmd = [
            'curl', '-L', '-C', '-',
            '-o', str(target_path),
            '--connect-timeout', '30',
            '--retry', '3',
            '--retry-delay', '5',
            '-S', '-s'
        ]

        # Add HF token if available (from UI or environment variable)
        token = hf_token or os.getenv('HF_TOKEN')
        if token and 'huggingface.co' in model_info['url']:
            curl_cmd.extend(['-H', f'Authorization: Bearer {token}'])
            print(f"[DOWNLOAD] Using HF_TOKEN for authentication (source: {'UI' if hf_token else 'ENV'})")

        curl_cmd.append(model_info['url'])

        print(f"[DOWNLOAD] Starting {model_info['name']} ({model_info['size_gb']}GB) from {model_info['url'][:80]}...")
        process = subprocess.Popen(curl_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        # Poll file size for progress while curl runs
        last_log_time = 0
        last_speed_size = 0
        last_speed_time = time.time()
        while process.poll() is None:
            if target_path.exists():
                current_size = target_path.stat().st_size
                current_time = time.time()
                download_progress[model_id]['downloaded'] = current_size

                # Calculate speed and ETA
                elapsed = current_time - last_speed_time
                if elapsed >= 2:
                    speed_bytes = (current_size - last_speed_size) / elapsed
                    download_progress[model_id]['speed'] = speed_bytes
                    if speed_bytes > 0 and total_bytes > 0:
                        remaining = total_bytes - current_size
                        download_progress[model_id]['eta'] = remaining / speed_bytes
                    last_speed_size = current_size
                    last_speed_time = current_time

                # Log progress every 10 seconds
                if current_time - last_log_time >= 10:
                    progress_gb = current_size / (1024**3)
                    percent = (current_size / total_bytes * 100) if total_bytes > 0 else 0
                    speed_mb = download_progress[model_id].get('speed', 0) / (1024**2)
                    eta_s = download_progress[model_id].get('eta', 0)
                    eta_str = f"{int(eta_s//60)}m{int(eta_s%60)}s" if eta_s > 0 else "..."
                    print(f"[DOWNLOAD] {model_id}: {progress_gb:.2f}GB / {model_info['size_gb']}GB ({percent:.1f}%) @ {speed_mb:.1f}MB/s ETA {eta_str}")
                    last_log_time = current_time
            time.sleep(1)

        if process.returncode == 0 and target_path.exists():
            final_size = target_path.stat().st_size
            download_progress[model_id]['downloaded'] = final_size
            download_progress[model_id]['total'] = final_size
            download_progress[model_id]['status'] = "completed"
            print(f"Download complete: {model_info['name']} ({final_size / (1024**3):.2f} GB)")
        else:
            stderr = process.stderr.read().decode().strip()
            print(f"Download error for {model_id}: curl exit {process.returncode} - {stderr}")
            download_progress[model_id]['status'] = "error"
            download_progress[model_id]['error'] = stderr or f"curl exit code {process.returncode}"
    except FileNotFoundError:
        # curl not found, fall back to Python requests
        print(f"curl not found, falling back to Python requests for {model_id}")
        _download_with_requests(model_info)
    except Exception as e:
        print(f"Download error for {model_id}: {e}")
        download_progress[model_id]['status'] = "error"
        download_progress[model_id]['error'] = str(e)

def _download_with_requests(model_info):
    """Fallback download using Python requests if curl is unavailable."""
    model_id = model_info['id']
    target_path = COMFY_MODELS_DIR / model_info['path']
    try:
        response = requests.get(model_info['url'], stream=True, timeout=30)
        total_size = int(response.headers.get('content-length', 0))
        download_progress[model_id]['total'] = total_size
        with open(target_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=1024*1024):
                if chunk:
                    f.write(chunk)
                    download_progress[model_id]['downloaded'] += len(chunk)
        download_progress[model_id]['status'] = "completed"
    except Exception as e:
        print(f"Fallback download error for {model_id}: {e}")
        download_progress[model_id]['status'] = "error"
        download_progress[model_id]['error'] = str(e)

@app.get("/api/models/status")
async def get_models_status(group: str = "z-image"):
    """Check which models are missing and verify file sizes."""
    if group not in REQUIRED_MODELS:
        return {"success": False, "error": "Unknown model group"}
    
    results = []
    for m in REQUIRED_MODELS[group]:
        full_path = COMFY_MODELS_DIR / m['path']
        exists = full_path.exists()
        
        # Basic corruption check: if file exists but much smaller than expected
        # Skip check if the file is currently being downloaded
        is_corrupt = False
        current_prog = download_progress.get(m['id'], {"status": "idle", "downloaded": 0, "total": 0})
        is_downloading = current_prog.get('status') == 'downloading'

        if exists and not is_downloading:
            fsize_gb = full_path.stat().st_size / (1024**3)
            threshold = 0.5 if m['size_gb'] < 1.0 else 0.95
            if fsize_gb < (m['size_gb'] * threshold):
                is_corrupt = True

        # If actively downloading, DON'T report as exists (even if file is growing on disk)
        model_exists = exists and not is_corrupt and not is_downloading

        # Clear stale progress for installed models (only completed/error, NEVER downloading)
        if model_exists and current_prog.get('status') in ('completed', 'error'):
            current_prog = {"status": "idle", "downloaded": 0, "total": 0}
            download_progress.pop(m['id'], None)

        results.append({
            **m,
            "exists": model_exists,
            "is_corrupt": is_corrupt,
            "actual_size_gb": round(full_path.stat().st_size / (1024**3), 3) if exists else 0,
            "progress": current_prog
        })
    
    return {"success": True, "models": results}

@app.post("/api/models/download")
async def trigger_download(model_id: str, group: str = "z-image", hf_token: Optional[str] = None):
    """Trigger background download for a specific model."""
    if group not in REQUIRED_MODELS:
        return {"success": False, "error": "Unknown group"}

    model_to_download = next((m for m in REQUIRED_MODELS[group] if m['id'] == model_id), None)
    if not model_to_download:
        return {"success": False, "error": "Model ID not found"}

    # Auto-purge corrupt/incomplete files (less than 50% of expected size)
    target_path = COMFY_MODELS_DIR / model_to_download['path']
    if target_path.exists():
        fsize_gb = target_path.stat().st_size / (1024**3)
        expected_gb = model_to_download.get('size_gb', 0)
        if expected_gb > 0 and fsize_gb < (expected_gb * 0.5):
            print(f"Auto-purging incomplete file: {target_path.name} ({fsize_gb:.3f}GB vs expected {expected_gb}GB)")
            try:
                target_path.unlink()
            except Exception as e:
                print(f"Failed to auto-purge {target_path}: {e}")

    # Pre-set progress so frontend sees "downloading" immediately (before thread starts)
    total_bytes = int(model_to_download.get('size_gb', 0) * 1024**3)
    download_progress[model_id] = {"status": "downloading", "downloaded": 0, "total": total_bytes, "name": model_to_download['name'], "speed": 0, "eta": 0}

    # Start thread with optional HF token
    thread = threading.Thread(target=start_download, args=(model_to_download, hf_token))
    thread.start()

    return {"success": True, "message": f"Download started for {model_id}"}


@app.post("/api/models/purge")
async def purge_models(group: str = "z-image"):
    """Delete models in a group to allow clean redownload."""
    if group not in REQUIRED_MODELS:
        return {"success": False, "error": "Unknown group"}
    
    purged = []
    for m in REQUIRED_MODELS[group]:
        fpath = COMFY_MODELS_DIR / m['path']
        if fpath.exists():
            try:
                fpath.unlink()
                purged.append(m['id'])
            except Exception as e:
                print(f"Failed to delete {fpath}: {e}")
                
    return {"success": True, "purged": purged}


# ============================================================================
# TIKTOK ENDPOINTS
# ============================================================================

class TikTokDownloadRequest(BaseModel):
    url: str
    cookie_source: str = "none"
    limit: Optional[int] = None

class TikTokCaptionRequest(BaseModel):
    frame_paths: list
    method: str = "ollama"
    model: str = "llava"

class TikTokExtractRequest(BaseModel):
    video_path: str
    count: int = 6

def _check_tiktok():
    if tiktok_service is None:
        raise HTTPException(status_code=503, detail="TikTok service not available")

@app.post("/api/tiktok/download-profile")
async def tiktok_download_profile(req: TikTokDownloadRequest):
    _check_tiktok()
    job_id = tiktok_service.download_profile(req.url, req.cookie_source, req.limit)
    return {"job_id": job_id, "status": "started"}

@app.post("/api/tiktok/download-video")
async def tiktok_download_video(req: TikTokDownloadRequest):
    _check_tiktok()
    job_id = tiktok_service.download_single_video(req.url, req.cookie_source)
    return {"job_id": job_id, "status": "started"}

@app.get("/api/tiktok/download-status/{job_id}")
async def tiktok_download_status(job_id: str):
    _check_tiktok()
    raw = tiktok_service.get_download_progress(job_id)
    # Normalize status for frontend compatibility
    status = raw.get("status", "not_found")
    if status == "completed":
        status = "done"
    # Build a human-readable message from the log
    log = raw.get("log", [])
    message = log[-1] if log else ""
    return {
        "status": status,
        "message": message,
        "progress": raw.get("progress", 0),
        "log": log,
        "videos": raw.get("videos", []),
        "downloaded": len(raw.get("videos", [])),
    }

@app.get("/api/tiktok/profiles")
async def tiktok_list_profiles():
    _check_tiktok()
    return {"profiles": tiktok_service.list_profiles()}

@app.get("/api/tiktok/videos/{profile}")
async def tiktok_list_videos(profile: str):
    _check_tiktok()
    videos = tiktok_service.list_videos(profile)
    # Add thumbnail_url for each video (generate lazily)
    for v in videos:
        try:
            thumb = tiktok_service.get_video_thumbnail(v["path"])
            v["thumbnail_url"] = thumb
        except Exception:
            v["thumbnail_url"] = None
    return {"videos": videos}

@app.post("/api/tiktok/extract-frames")
async def tiktok_extract_frames(req: TikTokExtractRequest):
    _check_tiktok()
    try:
        frame_paths = tiktok_service.extract_frames(req.video_path, req.count)
        # Return as objects so frontend can access .path
        return {"frames": [{"path": p} for p in frame_paths]}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/tiktok/frames/{video_id}")
async def tiktok_get_frames(video_id: str):
    _check_tiktok()
    return {"frames": tiktok_service.get_frames(video_id)}

@app.post("/api/tiktok/caption-frames")
async def tiktok_caption_frames(req: TikTokCaptionRequest):
    _check_tiktok()
    job_id = tiktok_service.caption_frames(req.frame_paths, req.method, req.model)
    return {"job_id": job_id, "status": "started"}

@app.get("/api/tiktok/caption-status/{job_id}")
async def tiktok_caption_status(job_id: str):
    _check_tiktok()
    raw = tiktok_service.get_caption_status(job_id)
    # Normalize status: backend uses "completed", frontend expects "done"
    normalized = dict(raw)
    if normalized.get("status") == "completed":
        normalized["status"] = "done"
    return normalized

@app.get("/api/tiktok/serve/{path:path}")
async def tiktok_serve_file(path: str):
    _check_tiktok()
    file_path = tiktok_service.get_file_path(path)
    if file_path is None:
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(str(file_path))

# ============================================================================
# Chat with IF_AI_tools (via ComfyUI workflow)
# ============================================================================

class ChatRequest(BaseModel):
    messages: list
    model: str = "qwen2.5-3b-instruct"


def _parse_vision_prompt_response(raw: str):
    """Parse model output into (description, suggestions) with forgiving fallbacks."""
    text = (raw or "").strip()
    if not text:
        return "", []

    # Remove fenced markdown wrappers.
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)

    # Try full JSON first.
    try:
        parsed = json.loads(text)
    except Exception:
        parsed = None

    # Try extracting first JSON object if model surrounded it with prose.
    if parsed is None:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                parsed = json.loads(text[start:end + 1])
            except Exception:
                parsed = None

    if isinstance(parsed, dict):
        description = str(parsed.get("description", "")).strip()
        suggestions = parsed.get("suggestions", [])
        if not isinstance(suggestions, list):
            suggestions = []
        suggestions = [str(s).strip() for s in suggestions if str(s).strip()]
        return description, suggestions[:3]

    # Plain text fallback:
    lines = [ln.strip("-* \t") for ln in text.splitlines() if ln.strip()]
    description = lines[0] if lines else text[:180]
    suggestions = []
    for ln in lines[1:]:
        if len(ln) > 20:
            suggestions.append(ln)
        if len(suggestions) >= 3:
            break
    return description, suggestions


@app.get("/api/ollama/vision-models")
async def ollama_vision_models():
    """Return installed Ollama models that are likely vision-capable."""
    try:
        resp = requests.get("http://127.0.0.1:11434/api/tags", timeout=10)
        if resp.status_code != 200:
            raise HTTPException(status_code=500, detail=f"Ollama returned HTTP {resp.status_code}")

        data = resp.json()
        models = data.get("models", []) if isinstance(data, dict) else []
        names = []
        for m in models:
            name = str(m.get("name", "")).strip()
            if not name:
                continue
            lowered = name.lower()
            if any(k in lowered for k in ["vision", "llava", "joycaption", "moondream", "minicpm-v"]):
                names.append(name)

        names = sorted(set(names))
        return {"success": True, "models": names, "default": names[0] if names else "llava"}
    except HTTPException:
        raise
    except requests.RequestException as e:
        raise HTTPException(status_code=500, detail=f"Ollama request failed: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/video/analyze-image-prompt")
async def analyze_image_prompt(
    image: UploadFile = File(...),
    model: str = Form("llava"),
):
    """
    Analyze a source image with a vision model and return:
    - short scene description
    - 3 motion prompt suggestions for Image-to-Video
    """
    try:
        image_bytes = await image.read()
        if not image_bytes:
            raise HTTPException(status_code=400, detail="Empty image upload")

        image_b64 = base64.b64encode(image_bytes).decode("utf-8")

        messages = [
            {
                "role": "system",
                "content": (
                    "You are an expert prompt engineer for image-to-video generation. "
                    "Return ONLY valid JSON with keys: description (string), suggestions (array of 3 strings). "
                    "Each suggestion must describe realistic motion/camera action while preserving identity/style of the source image."
                ),
            },
            {
                "role": "user",
                "content": (
                    "Analyze this image. "
                    "1) Write a concise visual description (1-2 sentences). "
                    "2) Provide exactly 3 different motion prompt ideas for image-to-video. "
                    "The prompts should be cinematic, specific, and production-ready."
                ),
                "images": [image_b64],
            },
        ]

        payload = {
            "model": model,
            "messages": messages,
            "stream": False,
            "options": {"num_predict": 500, "num_ctx": 4096},
        }

        resp = requests.post("http://127.0.0.1:11434/api/chat", json=payload, timeout=90)
        if resp.status_code != 200:
            detail = resp.text[:400] if resp.text else f"Ollama returned HTTP {resp.status_code}"
            raise HTTPException(status_code=500, detail=detail)

        out = resp.json()
        content = out.get("message", {}).get("content", "").strip()
        if not content:
            raise HTTPException(status_code=500, detail="Vision model returned empty response")

        description, suggestions = _parse_vision_prompt_response(content)

        # Robust fallback if model didn't follow format perfectly.
        if not description:
            description = "Image analyzed, but the model did not return a structured description."
        while len(suggestions) < 3:
            suggestions.append("Subtle camera push-in while the subject naturally shifts posture and expression.")

        return {
            "success": True,
            "description": description,
            "suggestions": suggestions,
            "model": model,
        }
    except HTTPException:
        raise
    except requests.RequestException as e:
        raise HTTPException(status_code=500, detail=f"Ollama request failed: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/chat")
async def chat_with_llm(request: ChatRequest):
    """Chat using Ollama directly (local) or IF_AI_tools (RunPod)."""
    is_runpod = os.environ.get("RUNPOD_POD_ID") is not None

    if is_runpod:
        # RunPod: route through ComfyUI IF_AI_tools
        try:
            # Try multiple paths (Docker vs local layout)
            for p in [
                Path(__file__).parent.parent / "frontend" / "dist" / "workflows" / "if-ai-chat.json",  # Docker
                Path(__file__).parent.parent / "public" / "workflows" / "if-ai-chat.json",              # Local
                Path(__file__).parent.parent / "frontend" / "public" / "workflows" / "if-ai-chat.json", # Dev
            ]:
                if p.exists():
                    workflow_path = p
                    break
            else:
                # List what actually exists for debugging
                base = Path(__file__).parent.parent
                print(f"Chat workflow not found. Base dir: {base}")
                print(f"  frontend/dist exists: {(base / 'frontend' / 'dist').exists()}")
                print(f"  frontend/dist/workflows exists: {(base / 'frontend' / 'dist' / 'workflows').exists()}")
                if (base / "frontend" / "dist" / "workflows").exists():
                    print(f"  files: {list((base / 'frontend' / 'dist' / 'workflows').iterdir())}")
                return {"success": False, "error": "Chat workflow file not found on server"}

            workflow = json.loads(workflow_path.read_text())
            print(f"[Chat] Loaded workflow from {workflow_path}")

            # Build prompt from messages
            prompt = "\n".join([f"{m['role']}: {m['content']}" for m in request.messages])
            workflow["1"]["inputs"]["prompt"] = prompt

            # Submit to ComfyUI
            comfy_url = "http://127.0.0.1:8199"
            response = requests.post(f"{comfy_url}/prompt", json={"prompt": workflow})

            # Check if ComfyUI rejected the workflow (e.g. unknown node types)
            if response.status_code != 200:
                error_text = response.text
                print(f"[Chat] ComfyUI rejected workflow: {error_text}")
                return {"success": False, "error": f"ComfyUI rejected workflow: {error_text[:200]}"}

            resp_json = response.json()
            if "error" in resp_json:
                print(f"[Chat] ComfyUI error: {resp_json['error']}")
                return {"success": False, "error": f"ComfyUI error: {resp_json['error']}"}
            if "node_errors" in resp_json and resp_json["node_errors"]:
                print(f"[Chat] Node errors: {resp_json['node_errors']}")
                return {"success": False, "error": f"Workflow node errors: {json.dumps(resp_json['node_errors'])[:200]}"}

            prompt_id = resp_json["prompt_id"]
            print(f"[Chat] Queued prompt_id={prompt_id}, waiting for result...")

            # Poll for result (model download on first use can take a while)
            import time
            for i in range(120):  # 120s timeout for first-time model download
                time.sleep(1)
                history_resp = requests.get(f"{comfy_url}/history/{prompt_id}")
                history = history_resp.json()
                if prompt_id in history:
                    entry = history[prompt_id]
                    if entry.get("outputs"):
                        outputs = entry["outputs"]
                        # Try to find text output in any node
                        for node_id, node_output in outputs.items():
                            if "text" in node_output:
                                text = node_output["text"]
                                result = text[0] if isinstance(text, list) else text
                                print(f"[Chat] Got response from node {node_id}: {result[:100]}...")
                                return {"response": result, "success": True}
                        print(f"[Chat] Outputs found but no text: {list(outputs.keys())}")
                        return {"success": False, "error": "LLM produced output but no text found"}
                    # Check if execution failed
                    if entry.get("status", {}).get("status_str") == "error":
                        msgs = entry.get("status", {}).get("messages", [])
                        print(f"[Chat] Execution error: {msgs}")
                        return {"success": False, "error": f"Workflow execution failed: {str(msgs)[:200]}"}

            return {"success": False, "error": "LLM response timeout (120s) — model may still be downloading"}
        except Exception as e:
            print(f"Chat error (RunPod): {e}")
            import traceback
            traceback.print_exc()
            return {"success": False, "error": str(e)}
    else:
        # Local: call Ollama directly
        try:
            ollama_payload = json.dumps({
                "model": request.model,
                "messages": request.messages,
                "stream": False,
                "keep_alive": "30s",
                "options": {"num_predict": 500, "num_ctx": 4096},
            }).encode("utf-8")
            req = urllib.request.Request(
                "http://127.0.0.1:11434/api/chat",
                data=ollama_payload,
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                result = json.loads(resp.read().decode("utf-8"))
                reply = result.get("message", {}).get("content", "")
                return {"response": reply, "success": True}
        except Exception as e:
            print(f"Chat error (Ollama): {e}")
            raise HTTPException(status_code=500, detail=f"Ollama error: {e}")


if __name__ == "__main__":
    print("FEDDA Backend starting on port 8000...")
    uvicorn.run(app, host="0.0.0.0", port=8000)







