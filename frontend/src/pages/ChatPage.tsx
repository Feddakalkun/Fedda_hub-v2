import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Send, Bot, User, Sparkles, Image as ImageIcon, Loader2, Mic, Square, Volume2, VolumeX, X } from 'lucide-react';
import { assistantService } from '../services/assistantService';
import { comfyService } from '../services/comfyService';
import ReactMarkdown from 'react-markdown';
import { CatalogCard } from '../components/layout/CatalogShell';
import { useToast } from '../components/ui/Toast';
import { directDownload } from '../utils/directDownload';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    type?: 'text' | 'image-generation-request' | 'image-result';
    timestamp: number;
    metadata?: any;
    images?: string[]; // Base64 images for vision models
}
interface CelebCatalogItem {
    name: string;
    file: string;
    installed: boolean;
}

import { AGENT_SYSTEM_PROMPT } from '../config/agentPrompt';
import { useChatAudio } from '../hooks/useChatAudio';

const IMAGE_INTENT_KEYWORDS = [
    'generate', 'create', 'make', 'draw', 'picture', 'image', 'photo', 'portrait', 'render',
    'show', 'change', 'add', 'remove', 'variant', 'version', 'look like', 'bilde', 'vis', 'lag'
];

function hasImageGenerationIntent(text: string): boolean {
    const lower = (text || '').toLowerCase();
    return IMAGE_INTENT_KEYWORDS.some(kw => lower.includes(kw)) || lower.length > 30;
}

function extractFallbackPrompt(responseText: string): string | null {
    if (!responseText) return null;

    const generatedTagMatch = responseText.match(/\[Generated Image:\s*([^\]]+)\]/i);
    if (generatedTagMatch?.[1]?.trim()) {
        return generatedTagMatch[1].trim();
    }

    const promptFieldMatch = responseText.match(/(?:^|\n)\s*(?:prompt|image prompt)[^:\n]*:\s*["“]?([^"”\n]{20,600})["”]?/i);
    if (promptFieldMatch?.[1]?.trim()) {
        return promptFieldMatch[1].trim();
    }

    const quotedMatch = responseText.match(/["“]([^"”]{25,700})["”]/);
    if (quotedMatch?.[1]?.trim()) {
        return quotedMatch[1].trim();
    }

    return null;
}

function derivePromptFromResponse(responseText: string): string | null {
    const text = (responseText || '').trim();
    if (!text) return null;

    const cleaned = text
        .replace(/\[Image[^\]]*\]/ig, '')
        .replace(/<<GENERATE>>[\s\S]*?(?:<<\/GENERATE>>|<<\/GENERATOR>>|$)/i, '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/\b(?:would you like|let me know if|i can(?:not|'t)? generate images?|i can provide text-based descriptions?)[^.\n]*[.\n]?/ig, '')
        .trim();

    const lines = cleaned
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean)
        .filter(l => l.length > 20)
        .filter(l => !/^let'?s create/i.test(l))
        .filter(l => !/^sure[,!]?/i.test(l))
        .filter(l => !/^of course[,!]?/i.test(l));

    if (lines.length > 0) {
        lines.sort((a, b) => b.length - a.length);
        const best = lines[0].replace(/^prompt\s*[:\-]\s*/i, '').trim();
        if (best.length >= 20) return best.slice(0, 700);
    }

    if (cleaned.length >= 20) {
        return cleaned.slice(0, 700);
    }

    return null;
}

function extractSubjectAnchor(userText: string): string | null {
    const text = (userText || '').trim().toLowerCase();
    if (!text) return null;

    const patterns = [
        /(?:image|picture|photo|portrait|render)\s+of\s+(.{2,80})/i,
        /create\s+(.{2,80})/i,
        /generate\s+(.{2,80})/i,
    ];

    for (const p of patterns) {
        const m = userText.match(p);
        if (m?.[1]) {
            return m[1].replace(/[.?!,;:]+$/g, '').trim();
        }
    }
    return null;
}

function isCelebListQuery(text: string): boolean {
    const t = (text || '').toLowerCase();
    return (
        (t.includes('celeb') || t.includes('celebrity') || t.includes('who can we make')) &&
        (t.includes('image') || t.includes('images') || t.includes('make'))
    );
}

function isGenericImageRequest(text: string): boolean {
    const t = (text || '').toLowerCase().trim();
    if (!hasImageGenerationIntent(t)) return false;
    const specificTokens = ['hello kitty', 'portrait of', 'image of', 'photo of', 'with ', 'wearing ', 'in ', 'at ', 'scene', 'style'];
    return !specificTokens.some(tok => t.includes(tok));
}

function hasLtxIntent(text: string): boolean {
    const t = (text || '').toLowerCase();
    return (
        t.includes('ltx') ||
        t.includes('image to video') ||
        t.includes('text to video') ||
        t.includes('video prompt') ||
        t.includes('cinematic shot')
    );
}

