"""
Voice Streaming Service — Real-time voice pipeline over WebSocket.
Architecture: Mic audio → Server-side VAD → STT → LLM streaming → Sentence buffer → TTS streaming → Audio playback

Implements:
- Server-side Silero VAD (speech detection + end-of-utterance)
- Sentence buffer (accumulates LLM tokens → fires TTS per sentence)
- Kokoro-first hybrid (fast first sentence, Chatterbox for quality on rest)
- Barge-in (interrupt TTS when user starts speaking)

All audio models are lazy-loaded on first voice use and auto-unload after 60s idle.
"""
import os
import re
import json
import time
import asyncio
import struct
import numpy as np
import torch
from typing import Optional
from pathlib import Path

# Import from audio_service (lazy-load — models load on first use, auto-unload after 60s)
import audio_service
from audio_service import (
    KOKORO_VOICES, TEMP_AUDIO_DIR,
    _get_clone_reference, _reset_unload_timer,
    _ensure_chatterbox, _ensure_kokoro, _ensure_whisper, _ensure_vad,
)


# ============================================================
# Sentence Buffer — splits LLM token stream into sentences
# ============================================================

class SentenceBuffer:
    """Accumulates LLM tokens and yields complete sentences."""

    def __init__(self):
        self.buffer = ""
        self.sentence_end = re.compile(r'[.!?\n](?:\s|$)')

    def add_token(self, token: str) -> list:
        """Add a token, return any complete sentences."""
        self.buffer += token
        sentences = []
        while True:
            match = self.sentence_end.search(self.buffer)
            if match:
                end_pos = match.end()
                sentence = self.buffer[:end_pos].strip()
                self.buffer = self.buffer[end_pos:]
                if sentence:
                    sentences.append(sentence)
            else:
                break
        return sentences

    def flush(self):
        """Flush remaining buffer (called when LLM stream ends)."""
        remaining = self.buffer.strip()
        self.buffer = ""
        return remaining if remaining else None


# ============================================================
# VAD Processor — detects speech boundaries from audio chunks
# ============================================================

class VADProcessor:
    """Processes incoming audio chunks and detects speech boundaries."""

    def __init__(self, threshold: float = 0.5, min_silence_ms: int = 400, sample_rate: int = 16000):
        self.threshold = threshold
        self.min_silence_ms = min_silence_ms
        self.sample_rate = sample_rate
        self.is_speaking = False
        self.audio_buffer = []
        self.silence_ms = 0

    def reset(self):
        self.is_speaking = False
        self.audio_buffer = []
        self.silence_ms = 0
        if audio_service._vad_model is not None:
            audio_service._vad_model.reset_states()

    def process_chunk(self, audio_bytes: bytes, chunk_ms: int = 200) -> dict:
        """Process a raw PCM 16-bit mono audio chunk. Returns event dict."""
        if audio_service._vad_model is None:
            # No VAD — just buffer everything, let the client decide
            self.audio_buffer.append(audio_bytes)
            return {"event": "speech_continue"}

        # Convert bytes → float32 tensor
        audio_np = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        audio_tensor = torch.from_numpy(audio_np)

        # Silero VAD expects specific chunk sizes at 16kHz (512 samples = 32ms)
        # Process in 512-sample sub-chunks, take max probability
        max_prob = 0.0
        for i in range(0, len(audio_tensor) - 512 + 1, 512):
            chunk = audio_tensor[i:i + 512]
            prob = audio_service._vad_model(chunk, self.sample_rate).item()
            max_prob = max(max_prob, prob)

        if max_prob >= self.threshold:
            self.silence_ms = 0
            if not self.is_speaking:
                self.is_speaking = True
                self.audio_buffer = []
                self.audio_buffer.append(audio_bytes)
                return {"event": "speech_start", "prob": max_prob}
            self.audio_buffer.append(audio_bytes)
            return {"event": "speech_continue", "prob": max_prob}
        else:
            if self.is_speaking:
                self.silence_ms += chunk_ms
                self.audio_buffer.append(audio_bytes)
                if self.silence_ms >= self.min_silence_ms:
                    # Speech ended — collect all buffered audio
                    self.is_speaking = False
                    complete_audio = b"".join(self.audio_buffer)
                    self.audio_buffer = []
                    return {"event": "speech_end", "audio": complete_audio, "prob": max_prob}
                return {"event": "speech_trailing_silence", "prob": max_prob}
            return {"event": "silence", "prob": max_prob}


