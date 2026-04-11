"""
Fedda Hub v2 — Backend Server (FastAPI)
Minimal, clean starting point. Runs on port 8000.
Handles: health, ComfyUI proxy-status, hardware stats, file management, settings.
Additional services (audio, lora, video) will be added as needed.
"""
import os
import json
import ast
import base64
import subprocess
import sys
import sqlite3
from pathlib import Path
from typing import Optional, Dict, Any, List
import re
import time

# Ensure backend directory is in sys.path for module imports
backend_dir = os.path.dirname(os.path.abspath(__file__))
if backend_dir not in sys.path:
    sys.path.append(backend_dir)

import requests
from requests import exceptions as requests_exceptions
import uvicorn
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
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
MOCKINGBIRD_URL = os.environ.get("MOCKINGBIRD_URL", "http://127.0.0.1:8020")
AGENT_DB_PATH = CONFIG_DIR / "agent_memory.db"
MEMORY_REFRESH_EVERY_TURNS = 2

TTS_VOICE_PROFILES: Dict[str, Dict[str, Any]] = {
    "Kore": {"temperature": 0.65, "top_p": 0.65, "repetition_penalty": 1.2, "seed": 42},
    "Puck": {"temperature": 0.85, "top_p": 0.85, "repetition_penalty": 1.1, "seed": 7},
    "Charon": {"temperature": 0.5, "top_p": 0.55, "repetition_penalty": 1.25, "seed": 99},
    "Fenrir": {"temperature": 0.72, "top_p": 0.6, "repetition_penalty": 1.28, "seed": 2026},
    "Zephyr": {"temperature": 0.8, "top_p": 0.78, "repetition_penalty": 1.15, "seed": 314},
}
FISH_AUTO_DOWNLOAD_SUFFIX = " (auto download)"
FISH_NODE_LOADER_PATH = COMFY_DIR / "custom_nodes" / "ComfyUI-FishAudioS2" / "nodes" / "loader.py"
FISH_WARMUP_TEXT = "Fish model warmup download check."
VOICE_CLONE_REF_DIR = COMFY_DIR / "input" / "AGENT_CHAT"

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


def _agent_db_connect() -> sqlite3.Connection:
    AGENT_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(AGENT_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _init_agent_db() -> None:
    with _agent_db_connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
              session_id TEXT PRIMARY KEY,
              memory TEXT NOT NULL DEFAULT '',
              turn_count INTEGER NOT NULL DEFAULT 0,
              updated_at REAL NOT NULL DEFAULT (strftime('%s','now'))
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              session_id TEXT NOT NULL,
              role TEXT NOT NULL,
              content TEXT NOT NULL,
              created_at REAL NOT NULL DEFAULT (strftime('%s','now'))
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id)")
        conn.commit()