function ensureCelebInPrompt(prompt: string, userInput: string, celebList: CelebCatalogItem[]): string {
    if (!prompt) return prompt;
    const lowerPrompt = prompt.toLowerCase();
    if (celebList.some(c => lowerPrompt.includes(c.name.toLowerCase()))) {
        return prompt;
    }
    if (!isGenericImageRequest(userInput) || celebList.length === 0) {
        return prompt;
    }
    const pick = celebList[Math.floor(Math.random() * celebList.length)];
    return `${pick.name}, ${prompt}`;
}

function isKnownCelebInput(text: string, celebList: CelebCatalogItem[]): boolean {
    const t = (text || '').trim().toLowerCase();
    if (!t || celebList.length === 0) return false;
    return celebList.some(c => c.name.toLowerCase() === t);
}

function findInstalledCelebLora(text: string, celebList: CelebCatalogItem[]): string | null {
    const t = (text || '').toLowerCase();
    if (!t || celebList.length === 0) return null;

    const installed = celebList.filter(c => c.installed);
    // Prefer exact match first
    const exact = installed.find(c => c.name.toLowerCase() === t.trim());
    if (exact) return exact.file;

    // Then partial match in prompt
    const partial = installed.find(c => t.includes(c.name.toLowerCase()));
    return partial ? partial.file : null;
}


