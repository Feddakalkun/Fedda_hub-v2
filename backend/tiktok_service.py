"""
TikTok Service — download profiles/videos via yt-dlp, extract frames, caption them
"""
import os
import re
import json
import time
import uuid
import base64
import subprocess
import threading
import requests
from pathlib import Path
from typing import Optional

# Directories
DOWNLOADS_DIR = Path(__file__).parent.parent / "tiktok_downloads"
FRAMES_DIR = DOWNLOADS_DIR / "_frames"

# Global job tracking
download_jobs = {}
caption_jobs = {}


# ============================================================================
# DOWNLOAD — yt-dlp profile and single video
# ============================================================================

def _get_ytdlp_cmd():
    """Find yt-dlp: prefer venv/embedded, fall back to system."""
    base = Path(__file__).parent.parent
    # Portable
    embedded_py = base / "python_embeded" / "Scripts" / "yt-dlp.exe"
    if embedded_py.exists():
        return str(embedded_py)
    # Venv
    venv_py = base / "venv" / "Scripts" / "yt-dlp.exe"
    if venv_py.exists():
        return str(venv_py)
    # System
    return "yt-dlp"


def _cookie_args(cookie_source: str) -> list:
    """Convert cookie source string to yt-dlp args."""
    mapping = {
        "chrome": ["--cookies-from-browser", "chrome"],
        "edge": ["--cookies-from-browser", "edge"],
        "firefox": ["--cookies-from-browser", "firefox"],
        "cookies.txt": ["--cookies", "cookies.txt"],
    }
    return mapping.get(cookie_source, [])


def download_profile(url: str, cookie_source: str = "none", limit: Optional[int] = None) -> str:
    """Start a background download of a TikTok profile. Returns job_id."""
    job_id = str(uuid.uuid4())[:8]
    download_jobs[job_id] = {"status": "downloading", "progress": 0, "log": [], "videos": []}

    thread = threading.Thread(
        target=_download_thread,
        args=(job_id, url, cookie_source, limit),
        daemon=True
    )
    thread.start()
    return job_id


def download_single_video(url: str, cookie_source: str = "none") -> str:
    """Start a background download of a single TikTok video. Returns job_id."""
    job_id = str(uuid.uuid4())[:8]
    download_jobs[job_id] = {"status": "downloading", "progress": 0, "log": [], "videos": []}

    thread = threading.Thread(
        target=_download_thread,
        args=(job_id, url, cookie_source, None),
        daemon=True
    )
    thread.start()
    return job_id


def _download_thread(job_id: str, url: str, cookie_source: str, limit: Optional[int]):
    """Background thread that runs yt-dlp."""
    try:
        DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)

        cmd = [_get_ytdlp_cmd()]
        cmd.extend(_cookie_args(cookie_source))

        if limit:
            cmd.extend(["--playlist-items", f"1:{limit}"])

        # Output template: tiktok_downloads/@uploader/date - id - title.ext
        output_template = str(DOWNLOADS_DIR / "%(uploader)s" / "%(upload_date>%Y-%m-%d)s - %(id)s - %(title).100B.%(ext)s")
        cmd.extend(["-o", output_template])
        cmd.extend(["--no-warnings", "--newline"])
        cmd.append(url)

        download_jobs[job_id]["log"].append(f"Running: {' '.join(cmd)}")

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)
        )

        for line in iter(process.stdout.readline, ""):
            line = line.strip()
            if line:
                download_jobs[job_id]["log"].append(line)
                # Parse progress
                match = re.search(r"(\d+\.?\d*)%", line)
                if match:
                    download_jobs[job_id]["progress"] = float(match.group(1))
                # Detect downloaded file
                if "[download] Destination:" in line or "has already been downloaded" in line:
                    filepath = line.split("Destination:")[-1].strip() if "Destination:" in line else ""
                    if filepath:
                        download_jobs[job_id]["videos"].append(filepath)

        process.wait()

        if process.returncode == 0:
            download_jobs[job_id]["status"] = "completed"
            download_jobs[job_id]["progress"] = 100
            download_jobs[job_id]["log"].append("Download complete.")
        else:
            download_jobs[job_id]["status"] = "error"
            download_jobs[job_id]["log"].append(f"yt-dlp exited with code {process.returncode}")

    except Exception as e:
        download_jobs[job_id]["status"] = "error"
        download_jobs[job_id]["log"].append(f"Error: {str(e)}")


def get_download_progress(job_id: str) -> dict:
    """Return current status of a download job."""
    return download_jobs.get(job_id, {"status": "not_found"})


# ============================================================================
# LIBRARY — list downloaded profiles and videos
# ============================================================================

