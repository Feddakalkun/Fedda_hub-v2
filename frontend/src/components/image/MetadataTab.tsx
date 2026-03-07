import { useState, useCallback, useEffect, useRef } from 'react';
import { Upload, X, Play, FileText, Copy, Check, ChevronDown } from 'lucide-react';
import { comfyService } from '../../services/comfyService';
import { useComfyExecution } from '../../contexts/ComfyExecutionContext';
import { useToast } from '../ui/Toast';

interface MetadataTabProps {
    isGenerating: boolean;
    setIsGenerating: (v: boolean) => void;
    initialImageUrl?: string | null;
    onConsumeImage?: () => void;
}

interface ParsedMetadata {
    prompt?: string;
    negativePrompt?: string;
    seed?: number;
    steps?: number;
    cfg?: number;
    denoise?: number;
    width?: number;
    height?: number;
    sampler?: string;
    scheduler?: string;
    checkpoint?: string;
    loras?: { name: string; strength: number }[];
    rawWorkflow?: Record<string, any>;
}

// ── PNG tEXt chunk reader ──────────────────────────────────────────
async function readPngMetadata(data: ArrayBuffer): Promise<Record<string, string>> {
    const view = new DataView(data);
    const metadata: Record<string, string> = {};

    // Verify PNG signature
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) {
        if (view.getUint8(i) !== sig[i]) throw new Error('Not a valid PNG file');
    }

    let offset = 8;
    while (offset < data.byteLength) {
        if (offset + 8 > data.byteLength) break;
        const length = view.getUint32(offset);
        const type = String.fromCharCode(
            view.getUint8(offset + 4),
            view.getUint8(offset + 5),
            view.getUint8(offset + 6),
            view.getUint8(offset + 7)
        );

        if (type === 'tEXt' && offset + 8 + length <= data.byteLength) {
            const chunkData = new Uint8Array(data, offset + 8, length);
            let nullIdx = 0;
            while (nullIdx < chunkData.length && chunkData[nullIdx] !== 0) nullIdx++;
            const key = new TextDecoder().decode(chunkData.slice(0, nullIdx));
            const value = new TextDecoder().decode(chunkData.slice(nullIdx + 1));
            metadata[key] = value;
        }

        if (type === 'IEND') break;
        offset += 12 + length;
    }
    return metadata;
}

// ── Extract human-readable params from ComfyUI API workflow ────────
function parseWorkflow(workflow: Record<string, any>): ParsedMetadata {
    const result: ParsedMetadata = { rawWorkflow: workflow, loras: [] };

    for (const [, node] of Object.entries(workflow)) {
        const cls = node.class_type as string;
        const inputs = node.inputs || {};

        // KSampler variants
        if (cls?.includes('KSampler') || cls === 'SamplerCustom') {
            result.seed = result.seed ?? inputs.seed;
            result.steps = result.steps ?? inputs.steps;
            result.cfg = result.cfg ?? inputs.cfg;
            result.denoise = result.denoise ?? inputs.denoise;
            result.sampler = result.sampler ?? inputs.sampler_name;
            result.scheduler = result.scheduler ?? inputs.scheduler;
        }

        // Positive prompt
        if (cls === 'CLIPTextEncode' && !result.prompt) {
            const text = typeof inputs.text === 'string' ? inputs.text : null;
            if (text && !text.toLowerCase().includes('blurry') && !text.toLowerCase().includes('bad anatomy')) {
                result.prompt = text;
            }
        }

        // Negative prompt (heuristic: contains common negative terms)
        if (cls === 'CLIPTextEncode') {
            const text = typeof inputs.text === 'string' ? inputs.text : null;
            if (text && (text.toLowerCase().includes('blurry') || text.toLowerCase().includes('bad anatomy') || text.toLowerCase().includes('low quality'))) {
                result.negativePrompt = result.negativePrompt ?? text;
            }
        }

        // Dimensions (only accept realistic image sizes)
        if (cls === 'EmptyLatentImage' || cls === 'EmptySD3LatentImage') {
            const w = inputs.width;
            const h = inputs.height;
            if (typeof w === 'number' && typeof h === 'number' && w >= 64 && h >= 64) {
                result.width = result.width ?? w;
                result.height = result.height ?? h;
            }
        }

        // Checkpoint
        if (cls === 'CheckpointLoaderSimple' || cls?.includes('CheckpointLoader')) {
            result.checkpoint = result.checkpoint ?? inputs.ckpt_name;
        }

        // LoRAs
        if (cls?.includes('LoraLoader') || cls?.includes('Power Lora')) {
            if (inputs.lora_name) {
                result.loras!.push({ name: inputs.lora_name, strength: inputs.strength_model ?? 1 });
            }
            // Power Lora Loader has lora_1, lora_2, etc.
            for (let i = 1; i <= 5; i++) {
                const l = inputs[`lora_${i}`];
                if (l && typeof l === 'object' && l.on && l.lora) {
                    result.loras!.push({ name: l.lora, strength: l.strength ?? 1 });
                }
            }
        }
    }

    return result;
}

