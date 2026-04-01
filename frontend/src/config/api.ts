// ComfyUI API Configuration
// Desktop mode: uses .env.development with localhost URLs
// Docker mode: falls back to relative URLs through Nginx reverse proxy

const COMFY_BASE = import.meta.env.VITE_COMFY_URL || '/comfy';
const BACKEND_BASE = import.meta.env.VITE_BACKEND_URL || '';
const WS_PROTO = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_HOST = import.meta.env.VITE_COMFY_WS_URL || `${WS_PROTO}//${window.location.host}/comfy/ws`;

export const COMFY_API = {
    BASE_URL: COMFY_BASE,

    ENDPOINTS: {
        PROMPT: '/prompt',
        QUEUE: '/queue',
        HISTORY: '/history',
        VIEW: '/view',
        UPLOAD_IMAGE: '/upload/image',
        SYSTEM_STATS: '/system_stats',
        OBJECT_INFO: '/object_info',
    },

    WS_URL: WS_HOST,
};

// Backend API Configuration (FastAPI server)
export const BACKEND_API = {
    BASE_URL: BACKEND_BASE,

    ENDPOINTS: {
        FILES_LIST: '/api/files/list',
        FILES_DELETE: '/api/files/delete',
        FILES_CLEANUP: '/api/files/cleanup',
        RUNPOD_ANIMATE: '/api/runpod/animate',
        RUNPOD_STATUS: '/api/runpod/status',
        RUNPOD_DOWNLOAD: '/api/runpod/download',
        LORA_DESCRIPTIONS: '/api/lora/descriptions',
        LORA_INSTALL: '/api/lora/install',
        LORA_DOWNLOAD_STATUS: '/api/lora/download-status',
        LORA_SYNC_PREMIUM: '/api/lora/sync-premium',
        LORA_INSTALLED: '/api/lora/installed',
        LORA_IMPORT_URL: '/api/lora/import-url',
        LORA_IMPORT_STATUS: '/api/lora/import-status',
        SETTINGS_CIVITAI_KEY: '/api/settings/civitai-key',
        SETTINGS_CIVITAI_KEY_STATUS: '/api/settings/civitai-key/status',
        CHAT_LTX_COPILOT: '/api/chat/ltx-copilot',
        COMFY_REFRESH_MODELS: '/api/comfy/refresh-models',
        AUDIO_TRANSCRIBE: '/api/audio/transcribe',
        AUDIO_TTS: '/api/audio/tts',
        AUDIO_REFERENCE_INFO: '/api/audio/reference-info',
        VIDEO_LIPSYNC: '/api/video/lipsync',
        VIDEO_ANALYZE_PROMPT: '/api/video/analyze-image-prompt',
        OLLAMA_VISION_MODELS: '/api/ollama/vision-models',
        HARDWARE_STATS: '/api/hardware/stats',
    },
};

/** True when running on RunPod (detected via proxy hostname) */
export const IS_RUNPOD = /\.proxy\.runpod\.net$/i.test(window.location.host);

export const APP_CONFIG = {
    NAME: 'FEDDA',
    VERSION: '0.1.0',
    DESCRIPTION: 'PREMIUM COMFYUI FRONTEND',
};

export const MODELS = {
    IMAGE: [
        { id: 'image-generate', label: 'GENERATE', icon: 'Sparkles', category: 'Z-IMAGE' },
        { id: 'image-hq', label: 'HQ IMAGE', icon: 'Layers', category: 'Z-IMAGE' },
        { id: 'image-img2img', label: 'IMG2IMG', icon: 'Image', category: 'Z-IMAGE' },
        { id: 'image-mood-edit', label: 'MOOD EDIT', icon: 'Sun', category: 'Z-IMAGE' },
        { id: 'image-inpaint', label: 'INPAINT', icon: 'Paintbrush', category: 'Z-IMAGE' },
        { id: 'image-metadata', label: 'METADATA', icon: 'FileText', category: 'Z-IMAGE' },
    ],
    QWEN: [
        { id: 'qwen-angle', label: 'MULTIANGLE', icon: 'Box', category: 'QWEN' },
    ],
    FLUX2KLEIN: [
        { id: 'flux2klein-txt2img9b', label: 'TXT2IMG 9B', icon: 'Sparkles', category: 'FLUX2KLEIN' },
        { id: 'flux2klein-image-edit', label: 'IMAGE EDIT', icon: 'Image', category: 'FLUX2KLEIN' },
        { id: 'flux2klein-2-referenceimg', label: '2 REFERENCE IMG', icon: 'Layers', category: 'FLUX2KLEIN' },
        { id: 'flux2klein-multiangle', label: 'MULTIANGLE', icon: 'Box', category: 'FLUX2KLEIN' },
    ],
    LTXHUB: [
        { id: 'ltx-generate-i2v', label: 'Generate I2V', icon: 'ImagePlay', category: 'GENERATE', source: 'LTX2.3', mapsTo: 'ltx-i2v' },
        { id: 'ltx-generate-t2v', label: 'Generate T2V', icon: 'Type', category: 'GENERATE', source: 'LTX2.3', mapsTo: 'ltx-t2v' },
        { id: 'ltx-edit-i2v-sound', label: 'I2V + Sound', icon: 'Volume2', category: 'EDIT', source: 'LTX2', mapsTo: 'ltx2-i2v-sound' },
        { id: 'ltx-motion-lipsync', label: 'Lipsync Pro', icon: 'Mic2', category: 'MOTION', source: 'LTX2', mapsTo: 'ltx2-lipsync' },
        { id: 'ltx-utility-lipsync', label: 'WAN Lipsync', icon: 'Mic2', category: 'UTILITY', source: 'WAN', mapsTo: 'lipsync' },
        { id: 'ltx-presets-scene-builder', label: 'Scene Builder', icon: 'Film', category: 'PRESETS', source: 'WAN', mapsTo: 'scene-builder' },
    ],
    VIDEO: [
        // Keep Video menu focused on WAN utilities.
        // LTX entries live in MODELS.LTXHUB to avoid duplicated navigation paths.
        { id: 'lipsync', label: 'Lipsync', icon: 'Mic2', category: 'WAN' },
        { id: 'scene-builder', label: 'Scene Builder', icon: 'Film', category: 'WAN' },
    ],
    AUDIO: [
        { id: 'ace-step', label: 'ACE-Step 1.5', icon: 'Music' },
    ],
};