# ============================================================
# STT — transcribe raw PCM audio bytes
# ============================================================

def transcribe_bytes(audio_bytes: bytes, sample_rate: int = 16000) -> str:
    """Transcribe raw PCM 16-bit mono audio bytes using faster-whisper."""
    _ensure_whisper()
    _reset_unload_timer()

    if audio_service._whisper_model is None:
        raise RuntimeError("Whisper model not initialized")

    # Save to temp file (faster-whisper needs a file path)
    import soundfile as sf
    temp_path = TEMP_AUDIO_DIR / f"stt_{int(time.time() * 1000)}.wav"
    audio_np = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
    sf.write(str(temp_path), audio_np, sample_rate)

    start = time.time()
    segments, info = audio_service._whisper_model.transcribe(
        str(temp_path),
        beam_size=5,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500, speech_pad_ms=200),
    )
    text = " ".join(seg.text.strip() for seg in segments)
    elapsed = time.time() - start
    print(f"[STT] {elapsed:.2f}s: {text[:80]}...")

    # Cleanup temp file
    try:
        temp_path.unlink()
    except Exception:
        pass

    return text


# ============================================================
# LLM Streaming — Ollama (local) or IF_AI_tools (RunPod)
# ============================================================

_IS_RUNPOD = os.environ.get("RUNPOD_POD_ID") is not None


async def stream_llm(prompt: str, model: str = "qwen2.5:7b-instruct",
                     system_prompt: str = None) -> "AsyncGenerator[str, None]":
    """Stream tokens from LLM. Ollama on local, IF_AI_tools on RunPod."""
    if _IS_RUNPOD:
        async for token in _stream_if_ai_tools(prompt, system_prompt):
            yield token
    else:
        async for token in _stream_ollama(prompt, model, system_prompt):
            yield token


async def _stream_ollama(prompt: str, model: str, system_prompt: str = None):
    """Stream tokens from Ollama (local)."""
    import httpx

    payload = {
        "model": model,
        "prompt": prompt,
        "stream": True,
        "keep_alive": "30s",
        "options": {"num_predict": 300, "num_ctx": 4096, "num_gpu": 99},
    }
    if system_prompt:
        payload["system"] = system_prompt

    async with httpx.AsyncClient() as client:
        async with client.stream("POST", "http://127.0.0.1:11434/api/generate",
                                  json=payload, timeout=30.0) as response:
            async for line in response.aiter_lines():
                if not line:
                    continue
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    continue
                token = data.get("response", "")
                if token:
                    yield token
                if data.get("done"):
                    return


async def _stream_if_ai_tools(prompt: str, system_prompt: str = None):
    """Get LLM response via ComfyUI IF_AI_tools (RunPod). Non-streaming, yields full response."""
    import httpx

    # Build IF_AI_tools workflow
    workflow_path = Path(__file__).parent.parent / "public" / "workflows" / "if-ai-chat.json"
    if not workflow_path.exists():
        # Fallback: yield error message
        yield "Voice LLM not available on this server (missing IF_AI_tools workflow)."
        return

    workflow = json.loads(workflow_path.read_text())
    full_prompt = prompt
    if system_prompt:
        full_prompt = f"System: {system_prompt}\n\nUser: {prompt}"
    workflow["1"]["inputs"]["prompt"] = full_prompt

    comfy_url = "http://127.0.0.1:8199"
    async with httpx.AsyncClient() as client:
        # Queue the workflow
        resp = await client.post(f"{comfy_url}/prompt", json={"prompt": workflow}, timeout=10.0)
        resp.raise_for_status()
        prompt_id = resp.json()["prompt_id"]

        # Poll for completion (max 60s)
        for _ in range(120):
            await asyncio.sleep(0.5)
            history_resp = await client.get(f"{comfy_url}/history/{prompt_id}", timeout=10.0)
            history = history_resp.json()
            if prompt_id in history and history[prompt_id].get("outputs"):
                outputs = history[prompt_id]["outputs"]
                if "2" in outputs and "text" in outputs["2"]:
                    response_text = outputs["2"]["text"][0]
                    # Yield word by word to feed sentence buffer
                    for word in response_text.split():
                        yield word + " "
                    return

        yield "LLM response timed out."


