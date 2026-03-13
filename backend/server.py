"""
Simple FastAPI server for audio transcription
Runs on port 8000
"""
import sys
import threading
import requests
from pathlib import Path

# Add backend directory to Python path
sys.path.insert(0, str(Path(__file__).parent))

from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import uvicorn
from audio_service import transcribe_audio, save_temp_audio, cleanup_temp_audio, text_to_speech
from lipsync_service import generate_lipsync
from lora_service import start_lora_download, get_download_status, refresh_comfy_models, sync_premium_folder, get_installed_premium_loras
from model_service import get_all_models_status, start_model_download, get_download_progress
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

# CORS for frontend â€” configurable via env var for Docker/RunPod
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
        print(f"âŒ Transcription error: {e}")
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
        
        # Return audio file
        return FileResponse(
            path=str(audio_path),
            media_type="audio/flac",
            filename=f"tts_{audio_path.name}"
        )
        
    except Exception as e:
        print(f"âŒ TTS error: {e}")
        raise HTTPException(status_code=500, detail=str(e))



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
        print(f"âŒ LipSync error: {e}")
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
        print(f"âš ï¸ GPU Stats Error: {e}")
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
        print(f"âŒ LoRA Install trigger error: {e}")
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
        print(f"âŒ Sync premium error: {e}")
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
        raise HTTPException(status_code=500, detail="Failed to refresh models on ComfyUI side")


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
            
        print(f"â˜ï¸ Uploading {len(local_files)} images to RunPod...")
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
        
        print(f"â˜ï¸ Sending job to {req.runpod_url}")
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
        print(f"âŒ RunPod Integration Error: {e}")
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
        print(f"âŒ RunPod Status Error: {e}")
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

        print(f"âœ… Downloaded from RunPod: {req.filename} -> {local_path}")
        return {
            "success": True,
            "local_path": str(local_path),
            "url": f"{COMFY_VIEW_BASE}/view?filename={req.filename}&subfolder=runpod&type=output"
        }

    except Exception as e:
        print(f"âŒ RunPod Download Error: {e}")
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
        print(f"âŒ List files error: {e}")
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
            print(f"âœ… Deleted: {file_path}")
            return {"success": True, "message": f"Deleted {request.filename}"}
        else:
            raise HTTPException(status_code=404, detail="File not found")
            
    except HTTPException:
        raise  # Re-raise HTTPExceptions as-is
    except Exception as e:
        print(f"âŒ Delete error: {e}")
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
                    print(f"ðŸ—‘ï¸ Cleaned up: {file_path.name}")
        
        return {
            "success": True,
            "deleted_count": len(deleted_files),
            "deleted_files": deleted_files
        }
        
    except Exception as e:
        print(f"âŒ Cleanup error: {e}")
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
            "size_gb": 0.052
        },
        {
            "id": "sam",
            "name": "sam_vit_b_01ec64.pth",
            "url": "https://huggingface.co/scenario-labs/sam_vit/resolve/main/sam_vit_b_01ec64.pth",
            "path": "sams/sam_vit_b_01ec64.pth",
            "size_gb": 0.375
        }
        ],
    "ace-step": [
        {
            "id": "ace-unet",
            "name": "acestep_v1.5_turbo.safetensors",
            "url": "https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/split_files/diffusion_models/acestep_v1.5_turbo.safetensors",
            "path": "diffusion_models/acestep_v1.5_turbo.safetensors",
            "size_gb": 4.8
        },
        {
            "id": "ace-clip-small",
            "name": "qwen_0.6b_ace15.safetensors",
            "url": "https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/split_files/text_encoders/qwen_0.6b_ace15.safetensors",
            "path": "text_encoders/qwen_0.6b_ace15.safetensors",
            "size_gb": 1.3
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
    ]
}

download_progress = {} # { model_id: { downloaded: 0, total: 0, status: 'idle' } }

