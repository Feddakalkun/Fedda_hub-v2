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
        COMFY_REFRESH_MODELS: '/api/comfy/refresh-models',
        AUDIO_TRANSCRIBE: '/api/audio/transcribe',
        AUDIO_TTS: '/api/audio/tts',
        AUDIO_REFERENCE_INFO: '/api/audio/reference-info',
        VIDEO_LIPSYNC: '/api/video/lipsync',
        HARDWARE_STATS: '/api/hardware/stats',
    },
};

export const APP_CONFIG = {
    NAME: 'FEDDA',
    VERSION: '0.1.0',
    DESCRIPTION: 'PREMIUM COMFYUI FRONTEND',
};

export const MODELS = {
    IMAGE: [
        { id: 'z-image', label: 'Z-Image', icon: 'Sparkles' },
        { id: 'qwen-angle', label: 'Qwen Multi-Angle', icon: 'Box' },
    ],
    VIDEO: [
        { id: 'lipsync', label: 'Lipsync', icon: 'Mic2' },
        { id: 'scene-builder', label: 'Scene Builder', icon: 'Film' },
    ],
    AUDIO: [
        { id: 'ace-step', label: 'ACE-Step 1.5', icon: 'Music' },
    ],
};


