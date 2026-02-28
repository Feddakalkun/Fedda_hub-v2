import os
import re
import requests
from pathlib import Path
import threading

# Global storage for tracking download progress
download_progress = {}

# Premium LoRA source (Google Drive folder)
PREMIUM_DRIVE_FOLDER_ID = "1jdliAnhXJG2TdqU6tNi5tbpoAOPuJalv"


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


def download_lora_task(url: str, filename: str, destination_dir: Path):
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
            print(f"📥 Google Drive download: {filename} (ID: {file_id})")
            _download_gdrive_file(file_id, dest_path, filename)
        else:
            print(f"📥 HTTP download: {filename}")
            response = requests.get(url, stream=True, timeout=30)
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
        print(f"✅ Downloaded: {filename} ({dest_path.stat().st_size / 1024 / 1024:.1f} MB)")
        refresh_comfy_models()

    except Exception as e:
        print(f"❌ Download error {filename}: {e}")
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
        print(f"❌ Sync error: {e}")
        return {"status": "error", "message": str(e)}


def _download_gdrive_file_task(file_id: str, filename: str, dest_dir: Path):
    """Background thread wrapper for Google Drive file download."""
    try:
        download_progress[filename] = {"status": "downloading", "progress": 0}
        dest_path = dest_dir / filename
        _download_gdrive_file(file_id, dest_path, filename)
        download_progress[filename] = {"status": "completed", "progress": 100, "local_path": str(dest_path)}
        print(f"✅ Synced: {filename} ({dest_path.stat().st_size / 1024 / 1024:.1f} MB)")
        refresh_comfy_models()
    except Exception as e:
        print(f"❌ Sync error for {filename}: {e}")
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
        res = requests.post("http://127.0.0.1:8188/refresh", timeout=5)
        if res.ok:
            print("🔄 ComfyUI models refreshed.")
            return True
        else:
            print(f"⚠️ ComfyUI refresh failed: {res.status_code}")
            return False
    except Exception as e:
        print(f"⚠️ Could not contact ComfyUI: {e}")
        return False


def start_lora_download(url: str, filename: str):
    """Triggers a background thread to download the LoRA."""
    comfy_loras = Path(__file__).parent.parent / "ComfyUI" / "models" / "loras" / "premium"
    thread = threading.Thread(target=download_lora_task, args=(url, filename, comfy_loras))
    thread.start()
    return {"status": "started", "filename": filename}


def get_download_status(filename: str):
    """Returns the current status of a specific download."""
    return download_progress.get(filename, {"status": "not_found"})