# ============================================================
# TTS — Kokoro fast (sentence 1) + Chatterbox non-streaming (sentence 2+)
# ============================================================

def tts_kokoro_bytes(text: str, voice: str = "af_heart") -> bytes:
    """Generate speech with Kokoro, return raw PCM 16-bit 24kHz bytes."""
    _ensure_kokoro()
    _reset_unload_timer()

    if not audio_service._kokoro_available or audio_service._kokoro_pipeline is None:
        return b""

    audio_chunks = []
    for _, _, audio in audio_service._kokoro_pipeline(text, voice=voice):
        if hasattr(audio, 'numpy'):
            audio_chunks.append(audio.numpy())
        else:
            audio_chunks.append(np.array(audio))

    if not audio_chunks:
        return b""

    full_audio = np.concatenate(audio_chunks)
    pcm_int16 = (full_audio * 32767).astype(np.int16)
    return pcm_int16.tobytes()


def tts_chatterbox_bytes(text: str, clone_ref: str = None) -> bytes:
    """Generate speech with Chatterbox (non-streaming, RTF~1.0x), return raw PCM 16-bit 24kHz bytes."""
    _ensure_chatterbox()
    _reset_unload_timer()

    if not audio_service._chatterbox_available or audio_service._chatterbox_model is None:
        return b""

    start = time.time()
    kwargs = {}
    if clone_ref:
        kwargs["audio_prompt_path"] = str(clone_ref)

    wav = audio_service._chatterbox_model.generate(text, **kwargs)
    pcm_float = wav.cpu().squeeze().numpy()
    pcm_int16 = (pcm_float * 32767).astype(np.int16)
    elapsed = time.time() - start
    duration = len(pcm_int16) / 24000
    print(f"[TTS] Chatterbox: {elapsed:.2f}s gen, {duration:.1f}s audio (RTF={elapsed/max(duration,0.1):.2f}x)")
    return pcm_int16.tobytes()


def warmup_tts():
    """Warmup TTS models with a dummy generation to eliminate first-call overhead."""
    if _ensure_kokoro() and audio_service._kokoro_pipeline is not None:
        try:
            tts_kokoro_bytes("Warming up.", "af_heart")
            print("[OK] Kokoro TTS warmed up")
        except Exception as e:
            print(f"[WARN] Kokoro warmup failed: {e}")

    if _ensure_chatterbox() and audio_service._chatterbox_model is not None:
        try:
            tts_chatterbox_bytes("Ready.")
            print("[OK] Chatterbox TTS warmed up")
        except Exception as e:
            print(f"[WARN] Chatterbox warmup failed: {e}")


# ============================================================
# Full Streaming Pipeline — orchestrates STT → LLM → TTS
# ============================================================

def _load_voice_models():
    """Load all voice models on demand (called at start of voice pipeline)."""
    _ensure_whisper()
    _ensure_vad()
    _ensure_kokoro()
    _ensure_chatterbox()
    _reset_unload_timer()


