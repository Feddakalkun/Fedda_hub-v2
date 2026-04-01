// ComfyUI API Service
import { COMFY_API, BACKEND_API } from '../config/api';
import type { ComfyPrompt, ComfyQueueItem, ComfyHistoryItem } from '../types/comfy';
import { addUiLog } from './uiLogger';
import { assertPreviewAllowed } from '../config/preview';

class ComfyUIService {
    private clientId: string;
    private ws: WebSocket | null = null;
    private wsReady: boolean = false;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectAttempts: number = 0;
    private objectInfoCache: Record<string, any> | null = null;
    private objectInfoCacheAt = 0;
    private static readonly COMPUTE_MODE_KEY = 'fedda_compute_mode';
    private static readonly RUNPOD_URL_KEY = 'runpodUrl';
    private static readonly RUNPOD_TOKEN_KEY = 'runpodToken';

    private detectWorkflowContext(workflow: any): {
        ltx: boolean;
        wan: boolean;
        flux2klein: boolean;
        qwen: boolean;
        zimage: boolean;
    } {
        const acc = {
            ltx: false,
            wan: false,
            flux2klein: false,
            qwen: false,
            zimage: false,
        };
        try {
            const blob = JSON.stringify(workflow).toLowerCase();
            acc.ltx = blob.includes('ltx');
            acc.wan = blob.includes('wan');
            acc.flux2klein = blob.includes('flux-2-klein') || blob.includes('flux2klein');
            acc.qwen = blob.includes('qwen');
            acc.zimage = blob.includes('z-image') || blob.includes('z_image') || blob.includes('zimage');
        } catch {
            // best effort only
        }
        return acc;
    }

    constructor() {
        this.clientId = this.generateClientId();
    }

    private generateClientId(): string {
        return `comfyfront_${Math.random().toString(36).substr(2, 9)}`;
    }

    private getComputeMode(): 'local' | 'runpod_pod' | 'runpod_serverless_batch' {
        const mode = (localStorage.getItem(ComfyUIService.COMPUTE_MODE_KEY) || 'local').trim();
        if (mode === 'runpod_pod' || mode === 'runpod_serverless_batch') return mode;
        return 'local';
    }

    private deriveRunPodBase(url: string): string {
        const trimmed = (url || '').trim();
        if (!trimmed) return '';
        return trimmed.replace(/\/prompt\/?$/i, '').replace(/\/+$/i, '');
    }

    private getComfyBaseUrl(): string {
        if (this.getComputeMode() === 'runpod_pod') {
            const runpodUrl = localStorage.getItem(ComfyUIService.RUNPOD_URL_KEY) || '';
            const base = this.deriveRunPodBase(runpodUrl);
            if (base) return base;
        }
        return COMFY_API.BASE_URL;
    }

    private getComfyWsUrl(): string {
        if (this.getComputeMode() === 'runpod_pod') {
            const runpodUrl = localStorage.getItem(ComfyUIService.RUNPOD_URL_KEY) || '';
            const base = this.deriveRunPodBase(runpodUrl);
            if (base) {
                // Convert runpod HTTP(S) endpoint base to ws path.
                return base.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:') + '/ws';
            }
        }
        return COMFY_API.WS_URL;
    }

    private getAuthHeaders(): Record<string, string> {
        const headers: Record<string, string> = {};
        if (this.getComputeMode() === 'runpod_pod') {
            const token = (localStorage.getItem(ComfyUIService.RUNPOD_TOKEN_KEY) || '').trim();
            if (token) headers.Authorization = `Bearer ${token}`;
        }
        return headers;
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
            const response = await fetch(`${this.getComfyBaseUrl()}${COMFY_API.ENDPOINTS.SYSTEM_STATS}`, {
                method: 'GET',
                headers: this.getAuthHeaders(),
            });
            if (response.ok) return true;
        } catch {
            // fall through to proxy fallback
        }

