"""
Audio Service - handles audio transcription and TTS via ComfyUI
"""
import os
import json
import time
import requests
import shutil
from pathlib import Path

# ComfyUI server URL
COMFYUI_URL = "http://127.0.0.1:8199"

# Paths
WORKFLOW_PATH = Path(__file__).parent / "workflows" / "audio" / "audio_caption_api.json"
TTS_WORKFLOW_PATH = Path(__file__).parent / "workflows" / "audio" / "voxcpm_tts_api.json"
TEMP_AUDIO_DIR = Path(__file__).parent.parent / "temp" / "audio"
TEMP_AUDIO_DIR.mkdir(parents=True, exist_ok=True)
COMFYUI_INPUT = Path(__file__).parent.parent / "ComfyUI" / "input"
COMFYUI_OUTPUT = Path(__file__).parent.parent / "ComfyUI" / "output"

def load_audio_caption_workflow():
    """Load the AUDIO CAPTION workflow (API format)"""
    with open(WORKFLOW_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)

def load_tts_workflow():
    """Load the TTS workflow (API format)"""
    with open(TTS_WORKFLOW_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_temp_audio(data: bytes, filename: str) -> Path:
    """Save raw audio data to a temp file"""
    file_path = TEMP_AUDIO_DIR / filename
    with open(file_path, "wb") as f:
        f.write(data)
    return file_path

def cleanup_temp_audio(file_path: Path):
    """Delete temp audio file"""
    try:
        if file_path.exists():
            os.remove(file_path)
    except Exception as e:
        print(f"Warning: Failed to delete temp file {file_path}: {e}")

def transcribe_audio(audio_path: Path) -> str:
    """
    Send audio to ComfyUI for transcription (Whisper)
    """
    # 1. Upload audio to ComfyUI input directory
    # Manual copy is more reliable than /upload/image for non-image types sometimes
    COMFYUI_INPUT.mkdir(parents=True, exist_ok=True)
    target_filename = f"transcribe_{int(time.time())}_{audio_path.name}"
    target_path = COMFYUI_INPUT / target_filename
    
    shutil.copy2(audio_path, target_path)
    print(f"✅ Audio uploaded/copied as: {target_filename}")

    # 2. Configure Workflow
    workflow = load_audio_caption_workflow()
    
    # Node 13 (LoadAudio) -> set widget "audio"
    node_found = False
    for node_id, node in workflow.items():
        if node.get("class_type") == "LoadAudio":
            node["inputs"]["audio"] = target_filename
            node_found = True
            break
            
    if not node_found:
        # Fallback to hardcoded ID if search fails
        if "13" in workflow:
            workflow["13"]["inputs"]["audio"] = target_filename
    
    # 3. Queue Job
    try:
        response = requests.post(f"{COMFYUI_URL}/prompt", json={"prompt": workflow, "client_id": "api_client_audio"})
        response.raise_for_status()
        prompt_id = response.json()['prompt_id']
    except Exception as e:
        raise Exception(f"Failed to queue transcription job: {e}")
    
    # 4. Poll
    max_frames = 60 # 2 mins timeout
    print(f"Processing transcription job {prompt_id}...")
    
    for _ in range(max_frames):
        time.sleep(1)
        try:
            history = requests.get(f"{COMFYUI_URL}/history/{prompt_id}").json()
            
            if prompt_id in history:
                outputs = history[prompt_id]['outputs']
                
                # Look for any text output
                for node_id, node_output in outputs.items():
                    if 'text' in node_output:
                        transcription = node_output['text'][0]
                        print(f"✅ Transcription success: {transcription[:30]}...")
                        return transcription
                    
                    # Also check for 'caption' string sometimes
                    if 'caption' in node_output:
                        return node_output['caption'][0]
                        
        except Exception as e:
            print(f"Polling warning: {e}")
            
    raise TimeoutError("Transcription timed out - no text output found")

def text_to_speech(text: str, voice_style: str = "female, clear voice") -> Path:
    """
    Generate speech from text using ComfyUI VoxCPM TTS workflow
    """
    # 1. Load TTS workflow (VoxCPM)
    workflow_api = load_tts_workflow()
    
    # 2. Update text in Node (Try to find VoxCPM Generator)
    text_node_found = False
    for node_id, node in workflow_api.items():
         if node.get("class_type") == "VoxCPM_Generator":
             node["inputs"]["text"] = text
             text_node_found = True
             break
    
    if not text_node_found and "26" in workflow_api:
        # Fallback to hardcoded ID 26
        workflow_api["26"]["inputs"]["text"] = text
        
    print(f"✅ Set TTS text: {text[:50]}...")
    
    # 3. Queue the workflow
    response = requests.post(
        f"{COMFYUI_URL}/prompt",
        json={"prompt": workflow_api, "client_id": "python-tts-service"}
    )
    
    if response.status_code != 200:
        print(f"❌ TTS Error response: {response.text}")
        response.raise_for_status()
        
    prompt_id = response.json()['prompt_id']
    print(f"✅ Queued TTS generation, prompt_id: {prompt_id}")
    
    # 4. Poll for completion and get audio file path
    max_attempts = 120  
    for attempt in range(max_attempts):
        time.sleep(2)
        
        try:
            history_response = requests.get(f"{COMFYUI_URL}/history/{prompt_id}")
            if history_response.status_code != 200:
                continue
                
            history = history_response.json()
            
            if prompt_id in history and history[prompt_id].get('outputs'):
                outputs = history[prompt_id]['outputs']
                
                # Check ALL outputs for audio files
                for node_id, node_output in outputs.items():
                    if 'audio' in node_output and len(node_output['audio']) > 0:
                        audio_info = node_output['audio'][0]
                        filename = audio_info.get('filename')
                        subfolder = audio_info.get('subfolder', '')
                        
                        audio_path = COMFYUI_OUTPUT / subfolder / filename
                        
                        if audio_path.exists():
                            print(f"✅ TTS audio generated: {audio_path}")
                            return audio_path
                
        except Exception as e:
            print(f"Polling error: {e}")
            
        # print(f"⏳ TTS attempt {attempt + 1}/{max_attempts}...")
    
    raise Exception("TTS generation timed out")
