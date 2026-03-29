import os
import re
import requests
from pathlib import Path
import threading
from typing import Optional
from urllib.parse import urlparse, parse_qs
import uuid

# Global storage for tracking download progress
download_progress = {}
import_jobs = {}

# Premium LoRA source (Google Drive folder)
PREMIUM_DRIVE_FOLDER_ID = "1jdliAnhXJG2TdqU6tNi5tbpoAOPuJalv"
ZIMAGE_TURBO_REPO = "pmczip/Z-Image-Turbo_Models"
HF_TIMEOUT = 30

zimage_sync_state = {
    "status": "idle",  # idle | running | completed | error
    "message": "",
    "downloaded": 0,
    "skipped": 0,
    "total": 0,
}
_zimage_sync_lock = threading.Lock()


def _get_gdrive_confirm_token(response):
    """Extract confirmation token for large Google Drive files."""
    for key, value in response.cookies.items():
        if key.startswith('download_warning'):
            return value
    if response.headers.get('content-type', '').startswith('text/html'):
        match = re.search(r'confirm=([0-9A-Za-z_-]+)', response.text)
        if match:
            return match.group(1)
    return None


def _download_gdrive_file(file_id: str, dest_path: Path, filename: str):
    """Download a file from Google Drive, handling the virus scan confirmation page."""
    session = requests.Session()
    url = "https://drive.google.com/uc?export=download"

    response = session.get(url, params={"id": file_id}, stream=True, timeout=60)

    token = _get_gdrive_confirm_token(response)
    if token:
        response = session.get(url, params={"id": file_id, "confirm": token}, stream=True, timeout=60)

    response.raise_for_status()

    total_size = int(response.headers.get('content-length', 0))
    downloaded_size = 0

    with open(dest_path, 'wb') as f:
        for chunk in response.iter_content(chunk_size=65536):
            if chunk:
                f.write(chunk)
                downloaded_size += len(chunk)
                if total_size > 0:
                    progress = int((downloaded_size / total_size) * 100)
                    download_progress[filename]["progress"] = progress

    # Verify we got a real file (not an HTML error page)
    if dest_path.stat().st_size < 10000:
        with open(dest_path, 'r', errors='ignore') as f:
            start = f.read(200)
            if '<html' in start.lower() or '<!doctype' in start.lower():
                dest_path.unlink()
                raise Exception("Google Drive returned HTML instead of the file. Check sharing permissions.")

    return dest_path


def _list_gdrive_folder(folder_id: str):
    """List .safetensors files in a public Google Drive folder."""
    url = f"https://drive.google.com/drive/folders/{folder_id}"
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    response = requests.get(url, headers=headers, timeout=30)
    response.raise_for_status()

    files = []
    seen_ids = set()

    # Pattern: ["FILE_ID","FILENAME",...
    pattern = re.findall(r'\["([a-zA-Z0-9_-]{25,})","([^"]+\.safetensors)"', response.text)
    for file_id, name in pattern:
        if file_id not in seen_ids:
            files.append({"id": file_id, "name": name})
            seen_ids.add(file_id)

    if not files:
        file_ids = re.findall(r'/file/d/([a-zA-Z0-9_-]{25,})', response.text)
        names = re.findall(r'([A-Za-z0-9_-]+\.safetensors)', response.text)
        for i, fid in enumerate(file_ids):
            if fid not in seen_ids:
                name = names[i] if i < len(names) else f"lora_{i}.safetensors"
                files.append({"id": fid, "name": name})
                seen_ids.add(fid)

    return files