def start_download(model_info):
    """Download a model using curl (fast, resume-capable) with file-size progress tracking."""
    import time
    model_id = model_info['id']
    target_path = COMFY_MODELS_DIR / model_info['path']
    target_path.parent.mkdir(parents=True, exist_ok=True)

    total_bytes = int(model_info.get('size_gb', 0) * 1024**3)
    download_progress[model_id] = {"status": "downloading", "downloaded": 0, "total": total_bytes, "name": model_info['name']}

    try:
        curl_cmd = [
            'curl', '-L', '-C', '-',
            '-o', str(target_path),
            '--connect-timeout', '30',
            '--retry', '3',
            '--retry-delay', '5',
            '-S', '-s',
            model_info['url']
        ]

        process = subprocess.Popen(curl_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        # Poll file size for progress while curl runs
        while process.poll() is None:
            if target_path.exists():
                download_progress[model_id]['downloaded'] = target_path.stat().st_size
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
            threshold = 0.5 if m['id'] == 'vae' else 0.8
            if fsize_gb < (m['size_gb'] * threshold):
                is_corrupt = True
        
        results.append({
            **m,
            "exists": exists and not is_corrupt,
            "is_corrupt": is_corrupt,
            "actual_size_gb": round(full_path.stat().st_size / (1024**3), 3) if exists else 0,
            "progress": current_prog
        })
    
    return {"success": True, "models": results}

@app.post("/api/models/download")
async def trigger_download(model_id: str, group: str = "z-image"):
    """Trigger background download for a specific model."""
    if group not in REQUIRED_MODELS:
        return {"success": False, "error": "Unknown group"}
    
    model_to_download = next((m for m in REQUIRED_MODELS[group] if m['id'] == model_id), None)
    if not model_to_download:
        return {"success": False, "error": "Model ID not found"}
        
    # Start thread
    thread = threading.Thread(target=start_download, args=(model_to_download,))
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
# Model Management Endpoints
# ============================================================================

@app.get("/api/models/status")
async def models_status():
    """Get status of all downloadable models"""
    try:
        status = get_all_models_status()
        return {"models": status, "success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ModelDownloadRequest(BaseModel):
    model_id: str


@app.post("/api/models/download")
async def download_model(request: ModelDownloadRequest):
    """Start downloading a specific model"""
    try:
        success = start_model_download(request.model_id)
        if success:
            return {"success": True, "message": f"Download started for {request.model_id}"}
        else:
            raise HTTPException(status_code=400, detail="Invalid model ID")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/models/progress/{model_id}")
async def model_progress(model_id: str):
    """Get download progress for a specific model"""
    try:
        progress = get_download_progress(model_id)
        if progress:
            return {"progress": progress, "success": True}
        else:
            return {"progress": None, "success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Chat with IF_AI_tools (via ComfyUI)
# ============================================================================

class ChatRequest(BaseModel):
    messages: list
    model: str = "qwen2.5-3b-instruct"

@app.post("/api/chat")
async def chat_with_llm(request: ChatRequest):
    """Chat using IF_AI_tools nodes in ComfyUI"""
    try:
        # Load workflow
        workflow_path = Path(__file__).parent.parent / "public" / "workflows" / "if-ai-chat.json"
        workflow = json.loads(workflow_path.read_text())

        # Build prompt from messages
        prompt = "\n".join([f"{m['role']}: {m['content']}" for m in request.messages])

        # Update workflow with prompt
        workflow["1"]["inputs"]["prompt"] = prompt

        # Queue workflow
        comfy_url = "http://127.0.0.1:8199"
        response = requests.post(f"{comfy_url}/prompt", json={"prompt": workflow})
        response.raise_for_status()
        prompt_id = response.json()["prompt_id"]

        # Poll for completion (max 60s)
        import time
        for _ in range(60):
            time.sleep(1)
            history_resp = requests.get(f"{comfy_url}/history/{prompt_id}")
            history = history_resp.json()

            if prompt_id in history and history[prompt_id].get("outputs"):
                # Extract text output from node 2
                outputs = history[prompt_id]["outputs"]
                if "2" in outputs and "text" in outputs["2"]:
                    return {"response": outputs["2"]["text"][0], "success": True}

        raise HTTPException(status_code=504, detail="LLM response timeout")

    except Exception as e:
        print(f"Chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    print("FEDDA Backend starting on port 8000...")
    uvicorn.run(app, host="0.0.0.0", port=8000)







