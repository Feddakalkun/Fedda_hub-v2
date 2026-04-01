"""
Audio Service - TTS (Chatterbox-Turbo/Kokoro/Edge) + STT (faster-whisper large-v3-turbo) + VAD (Silero)
Direct Python calls, no ComfyUI dependency.
All models are LAZY-LOADED on first use and can be unloaded to free VRAM for image generation.
"""
import os
import time
import asyncio
import threading
import numpy as np
import soundfile as sf
from pathlib import Path

# Fix HuggingFace symlink issue on Windows (faster-whisper model downloads)
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

# --- Paths ---
TEMP_AUDIO_DIR = Path(__file__).parent.parent / "temp" / "audio"
TEMP_AUDIO_DIR.mkdir(parents=True, exist_ok=True)
ASSETS_TTS_DIR = Path(__file__).parent.parent / "assets" / "audio-tts"

# --- Model state (all start unloaded) ---
_chatterbox_model = None
_chatterbox_available = None  # None = not checked yet, True/False = checked
_kokoro_pipeline = None
_kokoro_available = None
_whisper_model = None
_vad_model = None

# Lock to prevent concurrent model loading
_load_lock = threading.Lock()

# Auto-unload timer
_unload_timer = None
_UNLOAD_DELAY_SECONDS = 60  # Unload audio models 60s after last use

KOKORO_VOICES = {
    "Female": "af_heart",
    "Female Bella": "af_bella",
    "Female Nicole": "af_nicole",
    "Female Sarah": "af_sarah",
    "Male Adam": "am_adam",
    "Male Michael": "am_michael",
}

EDGE_VOICES = {
    "Female": "en-US-AriaNeural",
    "Male": "en-US-GuyNeural",
    "Female British": "en-GB-SoniaNeural",
}


# ================================
# LAZY LOADING
# ================================

def _ensure_chatterbox():
    """Load Chatterbox-Turbo on first use."""
    global _chatterbox_model, _chatterbox_available
    if _chatterbox_available is not None:
        return _chatterbox_available
    with _load_lock:
        if _chatterbox_available is not None:
            return _chatterbox_available
        try:
            import perth
            if perth.PerthImplicitWatermarker is None:
                print("[WARN] Perth watermarker is None, patching with DummyWatermarker")
                perth.PerthImplicitWatermarker = perth.DummyWatermarker
            from chatterbox import ChatterboxTTS
            _chatterbox_model = ChatterboxTTS.from_pretrained(device="cuda")
            _chatterbox_available = True
            print("[OK] Chatterbox-Turbo TTS loaded (CUDA)")
        except Exception as e:
            print(f"[WARN] Chatterbox-Turbo not available: {e}")
            _chatterbox_available = False
    return _chatterbox_available


def _ensure_kokoro():
    """Load Kokoro TTS on first use."""
    global _kokoro_pipeline, _kokoro_available
    if _kokoro_available is not None:
        return _kokoro_available
    with _load_lock:
        if _kokoro_available is not None:
            return _kokoro_available
        try:
            from kokoro import KPipeline
            _kokoro_pipeline = KPipeline(lang_code='a', repo_id='hexgrad/Kokoro-82M')
            _kokoro_available = True
            print("[OK] Kokoro TTS loaded")
        except Exception as e:
            print(f"[WARN] Kokoro TTS not available: {e}")
            _kokoro_available = False
    return _kokoro_available


def _ensure_whisper():
    """Load faster-whisper on first use."""
    global _whisper_model
    if _whisper_model is not None:
        return True
    with _load_lock:
        if _whisper_model is not None:
            return True
        try:
            from faster_whisper import WhisperModel
            _whisper_model = WhisperModel("large-v3-turbo", device="cuda", compute_type="int8")
            print("[OK] faster-whisper loaded (large-v3-turbo, CUDA, int8)")
            return True
        except Exception as e:
            print(f"[WARN] faster-whisper large-v3-turbo CUDA failed: {e}")
            try:
                from faster_whisper import WhisperModel
                _whisper_model = WhisperModel("base", device="cuda", compute_type="float16")
                print("[OK] faster-whisper fallback (base, CUDA)")
                return True
            except Exception:
                try:
                    from faster_whisper import WhisperModel
                    _whisper_model = WhisperModel("base", device="cpu", compute_type="int8")
                    print("[OK] faster-whisper fallback (base, CPU)")
                    return True
                except Exception as e3:
                    print(f"[ERROR] faster-whisper not available: {e3}")
                    return False


