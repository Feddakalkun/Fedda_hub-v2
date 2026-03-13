"""
Model download service for on-demand model downloads
"""
import os
import subprocess
import threading
from pathlib import Path
from typing import Dict, Optional

# Model definitions with file paths and download info
MODELS = {
    "z-image": {
        "name": "Z-Image Checkpoint",
        "size": "20 GB",
        "files": [
            "comfyui/checkpoints/zimage_realv12.safetensors"
        ],
        "download_cmd": "download-models.sh z-image"
    },
    "qwen-edit": {
        "name": "Qwen Image Edit FP8",
        "size": "19 GB",
        "files": [
            "comfyui/diffusion_models/Qwen_VL_Chat_Int4.safetensors"
        ],
        "download_cmd": "download-models.sh qwen"
    },
    "ltx-video": {
        "name": "LTX Video",
        "size": "10 GB",
        "files": [
            "comfyui/diffusion_models/ltx-video-2b-v0.9.safetensors"
        ],
        "download_cmd": "download-models.sh ltx"
    },
    "sam": {
        "name": "SAM ViT-B",
        "size": "375 MB",
        "files": [
            "comfyui/sams/sam_vit_b_01ec64.pth"
        ],
        "download_cmd": "download-models.sh sam"
    },
    "florence2": {
        "name": "Florence-2 Base",
        "size": "500 MB",
        "files": [
            "comfyui/LLM/Florence-2-base"
        ],
        "download_cmd": "download-models.sh florence"
    },
    "clip": {
        "name": "CLIP Vision Models",
        "size": "2 GB",
        "files": [
            "comfyui/clip/clip_l.safetensors",
            "comfyui/clip/t5xxl_fp8_e4m3fn.safetensors"
        ],
        "download_cmd": "download-models.sh clip"
    },
    "vae": {
        "name": "VAE",
        "size": "335 MB",
        "files": [
            "comfyui/vae/ae.safetensors"
        ],
        "download_cmd": "download-models.sh vae"
    },
    "ollama-qwen": {
        "name": "Ollama Qwen 2.5 3B",
        "size": "2 GB",
        "files": [],  # Ollama models checked differently
        "download_cmd": "ollama pull qwen2.5:3b",
        "check_cmd": "ollama list | grep qwen2.5:3b"
    },
    "ollama-llava": {
        "name": "Ollama Llava",
        "size": "4.7 GB",
        "files": [],
        "download_cmd": "ollama pull llava",
        "check_cmd": "ollama list | grep llava"
    }
}

# Track active downloads
active_downloads: Dict[str, dict] = {}


def get_models_dir() -> Path:
    """Get the models directory (platform-dependent)"""
    if os.name == 'nt':  # Windows
        return Path.cwd() / "models"
    else:  # Docker/Linux
        return Path("/workspace/models")


def check_model_exists(model_id: str) -> bool:
    """Check if a model exists locally"""
    if model_id not in MODELS:
        return False

    model_info = MODELS[model_id]

    # Special handling for Ollama models
    if "check_cmd" in model_info:
        try:
            result = subprocess.run(
                model_info["check_cmd"],
                shell=True,
                capture_output=True,
                text=True,
                timeout=5
            )
            return result.returncode == 0 and len(result.stdout.strip()) > 0
        except Exception:
            return False

    # Check if all required files exist
    models_dir = get_models_dir()
    for file_path in model_info["files"]:
        full_path = models_dir / file_path
        if not full_path.exists():
            return False

    return True


def get_all_models_status() -> Dict[str, dict]:
    """Get status of all models"""
    status = {}
    for model_id, info in MODELS.items():
        exists = check_model_exists(model_id)
        is_downloading = model_id in active_downloads

        status[model_id] = {
            "name": info["name"],
            "size": info["size"],
            "installed": exists,
            "downloading": is_downloading,
            "progress": active_downloads.get(model_id, {}).get("progress", 0) if is_downloading else 100 if exists else 0
        }

    return status


def start_model_download(model_id: str) -> bool:
    """Start downloading a model in background"""
    if model_id not in MODELS:
        return False

    if check_model_exists(model_id):
        return True  # Already exists

    if model_id in active_downloads:
        return True  # Already downloading

    # Mark as downloading
    active_downloads[model_id] = {
        "progress": 0,
        "status": "starting"
    }

    # Start download in background thread
    thread = threading.Thread(
        target=_download_model_thread,
        args=(model_id,),
        daemon=True
    )
    thread.start()

    return True


def _download_model_thread(model_id: str):
    """Background thread for downloading a model"""
    model_info = MODELS[model_id]

    try:
        # Update status
        active_downloads[model_id]["status"] = "downloading"

        # Run download command
        cmd = model_info["download_cmd"]

        # For shell scripts, prepend path if needed
        if cmd.endswith(".sh"):
            if os.name == 'nt':
                cmd = f"bash scripts/{cmd}"
            else:
                cmd = f"/app/scripts/{cmd}"

        process = subprocess.Popen(
            cmd,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True
        )

        # Monitor progress (simplified - real progress parsing would be more complex)
        for line in process.stdout:
            # Try to parse progress from output
            if "%" in line:
                try:
                    # Extract percentage from output like "  12.5%"
                    percent_str = [s for s in line.split() if "%" in s][0]
                    percent = float(percent_str.replace("%", ""))
                    active_downloads[model_id]["progress"] = int(percent)
                except Exception:
                    pass

        process.wait()

        # Check if successful
        if process.returncode == 0 and check_model_exists(model_id):
            active_downloads[model_id]["progress"] = 100
            active_downloads[model_id]["status"] = "completed"
        else:
            active_downloads[model_id]["status"] = "failed"

    except Exception as e:
        active_downloads[model_id]["status"] = "failed"
        active_downloads[model_id]["error"] = str(e)

    finally:
        # Remove from active downloads after a delay
        import time
        time.sleep(2)
        if model_id in active_downloads:
            del active_downloads[model_id]


def get_download_progress(model_id: str) -> Optional[dict]:
    """Get download progress for a model"""
    if model_id in active_downloads:
        return active_downloads[model_id]
    return None