def list_profiles() -> list:
    """Return list of downloaded profile folders with video counts."""
    if not DOWNLOADS_DIR.exists():
        return []

    profiles = []
    for folder in sorted(DOWNLOADS_DIR.iterdir()):
        if folder.is_dir() and folder.name != "_frames":
            videos = list(folder.glob("*.mp4")) + list(folder.glob("*.webm"))
            if videos:
                total_size = sum(v.stat().st_size for v in videos)
                profiles.append({
                    "name": folder.name,
                    "video_count": len(videos),
                    "total_size_mb": round(total_size / 1024 / 1024, 1),
                })
    return profiles


def list_videos(profile: str) -> list:
    """Return list of videos in a profile folder."""
    profile_dir = DOWNLOADS_DIR / profile
    if not profile_dir.exists():
        return []

    videos = []
    for f in sorted(profile_dir.iterdir()):
        if f.suffix.lower() in (".mp4", ".webm", ".mkv"):
            # Extract video ID from filename pattern: "date - id - title.ext"
            video_id = f.stem.split(" - ")[1] if " - " in f.stem else f.stem
            videos.append({
                "filename": f.name,
                "video_id": video_id,
                "path": str(f.relative_to(DOWNLOADS_DIR)),
                "size_mb": round(f.stat().st_size / 1024 / 1024, 1),
            })
    return videos


# ============================================================================
# FRAME EXTRACTION — ffmpeg / imageio
# ============================================================================

def extract_frames(video_path: str, count: int = 6) -> list:
    """
    Extract N evenly-spaced frames from a video.
    Returns list of frame file paths (relative to DOWNLOADS_DIR).
    """
    full_path = DOWNLOADS_DIR / video_path
    if not full_path.exists():
        raise FileNotFoundError(f"Video not found: {video_path}")

    # Create frames output dir using video ID
    video_id = full_path.stem.split(" - ")[1] if " - " in full_path.stem else full_path.stem
    frames_dir = FRAMES_DIR / video_id
    frames_dir.mkdir(parents=True, exist_ok=True)

    # Get video duration using ffprobe
    duration = _get_video_duration(str(full_path))
    if duration <= 0:
        raise ValueError("Could not determine video duration")

    frame_paths = []
    for i in range(count):
        # Evenly space frames across the video (skip very start/end)
        timestamp = duration * (i + 1) / (count + 1)
        frame_name = f"frame_{i + 1:03d}.png"
        frame_path = frames_dir / frame_name

        _extract_single_frame(str(full_path), str(frame_path), timestamp)

        if frame_path.exists():
            rel_path = str(frame_path.relative_to(DOWNLOADS_DIR))
            frame_paths.append(rel_path)

    return frame_paths


def _get_video_duration(video_path: str) -> float:
    """Get video duration in seconds using ffprobe."""
    ffprobe = _get_ffprobe_cmd()
    try:
        result = subprocess.run(
            [ffprobe, "-v", "quiet", "-show_entries", "format=duration",
             "-of", "csv=p=0", video_path],
            capture_output=True, text=True, timeout=30,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)
        )
        return float(result.stdout.strip())
    except Exception:
        # Fallback: try imageio
        try:
            import imageio.v3 as iio
            meta = iio.immeta(video_path, plugin="pyav")
            return meta.get("duration", 0)
        except Exception:
            return 0


def _extract_single_frame(video_path: str, output_path: str, timestamp: float):
    """Extract a single frame at a given timestamp using ffmpeg."""
    ffmpeg = _get_ffmpeg_cmd()
    try:
        subprocess.run(
            [ffmpeg, "-y", "-ss", str(timestamp), "-i", video_path,
             "-frames:v", "1", "-q:v", "2", output_path],
            capture_output=True, timeout=30,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)
        )
    except Exception as e:
        print(f"Frame extraction failed at {timestamp}s: {e}")


def _get_ffmpeg_cmd() -> str:
    """Find ffmpeg: imageio-ffmpeg bundle or system."""
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return "ffmpeg"


def _get_ffprobe_cmd() -> str:
    """Find ffprobe alongside ffmpeg."""
    ffmpeg = _get_ffmpeg_cmd()
    ffprobe = ffmpeg.replace("ffmpeg", "ffprobe")
    if Path(ffprobe).exists():
        return ffprobe
    return "ffprobe"


def get_frames(video_id: str) -> list:
    """Return list of extracted frame paths for a video."""
    frames_dir = FRAMES_DIR / video_id
    if not frames_dir.exists():
        return []

    frames = []
    for f in sorted(frames_dir.glob("frame_*.png")):
        frames.append(str(f.relative_to(DOWNLOADS_DIR)))
    return frames


