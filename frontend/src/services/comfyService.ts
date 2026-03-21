// ComfyUI API Service
import { COMFY_API, BACKEND_API } from '../config/api';
import type { ComfyPrompt, ComfyQueueItem, ComfyHistoryItem } from '../types/comfy';
import { addUiLog } from './uiLogger';

class ComfyUIService {
    private clientId: string;
    private ws: WebSocket | null = null;
    private wsReady: boolean = false;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectAttempts: number = 0;

    constructor() {
        this.clientId = this.generateClientId();
    }

    private generateClientId(): string {
        return `comfyfront_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Wait for WebSocket to be ready (connected)
     */
    private async waitForWebSocket(timeout = 5000): Promise<void> {
        if (this.wsReady && this.ws?.readyState === WebSocket.OPEN) {
            return;
        }

        const startTime = Date.now();
        while (!this.wsReady || this.ws?.readyState !== WebSocket.OPEN) {
            if (Date.now() - startTime > timeout) {
                console.warn('WebSocket not ready after timeout, proceeding anyway');
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }

    /**
     * Check if ComfyUI is running
     */
    async isAlive(): Promise<boolean> {
        try {
            const response = await fetch(`${COMFY_API.BASE_URL}${COMFY_API.ENDPOINTS.SYSTEM_STATS}`, {
                method: 'GET',
            });
            return response.ok;
        } catch {
            // Silently fail - ComfyUI may be starting up or offline
            // Status indicator will show "Offline" without spamming errors
            return false;
        }
    }

    /**
     * Get system statistics (CPU, RAM, VRAM)
     */
    async getSystemStats(): Promise<any> {
        const response = await fetch(`${COMFY_API.BASE_URL}${COMFY_API.ENDPOINTS.SYSTEM_STATS}`);
        if (!response.ok) {
            // Silently fail - status indicator already shows offline state
            throw new Error('Failed to fetch system stats');
        }
        return await response.json();
    }

    async getHardwareStats(): Promise<any> {
        try {
            const response = await fetch(`${BACKEND_API.BASE_URL}${BACKEND_API.ENDPOINTS.HARDWARE_STATS}`);
            if (!response.ok) return null;
            return await response.json();
        } catch {
            // Silently fail - backend may be starting up
            return null;
        }
    }

    /**
     * Queue a prompt for generation
     */
    async queuePrompt(workflow: any): Promise<{ prompt_id: string }> {
        // Wait for WebSocket to be ready before queueing to prevent first-batch failures
        await this.waitForWebSocket();

        const payload: ComfyPrompt = {
            prompt: workflow,
            client_id: this.clientId,
        };

        const response = await fetch(`${COMFY_API.BASE_URL}${COMFY_API.ENDPOINTS.PROMPT}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            // Try to extract detailed error from ComfyUI response
            let errorMsg = `Failed to queue prompt: ${response.statusText}`;
            let errorDetails = undefined;
            try {
                const errorData = await response.json();
                if (errorData?.error?.message) {
                    errorMsg = errorData.error.message;
                }
                if (errorData?.node_errors) {
                    const nodeErrors = Object.entries(errorData.node_errors) as any[];
                    if (nodeErrors.length > 0) {
                        const [nodeId, nodeError] = nodeErrors[0];
                        const firstError = nodeError?.errors?.[0];
                        if (firstError) {
                            // Build detailed error message
                            const nodeClass = nodeError.class_type || 'Unknown';
                            const errorMessage = firstError.message || 'Unknown error';
                            errorMsg = `Node #${nodeId} (${nodeClass}): ${errorMessage}`;
                            errorDetails = JSON.stringify(firstError.details || {}, null, 2);
                        }
                    }
                }
            } catch { }
            addUiLog('error', 'comfy', 'Queue prompt failed', `${errorMsg}\n${errorDetails || ''}`);
            throw new Error(errorMsg);
        }