        // Fallback to local proxy route (keeps behavior aligned with landing checks).
        try {
            const response = await fetch(`/comfy${COMFY_API.ENDPOINTS.SYSTEM_STATS}`, {
                method: 'GET',
                cache: 'no-store',
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
        try {
            const response = await fetch(`${this.getComfyBaseUrl()}${COMFY_API.ENDPOINTS.SYSTEM_STATS}`, {
                headers: this.getAuthHeaders(),
            });
            if (response.ok) {
                return await response.json();
            }
        } catch {
            // fall through to proxy fallback
        }

        const fallback = await fetch(`/comfy${COMFY_API.ENDPOINTS.SYSTEM_STATS}`, { cache: 'no-store' });
        if (!fallback.ok) {
            throw new Error('Failed to fetch system stats');
        }
        return await fallback.json();
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
        assertPreviewAllowed('queue_prompt');
        // Wait for WebSocket to be ready before queueing to prevent first-batch failures
        await this.waitForWebSocket();
        await this.normalizeWorkflowForCurrentComfy(workflow);

        const payload: ComfyPrompt = {
            prompt: workflow,
            client_id: this.clientId,
        };

        const response = await fetch(`${this.getComfyBaseUrl()}${COMFY_API.ENDPOINTS.PROMPT}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...this.getAuthHeaders(),
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

    private async getObjectInfoCached(): Promise<Record<string, any> | null> {
        const now = Date.now();
        if (this.objectInfoCache && now - this.objectInfoCacheAt < 10_000) {
            return this.objectInfoCache;
        }
        try {
            const res = await fetch(`${this.getComfyBaseUrl()}/object_info`, {
                headers: this.getAuthHeaders(),
            });
            if (!res.ok) return null;
            const data = await res.json();
            this.objectInfoCache = data;
            this.objectInfoCacheAt = now;
            return data;
        } catch {
            return null;
        }
    }

    private getComboOptions(inputSpec: any): any[] {
        // Legacy format: [ [options...], {...} ]
        if (Array.isArray(inputSpec) && Array.isArray(inputSpec[0])) {
            return inputSpec[0];
        }
        // New format: [ "COMBO", { options: [...] } ]
        if (
            Array.isArray(inputSpec) &&
            typeof inputSpec[0] === 'string' &&
            inputSpec[0] === 'COMBO' &&
            inputSpec[1] &&
            Array.isArray(inputSpec[1].options)
        ) {
            return inputSpec[1].options;
        }
        return [];
    }

    private pickBestComboValue(
        classType: string,
        inputName: string,
        currentValue: any,
        options: any[],
        ctx: { ltx: boolean; wan: boolean; flux2klein: boolean; qwen: boolean; zimage: boolean; }
    ): any {
        if (!options.length) return currentValue;
        const current = String(currentValue ?? '').toLowerCase();
        const wants = (needle: string) => current.includes(needle);
        const find = (needle: string) => options.find((o) => String(o).toLowerCase().includes(needle));
        const findAny = (needles: string[]) => {
            for (const n of needles) {
                const v = find(n);
                if (v !== undefined) return v;
            }
            return undefined;
        };

        // Prefer consistent "off" style when style preset is invalid
        if (inputName === 'styles') {
            const noStyle = findAny(['no style', 'none']);
            if (noStyle !== undefined) return noStyle;
        }

        // Prefer explicit "none/off" for optional-ish selectors.
        if (inputName.toLowerCase().includes('lora')) {
            const none = findAny(['none', 'off', 'disable']);
            if (none !== undefined && (current === '' || current === 'none')) return none;
        }

        // Context-aware family preferences for model-ish inputs.
        const lowerInput = inputName.toLowerCase();
        const isModelish = ['unet_name', 'model', 'model_name', 'ckpt_name', 'clip_name', 'clip_name1', 'clip_name2', 'vae_name'].includes(lowerInput);
        if (isModelish) {
            const familyNeedles: string[] = [];
            if (ctx.flux2klein) familyNeedles.push('flux-2-klein', 'flux2');
            if (ctx.ltx) familyNeedles.push('ltx', 'gemma');
            if (ctx.wan) familyNeedles.push('wan');
            if (ctx.qwen) familyNeedles.push('qwen');
            if (ctx.zimage) familyNeedles.push('z-image', 'z_image', 'zimage');

            // For CLIP fields in LTX, comfy_gemma tends to be safest in this install.
            if (ctx.ltx && (lowerInput === 'clip_name1' || lowerInput === 'clip_name2')) {
                const ltxClip = findAny(['comfy_gemma_3_12b', 'gemma', 'qwen_3_4b']);
                if (ltxClip !== undefined) return ltxClip;
            }

            // For FLUX2KLEIN UNET fallback when 9b is missing, prefer 4b.
            if (ctx.flux2klein && lowerInput === 'unet_name') {
                const klein4b = findAny(['flux-2-klein-4b', 'flux-2-klein']);
                if (klein4b !== undefined) return klein4b;
            }

            // For WAN vae/model pick WAN first, then generic vae.
            if (ctx.wan && (lowerInput === 'vae_name' || lowerInput === 'model_name' || lowerInput === 'model')) {
                const wanPreferred = findAny(['wan', 'vae-ft-mse', 'flux2-vae', 'z-image-vae']);
                if (wanPreferred !== undefined) return wanPreferred;
            }

            const familyPick = findAny(familyNeedles);
            if (familyPick !== undefined) return familyPick;
        }

        // LTX/Gemma/Qwen name normalization (value-driven)
        if (wants('gemma')) {
            const gemma = find('gemma');
            if (gemma !== undefined) return gemma;
        }
        if (wants('qwen')) {
            const qwen = find('qwen');
            if (qwen !== undefined) return qwen;
        }
        if (wants('wan')) {
            const wan = find('wan');
            if (wan !== undefined) return wan;
        }
        if (wants('ltx')) {
            const ltx = find('ltx');
            if (ltx !== undefined) return ltx;
        }
        if (wants('flux-2-klein') || wants('flux2klein')) {
            const klein = find('flux-2-klein');
            if (klein !== undefined) return klein;
        }
        if (wants('z-image') || wants('z_image')) {
            const z = find('z-image') ?? find('z_image');
            if (z !== undefined) return z;
        }

        // Empty lora values are common in templates; pick first to avoid hard failure.
        if (current === '' && inputName.toLowerCase().includes('lora')) {
            const none = findAny(['none', 'off', 'disable']);
            return none !== undefined ? none : options[0];
        }

        // Node-specific safer fallback for style-loader nodes.
        if (classType.toLowerCase().includes('styles csv')) {
            const noStyle = findAny(['no style', 'none']);
            if (noStyle !== undefined) return noStyle;
        }

        // Generic fallback
        return options[0];
    }

    private getDefaultValue(inputSpec: any): any | undefined {
        if (!Array.isArray(inputSpec)) return undefined;
        const meta = inputSpec[1];
        if (meta && typeof meta === 'object' && 'default' in meta) return meta.default;
        const options = this.getComboOptions(inputSpec);
        if (options.length) return options[0];
        return undefined;
    }

    private async normalizeWorkflowForCurrentComfy(workflow: any): Promise<void> {
        if (!workflow || typeof workflow !== 'object') return;
        const objectInfo = await this.getObjectInfoCached();
        if (!objectInfo) return;
        const ctx = this.detectWorkflowContext(workflow);

        let replacements = 0;

        for (const nodeId of Object.keys(workflow)) {
            const node = workflow[nodeId];
            if (!node || typeof node !== 'object') continue;
            const classType = node.class_type;
            if (!classType || !objectInfo[classType]) continue;
            if (!node.inputs || typeof node.inputs !== 'object') continue;

            const inputSpec = objectInfo[classType]?.input || {};
            const required = inputSpec.required || {};
            const optional = inputSpec.optional || {};

            // Fix invalid combo values
            for (const [inputName, currentValue] of Object.entries(node.inputs)) {
                // Skip linked inputs: ["nodeId", outputIndex]
                if (Array.isArray(currentValue) && currentValue.length >= 2 && typeof currentValue[0] === 'string') {
                    continue;
                }

                const spec = required[inputName] ?? optional[inputName];
                if (!spec) continue;
                const options = this.getComboOptions(spec);
                if (!options.length) continue;
                if (options.includes(currentValue)) continue;

                const nextValue = this.pickBestComboValue(classType, inputName, currentValue, options, ctx);
                if (nextValue !== currentValue) {
                    node.inputs[inputName] = nextValue;
                    replacements++;
                }
            }

            // Fill missing required inputs when a safe default is provided by node schema
            for (const [inputName, spec] of Object.entries(required)) {
                if (inputName in node.inputs) continue;
                const def = this.getDefaultValue(spec);
                if (def !== undefined) {
                    node.inputs[inputName] = def;
                    replacements++;
                }
            }
        }

        if (replacements > 0) {
            addUiLog('info', 'comfy', 'Workflow preflight normalization', `${replacements} compatibility adjustments applied`);
        }
    }

    /**
     * Interrupt the currently running workflow execution
     */
    async interrupt(): Promise<void> {
        assertPreviewAllowed('interrupt');
        const response = await fetch(`${this.getComfyBaseUrl()}/interrupt`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
        });
        if (!response.ok) {
            throw new Error('Failed to interrupt execution');
        }
    }

    /**
     * Get current queue status
     */
    async getQueue(): Promise<{ queue_running: ComfyQueueItem[]; queue_pending: ComfyQueueItem[] }> {
        const response = await fetch(`${this.getComfyBaseUrl()}${COMFY_API.ENDPOINTS.QUEUE}`, {
            headers: this.getAuthHeaders(),
        });

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
            ? `${this.getComfyBaseUrl()}${COMFY_API.ENDPOINTS.HISTORY}/${promptId}`
            : `${this.getComfyBaseUrl()}${COMFY_API.ENDPOINTS.HISTORY}`;

        const response = await fetch(url, { headers: this.getAuthHeaders() });

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

        return `${this.getComfyBaseUrl()}${COMFY_API.ENDPOINTS.VIEW}?${params}`;
    }

    /**
     * Upload an image to ComfyUI
     */
    async uploadImage(file: File): Promise<{ name: string; subfolder: string }> {
        assertPreviewAllowed('upload_image');
        const formData = new FormData();
        formData.append('image', file);

        const response = await fetch(`${this.getComfyBaseUrl()}${COMFY_API.ENDPOINTS.UPLOAD_IMAGE}`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
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
            const response = await fetch(`${this.getComfyBaseUrl()}/api/models/loras`, {
                headers: this.getAuthHeaders(),
            });
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
                const response = await fetch(`${this.getComfyBaseUrl()}/object_info/${type}`, {
                    headers: this.getAuthHeaders(),
                });
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
            const response = await fetch(`${this.getComfyBaseUrl()}/object_info/Load Styles CSV`, {
                headers: this.getAuthHeaders(),
            });
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
            const response = await fetch(`${this.getComfyBaseUrl()}/object_info/CheckpointLoaderSimple`, {
                headers: this.getAuthHeaders(),
            });
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
            const response = await fetch(`${this.getComfyBaseUrl()}/object_info/${encodeURIComponent(nodeName)}`, {
                headers: this.getAuthHeaders(),
            });
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

    async getNodeInputOptions(nodeName: string, inputName: string): Promise<string[]> {
        const data = await this.getObjectInfoNode(nodeName);
        if (!data || !data[nodeName]) return [];
        return this.extractComboValues(data[nodeName], inputName);
    }

    /**
     * Connect to WebSocket for real-time updates and return a listener cleanup function.
     * Safe to call multiple times (React Strict Mode) — reuses existing connection.
     */
    connectWebSocket(callbacks: {
        onStatus?: (data: any) => void;
        onProgress?: (node: string, value: number, max: number) => void;
        onExecuting?: (nodeId: string | null) => void;
        onExecutionError?: (data: any) => void;
        onCompleted?: (promptId: string, output?: any) => void;
        onPreview?: (blobUrl: string) => void;
    }): () => void {
        // Cancel any pending reconnect
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        // If we already have a working connection, just update callbacks
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            this.updateCallbacks(callbacks);
            return () => {
                // Don't close on cleanup — keep the connection alive across re-mounts
            };
        }

        this.wsReady = false;
        this.ws = new WebSocket(`${this.getComfyWsUrl()}?clientId=${this.clientId}`);
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
                        // Force transition to done when prompt finishes
                        this._callbacks?.onExecuting?.(null);
                        break;
                    case 'execution_error':
                        this._callbacks?.onExecutionError?.(data.data || {});
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
        onExecutionError?: (data: any) => void;
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
        assertPreviewAllowed('upload_audio');
        const formData = new FormData();
        formData.append('image', file); // ComfyUI uses 'image' field even for audio in the upload endpoint usually, or check API. 
        // Standard ComfyUI /upload/image endpoint accepts audio files too.

        // Let's verify if we need a specific audio endpoint. 
        // Usually /upload/image with overwrite=true works for all inputs.
        const response = await fetch(`${this.getComfyBaseUrl()}${COMFY_API.ENDPOINTS.UPLOAD_IMAGE}`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
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
        assertPreviewAllowed('free_memory');
        try {
            await fetch(`${this.getComfyBaseUrl()}/free`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
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