async def streaming_voice_pipeline(send_json, send_bytes, audio_bytes: bytes,
                                    voice_style: str = "Female",
                                    model: str = "qwen2.5:7b-instruct",
                                    system_prompt: str = None):
    """
    Full streaming pipeline: audio → STT → LLM stream → sentence-chunked TTS → audio stream.
    send_json: async callable to send JSON messages to client
    send_bytes: async callable to send binary audio to client
    """
    # Lazy-load all voice models
    await asyncio.to_thread(_load_voice_models)

    pipeline_start = time.time()

    # --- Stage 1: STT ---
    t0 = time.time()
    transcript = await asyncio.to_thread(transcribe_bytes, audio_bytes)
    stt_time = time.time() - t0

    if not transcript.strip():
        await send_json({"type": "error", "message": "Could not transcribe audio"})
        return

    await send_json({"type": "transcript", "text": transcript})

    # --- Stage 2+3: LLM streaming → Sentence buffer → TTS ---
    sentence_buffer = SentenceBuffer()
    sentence_index = 0
    full_response = []

    # Determine TTS strategy
    clone_ref = _get_clone_reference(voice_style)
    clone_ref_str = str(clone_ref) if clone_ref else None
    kokoro_voice = KOKORO_VOICES.get(voice_style, "af_heart")
    use_hybrid = audio_service._kokoro_available and audio_service._chatterbox_available

    t_llm_start = time.time()
    first_audio_time = None

    async for token in stream_llm(transcript, model=model, system_prompt=system_prompt):
        full_response.append(token)
        await send_json({"type": "llm_token", "token": token})

        # Feed to sentence buffer
        sentences = sentence_buffer.add_token(token)

        for sentence in sentences:
            if first_audio_time is None:
                first_audio_time = time.time()

            if sentence_index == 0 and use_hybrid:
                # Kokoro for fast first sentence
                audio_data = await asyncio.to_thread(tts_kokoro_bytes, sentence, kokoro_voice)
                if audio_data:
                    await send_bytes(audio_data)
            elif audio_service._chatterbox_available:
                # Chatterbox non-streaming per sentence (RTF~1.0x, pipelined)
                audio_data = await asyncio.to_thread(tts_chatterbox_bytes, sentence, clone_ref_str)
                if audio_data:
                    await send_bytes(audio_data)
            elif audio_service._kokoro_available:
                # Kokoro fallback
                audio_data = await asyncio.to_thread(tts_kokoro_bytes, sentence, kokoro_voice)
                if audio_data:
                    await send_bytes(audio_data)

            sentence_index += 1

    # Flush remaining text
    remaining = sentence_buffer.flush()
    if remaining:
        if audio_service._kokoro_available:
            audio_data = await asyncio.to_thread(tts_kokoro_bytes, remaining, kokoro_voice)
            if audio_data:
                await send_bytes(audio_data)
        elif audio_service._chatterbox_available:
            audio_data = await asyncio.to_thread(tts_chatterbox_bytes, remaining, clone_ref_str)
            if audio_data:
                await send_bytes(audio_data)

    total_time = time.time() - pipeline_start
    first_audio_latency = (first_audio_time - pipeline_start) if first_audio_time else total_time

    await send_json({
        "type": "audio_end",
        "metrics": {
            "stt_ms": round(stt_time * 1000),
            "first_audio_ms": round(first_audio_latency * 1000),
            "total_ms": round(total_time * 1000),
            "sentences": sentence_index,
            "response": "".join(full_response),
        }
    })

    print(f"[VOICE] STT={stt_time:.2f}s, first_audio={first_audio_latency:.2f}s, total={total_time:.2f}s, sentences={sentence_index}")


# ============================================================
# WebSocket endpoint registration (called from server.py)
# ============================================================