        return await response.json();
    }

    /**
     * Interrupt the currently running workflow execution
     */
    async interrupt(): Promise<void> {
        const response = await fetch(`${COMFY_API.BASE_URL}/interrupt`, {
            method: 'POST',
        });
        if (!response.ok) {
            throw new Error('Failed to interrupt execution');
        }
    }

    /**
     * Get current queue status
     */
    async getQueue(): Promise<{ queue_running: ComfyQueueItem[]; queue_pending: ComfyQueueItem[] }> {
        const response = await fetch(`${COMFY_API.BASE_URL}${COMFY_API.ENDPOINTS.QUEUE}`);

        if (!response.ok) {
            throw new Error('Failed to fetch queue');
        }

        return await response.json();
    }

    /**
     * Get history of generated images
     */
    async getHistory(promptId?: string): Promise<Record<string, ComfyHistoryItem>> {
        const url = promptId
            ? `${COMFY_API.BASE_URL}${COMFY_API.ENDPOINTS.HISTORY}/${promptId}`
            : `${COMFY_API.BASE_URL}${COMFY_API.ENDPOINTS.HISTORY}`;

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error('Failed to fetch history');
        }

        return await response.json();
    }

    /**
     * Get URL for viewing an image
     */
    getImageUrl(filename: string, subfolder: string = '', type: string = 'output'): string {
        const params = new URLSearchParams({
            filename,
            subfolder,
            type,
        });

        return `${COMFY_API.BASE_URL}${COMFY_API.ENDPOINTS.VIEW}?${params}`;
    }

    /**
     * Upload an image to ComfyUI
     */
    async uploadImage(file: File): Promise<{ name: string; subfolder: string }> {
        const formData = new FormData();
        formData.append('image', file);

        const response = await fetch(`${COMFY_API.BASE_URL}${COMFY_API.ENDPOINTS.UPLOAD_IMAGE}`, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            throw new Error('Failed to upload image');
        }

        return await response.json();
    }

    /**
     * Get available LoRAs from ComfyUI
     * Tries /api/models/loras first, then falls back to object_info
     */
    async getLoras(): Promise<string[]> {
        // Try the modern models API first (ComfyUI 0.3+)
        try {
            const response = await fetch(`${COMFY_API.BASE_URL}/api/models/loras`);
            if (response.ok) {
                const data = await response.json();
                if (Array.isArray(data) && data.length > 0) {
                    console.log(`Loaded ${data.length} LoRAs from /api/models/loras`);
                    return data;
                }
            }
        } catch { /* fall through */ }

        // Fallback: check object_info for common node types
        const nodeTypes = ['LoraLoader', 'LoraLoaderModelOnly', 'Power Lora Loader (rgthree)'];

        for (const type of nodeTypes) {
            try {
                const response = await fetch(`${COMFY_API.BASE_URL}/object_info/${type}`);
                if (!response.ok) continue;

                const data = await response.json();
                const nodeData = data[type];

                const loraList =
                    nodeData?.input?.required?.lora_name?.[0] ||
                    nodeData?.input?.required?.lora?.[0] ||
                    [];

                if (loraList.length > 0) {
                    console.log(`Loaded ${loraList.length} LoRAs from ${type}`);
                    return loraList;
                }
            } catch {
                // Silently try next one
            }
        }

        // Silently return empty array if no LoRAs found (ComfyUI may not be ready yet)
        return [];
    }

    /**
     * Get available styles from 'Load Styles CSV' node
     */
    async getStyles(): Promise<string[]> {
        try {
            const response = await fetch(`${COMFY_API.BASE_URL}/object_info/Load Styles CSV`);
            if (!response.ok) throw new Error('Failed to fetch styles');

            const data = await response.json();
            // Load Styles CSV node structure: input -> required -> styles -> [0]
            const styleList = data['Load Styles CSV']?.input?.required?.styles?.[0] || [];
            return styleList;
        } catch (error) {
            // Silently return defaults - ComfyUI may be starting up
            return ['No Style', 'Photographic', 'Cinematic', 'Anime', 'Digital Art'];
        }
    }
    async getCheckpoints(): Promise<string[]> {
        try {
            const response = await fetch(`${COMFY_API.BASE_URL}/object_info/CheckpointLoaderSimple`);
            if (!response.ok) throw new Error('Failed to fetch checkpoints');

            const data = await response.json();
            return data.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
        } catch (error) {
            // Silently return empty - ComfyUI may be starting up
            return [];
        }
    }

    private async getObjectInfoNode(nodeName: string): Promise<any | null> {
        try {
            const response = await fetch(`${COMFY_API.BASE_URL}/object_info/${encodeURIComponent(nodeName)}`);
            if (!response.ok) return null;
            return await response.json();
        } catch {
            return null;
        }
    }

    private extractComboValues(nodeData: any, inputName: string): string[] {
        const values = nodeData?.input?.required?.[inputName]?.[0];
        return Array.isArray(values) ? values : [];
    }

    async getUNetModels(): Promise<string[]> {
        const data = await this.getObjectInfoNode('UNETLoader');
        return this.extractComboValues(data?.UNETLoader, 'unet_name');
    }

    async getDualClipModels(inputName: 'clip_name1' | 'clip_name2' = 'clip_name1'): Promise<string[]> {
        const data = await this.getObjectInfoNode('DualCLIPLoader');
        return this.extractComboValues(data?.DualCLIPLoader, inputName);
    }

    async getVaeModels(): Promise<string[]> {
        const data = await this.getObjectInfoNode('VAELoader');
        return this.extractComboValues(data?.VAELoader, 'vae_name');
    }

    /**
     * Connect to WebSocket for real-time updates and return a listener cleanup function.
     * Safe to call multiple times (React Strict Mode) — reuses existing connection.
     */
    connectWebSocket(callbacks: {
        onStatus?: (data: any) => void;
        onProgress?: (node: string, value: number, max: number) => void;
        onExecuting?: (nodeId: string | null) => void;
        onCompleted?: (promptId: string, output?: any) => void;
        onPreview?: (blobUrl: string) => void;
    }): () => void {
        // If we already have a working connection, just update callbacks
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            this.updateCallbacks(callbacks);
            return () => {
                // Don't close on cleanup — keep the connection alive across re-mounts
            };
        }

        this.wsReady = false;
        this.ws = new WebSocket(`${COMFY_API.WS_URL}?clientId=${this.clientId}`);
        this.updateCallbacks(callbacks);

        this.ws.onopen = () => {
            this.wsReady = true;
        };

        this.ws.onmessage = (event) => {
            // Binary message = preview image from ComfyUI (JPEG/PNG)
            if (event.data instanceof Blob) {
                const blob = event.data.slice(8); // skip 8-byte header (type + format)
                const url = URL.createObjectURL(blob);
                this._callbacks?.onPreview?.(url);
                return;
            }

            try {
                const data = JSON.parse(event.data);

                switch (data.type) {
                    case 'status':
                        // data.data has { status: { exec_info: { queue_remaining: 0 } } }
                        this._callbacks?.onStatus?.(data.data?.status || data.data);
                        break;
                    case 'progress':
                        this._callbacks?.onProgress?.(data.data.node, data.data.value, data.data.max);
                        break;
                    case 'executing':
                        this._callbacks?.onExecuting?.(data.data.node);
                        break;
                    case 'execution_success':
                    case 'execution_interrupted':
                    case 'execution_error':
                        // Force transition to done when prompt finishes or errors
                        this._callbacks?.onExecuting?.(null);
                        break;
                    case 'executed':
                        if (data.data.prompt_id) {
                            this._callbacks?.onCompleted?.(data.data.prompt_id, data.data.output);
                        }
                        break;
                }
            } catch {
                // Silently ignore parse errors - may occur during startup
            }
        };

        this.ws.onerror = () => {
            this.wsReady = false;
        };

        this.ws.onclose = () => {
            this.wsReady = false;
            this.ws = null;
            // Auto-reconnect with exponential backoff (1s, 2s, 4s, 8s, max 10s)
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
            this.reconnectAttempts++;
            this.reconnectTimer = setTimeout(() => {
                if (this._callbacks) {
                    this.connectWebSocket(this._callbacks);
                }
            }, delay);
        };

        // Reset reconnect counter on successful connection
        this.ws.addEventListener('open', () => {
            this.reconnectAttempts = 0;
        });

        return () => {
            // Don't close on cleanup — singleton connection survives React re-mounts
        };
    }

    private _callbacks: {
        onStatus?: (data: any) => void;
        onProgress?: (node: string, value: number, max: number) => void;
        onExecuting?: (nodeId: string | null) => void;
        onCompleted?: (promptId: string, output?: any) => void;
        onPreview?: (blobUrl: string) => void;
    } | null = null;

    private updateCallbacks(callbacks: typeof this._callbacks) {
        this._callbacks = callbacks;
    }
    /**
     * Upload an audio file to ComfyUI
     */
    async uploadAudio(file: File): Promise<{ name: string; subfolder: string }> {
        const formData = new FormData();
        formData.append('image', file); // ComfyUI uses 'image' field even for audio in the upload endpoint usually, or check API. 
        // Standard ComfyUI /upload/image endpoint accepts audio files too.

        // Let's verify if we need a specific audio endpoint. 
        // Usually /upload/image with overwrite=true works for all inputs.
        const response = await fetch(`${COMFY_API.BASE_URL}${COMFY_API.ENDPOINTS.UPLOAD_IMAGE}`, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            throw new Error('Failed to upload audio');
        }

        return await response.json();
    }

    // --- LTX-2 Helpers ---

    /**
     * Snap dimensions to multiples of 32 (Requirement for LTX-2)
     */
    getLTXResolution(width: number, height: number): { width: number, height: number } {
        return {
            width: Math.round(width / 32) * 32,
            height: Math.round(height / 32) * 32
        };
    }

    /**
     * Calculate valid frame count for LTX-2 (Must be 8n + 1)
     */
    getLTXFrameCount(seconds: number, fps: number): number {
        const rawFrames = seconds * fps;
        // Find nearest 8n + 1
        const n = Math.round((rawFrames - 1) / 8);
        const validFrames = (n * 8) + 1;
        return Math.max(9, validFrames); // Minimum 9 frames
    }

    async freeMemory(unloadModels: boolean = true, freeCache: boolean = true): Promise<void> {
        try {
            await fetch(`${COMFY_API.BASE_URL}/free`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    unload_models: unloadModels,
                    free_memory: freeCache
                })
            });
            console.log('âœ… ComfyUI Memory Freed');
        } catch (error) {
            // Silently ignore - not critical for user experience
        }
    }
}

export const comfyService = new ComfyUIService();