def get_video_thumbnail(video_path: str) -> Optional[str]:
    """Extract first frame as thumbnail. Returns relative path or None."""
    full_path = DOWNLOADS_DIR / video_path
    if not full_path.exists():
        return None

    video_id = full_path.stem.split(" - ")[1] if " - " in full_path.stem else full_path.stem
    thumb_dir = FRAMES_DIR / video_id
    thumb_dir.mkdir(parents=True, exist_ok=True)
    thumb_path = thumb_dir / "thumbnail.jpg"

    if not thumb_path.exists():
        _extract_single_frame(str(full_path), str(thumb_path), 0.5)

    if thumb_path.exists():
        return str(thumb_path.relative_to(DOWNLOADS_DIR))
    return None


# ============================================================================
# CAPTIONING — Ollama vision or ComfyUI
# ============================================================================

def caption_frames(frame_paths: list, method: str = "ollama", model: str = "llava") -> str:
    """Start background captioning job. Returns job_id."""
    job_id = str(uuid.uuid4())[:8]
    caption_jobs[job_id] = {"status": "processing", "captions": {}, "total": len(frame_paths), "done": 0}

    thread = threading.Thread(
        target=_caption_thread,
        args=(job_id, frame_paths, method, model),
        daemon=True
    )
    thread.start()
    return job_id


def _caption_thread(job_id: str, frame_paths: list, method: str, model: str):
    """Background thread for captioning frames."""
    try:
        # Validate model exists in Ollama before starting
        if method == "ollama":
            try:
                r = requests.get("http://127.0.0.1:11434/api/tags", timeout=5)
                if r.ok:
                    installed = [m["name"] for m in r.json().get("models", [])]
                    # Allow prefix match (e.g. "llava" matches "llava:latest")
                    if not any(m == model or m.startswith(model.split(":")[0]) for m in installed):
                        available = ", ".join(installed) if installed else "none"
                        err = f"[Model '{model}' not found in Ollama. Installed: {available}]"
                        for fp in frame_paths:
                            norm = fp.replace("\\", "/")
                            caption_jobs[job_id]["captions"][norm] = err
                            caption_jobs[job_id]["done"] += 1
                        caption_jobs[job_id]["status"] = "completed"
                        return
            except Exception:
                pass  # If we can't check, proceed and let the actual call fail

        for frame_rel_path in frame_paths:
            # Normalize to forward slashes for consistent key lookup from frontend
            norm_path = frame_rel_path.replace("\\", "/")
            frame_full_path = DOWNLOADS_DIR / frame_rel_path

            if not frame_full_path.exists():
                caption_jobs[job_id]["captions"][norm_path] = "[Frame not found]"
                caption_jobs[job_id]["done"] += 1
                continue

            if method == "ollama":
                caption = _caption_ollama(frame_full_path, model)
            else:
                caption = _caption_ollama(frame_full_path, model)  # Fallback to ollama for now

            caption_jobs[job_id]["captions"][norm_path] = caption
            caption_jobs[job_id]["done"] += 1

        caption_jobs[job_id]["status"] = "completed"

    except Exception as e:
        caption_jobs[job_id]["status"] = "error"
        caption_jobs[job_id]["error"] = str(e)


def _caption_ollama(image_path: Path, model: str = "llava") -> str:
    """Caption a single image using Ollama vision model via /api/chat."""
    try:
        with open(image_path, "rb") as f:
            image_b64 = base64.b64encode(f.read()).decode("utf-8")

        response = requests.post(
            "http://127.0.0.1:11434/api/chat",
            json={
                "model": model,
                "stream": False,
                "messages": [{
                    "role": "user",
                    "content": "Describe this scene in detail for image generation. Focus on the person's appearance, pose, expression, clothing, hairstyle, background, lighting, and composition. Be specific and concise.",
                    "images": [image_b64],
                }],
            },
            timeout=120,
        )
        response.raise_for_status()
        result = response.json()
        return result.get("message", {}).get("content", "").strip()

    except requests.exceptions.HTTPError as e:
        if e.response is not None and e.response.status_code == 404:
            return f"[Model '{model}' not found — use the Caption Model button in the header to install a vision model]"
        return f"[Caption failed: {e}]"
    except Exception as e:
        return f"[Caption failed: {e}]"


def get_caption_status(job_id: str) -> dict:
    """Return current status of a captioning job."""
    return caption_jobs.get(job_id, {"status": "not_found"})


# ============================================================================
# FILE SERVING
# ============================================================================

def get_file_path(relative_path: str) -> Optional[Path]:
    """Resolve a relative path within tiktok_downloads safely."""
    full_path = (DOWNLOADS_DIR / relative_path).resolve()
    # Security: ensure it's still within DOWNLOADS_DIR
    if not str(full_path).startswith(str(DOWNLOADS_DIR.resolve())):
        return None
    if full_path.exists():
        return full_path
    return None