def register_voice_websocket(app):
    """Register the /ws/voice WebSocket endpoint on the FastAPI app."""
    from fastapi import WebSocket, WebSocketDisconnect

    @app.websocket("/ws/voice")
    async def voice_ws(websocket: WebSocket):
        await websocket.accept()

        # Lazy-load VAD on first WebSocket connection
        _ensure_vad()
        _reset_unload_timer()

        vad = VADProcessor(threshold=0.5, min_silence_ms=400)
        current_task: asyncio.Task = None
        cancelled = False

        print("[WS] Voice WebSocket connected")

        # Config defaults
        voice_style = "Female"
        llm_model = "qwen2.5:7b-instruct"
        system_prompt = "You are a helpful voice assistant. Keep responses concise (1-3 sentences)."

        async def send_json(data):
            try:
                await websocket.send_json(data)
            except Exception:
                pass

        async def send_bytes(data):
            try:
                await websocket.send_bytes(data)
            except Exception:
                pass

        try:
            while True:
                message = await websocket.receive()

                if "bytes" in message and message["bytes"]:
                    # Binary = audio chunk from mic (PCM 16-bit mono 16kHz)
                    result = vad.process_chunk(message["bytes"])

                    if result["event"] == "speech_start":
                        await send_json({"type": "vad_start"})
                        # Barge-in: cancel current TTS if playing
                        if current_task and not current_task.done():
                            current_task.cancel()
                            cancelled = True
                            await send_json({"type": "audio_end"})

                    elif result["event"] == "speech_end":
                        await send_json({"type": "vad_end"})
                        vad.reset()
                        # Launch streaming pipeline
                        current_task = asyncio.create_task(
                            streaming_voice_pipeline(
                                send_json, send_bytes,
                                result["audio"],
                                voice_style=voice_style,
                                model=llm_model,
                                system_prompt=system_prompt,
                            )
                        )

                elif "text" in message and message["text"]:
                    # JSON = config or control message
                    try:
                        data = json.loads(message["text"])
                    except json.JSONDecodeError:
                        continue

                    msg_type = data.get("type", "")

                    if msg_type == "config":
                        voice_style = data.get("voice", voice_style)
                        llm_model = data.get("model", llm_model)
                        system_prompt = data.get("system_prompt", system_prompt)
                        await send_json({"type": "config_ack", "voice": voice_style, "model": llm_model})

                    elif msg_type == "interrupt":
                        if current_task and not current_task.done():
                            current_task.cancel()
                            await send_json({"type": "audio_end"})

                    elif msg_type == "text_input":
                        # Direct text input (no STT needed) — for typed messages
                        text = data.get("text", "").strip()
                        if text:
                            if current_task and not current_task.done():
                                current_task.cancel()

                            async def text_pipeline():
                                # Lazy-load voice models
                                await asyncio.to_thread(_load_voice_models)

                                await send_json({"type": "transcript", "text": text})
                                # Skip STT, go straight to LLM → TTS
                                sentence_buffer = SentenceBuffer()
                                sentence_index = 0
                                clone_ref = _get_clone_reference(voice_style)
                                clone_ref_str = str(clone_ref) if clone_ref else None
                                kokoro_voice = KOKORO_VOICES.get(voice_style, "af_heart")
                                use_hybrid = audio_service._kokoro_available and audio_service._chatterbox_available

                                async for token in stream_llm(text, model=llm_model, system_prompt=system_prompt):
                                    await send_json({"type": "llm_token", "token": token})
                                    sentences = sentence_buffer.add_token(token)
                                    for sentence in sentences:
                                        if sentence_index == 0 and use_hybrid:
                                            audio = await asyncio.to_thread(tts_kokoro_bytes, sentence, kokoro_voice)
                                            if audio:
                                                await send_bytes(audio)
                                        elif audio_service._chatterbox_available:
                                            audio = await asyncio.to_thread(tts_chatterbox_bytes, sentence, clone_ref_str)
                                            if audio:
                                                await send_bytes(audio)
                                        elif audio_service._kokoro_available:
                                            audio = await asyncio.to_thread(tts_kokoro_bytes, sentence, kokoro_voice)
                                            if audio:
                                                await send_bytes(audio)
                                        sentence_index += 1
                                remaining = sentence_buffer.flush()
                                if remaining and audio_service._kokoro_available:
                                    audio = await asyncio.to_thread(tts_kokoro_bytes, remaining, kokoro_voice)
                                    if audio:
                                        await send_bytes(audio)
                                await send_json({"type": "audio_end"})

                            current_task = asyncio.create_task(text_pipeline())

        except WebSocketDisconnect:
            print("[WS] Voice WebSocket disconnected")
            if current_task and not current_task.done():
                current_task.cancel()
        except Exception as e:
            print(f"[WS] Voice WebSocket error: {e}")
            if current_task and not current_task.done():
                current_task.cancel()