def _ensure_vad():
    """Load Silero VAD on first use."""
    global _vad_model
    if _vad_model is not None:
        return True
    with _load_lock:
        if _vad_model is not None:
            return True
        try:
            import torch
            _vad_model, _ = torch.hub.load(
                repo_or_dir='snakers4/silero-vad',
                model='silero_vad',
                trust_repo=True
            )
            print("[OK] Silero VAD loaded")
            return True
        except Exception as e:
            print(f"[WARN] Silero VAD not available: {e}")
            return False


def _reset_unload_timer():
    """Reset the auto-unload timer. Called after every audio operation."""
    global _unload_timer
    if _unload_timer is not None:
        _unload_timer.cancel()
    _unload_timer = threading.Timer(_UNLOAD_DELAY_SECONDS, unload_audio_models)
    _unload_timer.daemon = True
    _unload_timer.start()


def unload_audio_models():
    """Unload all audio models from VRAM to free memory for image generation."""
    global _chatterbox_model, _chatterbox_available
    global _kokoro_pipeline, _kokoro_available
    global _whisper_model, _vad_model

    freed = []
    with _load_lock:
        if _chatterbox_model is not None:
            del _chatterbox_model
            _chatterbox_model = None
            _chatterbox_available = None  # Reset so it can be reloaded
            freed.append("Chatterbox")

        if _kokoro_pipeline is not None:
            del _kokoro_pipeline
            _kokoro_pipeline = None
            _kokoro_available = None
            freed.append("Kokoro")

        if _whisper_model is not None:
            del _whisper_model
            _whisper_model = None
            freed.append("faster-whisper")

        if _vad_model is not None:
            del _vad_model
            _vad_model = None
            freed.append("Silero VAD")

    if freed:
        import torch
        torch.cuda.empty_cache()
        print(f"[OK] Unloaded audio models: {', '.join(freed)} — VRAM freed")
    else:
        print("[OK] No audio models loaded, nothing to unload")


# ================================
# PUBLIC API
# ================================

def save_temp_audio(data: bytes, filename: str) -> Path:
    """Save raw audio data to a temp file."""
    file_path = TEMP_AUDIO_DIR / filename
    with open(file_path, "wb") as f:
        f.write(data)
    return file_path


def cleanup_temp_audio(file_path: Path):
    """Delete temp audio file."""
    try:
        if file_path.exists():
            os.remove(file_path)
    except Exception as e:
        print(f"Warning: Failed to delete temp file {file_path}: {e}")


def transcribe_audio(audio_path: Path) -> str:
    """Transcribe audio file using faster-whisper with optional VAD filtering."""
    _ensure_whisper()
    _ensure_vad()
    _reset_unload_timer()

    if _whisper_model is None:
        raise RuntimeError("Whisper model not initialized")

    start = time.time()

    vad_filter = _vad_model is not None
    segments, info = _whisper_model.transcribe(
        str(audio_path),
        beam_size=5,
        vad_filter=vad_filter,
        vad_parameters=dict(
            min_silence_duration_ms=500,
            speech_pad_ms=200,
        ) if vad_filter else None,
    )
    text = " ".join(seg.text.strip() for seg in segments)
    elapsed = time.time() - start
    model_info = "large-v3-turbo" if "turbo" in str(getattr(_whisper_model, 'model_size_or_path', '')) else "base"
    print(f"[OK] Transcribed ({model_info}, VAD={'on' if vad_filter else 'off'}) in {elapsed:.2f}s: {text[:60]}...")
    return text


def text_to_speech(text: str, voice_style: str = "Female") -> Path:
    """
    Generate speech from text.
    Priority: Chatterbox-Turbo (voice cloning) > Kokoro (fast) > Edge TTS (cloud).
    """
    _reset_unload_timer()

    clone_ref = _get_clone_reference(voice_style)

    # Try Chatterbox-Turbo first
    if _ensure_chatterbox() and _chatterbox_model is not None:
        return _tts_chatterbox(text, voice_style, clone_ref)

    # Fallback to Kokoro
    if _ensure_kokoro() and _kokoro_pipeline is not None:
        kokoro_voice = KOKORO_VOICES.get(voice_style, "af_heart")
        return _tts_kokoro(text, kokoro_voice)

    # Last resort: Edge TTS (cloud, no VRAM)
    return _tts_edge(text, voice_style)