export const MetadataTab = ({ isGenerating, setIsGenerating, initialImageUrl, onConsumeImage }: MetadataTabProps) => {
    const { queueWorkflow } = useComfyExecution();
    const { toast } = useToast();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [isDragging, setIsDragging] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [metadata, setMetadata] = useState<ParsedMetadata | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copiedField, setCopiedField] = useState<string | null>(null);

    // LoRA editing state
    const [availableLoras, setAvailableLoras] = useState<string[]>([]);
    const [loraOverrides, setLoraOverrides] = useState<{ name: string; strength: number }[]>([]);

    // Fetch available LoRAs on mount
    useEffect(() => {
        comfyService.getLoras().then(setAvailableLoras).catch(() => {});
    }, []);

    const processImageData = useCallback(async (arrayBuffer: ArrayBuffer, preview: string) => {
        setIsLoading(true);
        setError(null);
        setMetadata(null);
        setLoraOverrides([]);
        setPreviewUrl(preview);

        try {
            const pngMeta = await readPngMetadata(arrayBuffer);
            const promptJson = pngMeta['prompt'];

            if (!promptJson) {
                setError('No ComfyUI metadata found in this image. Only PNG images generated by ComfyUI contain workflow metadata.');
                setIsLoading(false);
                return;
            }

            const workflow = JSON.parse(promptJson);
            const parsed = parseWorkflow(workflow);
            setMetadata(parsed);
            // Initialize LoRA overrides from parsed metadata
            if (parsed.loras && parsed.loras.length > 0) {
                setLoraOverrides(parsed.loras.map(l => ({ ...l })));
            }
        } catch (err: any) {
            console.error('Metadata parse error:', err);
            setError(err.message || 'Failed to read metadata from image');
        } finally {
            setIsLoading(false);
        }
    }, []);

    const loadFromUrl = useCallback(async (url: string) => {
        setIsLoading(true);
        setPreviewUrl(url);
        setError(null);
        setMetadata(null);
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error('Failed to fetch image');
            const arrayBuffer = await resp.arrayBuffer();
            await processImageData(arrayBuffer, url);
        } catch (err: any) {
            setError('Failed to load image from URL. ' + (err.message || ''));
            setIsLoading(false);
        }
    }, [processImageData]);

    // Auto-load from gallery when sent via quick action
    const lastLoadedUrl = useRef<string | null>(null);
    useEffect(() => {
        if (initialImageUrl && initialImageUrl !== lastLoadedUrl.current) {
            lastLoadedUrl.current = initialImageUrl;
            loadFromUrl(initialImageUrl);
            onConsumeImage?.();
        }
    }, [initialImageUrl, loadFromUrl, onConsumeImage]);

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        // Case 1: File dropped (from filesystem)
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            const arrayBuffer = await file.arrayBuffer();
            const preview = URL.createObjectURL(file);
            await processImageData(arrayBuffer, preview);
            return;
        }

        // Case 2: Image URL dropped (from gallery)
        const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
        if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
            await loadFromUrl(url);
            return;
        }

        setError('Please drop a PNG image file or drag one from the gallery.');
    }, [processImageData, loadFromUrl]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const arrayBuffer = file.arrayBuffer();
        const preview = URL.createObjectURL(file);
        arrayBuffer.then(ab => processImageData(ab, preview));
    };

    const handleClear = () => {
        if (previewUrl && previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
        setMetadata(null);
        setError(null);
        lastLoadedUrl.current = null;
    };

    // Build a workflow from our own z-image-master template, injecting extracted metadata
    const buildWorkflow = async (overrideSeed?: number): Promise<Record<string, any>> => {
        const resp = await fetch('/workflows/z-image-master.json');
        if (!resp.ok) throw new Error('Failed to load z-image workflow template');
        const workflow = await resp.json();

        if (!metadata) throw new Error('No metadata');

        // KSampler (node 3)
        if (workflow['3']) {
            const ks = workflow['3'].inputs;
            ks.seed = overrideSeed ?? metadata.seed ?? ks.seed;
            ks.steps = metadata.steps ?? ks.steps;
            ks.cfg = metadata.cfg ?? ks.cfg;
            ks.denoise = metadata.denoise ?? ks.denoise;
            if (metadata.sampler) ks.sampler_name = metadata.sampler;
            if (metadata.scheduler) ks.scheduler = metadata.scheduler;
        }

        // Positive prompt (node 6)
        if (workflow['6'] && metadata.prompt) {
            workflow['6'].inputs.text = metadata.prompt;
        }

        // Negative prompt (node 7)
        if (workflow['7'] && metadata.negativePrompt) {
            workflow['7'].inputs.text = metadata.negativePrompt;
        }

        // Dimensions — find EmptyLatentImage node
        if (metadata.width && metadata.height) {
            for (const [, node] of Object.entries(workflow)) {
                if ((node as any).class_type === 'EmptyLatentImage') {
                    (node as any).inputs.width = metadata.width;
                    (node as any).inputs.height = metadata.height;
                }
            }
        }

        // LoRAs — inject into Power Lora Loader (node 126)
        if (workflow['126'] && loraOverrides.length > 0) {
            const powerLora = workflow['126'].inputs;
            loraOverrides.forEach((l, i) => {
                powerLora[`lora_${i + 1}`] = {
                    on: true,
                    lora: l.name,
                    strength: l.strength,
                    strengthTwo: l.strength,
                };
            });
        }

        return workflow;
    };

    const handleReproduce = async () => {
        if (!metadata) {
            toast('No metadata available to reproduce', 'error');
            return;
        }
        setIsGenerating(true);
        try {
            const workflow = await buildWorkflow();
            await queueWorkflow(workflow);
            toast('Reproducing with extracted settings!', 'success');
        } catch (err: any) {
            console.error('Reproduce failed:', err);
            toast(err.message || 'Failed to reproduce image', 'error');
            setIsGenerating(false);
        }
    };

    const handleReproduceNewSeed = async () => {
        if (!metadata) {
            toast('No metadata available', 'error');
            return;
        }
        setIsGenerating(true);
        try {
            const newSeed = Math.floor(Math.random() * 1000000000000000);
            const workflow = await buildWorkflow(newSeed);
            await queueWorkflow(workflow);
            toast('Generating with same settings but new seed!', 'success');
        } catch (err: any) {
            console.error('Generate failed:', err);
            toast(err.message || 'Generation failed', 'error');
            setIsGenerating(false);
        }
    };

    const handleBatchVariations = async () => {
        if (!metadata) {
            toast('No metadata available', 'error');
            return;
        }
        setIsGenerating(true);
        try {
            for (let i = 0; i < 4; i++) {
                const newSeed = Math.floor(Math.random() * 1000000000000000);
                const workflow = await buildWorkflow(newSeed);
                await queueWorkflow(workflow);
            }
            toast('Queued 4 variations!', 'success');
        } catch (err: any) {
            console.error('Batch failed:', err);
            toast(err.message || 'Batch generation failed', 'error');
            setIsGenerating(false);
        }
    };

    const copyToClipboard = (text: string, field: string) => {
        navigator.clipboard.writeText(text);
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 1500);
    };

    return (
        <div className="space-y-4">
            {/* Drop Zone / Preview */}
            <div className="bg-[#121218] border border-white/5 rounded-2xl p-6 shadow-xl">
                <label className="block text-xs text-slate-400 uppercase tracking-wider mb-2">Source Image</label>
                {previewUrl ? (
                    <div className="relative rounded-xl overflow-hidden border border-white/10">
                        <img src={previewUrl} alt="Input" className="w-full max-h-48 object-contain bg-black/30" />
                        <button onClick={handleClear} className="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-red-500/80 rounded-full text-white transition-colors">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                ) : (
                    <div
                        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${isDragging ? 'border-white/50 bg-white/5' : 'border-white/10 hover:border-white/30 hover:bg-white/5'}`}
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <FileText className="w-8 h-8 text-slate-500 mx-auto mb-2" />
                        <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Drop a PNG Image or Click to Browse</p>
                        <p className="text-[10px] text-slate-600 mt-1">Or drag from the Gallery / click the metadata button on any image</p>
                    </div>
                )}
                <input ref={fileInputRef} type="file" className="hidden" accept="image/png" onChange={handleFileChange} />
            </div>

            {/* Loading */}
            {isLoading && (
                <div className="bg-[#121218] border border-white/5 rounded-2xl p-6 shadow-xl text-center">
                    <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto mb-2" />
                    <p className="text-xs text-slate-400">Reading metadata...</p>
                </div>
            )}

            {/* Error */}
            {error && (
                <div className="bg-[#121218] border border-red-500/20 rounded-2xl p-6 shadow-xl">
                    <p className="text-xs text-red-400">{error}</p>
                </div>
            )}

            {/* Metadata Display */}
            {metadata && (
                <>
                    {/* Reproduce Buttons */}
                    <div className="grid grid-cols-3 gap-2">
                        <button
                            onClick={handleReproduce}
                            disabled={isGenerating}
                            className="flex items-center justify-center gap-1.5 py-3 bg-white text-black font-bold text-xs rounded-xl hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                            <Play className="w-3.5 h-3.5" />
                            Exact Copy
                        </button>
                        <button
                            onClick={handleReproduceNewSeed}
                            disabled={isGenerating}
                            className="flex items-center justify-center gap-1.5 py-3 bg-white/10 text-white font-bold text-xs rounded-xl hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all border border-white/10"
                        >
                            <Play className="w-3.5 h-3.5" />
                            New Seed
                        </button>
                        <button
                            onClick={handleBatchVariations}
                            disabled={isGenerating}
                            className="flex items-center justify-center gap-1.5 py-3 bg-amber-500/20 text-amber-400 font-bold text-xs rounded-xl hover:bg-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all border border-amber-500/20"
                        >
                            <span className="text-sm">×4</span>
                            Batch
                        </button>
                    </div>

                    {/* Parameters */}
                    <div className="bg-[#121218] border border-white/5 rounded-2xl p-6 shadow-xl space-y-4">
                        <h3 className="text-xs text-slate-400 uppercase tracking-wider font-bold">Extracted Parameters</h3>

                        {metadata.prompt && (
                            <MetaField
                                label="Prompt"
                                value={metadata.prompt}
                                multiline
                                onCopy={() => copyToClipboard(metadata.prompt!, 'prompt')}
                                copied={copiedField === 'prompt'}
                            />
                        )}

                        {metadata.negativePrompt && (
                            <MetaField
                                label="Negative Prompt"
                                value={metadata.negativePrompt}
                                multiline
                                onCopy={() => copyToClipboard(metadata.negativePrompt!, 'negative')}
                                copied={copiedField === 'negative'}
                            />
                        )}

                        <div className="grid grid-cols-2 gap-3">
                            {metadata.seed != null && <MetaItem label="Seed" value={String(metadata.seed)} />}
                            {metadata.steps != null && <MetaItem label="Steps" value={String(metadata.steps)} />}
                            {metadata.cfg != null && <MetaItem label="CFG" value={String(metadata.cfg)} />}
                            {metadata.denoise != null && <MetaItem label="Denoise" value={String(metadata.denoise)} />}
                            {metadata.width && metadata.height && <MetaItem label="Dimensions" value={`${metadata.width}x${metadata.height}`} />}
                            {metadata.sampler && <MetaItem label="Sampler" value={metadata.sampler} />}
                            {metadata.scheduler && <MetaItem label="Scheduler" value={metadata.scheduler} />}
                        </div>

                        {metadata.checkpoint && (
                            <MetaField label="Checkpoint" value={metadata.checkpoint} />
                        )}

                        {loraOverrides.length > 0 && (
                            <div>
                                <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">LoRAs (Editable)</label>
                                <div className="space-y-2">
                                    {loraOverrides.map((l, i) => (
                                        <div key={i} className="bg-[#0a0a0f] border border-white/5 rounded-lg px-3 py-2.5 space-y-2">
                                            <div className="relative">
                                                <select
                                                    value={l.name}
                                                    onChange={(e) => {
                                                        setLoraOverrides(prev => prev.map((lo, idx) => idx === i ? { ...lo, name: e.target.value } : lo));
                                                    }}
                                                    className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-slate-300 appearance-none pr-6 focus:outline-none focus:ring-1 focus:ring-white/20 truncate"
                                                >
                                                    {/* Keep current value even if not in list */}
                                                    {!availableLoras.includes(l.name) && (
                                                        <option value={l.name}>{l.name}</option>
                                                    )}
                                                    {availableLoras.map(name => (
                                                        <option key={name} value={name}>{name}</option>
                                                    ))}
                                                </select>
                                                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] text-slate-500 w-12">Str</span>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="2"
                                                    step="0.05"
                                                    value={l.strength}
                                                    onChange={(e) => {
                                                        setLoraOverrides(prev => prev.map((lo, idx) => idx === i ? { ...lo, strength: parseFloat(e.target.value) } : lo));
                                                    }}
                                                    className="flex-1 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-400"
                                                />
                                                <span className="text-[10px] text-slate-400 w-8 text-right font-mono">{l.strength.toFixed(2)}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

// ── Sub-components ─────────────────────────────────────────────────
function MetaField({ label, value, multiline, onCopy, copied }: { label: string; value: string; multiline?: boolean; onCopy?: () => void; copied?: boolean }) {
    return (
        <div>
            <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</label>
                {onCopy && (
                    <button onClick={onCopy} className="p-1 hover:bg-white/10 rounded transition-colors">
                        {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-slate-500" />}
                    </button>
                )}
            </div>
            {multiline ? (
                <div className="bg-[#0a0a0f] border border-white/5 rounded-lg p-3 text-xs text-slate-300 max-h-32 overflow-y-auto custom-scrollbar whitespace-pre-wrap break-words">
                    {value}
                </div>
            ) : (
                <div className="bg-[#0a0a0f] border border-white/5 rounded-lg px-3 py-2 text-xs text-slate-300 truncate">
                    {value}
                </div>
            )}
        </div>
    );
}

function MetaItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="bg-[#0a0a0f] border border-white/5 rounded-lg px-3 py-2">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>
            <div className="text-sm text-white font-medium mt-0.5 truncate">{value}</div>
        </div>
    );
}
