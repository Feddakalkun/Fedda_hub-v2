import os
import json
import time
import shutil
import requests
from pathlib import Path
from typing import Optional

# ComfyUI Configuration
COMFYUI_URL = "http://127.0.0.1:8199"
COMFYUI_INPUT_DIR = Path(__file__).parent.parent / "ComfyUI" / "input"
COMFYUI_OUTPUT_DIR = Path(__file__).parent.parent / "ComfyUI" / "output"

# Workflows
WORKFLOWS = {
    "256": Path(__file__).parent.parent / "assets" / "workflows" / "WAN-INFINITE-TALK-256.json",
    "512": Path(__file__).parent.parent / "assets" / "workflows" / "WAN-INFINITE-TALK-512.json",
    "768": Path(__file__).parent.parent / "assets" / "workflows" / "WAN-INFINITE-TALK-768.json"
}

def load_workflow(resolution: str = "512"):
    """Load the specific resolution workflow"""
    workflow_path = WORKFLOWS.get(str(resolution), WORKFLOWS["512"])
    if not workflow_path.exists():
        raise FileNotFoundError(f"Workflow not found: {workflow_path}")
        
    with open(workflow_path, 'r', encoding='utf-8') as f:
        return json.load(f)

def generate_lipsync(
    image_path: Path, 
    audio_path: Path, 
    resolution: int = 512,
    seed: int = -1,
    steps: int = 15,
    prompt: str = "woman talking"
) -> Path:
    """
    Execute Wan2.1 Infinite Talk LipSync Workflow
    """
    # 1. Setup Input Files
    COMFYUI_INPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    # Copy Image
    target_image_name = f"lipsync_input_{int(time.time())}_{image_path.name}"
    target_image_path = COMFYUI_INPUT_DIR / target_image_name
    shutil.copy2(image_path, target_image_path)
    
    # Copy Audio
    target_audio_name = f"lipsync_audio_{int(time.time())}_{audio_path.name}"
    target_audio_path = COMFYUI_INPUT_DIR / target_audio_name
    shutil.copy2(audio_path, target_audio_path)
    
    print(f"✅ Prepared Inputs:\n  Image: {target_image_name}\n  Audio: {target_audio_name}")
    
    # 2. Load and Configure Workflow
    workflow = load_workflow(str(resolution))
    
    # Node 284: Load Image
    if "284" in workflow:
        workflow["284"]["inputs"]["image"] = target_image_name
    else:
        raise ValueError("Node 284 (Load Image) not found in workflow")
        
    # Node 125: Load Audio
    if "125" in workflow:
        workflow["125"]["inputs"]["audio"] = target_audio_name
    else:
        raise ValueError("Node 125 (Load Audio) not found in workflow")

    # Node 128: WanVideo Sampler (Seed & Steps)
    if "128" in workflow:
        if seed != -1:
            workflow["128"]["inputs"]["seed"] = seed
        workflow["128"]["inputs"]["steps"] = steps
        
    # Node 241: Text Encode (Optional Positive Prompt)
    if "241" in workflow:
        workflow["241"]["inputs"]["positive_prompt"] = prompt

    # 3. Queue Job
    try:
        response = requests.post(
            f"{COMFYUI_URL}/prompt",
            json={"prompt": workflow, "client_id": "comfyfront-lipsync"}
        )
        response.raise_for_status()
        prompt_id = response.json()['prompt_id']
        print(f"🚀 Queued LipSync Job: {prompt_id}")
    except Exception as e:
        print(f"❌ Failed to queue job: {e}")
        raise e

    # 4. Poll for Result
    output_file = poll_for_video(prompt_id)
    
    # Cleanup Inputs (Optional - maybe keep for history?)
    # target_image_path.unlink(missing_ok=True)
    # target_audio_path.unlink(missing_ok=True)
    
    return output_file

def poll_for_video(prompt_id: str, timeout: int = 600) -> Path:
    """Wait for video generation to complete"""
    start_time = time.time()
    
    while (time.time() - start_time) < timeout:
        time.sleep(2)
        try:
            history = requests.get(f"{COMFYUI_URL}/history/{prompt_id}").json()
            
            if prompt_id in history:
                outputs = history[prompt_id].get('outputs', {})
                
                # Node 131 is VHS_VideoCombine
                if "131" in outputs:
                    video_files = outputs["131"].get("gifs", []) # VHS often returns 'gifs' even for mp4
                    if not video_files: # Check 'videos' key just in case
                         video_files = outputs["131"].get("videos", [])
                         
                    if video_files:
                        file_info = video_files[0]
                        filename = file_info['filename']
                        subfolder = file_info.get('subfolder', '')
                        
                        output_path = COMFYUI_OUTPUT_DIR / subfolder / filename
                        if output_path.exists():
                            print(f"✅ Video Generated: {output_path}")
                            return output_path
                
                # If we are here, the job is in history (finished) but Node 131 produced no output or wasn't found.
                print(f"⚠️ Job {prompt_id} finished but no video found. Outputs: {list(outputs.keys())}")
                raise Exception("Generation finished without video. First run? Models might have been downloading. Please try again!")
                
        except Exception as e:
            if "Generation finished without video" in str(e):
                raise e
            print(f"⚠️ Polling error: {e}")
            
    raise TimeoutError("LipSync generation timed out")
