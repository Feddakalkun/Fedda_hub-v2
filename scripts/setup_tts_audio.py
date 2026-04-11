import shutil
import os
from pathlib import Path

def setup_audio_files():
    # Determine paths based on script location (h:\comfyfront\scripts\setup_tts_audio.py)
    script_dir = Path(__file__).parent
    root_dir = script_dir.parent
    
    # Asset source
    src_path = root_dir / "assets" / "audio-tts" / "charlotte" / "charlotte.wav"
    
    # ComfyUI input destination
    dest_dir = root_dir / "ComfyUI" / "input"
    dest_dir.mkdir(parents=True, exist_ok=True)
    
    dest_path = dest_dir / "charlotte.wav"
    
    # Copy
    if src_path.exists():
        print(f"[Audio Setup] Copying {src_path.name} to ComfyUI input...")
        shutil.copy2(src_path, dest_path)
    else:
        print(f"[Audio Setup] ERROR: Source file not found at {src_path}")

    # Mockingbird/XTTS default speaker destination
    mockingbird_speaker_dir = root_dir / "mockingbird_tts" / "speakers"
    mockingbird_speaker_dir.mkdir(parents=True, exist_ok=True)
    mockingbird_dest = mockingbird_speaker_dir / "charlotte.wav"
    if src_path.exists():
        print(f"[Audio Setup] Copying {src_path.name} to Mockingbird speakers...")
        shutil.copy2(src_path, mockingbird_dest)

    # Cleanup trash from previous tests
    trash_path = dest_dir / "reference_voice.wav"
    if trash_path.exists():
        try:
            trash_path.unlink()
            print("[Audio Setup] Cleaned up temporary reference_voice.wav")
        except:
            pass

if __name__ == "__main__":
    setup_audio_files()