def download_lora_task(url: str, filename: str, destination_dir: Path, headers: Optional[dict] = None):
    """Background task to download a LoRA. Supports regular URLs and Google Drive."""
    try:
        download_progress[filename] = {"status": "downloading", "progress": 0}
        destination_dir.mkdir(parents=True, exist_ok=True)
        dest_path = destination_dir / filename

        # Detect Google Drive URLs
        gdrive_match = re.search(r'drive\.google\.com.*?/d/([a-zA-Z0-9_-]+)', url)
        if not gdrive_match:
            gdrive_match = re.search(r'[?&]id=([a-zA-Z0-9_-]+)', url)

        if gdrive_match or 'drive.google.com' in url:
            file_id = gdrive_match.group(1) if gdrive_match else url.split('/')[-1]
            print(f"[DL] Google Drive download: {filename} (ID: {file_id})")
            _download_gdrive_file(file_id, dest_path, filename)
        else:
            print(f"[DL] HTTP download: {filename}")
            response = requests.get(url, stream=True, timeout=30, headers=headers or {})
            response.raise_for_status()

            total_size = int(response.headers.get('content-length', 0))
            downloaded_size = 0

            with open(dest_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
                        downloaded_size += len(chunk)
                        if total_size > 0:
                            progress = int((downloaded_size / total_size) * 100)
                            download_progress[filename]["progress"] = progress

        download_progress[filename] = {"status": "completed", "progress": 100, "local_path": str(dest_path)}
        print(f"[OK] Downloaded: {filename} ({dest_path.stat().st_size / 1024 / 1024:.1f} MB)")
        refresh_comfy_models()

    except Exception as e:
        print(f"[ERROR] Download error {filename}: {e}")
        download_progress[filename] = {"status": "error", "message": str(e)}
        partial = destination_dir / filename
        if partial.exists() and partial.stat().st_size < 10000:
            partial.unlink()


def sync_premium_folder(folder_id: str = None):
    """Download ALL LoRAs from the premium Google Drive folder. Skips existing."""
    folder_id = folder_id or PREMIUM_DRIVE_FOLDER_ID
    comfy_loras = Path(__file__).parent.parent / "ComfyUI" / "models" / "loras" / "premium"
    comfy_loras.mkdir(parents=True, exist_ok=True)

    try:
        files = _list_gdrive_folder(folder_id)
        if not files:
            return {"status": "error", "message": "Could not list files in Google Drive folder. Make sure it is publicly shared."}

        started = []
        skipped = []

        for f in files:
            dest = comfy_loras / f["name"]
            if dest.exists() and dest.stat().st_size > 10000:
                skipped.append(f["name"])
                continue

            download_progress[f["name"]] = {"status": "downloading", "progress": 0}
            thread = threading.Thread(
                target=_download_gdrive_file_task,
                args=(f["id"], f["name"], comfy_loras)
            )
            thread.start()
            started.append(f["name"])

        return {
            "status": "started",
            "downloading": started,
            "skipped": skipped,
            "total_files": len(files),
        }

    except Exception as e:
        print(f"[ERROR] Sync error: {e}")
        return {"status": "error", "message": str(e)}


def _download_gdrive_file_task(file_id: str, filename: str, dest_dir: Path):
    """Background thread wrapper for Google Drive file download."""
    try:
        download_progress[filename] = {"status": "downloading", "progress": 0}
        dest_path = dest_dir / filename
        _download_gdrive_file(file_id, dest_path, filename)
        download_progress[filename] = {"status": "completed", "progress": 100, "local_path": str(dest_path)}
        print(f"[OK] Synced: {filename} ({dest_path.stat().st_size / 1024 / 1024:.1f} MB)")
        refresh_comfy_models()
    except Exception as e:
        print(f"[ERROR] Sync error for {filename}: {e}")
        download_progress[filename] = {"status": "error", "message": str(e)}


def get_installed_premium_loras():
    """Check which premium LoRAs are already installed."""
    comfy_loras = Path(__file__).parent.parent / "ComfyUI" / "models" / "loras" / "premium"
    installed = {}
    if comfy_loras.exists():
        for f in comfy_loras.glob("*.safetensors"):
            if f.stat().st_size > 10000:
                installed[f.name] = round(f.stat().st_size / 1024 / 1024, 1)
    return installed


def refresh_comfy_models():
    """Tells ComfyUI to refresh its internal list of LoRAs and models."""
    try:
        res = requests.post("http://127.0.0.1:8199/refresh", timeout=5)
        if res.ok:
            print("[OK] ComfyUI models refreshed.")
            return True
        else:
            print(f"[WARN] ComfyUI refresh failed: {res.status_code}")
            return False
    except Exception as e:
        print(f"[WARN] Could not contact ComfyUI: {e}")
        return False


def start_lora_download(url: str, filename: str, headers: Optional[dict] = None):
    """Triggers a background thread to download the LoRA."""
    comfy_loras = Path(__file__).parent.parent / "ComfyUI" / "models" / "loras" / "premium"
    thread = threading.Thread(target=download_lora_task, args=(url, filename, comfy_loras, headers))
    thread.start()
    return {"status": "started", "filename": filename}


def get_download_status(filename: str):
    """Returns the current status of a specific download."""
    return download_progress.get(filename, {"status": "not_found"})


def _safe_filename(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._")
    return cleaned or f"lora_{uuid.uuid4().hex[:8]}.safetensors"


def _resolve_civitai_download(url: str):
    parsed = urlparse(url)
    host = (parsed.netloc or "").lower()
    if "civitai.com" not in host:
        return None

    path = parsed.path or ""
    query = parse_qs(parsed.query or "")

    # Direct API download link
    m = re.search(r"/api/download/models/(\d+)", path)
    if m:
        version_id = m.group(1)
        filename = query.get("filename", [None])[0]
        return {
            "provider": "civitai",
            "url": f"https://civitai.com/api/download/models/{version_id}",
            "filename_hint": filename,
        }

    # /models/<id>?modelVersionId=<id>
    version = query.get("modelVersionId", [None])[0]
    if version and str(version).isdigit():
        return {
            "provider": "civitai",
            "url": f"https://civitai.com/api/download/models/{version}",
            "filename_hint": None,
        }

    # /model-versions/<id>
    m2 = re.search(r"/model-versions/(\d+)", path)
    if m2:
        return {
            "provider": "civitai",
            "url": f"https://civitai.com/api/download/models/{m2.group(1)}",
            "filename_hint": None,
        }

    return {"provider": "civitai", "url": url, "filename_hint": None}


def start_lora_import_from_url(
    url: str,
    provider: Optional[str] = None,
    filename_override: Optional[str] = None,
    civitai_api_key: Optional[str] = None,
):
    """
    Start LoRA import from arbitrary URL (HF/Civitai/direct).
    Returns a job id to poll.
    """
    resolved_url = url.strip()
    detected_provider = (provider or "").strip().lower() or "auto"
    filename_hint = None
    headers: dict = {}

    civitai_info = _resolve_civitai_download(resolved_url)
    if detected_provider in ("auto", "civitai") and civitai_info:
        detected_provider = "civitai"
        resolved_url = civitai_info["url"]
        filename_hint = civitai_info.get("filename_hint")
        if civitai_api_key:
            headers["Authorization"] = f"Bearer {civitai_api_key}"
            sep = "&" if "?" in resolved_url else "?"
            resolved_url = f"{resolved_url}{sep}token={civitai_api_key}"

    filename = filename_override or filename_hint
    if not filename:
        tail = urlparse(resolved_url).path.split("/")[-1] or ""
        filename = tail if tail.lower().endswith(".safetensors") else ""
    if not filename or not filename.lower().endswith(".safetensors"):
        filename = f"imported_lora_{uuid.uuid4().hex[:10]}.safetensors"
    filename = _safe_filename(filename)

    start_lora_download(resolved_url, filename, headers=headers if headers else None)
    job_id = uuid.uuid4().hex
    import_jobs[job_id] = {"filename": filename, "provider": detected_provider, "url": resolved_url}

    return {"success": True, "job_id": job_id, "resolved_filename": filename}


def get_lora_import_status(job_id: str):
    job = import_jobs.get(job_id)
    if not job:
        return {"success": False, "status": "not_found"}
    status = get_download_status(job["filename"])
    return {"success": True, "job_id": job_id, "filename": job["filename"], "provider": job.get("provider"), **status}


def _list_hf_safetensors(repo_id: str):
    """List .safetensors files in an HF model repo root."""
    url = f"https://huggingface.co/api/models/{repo_id}/tree/main"
    response = requests.get(url, timeout=HF_TIMEOUT)
    response.raise_for_status()
    items = response.json() if isinstance(response.json(), list) else []
    files = []
    for item in items:
        path = str(item.get("path", "")).strip()
        if path.lower().endswith(".safetensors") and "/" not in path:
            files.append(path)
    return sorted(set(files))


def _resolve_hf_file_url(repo_id: str, filename: str) -> str:
    return f"https://huggingface.co/{repo_id}/resolve/main/{filename}"


def _run_zimage_turbo_sync(limit: Optional[int] = None):
    target_dir = Path(__file__).parent.parent / "ComfyUI" / "models" / "loras" / "zimage_turbo"
    target_dir.mkdir(parents=True, exist_ok=True)

    with _zimage_sync_lock:
        zimage_sync_state.update({
            "status": "running",
            "message": "Fetching file list...",
            "downloaded": 0,
            "skipped": 0,
            "total": 0,
        })

    try:
        files = _list_hf_safetensors(ZIMAGE_TURBO_REPO)
        if limit is not None and limit > 0:
            files = files[:limit]

        with _zimage_sync_lock:
            zimage_sync_state["total"] = len(files)
            zimage_sync_state["message"] = f"Syncing {len(files)} LoRAs..."

        downloaded = 0
        skipped = 0

        for idx, filename in enumerate(files, start=1):
            dest = target_dir / filename
            if dest.exists() and dest.stat().st_size > 10000:
                skipped += 1
                with _zimage_sync_lock:
                    zimage_sync_state["skipped"] = skipped
                    zimage_sync_state["message"] = f"Skipping existing ({idx}/{len(files)}): {filename}"
                continue

            url = _resolve_hf_file_url(ZIMAGE_TURBO_REPO, filename)
            with _zimage_sync_lock:
                zimage_sync_state["message"] = f"Downloading ({idx}/{len(files)}): {filename}"
            download_lora_task(url, filename, target_dir)
            if get_download_status(filename).get("status") == "completed":
                downloaded += 1
                with _zimage_sync_lock:
                    zimage_sync_state["downloaded"] = downloaded

        refresh_comfy_models()
        with _zimage_sync_lock:
            zimage_sync_state["status"] = "completed"
            zimage_sync_state["message"] = f"Completed. Downloaded {downloaded}, skipped {skipped}."
            zimage_sync_state["downloaded"] = downloaded
            zimage_sync_state["skipped"] = skipped
    except Exception as e:
        with _zimage_sync_lock:
            zimage_sync_state["status"] = "error"
            zimage_sync_state["message"] = str(e)


def start_zimage_turbo_sync(limit: Optional[int] = None):
    """Start background sync of Z-Image Turbo celeb LoRAs from Hugging Face."""
    with _zimage_sync_lock:
        if zimage_sync_state.get("status") == "running":
            return {"status": "running", "message": zimage_sync_state.get("message", "Already syncing")}
        zimage_sync_state.update({
            "status": "running",
            "message": "Starting sync...",
            "downloaded": 0,
            "skipped": 0,
            "total": 0,
        })

    thread = threading.Thread(target=_run_zimage_turbo_sync, args=(limit,), daemon=True)
    thread.start()
    return {"status": "started", "message": "Z-Image Turbo sync started in background"}


def get_zimage_turbo_sync_status():
    with _zimage_sync_lock:
        return dict(zimage_sync_state)


def _filename_to_celebrity_label(filename: str) -> str:
    name = Path(filename).stem
    name = re.sub(r"_PMv\d+[a-z]?_ZImage$", "", name, flags=re.IGNORECASE)
    name = name.replace("_", " ").strip()
    return name


def get_zimage_turbo_catalog(max_items: int = 500):
    """
    Returns celebrity catalog for Z-Image Turbo pack.
    Includes remote repo files + local installed status.
    """
    local_dir = Path(__file__).parent.parent / "ComfyUI" / "models" / "loras" / "zimage_turbo"
    local_files = {}
    if local_dir.exists():
        for f in local_dir.glob("*.safetensors"):
            if f.stat().st_size > 10000:
                local_files[f.name] = f.stat().st_size

    remote_files = []
    remote_error = None
    try:
        remote_files = _list_hf_safetensors(ZIMAGE_TURBO_REPO)
    except Exception as e:
        remote_error = str(e)

    source_files = remote_files if remote_files else sorted(local_files.keys())
    if max_items and max_items > 0:
        source_files = source_files[:max_items]

    celebs = []
    for file_name in source_files:
        celebs.append({
            "name": _filename_to_celebrity_label(file_name),
            "file": file_name,
            "installed": file_name in local_files,
            "size_mb": round((local_files.get(file_name, 0) / 1024 / 1024), 1) if file_name in local_files else None,
        })

    installed_count = sum(1 for c in celebs if c["installed"])
    return {
        "repo": ZIMAGE_TURBO_REPO,
        "total": len(celebs),
        "installed": installed_count,
        "items": celebs,
        "remote_error": remote_error,
    }