export const ChatPage = () => {
    const { toast } = useToast();
    const [messages, setMessages] = useState<Message[]>([
        {
            id: 'welcome',
            role: 'assistant',
            content: "Hey! I'm your creative AI assistant. I can help you brainstorm ideas, answer questions, and generate images when you need them. How can I help you?",
            timestamp: Date.now(),
            type: 'text'
        }
    ]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const [generatingMsgId, setGeneratingMsgId] = useState<string | null>(null);
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [selectedModel, setSelectedModel] = useState<string>('');
    const [celebCatalog, setCelebCatalog] = useState<CelebCatalogItem[]>([]);
    const [executionStatus, setExecutionStatus] = useState('');
    const [progress, setProgress] = useState(0);
    const {
        isRecording,
        isTranscribing,
        recordingMode,
        setRecordingMode,
        handleMicMouseDown,
        handleMicMouseUp,
        handleMicClick,
        ttsEnabled,
        setTtsEnabled,
        playingMsgId,
        generatingTtsId,
        voiceStyle,
        setVoiceStyle,
        availableVoices,
        isLoadingVoices,
        playTTS,
        stopTTS,
        fetchAvailableVoices,
        unloadAudioModels,
        isUnloadingAudio,
    } = useChatAudio({
        setInput,
        appendMessage: (role, content) => {
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role,
                content,
                timestamp: Date.now(),
                type: 'text'
            }]);
        },
        autoPlayTTSMsg: messages.length > 0 ? messages[messages.length - 1] : null
    });

    // Drag & Drop / Vision State
    const [isDragging, setIsDragging] = useState(false);
    const [pendingImages, setPendingImages] = useState<string[]>([]); // Base64 strings
    const [lightboxImage, setLightboxImage] = useState<string | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Fetch Models & LoRAs on Mount
    useEffect(() => {
        const fetchData = async () => {
            try {
                // Prefer backend-resolved model list (guaranteed installed names).
                let models: string[] = [];
                let defaultModel = '';
                try {
                    const modelResp = await fetch('/api/chat/models');
                    if (modelResp.ok) {
                        const modelData = await modelResp.json();
                        if (modelData?.success && Array.isArray(modelData.models)) {
                            models = modelData.models;
                            defaultModel = modelData.default || '';
                        }
                    }
                } catch {
                    // Fallback below
                }

                // Fallback to raw Ollama tags if backend endpoint is unavailable.
                if (models.length === 0) {
                    try {
                        const tagsResp = await fetch('/ollama/tags');
                        if (tagsResp.ok) {
                            const tagsData = await tagsResp.json();
                            const rawModels = Array.isArray(tagsData?.models) ? tagsData.models : [];
                            models = rawModels
                                .map((m: any) => String(m?.name || '').trim())
                                .filter(Boolean);
                        }
                    } catch {
                        // Leave empty; UI will still load with existing selected value.
                    }
                }

                if (models.length > 0) {
                    setAvailableModels(models);
                    setSelectedModel(defaultModel && models.includes(defaultModel) ? defaultModel : models[0]);
                }

                // Load celeb catalog for chat helpers.
                try {
                    const celebResp = await fetch('/api/lora/zimage-turbo/celebs?limit=500');
                    if (celebResp.ok) {
                        const celebData = await celebResp.json();
                        if (celebData?.success && Array.isArray(celebData.items)) {
                            setCelebCatalog(celebData.items);
                        }
                    }
                } catch {
                    // Ignore catalog load failure.
                }

            } catch (error) {
                console.error('Failed to load data:', error);
            }
        };
        fetchData();
    }, []);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isThinking]);

    const handleSend = async () => {
        if (!input.trim()) return;

        const inputImages = [...pendingImages];

        const userMsg: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: input,
            timestamp: Date.now(),
            type: 'text',
            images: inputImages.length > 0 ? inputImages : undefined
        };

        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setPendingImages([]);
        setIsThinking(true);

        try {
            if (hasLtxIntent(input)) {
                const spec = await assistantService.ltxCopilot(selectedModel, input);
                const prompt = `${spec.subject}. ${spec.motion}. ${spec.camera}. ${spec.lighting}. ${spec.style}.`;
                const reply = spec.policy_note
                    ? `LTX Copilot switched this to a mature non-explicit cinematic variant.\n\n${prompt}`
                    : `LTX Copilot ready.\n\n${prompt}`;

                setMessages(prev => [...prev, {
                    id: Date.now().toString(),
                    role: 'assistant',
                    content: reply,
                    timestamp: Date.now(),
                    type: 'text'
                }]);

                setMessages(prev => [...prev, {
                    id: (Date.now() + 1).toString(),
                    role: 'assistant',
                    content: prompt,
                    timestamp: Date.now(),
                    type: 'image-generation-request',
                    metadata: {
                        sourceUserInput: input,
                        generator: 'ltx',
                        ltxSpec: spec,
                    }
                }]);
                return;
            }

            if (isCelebListQuery(input)) {
                let items = celebCatalog;
                if (!items.length) {
                    try {
                        const celebResp = await fetch('/api/lora/zimage-turbo/celebs?limit=500');
                        if (celebResp.ok) {
                            const celebData = await celebResp.json();
                            if (celebData?.success && Array.isArray(celebData.items)) {
                                items = celebData.items;
                                setCelebCatalog(items);
                            }
                        }
                    } catch {
                        // noop
                    }
                }

                const names = items.map(c => c.name).sort();
                const preview = names.slice(0, 30).join(', ');
                const more = names.length > 30 ? `\n...and ${names.length - 30} more.` : '';
                const reply = names.length
                    ? `We can generate these celeb LoRAs from the Z-Image Turbo pack:\n${preview}${more}`
                    : `Celeb catalog is still syncing/downloading. Ask again in a minute, or generate and I’ll use available celeb LoRAs as they arrive.`;

                setMessages(prev => [...prev, {
                    id: Date.now().toString(),
                    role: 'assistant',
                    content: reply,
                    timestamp: Date.now(),
                    type: 'text'
                }]);
                return;
            }

            // Prepare history for Ollama
            // We keep the prompt content in history so the model knows what it generated previously
            const history = messages.map(m => ({
                role: m.role,
                content: m.content.replace(/<<GENERATE>>([\s\S]*?)(?:<<\/GENERATE>>|<<\/GENERATOR>>|$)/i, ' [Previous Prompt: $1] '),
                images: m.images ? m.images.map(img => img.replace(/^data:image\/[a-z]+;base64,/, "")) : undefined
            }));
            history.push({
                role: 'user',
                content: userMsg.content,
                images: inputImages.map(img => img.replace(/^data:image\/[a-z]+;base64,/, ""))
            });

            // Add system prompt at the start
            const fullHistory = [{ role: 'system', content: AGENT_SYSTEM_PROMPT }, ...history];

            // Use Ollama to chat
            // Use Ollama to chat with selected model
            const responseText = await assistantService.chat(selectedModel, fullHistory);

            // Determine if the user actually intended to generate something
            // (Prevents model from hallucinating cards on "Hi" or small talk)
            const userHasIntent = hasImageGenerationIntent(input) || isKnownCelebInput(input, celebCatalog);

            // Parse response for <<GENERATE>> (Robust)
            const genMatch = responseText.match(/<<GENERATE>>([\s\S]*?)(?:<<\/GENERATE>>|<<\/GENERATOR>>|$)/i);

            if (genMatch) {
                const textPart = responseText.replace(/<<GENERATE>>[\s\S]*?(?:<<\/GENERATE>>|<<\/GENERATOR>>|$)/i, '').trim();
                let promptPart = genMatch[1].trim();

                // Cleanup: Remove leading "[Detailed Prompt]", strip quotes, and trim
                promptPart = promptPart.replace(/^\[Detailed Prompt\][\s:-]*/i, '');
                promptPart = promptPart.replace(/^["'“”]|["'“”]$/g, '').trim();

                // Add the generation request card ONLY if prompt is valid
                if (promptPart && promptPart.length > 5 && !['hi', 'hello', 'hey'].includes(promptPart.toLowerCase())) {
                    const tunedPrompt = ensureCelebInPrompt(promptPart, input, celebCatalog);
                    // Add text
                    if (textPart) {
                        setMessages(prev => [...prev, {
                            id: Date.now().toString(),
                            role: 'assistant',
                            content: textPart,
                            timestamp: Date.now(),
                            type: 'text'
                        }]);
                    }
                    // Add Card
                    setMessages(prev => [...prev, {
                        id: (Date.now() + 1).toString(),
                        role: 'assistant',
                        content: tunedPrompt,
                        timestamp: Date.now(),
                        type: 'image-generation-request',
                        metadata: { sourceUserInput: input }
                    }]);
                } else {
                    // Malformed or empty prompt -> Treat as text
                    setMessages(prev => [...prev, {
                        id: Date.now().toString(),
                        role: 'assistant',
                        content: responseText.replace(/<<GENERATE>>[\s\S]*?(?:<<\/GENERATE>>|<<\/GENERATOR>>|$)/i, '').trim() || responseText,
                        timestamp: Date.now(),
                        type: 'text'
                    }]);
                }

            } else {
                // Fallback for models that ignore <<GENERATE>> formatting.
                if (userHasIntent) {
                    const fallbackPrompt = extractFallbackPrompt(responseText) || derivePromptFromResponse(responseText);
                    if (fallbackPrompt) {
                        const tunedPrompt = ensureCelebInPrompt(fallbackPrompt, input, celebCatalog);
                        const cleanText = responseText
                            .replace(/\[Generated Image:[^\]]+\]/ig, '')
                            .replace(/(?:^|\n)\s*(?:prompt|image prompt)[^:\n]*:\s*["“]?[^"”\n]{20,600}["”]?/ig, '')
                            .trim();

                        if (cleanText) {
                            setMessages(prev => [...prev, {
                                id: Date.now().toString(),
                                role: 'assistant',
                                content: cleanText,
                                timestamp: Date.now(),
                                type: 'text'
                            }]);
                        }

                        setMessages(prev => [...prev, {
                            id: (Date.now() + 1).toString(),
                            role: 'assistant',
                            content: tunedPrompt,
                            timestamp: Date.now(),
                            type: 'image-generation-request',
                            metadata: { sourceUserInput: input }
                        }]);
                        return;
                    }
                }

                // Normal text response (strip hallucinated tags if they shouldn't be there)
                const cleanText = responseText.replace(/<<GENERATE>>[\s\S]*?(?:<<\/GENERATE>>|<<\/GENERATOR>>|$)/i, '').trim();

                setMessages(prev => [...prev, {
                    id: Date.now().toString(),
                    role: 'assistant',
                    content: cleanText || responseText, // Fallback to raw if cleaning emptied it entirely
                    timestamp: Date.now(),
                    type: 'text'
                }]);
            }

        } catch (error) {
            console.error(error);
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'assistant',
                content: "Sorry, I couldn't reach the AI model. Check Settings to make sure a language model is available.",
                timestamp: Date.now(),
                type: 'text'
            }]);
        } finally {
            setIsThinking(false);
        }
    };

    const handleGenerateImage = async (msgId: string, prompt: string, sourceUserInput?: string) => {
        setGeneratingMsgId(msgId);

        try {
            // Load the same Z-Image workflow as ImagePage (support legacy filenames)
            let workflow: any = null;
            const workflowCandidates = [
                '/workflows/z-image-master.json',
                '/workflows/z-image.json',
                '/workflows/zimage-HQ.json',
            ];
            for (const candidate of workflowCandidates) {
                const response = await fetch(candidate);
                if (response.ok) {
                    workflow = await response.json();
                    break;
                }
            }
            if (!workflow) throw new Error('Failed to load Z-Image workflow');

            // Generate random seed
            const seed = Math.floor(Math.random() * 1000000000);

            console.log('🤖 Agent generating image:', { prompt, seed });

            // Modify workflow parameters (same node IDs as ImagePage)
            if (workflow["3"]) {
                workflow["3"].inputs.seed = seed;
                workflow["3"].inputs.steps = 9;
                workflow["3"].inputs.cfg = 1;
            }

            // Strengthen prompt adherence in chat context.
            const anchor = extractSubjectAnchor(sourceUserInput || '');
            const anchoredPrompt = anchor
                ? `${prompt}\n\nStrict subject lock: ${anchor}. Keep this exact subject identity and do not replace with unrelated objects.`
                : prompt;

            // Node 33/6: Positive Prompt
            if (workflow["33"]) {
                workflow["33"].inputs.string = anchoredPrompt;
            }
            if (workflow["6"]) {
                workflow["6"].inputs.text = anchoredPrompt;
            }

            // Negative prompt
            if (workflow["34"]) {
                workflow["34"].inputs.string = "text, watermark, blur, ugly";
            }
            if (workflow["7"]) {
                workflow["7"].inputs.text = "text, watermark, blur, ugly";
            }

            // Node 30: Dimensions (1024x1024 default for chat)
            if (workflow["30"]) {
                workflow["30"].inputs.width = 1024;
                workflow["30"].inputs.height = 1024;
            }

            const autoLora = findInstalledCelebLora(sourceUserInput || prompt, celebCatalog);

            // Node 126: LoRA Injection (auto only if celeb is detected + installed)
            if (workflow["126"]) {
                if (autoLora) {
                    workflow["126"].inputs.lora_1 = {
                        "on": true,
                        "lora": autoLora,
                        "strength": 1.0
                    };
                    console.log('🎨 Applying auto celeb LoRA:', autoLora);
                } else {
                    // Disable LoRA if none selected
                    if (workflow["126"].inputs.lora_1) {
                        workflow["126"].inputs.lora_1.on = false;
                    }
                }
            }

            // Node 3: stronger conditioning for better intent adherence in chat.
            if (workflow["3"]) {
                const randomSeed = Math.floor(Math.random() * 1000000000000000); // 15 digits
                workflow["3"].inputs.seed = randomSeed;
                workflow["3"].inputs.cfg = Math.max(3.2, Number(workflow["3"].inputs.cfg || 1));
                workflow["3"].inputs.steps = Math.max(14, Number(workflow["3"].inputs.steps || 9));
                console.log('🎲 New Seed generated:', randomSeed);
            }

            // 2. Queue the workflow and get prompt_id
            console.log('📤 Queueing workflow...');
            const { prompt_id } = await comfyService.queuePrompt(workflow);
            console.log('✅ Queued! Prompt ID:', prompt_id);

            // 3. Setup WebSocket for progress tracking
            const cleanup = comfyService.connectWebSocket({
                onExecuting: (nodeId) => {
                    if (!nodeId) {
                        setExecutionStatus('Finalizing...');
                        return;
                    }
                    const statusMap: Record<string, string> = {
                        '3': 'Generating Image (Sampling)...',
                        '126': 'Loading LoRAs...',
                        '9': 'Saving Image...',
                    };
                    setExecutionStatus(statusMap[nodeId] || `Processing Node ${nodeId}...`);
                },
                onProgress: (_node, value, max) => {
                    setProgress(Math.round((value / max) * 100));
                }
            });

            // 4. Poll for completion and fetch image
            let attempts = 0;
            const maxAttempts = 60; // Wait up to 120s (60 * 2s) for generation
            let imageUrl: string | null = null;

            while (attempts < maxAttempts && !imageUrl) {
                attempts++;
                await new Promise(r => setTimeout(r, 2000)); // Wait 2 seconds between attempts

                console.log(`📚 Fetching history (attempt ${attempts}/${maxAttempts})...`);

                try {
                    const history = await comfyService.getHistory(prompt_id);

                    if (history[prompt_id] && history[prompt_id].outputs) {
                        const outputs = history[prompt_id].outputs['9'];

                        if (outputs && outputs.images && outputs.images.length > 0) {
                            const img = outputs.images[0];
                            // Add a cache-buster timestamp to ensure fresh image is displayed
                            imageUrl = `${comfyService.getImageUrl(img.filename, img.subfolder, img.type)}&t=${Date.now()}`;
                            console.log('✅ Fresh Image found!', imageUrl);
                        }
                    }

                    // Surface execution errors immediately (instead of timing out with generic message)
                    if (history[prompt_id] && history[prompt_id].status?.status_str === 'error') {
                        const statusAny = history[prompt_id].status as any;
                        const messages = statusAny?.messages || [];
                        const execError = messages.find((m: any) => m?.[0] === 'execution_error')?.[1];
                        if (execError) {
                            const node = execError.node_id ? `Node #${execError.node_id} (${execError.node_type || 'Unknown'})` : 'Workflow';
                            const detail = (execError.exception_message || 'Execution failed').toString().trim();
                            throw new Error(`${node}: ${detail}`);
                        }
                        throw new Error('Workflow execution failed');
                    }
                } catch (err) {
                    console.warn(`⚠️ Attempt ${attempts} failed:`, err);
                }
            }

            cleanup();

            if (!imageUrl) {
                throw new Error('Failed to retrieve image after all attempts');
            }

            // 4. Add Image Result Message
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'assistant',
                content: prompt, // Keep prompt as content or reference
                type: 'image-result',
                timestamp: Date.now(),
                metadata: { imageUrl }
            }]);

        } catch (error) {
            console.error("Gen Error:", error);
            const msg = error instanceof Error ? error.message : 'Unknown generation error';
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'assistant',
                content: `Generation failed: ${msg}`,
                timestamp: Date.now(),
                type: 'text'
            }]);
        } finally {
            setGeneratingMsgId(null);
            setExecutionStatus('');
            setProgress(0);
        }
    };

    const handleGenerateLtx = async (msg: Message) => {
        const spec = msg.metadata?.ltxSpec;
        if (!spec) return;
        const mode = spec.mode === 't2v' ? 'ltx-generate-t2v' : 'ltx-generate-i2v';

        localStorage.setItem('ltx_copilot_prompt', `${spec.subject}. ${spec.motion}. ${spec.camera}. ${spec.lighting}. ${spec.style}.`);
        localStorage.setItem('ltx_copilot_negative', spec.negatives || '');
        localStorage.setItem('ltx_copilot_steps', String(spec.steps ?? 16));
        localStorage.setItem('ltx_copilot_cfg', String(spec.cfg ?? 4));
        localStorage.setItem('ltx_copilot_denoise', String(spec.denoise ?? 0.6));
        localStorage.setItem('ltx_copilot_duration', String(spec.duration ?? 6));
        localStorage.setItem('ltx_copilot_fps', String(spec.fps ?? 20));
        window.location.hash = `#ltxhub/${mode}`;
    };

    // Drag & Drop Handlers
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        const files = Array.from(e.dataTransfer.files);
        const imageFiles = files.filter(f => f.type.startsWith('image/'));

        if (imageFiles.length === 0) return;

        const base64Promises = imageFiles.map(file => {
            return new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    resolve(reader.result as string);
                };
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
        });

        try {
            const base64Images = await Promise.all(base64Promises);
            setPendingImages(prev => [...prev, ...base64Images]);
        } catch (error) {
            console.error('Failed to process dropped images:', error);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };


    const handleDownloadGeneratedImage = async (msg: Message) => {
        const imageUrl = msg.metadata?.imageUrl as string | undefined;
        if (!imageUrl) {
            toast('No image URL found for download', 'error');
            return;
        }

        const fallbackName = `chat-image-${msg.id}.png`;
        try {
            const savedAs = await directDownload(imageUrl, fallbackName);
            toast(`Downloaded ${savedAs}`, 'success');
        } catch {
            toast('Failed to download image', 'error');
        }
    };


    return (
        <div
            className="flex flex-col h-full w-full relative"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {/* Drag Overlay */}
            {isDragging && (
                <div className="absolute inset-0 bg-black/80 z-50 flex items-center justify-center border-4 border-dashed border-white/30 rounded-xl backdrop-blur-sm pointer-events-none animate-in fade-in duration-200">
                    <div className="flex flex-col items-center gap-4 animate-bounce">
                        <ImageIcon className="w-16 h-16 text-white" />
                        <span className="text-2xl font-bold text-white tracking-widest uppercase">Drop Idea Here</span>
                    </div>
                </div>
            )}

            <div className="px-6 pt-4 pb-2">
                <CatalogCard className="p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2 bg-[#0a0a0f] border border-white/10 rounded-lg px-2 py-1">
                            <span className="text-[10px] text-slate-500 uppercase tracking-tighter">Brain</span>
                            <select
                                value={selectedModel}
                                onChange={(e) => setSelectedModel(e.target.value)}
                                className="bg-transparent text-[10px] text-white border-none focus:ring-0 cursor-pointer outline-none font-bold"
                                disabled={availableModels.length === 0}
                            >
                                {availableModels.length === 0 ? (
                                    <option value="">No models</option>
                                ) : (
                                    availableModels.map(m => (
                                        <option key={m} value={m} className="bg-[#121218] text-white py-1">{m}</option>
                                    ))
                                )}
                            </select>
                        </div>

                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => setTtsEnabled(!ttsEnabled)}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all ${ttsEnabled ? 'bg-white/10 text-white' : 'bg-white/5 text-slate-400 hover:text-white'}`}
                                title="Toggle AI voice responses"
                            >
                                {ttsEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                                <span className="text-xs font-medium">Voice</span>
                            </button>

                            {ttsEnabled && (
                                <>
                                    <select
                                        value={voiceStyle}
                                        onChange={(e) => setVoiceStyle(e.target.value)}
                                        className="px-2 py-1 rounded-lg bg-[#121218] border border-white/10 text-xs text-white min-w-[170px]"
                                        disabled={isLoadingVoices}
                                        title="Voice engine/style"
                                    >
                                        {availableVoices.map(v => (
                                            <option key={v.id} value={v.id}>
                                                {v.name}{v.engine ? ` (${v.engine})` : ''}
                                            </option>
                                        ))}
                                    </select>

                                    <button
                                        onClick={fetchAvailableVoices}
                                        className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-slate-200"
                                        disabled={isLoadingVoices}
                                        title="Refresh available voices"
                                    >
                                        {isLoadingVoices ? 'Refreshing...' : 'Refresh Voices'}
                                    </button>

                                    <button
                                        onClick={unloadAudioModels}
                                        className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-slate-200"
                                        disabled={isUnloadingAudio}
                                        title="Unload voice models from VRAM"
                                    >
                                        {isUnloadingAudio ? 'Unloading...' : 'Free Voice VRAM'}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </CatalogCard>
            </div>
            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto px-8 py-6 space-y-8 custom-scrollbar">
                {messages.map((msg) => (
                    <div
                        key={msg.id}
                        className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                        {msg.role === 'assistant' && (
                            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 mt-1 shadow-inner">
                                <Bot className="w-4 h-4 text-white" />
                            </div>
                        )}

                        <div className={`max-w-[95%] flex flex-col gap-2 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>

                            {/* User Images */}
                            {msg.images && msg.images.length > 0 && (
                                <div className={`flex flex-wrap gap-2 mb-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    {msg.images.map((img, idx) => (
                                        <img key={idx} src={img} alt="Context" className="w-32 h-32 object-cover rounded-xl border border-white/20 shadow-lg" />
                                    ))}
                                </div>
                            )}

                            {/* Text Bubble */}
                            {msg.type === 'text' && (
                                <div className={`px-5 py-4 rounded-2xl ${msg.role === 'user'
                                    ? 'bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.1)]'
                                    : 'bg-[#121218] border border-white/5 text-slate-200 shadow-xl'
                                    }`}>
                                    <div className="prose prose-invert prose-sm max-w-none">
                                        <ReactMarkdown>
                                            {msg.content}
                                        </ReactMarkdown>
                                    </div>
                                </div>
                            )}

                            {/* TTS Button for Assistant Messages */}
                            {msg.role === 'assistant' && msg.type === 'text' && (
                                <button
                                    onClick={() => {
                                        if (playingMsgId === msg.id) {
                                            stopTTS();
                                        } else {
                                            playTTS(msg.id, msg.content);
                                        }
                                    }}
                                    disabled={generatingTtsId === msg.id}
                                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-xs text-white/50 hover:text-white/70 disabled:opacity-50"
                                    title={playingMsgId === msg.id ? "Stop" : "Play voice"}
                                >
                                    {generatingTtsId === msg.id ? (
                                        <>
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                            <span>Generating...</span>
                                        </>
                                    ) : playingMsgId === msg.id ? (
                                        <>
                                            <VolumeX className="w-3 h-3" />
                                            <span>Stop</span>
                                        </>
                                    ) : (
                                        <>
                                            <Volume2 className="w-3 h-3" />
                                            <span>Play</span>
                                        </>
                                    )}
                                </button>
                            )}

                            {/* Generation Request Card */}
                            {msg.type === 'image-generation-request' && (
                                <div className="bg-[#121218] border border-white/10 rounded-2xl p-5 shadow-2xl w-full max-w-2xl animate-in zoom-in-95 duration-300">
                                    <div className="flex items-center gap-2 mb-3 text-white/50 text-xs font-bold tracking-wider uppercase">
                                        <Sparkles className="w-3 h-3" />
                                        <span>Ready to Generate</span>
                                    </div>
                                    <p className="text-sm text-slate-300 italic mb-4 border-l-2 border-white/20 pl-3 py-1">
                                        "{msg.content}"
                                    </p>

                                    {/* Progress Indicator */}
                                    {generatingMsgId === msg.id && executionStatus && (
                                        <div className="mb-4 space-y-2">
                                            <div className="flex items-center justify-between text-xs">
                                                <span className="text-slate-400">{executionStatus}</span>
                                                <span className="text-white font-mono">{progress}%</span>
                                            </div>
                                            <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-white transition-all duration-300 ease-out"
                                                    style={{ width: `${progress}%` }}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    <button
                                        onClick={() => {
                                            if (msg.metadata?.generator === 'ltx') {
                                                handleGenerateLtx(msg);
                                                return;
                                            }
                                            handleGenerateImage(msg.id, msg.content, msg.metadata?.sourceUserInput);
                                        }}
                                        disabled={generatingMsgId !== null}
                                        className="w-full bg-white hover:bg-slate-200 text-black py-3 rounded-xl font-bold transition-all shadow-lg flex items-center justify-center gap-2"
                                    >
                                        {generatingMsgId === msg.id ? (
                                            <>
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                Generating...
                                            </>
                                        ) : (
                                            <>
                                                <ImageIcon className="w-4 h-4" />
                                                {msg.metadata?.generator === 'ltx' ? 'Generate with LTX' : 'Generate Image'}
                                            </>
                                        )}
                                    </button>
                                </div>
                            )}

                            {/* Image Result Card */}
                            {msg.type === 'image-result' && (
                                <div className="bg-[#121218] border border-white/10 rounded-2xl p-2 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-500">
                                    <img
                                        src={msg.metadata?.imageUrl}
                                        alt="Generated"
                                        className="rounded-xl w-full h-auto object-cover max-h-[800px] cursor-pointer hover:opacity-90 transition-opacity"
                                        onClick={() => setLightboxImage(msg.metadata?.imageUrl)}
                                    />
                                    <div className="p-3 flex items-center justify-between">
                                        <span className="text-xs text-slate-500 font-mono">Z-Image v1</span>
                                        <button onClick={() => handleDownloadGeneratedImage(msg)} className="text-xs text-white hover:underline">Download</button>
                                    </div>
                                </div>
                            )}

                        </div>

                        {msg.role === 'user' && (
                            <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center flex-shrink-0 mt-1 shadow-[0_0_15px_rgba(255,255,255,0.3)]">
                                <User className="w-4 h-4 text-black" />
                            </div>
                        )}
                    </div>
                ))}

                {isThinking && (
                    <div className="flex gap-4">
                        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 mt-1">
                            <Bot className="w-4 h-4 text-white" />
                        </div>
                        <div className="bg-[#121218] border border-white/5 rounded-2xl p-4 flex items-center gap-3">
                            <div className="flex gap-1">
                                <div className="w-1.5 h-1.5 bg-white rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                                <div className="w-1.5 h-1.5 bg-white rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                                <div className="w-1.5 h-1.5 bg-white rounded-full animate-bounce"></div>
                            </div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="px-8 pb-6 pt-4 relative z-20">
                <div className="relative w-full">

                    {/* Pending Image Preview */}
                    {pendingImages.length > 0 && (
                        <div className="absolute -top-24 left-0 flex gap-4 p-4 z-10">
                            {pendingImages.map((img, idx) => (
                                <div key={idx} className="relative group animate-in zoom-in-50 duration-200">
                                    <img src={img} className="w-20 h-20 object-cover rounded-lg border-2 border-white/30 shadow-2xl" />
                                    <button
                                        onClick={() => setPendingImages(prev => prev.filter((_, i) => i !== idx))}
                                        className="absolute -top-2 -right-2 bg-red-500 rounded-full w-5 h-5 flex items-center justify-center text-white text-xs font-bold shadow-md hover:bg-red-600 transition-colors"
                                    >
                                        ✕
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Mode Toggle Tooltip */}
                    {isRecording && (
                        <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-red-500 text-white text-xs px-3 py-1 rounded-full font-medium animate-pulse">
                            Recording... ({recordingMode === 'hold' ? 'Release to stop' : 'Click to stop'})
                        </div>
                    )}

                    <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Message Fedda Agent..."
                        disabled={isRecording || isTranscribing}
                        className="w-full bg-[#121218] border border-white/10 rounded-2xl pl-6 pr-28 py-4 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-white/20 resize-none shadow-2xl custom-scrollbar disabled:opacity-50"
                        style={{ minHeight: '60px', maxHeight: '200px' }}
                    />

                    {/* Microphone Button */}
                    <button
                        onMouseDown={handleMicMouseDown}
                        onMouseUp={handleMicMouseUp}
                        onMouseLeave={handleMicMouseUp}
                        onClick={handleMicClick}
                        disabled={isTranscribing}
                        className={`absolute right-16 bottom-3 p-2 rounded-xl transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-slate-700 text-white hover:bg-slate-600'}`}
                        title={recordingMode === 'hold' ? 'Hold to record' : 'Click to start/stop'}
                    >
                        {isTranscribing ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : isRecording ? (
                            <Square className="w-4 h-4" />
                        ) : (
                            <Mic className="w-4 h-4" />
                        )}
                    </button>

                    {/* Mode Toggle (small button) */}
                    <button
                        onClick={() => setRecordingMode(mode => mode === 'hold' ? 'toggle' : 'hold')}
                        disabled={isRecording || isTranscribing}
                        className="absolute right-16 bottom-[-20px] text-[10px] text-slate-500 hover:text-white transition-all disabled:opacity-50"
                        title="Toggle recording mode"
                    >
                        {recordingMode === 'hold' ? '📌 Hold' : '🔘 Click'}
                    </button>

                    {/* Send Button */}
                    <button
                        onClick={handleSend}
                        disabled={!input.trim() || isThinking || isRecording || isTranscribing}
                        className="absolute right-3 bottom-3 p-2 bg-white text-black rounded-xl hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg"
                    >
                        <Send className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Lightbox — portal to body to escape stacking contexts */}
            {lightboxImage && createPortal(
                <div
                    className="fixed inset-0 z-[9999] bg-black/95 backdrop-blur-sm flex items-center justify-center p-4 md:p-8 animate-in fade-in duration-200"
                    onClick={() => setLightboxImage(null)}
                >
                    <button
                        onClick={() => setLightboxImage(null)}
                        className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
                    >
                        <X className="w-6 h-6" />
                    </button>
                    <img
                        src={lightboxImage}
                        alt="Full size"
                        className="max-w-full max-h-full object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-300"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>,
                document.body
            )}
        </div>
    );
};