def get_available_voices() -> list:
    """Return list of available voices for the frontend dropdown.
    Does NOT load models — just checks what's potentially available."""
    voices = []

    # Check if chatterbox/kokoro packages are importable (without loading models)
    chatterbox_importable = _chatterbox_available is True or (_chatterbox_available is None and _check_importable("chatterbox"))
    kokoro_importable = _kokoro_available is True or (_kokoro_available is None and _check_importable("kokoro"))

    if chatterbox_importable:
        voices.extend([
            {"name": "Female (Natural)", "engine": "chatterbox", "id": "chatterbox_female"},
            {"name": "Male (Natural)", "engine": "chatterbox", "id": "chatterbox_male"},
        ])

    if kokoro_importable:
        for name, voice_id in KOKORO_VOICES.items():
            voices.append({
                "name": f"{name} (Fast)" if chatterbox_importable else name,
                "engine": "kokoro",
                "id": voice_id,
            })

    if not chatterbox_importable and not kokoro_importable:
        for name, voice_id in EDGE_VOICES.items():
            voices.append({"name": name, "engine": "edge", "id": voice_id})

    # Cloned voices from assets/audio-tts/
    if ASSETS_TTS_DIR.exists():
        for folder in sorted(ASSETS_TTS_DIR.iterdir()):
            if folder.is_dir():
                wav_file = folder / f"{folder.name}.wav"
                if wav_file.exists():
                    engine = "chatterbox-clone" if chatterbox_importable else "clone"
                    voices.append({
                        "name": f"{folder.name.capitalize()} (Clone)",
                        "engine": engine,
                        "id": folder.name,
                    })

    return voices


def _check_importable(module_name: str) -> bool:
    """Check if a module can be imported without actually loading it into VRAM."""
    try:
        import importlib
        importlib.import_module(module_name)
        return True
    except ImportError:
        return False


# ================================
# INTERNAL TTS ENGINES
# ================================

def _get_clone_reference(voice_style: str):
    """Check if a voice has a reference audio file for cloning."""
    if not ASSETS_TTS_DIR.exists():
        return None
    voice_lower = voice_style.lower().replace(" (clone)", "").replace(" (natural)", "").replace(" (fast)", "").strip()
    ref_dir = ASSETS_TTS_DIR / voice_lower
    if ref_dir.is_dir():
        wav_file = ref_dir / f"{voice_lower}.wav"
        if wav_file.exists():
            return wav_file
    return None


def _tts_chatterbox(text: str, voice_style: str, clone_ref: Path = None) -> Path:
    """Generate speech using Chatterbox-Turbo with optional voice cloning."""
    import torchaudio

    start = time.time()
    output_path = TEMP_AUDIO_DIR / f"tts_{int(time.time() * 1000)}.wav"

    if clone_ref is not None:
        wav = _chatterbox_model.generate(text, audio_prompt_path=str(clone_ref))
        clone_info = f", clone={clone_ref.parent.name}"
    else:
        wav = _chatterbox_model.generate(text)
        clone_info = ""

    torchaudio.save(str(output_path), wav, _chatterbox_model.sr)

    elapsed = time.time() - start
    duration = wav.shape[-1] / _chatterbox_model.sr
    print(f"[OK] Chatterbox TTS: {elapsed:.2f}s gen, {duration:.1f}s audio{clone_info}")
    return output_path


def _tts_kokoro(text: str, voice: str = "af_heart") -> Path:
    """Generate speech using Kokoro TTS (fast, lightweight)."""
    start = time.time()
    output_path = TEMP_AUDIO_DIR / f"tts_{int(time.time() * 1000)}.wav"

    audio_chunks = []
    for _, _, audio in _kokoro_pipeline(text, voice=voice):
        if hasattr(audio, 'numpy'):
            audio_chunks.append(audio.numpy())
        else:
            audio_chunks.append(np.array(audio))

    if not audio_chunks:
        raise RuntimeError("Kokoro produced no audio")

    full_audio = np.concatenate(audio_chunks)
    sf.write(str(output_path), full_audio, 24000)

    elapsed = time.time() - start
    duration = len(full_audio) / 24000
    print(f"[OK] Kokoro TTS: {elapsed:.2f}s gen, {duration:.1f}s audio, voice={voice}")
    return output_path


def _tts_edge(text: str, voice_style: str = "Female") -> Path:
    """Generate speech using Edge TTS (cloud fallback)."""
    import edge_tts
    import concurrent.futures

    edge_voice = EDGE_VOICES.get(voice_style, "en-US-AriaNeural")
    output_path = TEMP_AUDIO_DIR / f"tts_{int(time.time() * 1000)}.mp3"

    start = time.time()

    async def _generate():
        communicate = edge_tts.Communicate(text, edge_voice)
        await communicate.save(str(output_path))

    # FastAPI runs inside an active event loop. If we're already in one,
    # run Edge-TTS in a dedicated thread with its own loop.
    try:
        asyncio.get_running_loop()
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            pool.submit(lambda: asyncio.run(_generate())).result()
    except RuntimeError:
        asyncio.run(_generate())

    elapsed = time.time() - start
    print(f"[OK] Edge TTS: {elapsed:.2f}s, voice={edge_voice}")
    return output_path


print("--- Audio Service Ready (lazy-load mode, no VRAM used until needed) ---")