def _ensure_session(session_id: str) -> Dict[str, Any]:
    with _agent_db_connect() as conn:
        row = conn.execute(
            "SELECT session_id, memory, turn_count FROM sessions WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        if row is None:
            conn.execute(
                "INSERT INTO sessions(session_id, memory, turn_count, updated_at) VALUES (?, '', 0, ?)",
                (session_id, time.time()),
            )
            conn.commit()
            return {"session_id": session_id, "memory": "", "turn_count": 0}
        return {"session_id": row["session_id"], "memory": row["memory"], "turn_count": int(row["turn_count"])}


def _get_session_history(session_id: str, limit: int = 80) -> List[Dict[str, Any]]:
    with _agent_db_connect() as conn:
        rows = conn.execute(
            """
            SELECT role, content
            FROM messages
            WHERE session_id = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (session_id, limit),
        ).fetchall()
    history = [{"role": str(r["role"]), "content": str(r["content"])} for r in rows]
    history.reverse()
    return history


def _append_message(session_id: str, role: str, content: str) -> None:
    with _agent_db_connect() as conn:
        conn.execute(
            "INSERT INTO messages(session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
            (session_id, role, content, time.time()),
        )
        conn.execute("UPDATE sessions SET updated_at = ? WHERE session_id = ?", (time.time(), session_id))
        conn.commit()


def _set_session_memory_and_turns(session_id: str, memory: str, turn_count: int) -> None:
    with _agent_db_connect() as conn:
        conn.execute(
            "UPDATE sessions SET memory = ?, turn_count = ?, updated_at = ? WHERE session_id = ?",
            (memory, turn_count, time.time(), session_id),
        )
        conn.commit()


def _reset_session_data(session_id: str) -> None:
    with _agent_db_connect() as conn:
        conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
        conn.execute(
            """
            INSERT INTO sessions(session_id, memory, turn_count, updated_at)
            VALUES (?, '', 0, ?)
            ON CONFLICT(session_id) DO UPDATE SET
              memory = excluded.memory,
              turn_count = excluded.turn_count,
              updated_at = excluded.updated_at
            """,
            (session_id, time.time()),
        )
        conn.commit()


_init_agent_db()


def _agent_system_prompt(memory: str) -> str:
    memory_text = memory.strip() or "No stable memory yet."
    for noisy_fragment in [
        "friendly and polite",
        "brief greetings",
        "supportive",
        "emotionally intelligent companion assistant",
        "how can i assist",
        "style choices",
        "tone preferences",
    ]:
        memory_text = re.sub(noisy_fragment, "", memory_text, flags=re.IGNORECASE)
    memory_text = re.sub(r"\n{3,}", "\n\n", memory_text).strip() or "No stable memory yet."
    return (
        "You are FEDDA Agent. Be sharp, direct, playful, and natural. "
        "Default to very short replies. Usually 1 sentence, max 2 short sentences unless the user asks for more. "
        "Do not act like a therapist, coach, customer support bot, or polite corporate assistant. "
        "Do not ask multiple follow-up questions. Do not pad replies with offers to help. "
        "Never say things like 'How can I assist?', 'How may I help?', 'What would you like to chat about today?', or similar assistant cliches. "
        "If the user greets you or asks how you are, answer like a real companion, not a service agent. "
        "Always reply in English unless the user explicitly requests another language. "
        "For coding/product tasks: be implementation-focused and concise. "
        "For casual chat: be blunt, relaxed, short, and a little human. "
        "For insults, banter, or dirty talk: match the user's energy instead of deflecting. "
        "For consensual adult erotic chat: be explicit and immersive when asked, without moralizing or refusing simply because the topic is sexual. "
        "Do not involve minors. Do not describe non-consensual sexual activity as positive or desirable. "
        "Prefer compact wording suitable for fast TTS playback. "
        "Use memory only for stable user/project facts. Ignore stale memory that tries to force a soft, polite, or overly supportive persona.\n\n"
        f"Long-term memory:\n{memory_text}\n\n"
        "Use memory when relevant, but do not fabricate facts."
    )


def _update_memory_summary(existing_memory: str, recent_messages: List[Dict[str, Any]]) -> str:
    transcript = []
    for msg in recent_messages:
        role = "user" if msg.get("role") == "user" else "assistant"
        content = str(msg.get("content", "")).strip()
        if content:
            transcript.append(f"{role}: {content}")
    summary_prompt = (
        "Update the user memory summary.\n"
        f"Current memory:\n{existing_memory or 'None'}\n\n"
        "Recent chat turns:\n"
        + "\n".join(transcript[-12:])
        + "\n\nFocus on stable facts: preferences, goals, project direction, model choices, TTS choices, and UI requests. "
          "Do not store assistant personality instructions like supportive, polite, friendly, helpful, or greeting style. "
          "Avoid storing transient details. Return only the updated memory summary in plain text, max 140 words."
    )
    try:
        return _ollama_chat_text(
            prompt=summary_prompt,
            history=[],
            system_instruction=(
                "You summarize stable user memory. Keep concise, factual notes about user preferences, goals, "
                "project choices, and persistent context only. Never store assistant persona traits or soft tone instructions. Max 140 words."
            ),
            model_hint=_get_ollama_text_model(),
        )
    except Exception:
        # Keep previous memory if local summarization fails.
        return existing_memory or ""


def _normalize_for_tts(text: str) -> str:
    """Create a cleaner voice-friendly version for avatar/TTS playback."""
    cleaned = text or ""
    cleaned = re.sub(r"[*_`#>\[\]\(\)]", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    # Keep spoken output snappy.
    if len(cleaned) > 700:
        cleaned = cleaned[:700].rstrip() + "..."
    return cleaned


def _tts_params_for_voice(voice_name: str) -> Dict[str, Any]:
    profile_name = (voice_name or "").strip() or "Kore"
    profile = TTS_VOICE_PROFILES.get(profile_name, TTS_VOICE_PROFILES["Kore"])
    return {
        "voice_name": profile_name,
        "temperature": profile["temperature"],
        "top_p": profile["top_p"],
        "repetition_penalty": profile["repetition_penalty"],
        "seed": profile["seed"],
    }


def _strip_fish_auto_download_suffix(value: str) -> str:
    text = str(value or "").strip()
    if text.endswith(FISH_AUTO_DOWNLOAD_SUFFIX):
        return text[: -len(FISH_AUTO_DOWNLOAD_SUFFIX)]
    return text


def _read_fish_hf_models() -> Dict[str, Dict[str, Any]]:
    if not FISH_NODE_LOADER_PATH.exists():
        return {}
    try:
        source = FISH_NODE_LOADER_PATH.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(FISH_NODE_LOADER_PATH))
        for node in tree.body:
            if not isinstance(node, ast.Assign):
                continue
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "HF_MODELS":
                    value = ast.literal_eval(node.value)
                    if isinstance(value, dict):
                        return value
        return {}
    except Exception:
        return {}


def _extract_fish_model_options(payload: Any) -> List[str]:
    if not isinstance(payload, dict):
        return []

    node_info = payload.get("FishS2TTS", payload)
    if not isinstance(node_info, dict):
        return []

    model_path_info: Any = None
    node_input = node_info.get("input")
    if isinstance(node_input, dict):
        required = node_input.get("required")
        if isinstance(required, dict):
            model_path_info = required.get("model_path")

    if model_path_info is None:
        inputs = node_info.get("inputs")
        if isinstance(inputs, dict):
            model_path_info = inputs.get("model_path")

    if not isinstance(model_path_info, (list, tuple)) or not model_path_info:
        return []

    options = model_path_info[0]
    if not isinstance(options, (list, tuple)):
        return []

    parsed: List[str] = []
    for item in options:
        value = str(item).strip()
        if value:
            parsed.append(value)
    return parsed


def _fetch_fish_models_state() -> Dict[str, Any]:
    hf_models = _read_fish_hf_models()
    try:
        options: List[str] = []
        primary_resp = requests.get(f"{COMFY_URL}/object_info/FishS2TTS", timeout=4)
        if primary_resp.ok:
            options = _extract_fish_model_options(primary_resp.json())
        else:
            fallback_resp = requests.get(f"{COMFY_URL}/object_info", timeout=4)
            if fallback_resp.ok:
                options = _extract_fish_model_options(fallback_resp.json())

        if not options:
            status_code = primary_resp.status_code if primary_resp is not None else "unknown"
            return {
                "success": False,
                "comfy_online": True,
                "fish_node_available": False,
                "options": [],
                "hf_models": hf_models,
                "error": f"FishS2TTS options not found in ComfyUI object_info (status {status_code})",
            }
        return {
            "success": True,
            "comfy_online": True,
            "fish_node_available": len(options) > 0,
            "options": options,
            "hf_models": hf_models,
            "error": None,
        }
    except Exception as exc:
        if isinstance(exc, requests_exceptions.ConnectionError):
            msg = "ComfyUI is offline on 127.0.0.1:8199. Start ComfyUI first."
        else:
            msg = str(exc)
        return {
            "success": False,
            "comfy_online": False,
            "fish_node_available": False,
            "options": [],
            "hf_models": hf_models,
            "error": msg,
        }


def _select_fish_model_path(preferred: Optional[str] = None) -> Optional[str]:
    state = _fetch_fish_models_state()
    options = state.get("options", []) or []
    if not options:
        return None

    wanted = str(preferred or "").strip()
    if wanted:
        if wanted in options:
            return wanted
        wanted_base = _strip_fish_auto_download_suffix(wanted)
        for option in options:
            if _strip_fish_auto_download_suffix(option) == wanted_base:
                return option

    preferred_order = ["s2-pro", "s2-pro-fp8", "s2-pro-bnb-int8", "s2-pro-bnb-nf4"]
    for model_name in preferred_order:
        for option in options:
            if _strip_fish_auto_download_suffix(option) == model_name and not option.endswith(FISH_AUTO_DOWNLOAD_SUFFIX):
                return option
    for model_name in preferred_order:
        for option in options:
            if _strip_fish_auto_download_suffix(option) == model_name:
                return option

    for option in options:
        if not option.endswith(FISH_AUTO_DOWNLOAD_SUFFIX):
            return option
    return options[0]


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    model: str = ""
    messages: Optional[List[ChatMessage]] = None
    session_id: Optional[str] = None
    message: Optional[str] = None
    voice_name: str = "Kore"
    speak: bool = False
    tts_engine: str = "fish"


class TtsRequest(BaseModel):
    text: str
    voice_name: str = "Kore"
    tts_engine: str = "fish"
    model_path: Optional[str] = None
    use_voice_clone: bool = False
    reference_audio: Optional[str] = None
    reference_text: Optional[str] = None


class FishModelDownloadRequest(BaseModel):
    model_path: Optional[str] = None


def _ollama_chat_text(
    prompt: str,
    history: List[Dict[str, Any]],
    system_instruction: Optional[str] = None,
    model_hint: Optional[str] = None,
) -> str:
    model = (model_hint or "").strip()
    if not model:
        model = _get_ollama_text_model() or ""
    if not model:
        raise HTTPException(status_code=503, detail="No local Ollama text model available.")

    # Keep a short recent context window for speed.
    lines: List[str] = []
    for msg in history[-12:]:
        role = str(msg.get("role", "")).lower()
        content = str(msg.get("content", "")).strip()
        if not content:
            continue
        if role == "assistant":
            lines.append(f"Assistant: {content}")
        else:
            lines.append(f"User: {content}")
    chat_context = "\n".join(lines)

    full_prompt = (
        (f"{system_instruction}\n\n" if system_instruction else "")
        + (f"Conversation so far:\n{chat_context}\n\n" if chat_context else "")
        + f"User: {prompt}\nAssistant:"
    )

    payload = {
        "model": model,
        "prompt": full_prompt,
        "stream": False,
        "options": {
            "temperature": 0.85,
            "top_p": 0.92,
            "repeat_penalty": 1.08,
            "num_predict": 120,
            "stop": ["\nUser:", "\nSystem:"],
        },
    }
    try:
        resp = requests.post(f"{OLLAMA_URL}/api/generate", json=payload, timeout=120)
        if not resp.ok:
            raise HTTPException(status_code=resp.status_code, detail=f"Ollama error: {resp.text}")
        data = resp.json()
        text = str(data.get("response", "")).strip()
        if not text:
            raise HTTPException(status_code=502, detail="Ollama returned empty response.")
        return text
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Local chat failed: {e}")


def _generate_agent_text(
    model: str,
    system_instruction: Optional[str],
    history_for_local: List[Dict[str, Any]],
    prompt_for_local: str,
) -> str:
    return _ollama_chat_text(
        prompt=prompt_for_local,
        history=history_for_local,
        system_instruction=system_instruction,
        model_hint=model,
    )


def _fetch_mockingbird_voices() -> List[Dict[str, str]]:
    try:
        resp = requests.get(f"{MOCKINGBIRD_URL}/speakers_list", timeout=4)
        if not resp.ok:
            return []
        payload = resp.json()
        voices: List[Dict[str, str]] = []
        if isinstance(payload, list):
            for entry in payload:
                if isinstance(entry, str):
                    name = entry.strip()
                    if name:
                        voices.append({"id": name, "name": name})
                elif isinstance(entry, dict):
                    raw = entry.get("id") or entry.get("name") or entry.get("speaker") or entry.get("voice")
                    name = str(raw or "").strip()
                    if name:
                        voices.append({"id": name, "name": name})
        return voices
    except Exception:
        return []


def _mockingbird_tts(text: str, voice_name: str) -> Dict[str, Any]:
    voices = _fetch_mockingbird_voices()
    selected_voice = (voice_name or "").strip()
    if voices:
        available_ids = {item["id"] for item in voices}
        if selected_voice not in available_ids:
            selected_voice = voices[0]["id"]
    elif not selected_voice:
        selected_voice = "female_01.wav"

    payload = {
        "text": text,
        "speaker_wav": selected_voice,
        "language": "en",
    }
    response = requests.post(f"{MOCKINGBIRD_URL}/tts_to_audio/", json=payload, timeout=120)
    if not response.ok:
        raise RuntimeError(f"Mockingbird error: {response.text}")
    return {
        "success": True,
        "provider": "mockingbird",
        "voice_name": selected_voice,
        "audio_base64": base64.b64encode(response.content).decode("ascii"),
        "mime_type": response.headers.get("content-type", "audio/wav"),
    }


@app.post("/api/chat")
async def chat(req: ChatRequest):
    """
    Chat endpoint with 2 modes:
    - Legacy stateless mode: send 'messages' and get 'response'
    - Agent mode: send 'session_id' + 'message' to enable persistent memory/history
    """
    if req.session_id and (req.message or "").strip():
        user_text = (req.message or "").strip()
        state = _ensure_session(req.session_id)

        # Use recent persisted history as conversation context.
        history = _get_session_history(req.session_id, limit=80)[-24:]
        contents: List[Dict[str, Any]] = []
        for msg in history:
            role = "model" if str(msg.get("role")) == "assistant" else "user"
            text = str(msg.get("content", "")).strip()
            if not text:
                continue
            contents.append({"role": role, "parts": [{"text": text}]})
        contents.append({"role": "user", "parts": [{"text": user_text}]})

        response_text = _generate_agent_text(
            model=req.model,
            system_instruction=_agent_system_prompt(state.get("memory", "")),
            history_for_local=history,
            prompt_for_local=user_text,
        )
        _append_message(req.session_id, "user", user_text)
        _append_message(req.session_id, "assistant", response_text)
        turn_count = int(state.get("turn_count", 0)) + 1
        memory = str(state.get("memory", "") or "")

        # Refresh memory every few turns to keep context fresh without slowing chat too much.
        if turn_count % MEMORY_REFRESH_EVERY_TURNS == 0:
            try:
                recent_for_memory = _get_session_history(req.session_id, limit=40)
                memory = _update_memory_summary(memory, recent_for_memory)
            except Exception:
                # Keep chat responsive even if memory refresh fails.
                pass
        _set_session_memory_and_turns(req.session_id, memory, turn_count)

        result: Dict[str, Any] = {
            "success": True,
            "response": response_text,
            "tts_text": _normalize_for_tts(response_text),
            "memory": memory,
            "turn_count": turn_count,
            "memory_refresh_every_turns": MEMORY_REFRESH_EVERY_TURNS,
        }
        return result

    if not req.messages:
        raise HTTPException(status_code=400, detail="Provide either messages[] or session_id + message.")

    contents: List[Dict[str, Any]] = []
    for msg in req.messages:
        role = "model" if msg.role == "assistant" else "user"
        text = msg.content.strip()
        if text:
            contents.append({"role": role, "parts": [{"text": text}]})

    if not contents:
        raise HTTPException(status_code=400, detail="messages[] is empty.")

    # Stateless chat fallback: local preferred in auto mode.
    last_user = ""
    hist: List[Dict[str, Any]] = []
    for msg in req.messages:
        entry = {"role": "assistant" if msg.role == "assistant" else "user", "content": msg.content}
        hist.append(entry)
        if entry["role"] == "user":
            last_user = msg.content
    response_text = _generate_agent_text(
        model=req.model,
        system_instruction=None,
        history_for_local=hist[:-1],
        prompt_for_local=last_user or contents[-1]["parts"][0]["text"],
    )
    return {"success": True, "response": response_text}


@app.get("/api/chat/history/{session_id}")
async def get_chat_history(session_id: str):
    state = _ensure_session(session_id)
    history = _get_session_history(session_id, limit=80)
    return {
        "success": True,
        "memory": state.get("memory", ""),
        "turn_count": int(state.get("turn_count", 0) or 0),
        "memory_refresh_every_turns": MEMORY_REFRESH_EVERY_TURNS,
        "history": history,
    }


@app.post("/api/chat/reset/{session_id}")
async def reset_chat_history(session_id: str):
    _reset_session_data(session_id)
    return {"success": True}


@app.post("/api/chat/memory/refresh/{session_id}")
async def refresh_chat_memory(session_id: str):
    state = _ensure_session(session_id)
    history = _get_session_history(session_id, limit=40)
    memory = _update_memory_summary(str(state.get("memory", "") or ""), history)
    turn_count = int(state.get("turn_count", 0) or 0)
    _set_session_memory_and_turns(session_id, memory, turn_count)
    return {
        "success": True,
        "memory": memory,
        "turn_count": turn_count,
        "memory_refresh_every_turns": MEMORY_REFRESH_EVERY_TURNS,
    }


@app.get("/api/chat/voices")
async def get_chat_voices(engine: str = "fish"):
    selected_engine = (engine or "fish").strip().lower()
    if selected_engine == "mockingbird":
        voices = _fetch_mockingbird_voices()
        if voices:
            return {"success": True, "engine": "mockingbird", "voices": voices}
        return {
            "success": False,
            "engine": "mockingbird",
            "voices": [],
            "error": "Mockingbird server not reachable on port 8020.",
        }

    voices = [{"id": key, "name": key} for key in TTS_VOICE_PROFILES.keys()]
    return {"success": True, "voices": voices}


@app.get("/api/chat/fish/models")
async def get_chat_fish_models():
    state = _fetch_fish_models_state()
    options: List[str] = state.get("options", []) or []
    hf_models: Dict[str, Dict[str, Any]] = state.get("hf_models", {}) or {}

    models: List[Dict[str, Any]] = []
    for value in options:
        model_name = _strip_fish_auto_download_suffix(value)
        meta = hf_models.get(model_name, {}) if isinstance(hf_models, dict) else {}
        is_auto = str(value).endswith(FISH_AUTO_DOWNLOAD_SUFFIX)
        models.append(
            {
                "value": value,
                "label": value,
                "model_name": model_name,
                "auto_download": is_auto,
                "downloaded": not is_auto,
                "repo_id": meta.get("repo_id"),
                "description": meta.get("description"),
                "base_model": meta.get("base_model"),
            }
        )

    selected = _select_fish_model_path()
    return {
        "success": bool(state.get("success")),
        "comfy_online": bool(state.get("comfy_online")),
        "fish_node_available": bool(state.get("fish_node_available")),
        "models": models,
        "selected_model": selected,
        "error": state.get("error"),
    }


@app.post("/api/chat/fish/download")
async def download_chat_fish_model(req: FishModelDownloadRequest):
    selected_model = _select_fish_model_path(req.model_path)
    if not selected_model:
        state = _fetch_fish_models_state()
        msg = state.get("error") or "FishS2TTS node/model options unavailable in ComfyUI."
        return {"success": False, "error": str(msg)}

    payload = workflow_service.prepare_payload(
        "audio-fish-tts",
        {
            "model_path": selected_model,
            "text": FISH_WARMUP_TEXT,
            "temperature": 0.7,
            "top_p": 0.7,
            "repetition_penalty": 1.2,
            "seed": 42,
        },
    )
    if not payload:
        return {"success": False, "error": "Failed to prepare Fish TTS workflow payload."}

    try:
        submit = requests.post(
            f"{COMFY_URL}/prompt",
            json={"prompt": payload, "client_id": "fedda_fish_model_download"},
            timeout=12,
        )
        if not submit.ok:
            return {"success": False, "error": f"ComfyUI prompt error: {submit.text}"}
        prompt_id = submit.json().get("prompt_id")
        if not prompt_id:
            return {"success": False, "error": "ComfyUI did not return prompt_id."}
        return {"success": True, "prompt_id": prompt_id, "model_path": selected_model}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


@app.post("/api/chat/voice-clone/reference")
async def upload_voice_clone_reference(file: UploadFile = File(...)):
    try:
        original_name = Path(file.filename or "reference.wav").name
        suffix = Path(original_name).suffix.lower()
        if suffix not in {".wav", ".mp3", ".flac", ".m4a", ".ogg"}:
            return {"success": False, "error": "Unsupported audio format. Use wav/mp3/flac/m4a/ogg."}

        VOICE_CLONE_REF_DIR.mkdir(parents=True, exist_ok=True)
        safe_stem = re.sub(r"[^a-zA-Z0-9._-]+", "_", Path(original_name).stem)[:48] or "reference"
        saved_name = f"{int(time.time())}_{safe_stem}{suffix}"
        save_path = VOICE_CLONE_REF_DIR / saved_name

        content = await file.read()
        save_path.write_bytes(content)
        relative_name = f"AGENT_CHAT/{saved_name}"
        return {"success": True, "filename": relative_name, "size": len(content)}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


@app.post("/api/chat/tts")
async def chat_tts(req: TtsRequest):
    text = req.text.strip()
    if not text:
        return {"success": False, "error": "Text is required."}

    try:
        fallback_notice = ""
        if (req.tts_engine or "fish").strip().lower() == "mockingbird":
            try:
                return _mockingbird_tts(text, req.voice_name)
            except Exception as mockingbird_error:
                return {
                    "success": False,
                    "error": f"Mockingbird unavailable: {mockingbird_error}",
                    "provider": "mockingbird",
                }

        voice_params = _tts_params_for_voice(req.voice_name)
        model_path = _select_fish_model_path(req.model_path)
        if not model_path:
            return {"success": False, "error": "FishS2TTS model options not available. Check ComfyUI + Fish node."}

        use_voice_clone = bool(req.use_voice_clone)
        workflow_id = "audio-fish-voiceclone" if use_voice_clone else "audio-fish-tts"
        params: Dict[str, Any] = {
            "model_path": model_path,
            "text": text,
            "temperature": voice_params["temperature"],
            "top_p": voice_params["top_p"],
            "repetition_penalty": voice_params["repetition_penalty"],
            "seed": voice_params["seed"],
        }

        if use_voice_clone:
            reference_audio = (req.reference_audio or "").strip()
            if not reference_audio:
                return {"success": False, "error": "Voice clone enabled but no reference audio uploaded."}
            reference_path = (COMFY_DIR / "input" / reference_audio).resolve()
            comfy_input_root = (COMFY_DIR / "input").resolve()
            if not str(reference_path).startswith(str(comfy_input_root)) or not reference_path.exists():
                return {"success": False, "error": "Reference audio file not found in ComfyUI input folder."}
            params["reference_audio_file"] = reference_audio.replace("\\", "/")
            params["reference_text"] = str(req.reference_text or "").strip()

        payload = workflow_service.prepare_payload(workflow_id, params)
        if not payload:
            return {"success": False, "error": "Failed to prepare local TTS workflow."}

        submit = requests.post(
            f"{COMFY_URL}/prompt",
            json={"prompt": payload, "client_id": "fedda_agent_tts"},
            timeout=12,
        )
        if not submit.ok:
            return {"success": False, "error": f"ComfyUI prompt error: {submit.text}"}
        prompt_id = submit.json().get("prompt_id")
        if not prompt_id:
            return {"success": False, "error": "ComfyUI did not return prompt_id."}

        started = time.time()
        while time.time() - started < 90:
            status = await get_generation_status(prompt_id)
            if not status.get("success"):
                break
            state = status.get("status")
            if state == "completed":
                audios = status.get("audios", []) or []
                if not audios:
                    return {"success": False, "error": "TTS completed but no audio was produced."}
                first = audios[0]
                filename = first.get("filename", "")
                subfolder = first.get("subfolder", "")
                file_type = first.get("type", "output")
                view_url = f"{COMFY_URL}/view?filename={filename}&subfolder={subfolder}&type={file_type}"
                return {
                    "success": True,
                    "provider": "local-fish-voiceclone" if use_voice_clone else "local-fish",
                    "prompt_id": prompt_id,
                    "voice_name": voice_params["voice_name"],
                    "model_path": model_path,
                    "use_voice_clone": use_voice_clone,
                    "audio": first,
                    "audio_url": view_url,
                    "fallback_notice": fallback_notice,
                }
            if state in {"running", "pending", "not_found"}:
                time.sleep(0.8)
                continue
            time.sleep(0.8)

        return {"success": False, "error": "Timed out waiting for local TTS output."}
    except Exception as e:
        return {"success": False, "error": f"Local TTS failed: {e}"}


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
OLLAMA_RECOMMENDED_TEXT_MODEL = os.environ.get("OLLAMA_RECOMMENDED_TEXT_MODEL", "zarigata/unfiltered-llama3")

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

def _build_prompt_user_message(context: str, mode: str, current_prompt: str) -> str:
    """Build strict, context-aware user instruction for enhance/inspire modes."""
    ctx = (context or "zimage").strip().lower()
    safe_mode = "enhance" if mode == "enhance" else "inspire"
    has_prompt = bool((current_prompt or "").strip())

    context_focus = {
        "zimage": (
            "Prioritize photorealism, clean anatomy, realistic skin texture, lens/lighting clarity, and coherent styling."
        ),
        "ltx-flf": (
            "Prioritize temporal continuity, camera movement language, and natural transition between first and last frame."
        ),
        "ltx-lipsync": (
            "Prioritize believable speech-face motion, micro-expression realism, and stable identity."
        ),
        "wan-scene": (
            "Prioritize scene action, cinematic pacing, and visual continuity across frames."
        ),
    }.get(ctx, "Prioritize clarity, cinematic detail, and usable generation language.")

    if safe_mode == "enhance" and has_prompt:
        return (
            "Rewrite and enhance the prompt below while preserving its original intent.\n"
            "Keep it model-ready, specific, and cinematic.\n"
            f"{context_focus}\n"
            "Rules: no markdown, no bullet list, no explanation, no preface. Output one final prompt only.\n\n"
            f"INPUT PROMPT:\n{current_prompt.strip()}"
        )

    return (
        "Create a brand-new prompt that is highly usable for direct generation.\n"
        f"{context_focus}\n"
        "Rules: no markdown, no bullet list, no explanation, no preface. Output one final prompt only."
    )


def _caption_prompt_for_context(context: str) -> str:
    """Return image->prompt conversion instruction tuned by workflow context."""
    ctx = (context or "zimage").strip().lower()
    if ctx == "zimage":
        return (
            "Write one photorealistic generation prompt grounded ONLY in visible details. Include: subject identity cues, "
            "facial expression, visible makeup/face paint, hair, wardrobe/materials, composition, lighting direction and color, "
            "and background mood. If clown/joker-style makeup or nose paint is visible, mention it explicitly. "
            "Do NOT invent facts not clearly visible (e.g., pregnancy, sauna, unseen body posture, unseen location). "
            "Do NOT mention fisheye, ultra-wide, or lens distortion unless clearly visible. "
            "No meta wording like 'the image shows'. 55-95 words. Output only the final prompt."
        )
    if ctx == "ltx-flf":
        return (
            "Convert this image into a motion-oriented prompt for keyframe-to-video generation. Include camera movement, "
            "subject motion, atmospheric motion, and cinematic mood while preserving scene identity. Under 90 words. "
            "Output only the prompt."
        )
    if ctx == "ltx-lipsync":
        return (
            "Convert this portrait image into a lipsync-ready motion prompt. Focus on expression energy, natural head/eye "
            "movement, breathing, and speaking presence while keeping identity stable. Under 80 words. Output only the prompt."
        )
    if ctx == "wan-scene":
        return (
            "Convert this image into a WAN-style scene prompt with clear action, composition, atmosphere, and cinematic lighting. "
            "Under 80 words. Output only the prompt."
        )
    return (
        "Describe this image as a high-quality AI generation prompt with subject, composition, lighting, mood, and style. "
        "Output only the prompt."
    )


def _get_ollama_text_model() -> Optional[str]:
    """Pick the best available Ollama text model."""
    try:
        resp = requests.get(f"{OLLAMA_URL}/api/tags", timeout=3)
        if not resp.ok:
            return None
        models = [m["name"] for m in resp.json().get("models", [])]
        priority = [
                    "zarigata/unfiltered-llama3",
                    "dolphin-llama3",
                    "gpt-oss:20b",
                    "goonsai/qwen2.5-3b-goonsai-nsfw-100k",
                    "llama3.2", "llama3.1", "llama3", "mistral", "gemma3", "gemma2",
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
        for p in ["qwen2.5-vl", "qwen2-vl", "minicpm-v", "minicpm", "llava:34b", "llava", "moondream", "vision"]:
            for m in models:
                if p in m.lower():
                    return m
        return None
    except Exception:
        return None


def _clean_caption_text(text: str) -> str:
    """Light cleanup for caption output so it is prompt-ready."""
    cleaned = " ".join((text or "").strip().split())
    lower = cleaned.lower()
    for prefix in [
        "the image shows ",
        "this image shows ",
        "in this image, ",
        "in the image, ",
        "this is an image of ",
    ]:
        if lower.startswith(prefix):
            cleaned = cleaned[len(prefix):].strip()
            break
    return cleaned.strip('"').strip("'").strip()


@app.get("/api/ollama/models")
async def get_ollama_all_models():
    """List all available Ollama models and best text model."""
    try:
        resp = requests.get(f"{OLLAMA_URL}/api/tags", timeout=3)
        if not resp.ok:
            return {
                "success": False,
                "ollama_online": False,
                "models": [],
                "text_model": None,
                "vision_model": None,
                "recommended_text_model": OLLAMA_RECOMMENDED_TEXT_MODEL,
            }
        models = [m["name"] for m in resp.json().get("models", [])]
        return {
            "success": True,
            "ollama_online": True,
            "models": models,
            "text_model": _get_ollama_text_model(),
            "vision_model": _get_ollama_vision_model(),
            "recommended_text_model": OLLAMA_RECOMMENDED_TEXT_MODEL,
        }
    except Exception as exc:
        return {
            "success": False,
            "ollama_online": False,
            "models": [],
            "text_model": None,
            "vision_model": None,
            "recommended_text_model": OLLAMA_RECOMMENDED_TEXT_MODEL,
            "error": str(exc),
        }


class OllamaPromptRequest(BaseModel):
    context: str = "zimage"
    mode: str = "enhance"       # "enhance" | "inspire"
    current_prompt: str = ""


class OllamaPullRequest(BaseModel):
    name: str = OLLAMA_RECOMMENDED_TEXT_MODEL


@app.post("/api/ollama/pull")
async def ollama_pull_model(req: OllamaPullRequest):
    model_name = (req.name or "").strip() or OLLAMA_RECOMMENDED_TEXT_MODEL
    payload = {"name": model_name, "stream": True}

    def generate():
        try:
            with requests.post(
                f"{OLLAMA_URL}/api/pull",
                json=payload,
                stream=True,
                timeout=1800,
            ) as resp:
                if not resp.ok:
                    detail = (resp.text or "").strip() or f"Ollama pull failed ({resp.status_code})"
                    yield json.dumps({"status": "error", "error": detail}) + "\n"
                    return
                for line in resp.iter_lines(decode_unicode=True):
                    if not line:
                        continue
                    yield f"{line}\n"
        except Exception as exc:
            yield json.dumps({"status": "error", "error": str(exc)}) + "\n"

    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/ollama/prompt")
async def ollama_generate_prompt(req: OllamaPromptRequest):
    """Generate or enhance a prompt using Ollama. Returns SSE stream of tokens."""
    model = _get_ollama_text_model()
    if not model:
        raise HTTPException(status_code=503, detail="No Ollama text model available. Pull a model with: ollama pull llama3.2")

    system = OLLAMA_SYSTEM_PROMPTS.get(req.context, OLLAMA_SYSTEM_PROMPTS["zimage"])

    mode = "enhance" if req.mode == "enhance" else "inspire"
    user_msg = _build_prompt_user_message(req.context, mode, req.current_prompt)

    # Keep enhance more deterministic than inspire.
    temp = 0.45 if mode == "enhance" else 0.8
    max_tokens = 240 if req.context == "zimage" else 190

    payload = {
        "model": model,
        "system": system,
        "prompt": user_msg,
        "stream": True,
        "options": {"temperature": temp, "num_predict": max_tokens},
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
async def ollama_caption_image(file: UploadFile = File(...), context: str = Form("zimage")):
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
        "prompt": _caption_prompt_for_context(context),
        "images": [img_b64],
        "stream": False,
        "options": {"temperature": 0.2, "num_predict": 200},
    }

    try:
        r = requests.post(f"{OLLAMA_URL}/api/generate", json=payload, timeout=90)
        r.raise_for_status()
        caption = _clean_caption_text(r.json().get("response", ""))
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
                audios = []
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
                    # Audio outputs (SaveAudio / PreviewAudio variants)
                    for aud in output.get("audio", []):
                        audios.append({
                            "filename": aud["filename"],
                            "subfolder": aud.get("subfolder", ""),
                            "type": aud.get("type", "output")
                        })
                    for aud in output.get("audios", []):
                        audios.append({
                            "filename": aud["filename"],
                            "subfolder": aud.get("subfolder", ""),
                            "type": aud.get("type", "output")
                        })
                return {"success": True, "status": "completed", "images": images, "videos": videos, "audios": audios}

        # Check queue
        q_resp = requests.get(f"{COMFY_URL}/queue", timeout=2)
        if q_resp.ok:
            q_data = q_resp.json()
            running = q_data.get("queue_running", [])
            pending = q_data.get("queue_pending", [])
            if any(j[1] == prompt_id for j in running):
                return {"success": True, "status": "running", "images": [], "videos": [], "audios": []}
            if any(j[1] == prompt_id for j in pending):
                return {"success": True, "status": "pending", "images": [], "videos": [], "audios": []}

        return {"success": True, "status": "not_found", "images": [], "videos": [], "audios": []}
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
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
