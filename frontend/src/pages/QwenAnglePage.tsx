import { useEffect, useState } from 'react';
import { Camera } from 'lucide-react';
import { ModelDownloader } from '../components/ModelDownloader';
import { ImageGallery } from '../components/image/ImageGallery';
import { ImageUpload } from '../components/image/ImageUpload';
import { AngleCompass } from '../components/image/AngleCompass';
import { WorkbenchShell } from '../components/layout/WorkbenchShell';
import { CatalogCard } from '../components/layout/CatalogShell';
import { comfyService } from '../services/comfyService';
import { useComfyExecution } from '../contexts/ComfyExecutionContext';
import { useToast } from '../components/ui/Toast';
import { usePersistentState } from '../hooks/usePersistentState';
import {
    type AngleConfig,
    PIPELINES,
    PRESETS,
    MLS_NEGATIVE_PROMPT,
    MLS_ULTRA_NEGATIVE_PROMPT,
    MLS_STRICT_PRESERVE_NEGATIVE_PROMPT,
    QUALITY_PRESETS,
    type QualityPresetKey,
    QUICK_PICKS,
    getAngleLabel,
} from '../config/anglePresets';

interface QwenAnglePageProps {
    modelId: string;
    modelLabel: string;
}

interface ResolutionInfo {
    sourceWidth: number;
    sourceHeight: number;
    targetWidth: number;
    targetHeight: number;
    wasAdjusted: boolean;
}

const COMPAT_MULTIPLE = 64;

function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new window.Image();
        img.onload = () => {
            const result = { width: img.naturalWidth, height: img.naturalHeight };
            URL.revokeObjectURL(url);
            resolve(result);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to read image dimensions'));
        };
        img.src = url;
    });
}

function nearestCompatibleDimensions(width: number, height: number, multiple: number): { width: number; height: number } {
    const ratio = width / height;
    const baseW = Math.max(1, Math.round(width / multiple));
    const baseH = Math.max(1, Math.round(height / multiple));

    let bestW = Math.max(multiple, baseW * multiple);
    let bestH = Math.max(multiple, baseH * multiple);
    let bestScore = Number.POSITIVE_INFINITY;

    for (let dw = -5; dw <= 5; dw++) {
        for (let dh = -5; dh <= 5; dh++) {
            const wSteps = Math.max(1, baseW + dw);
            const hSteps = Math.max(1, baseH + dh);
            const candW = wSteps * multiple;
            const candH = hSteps * multiple;

            const ratioError = Math.abs((candW / candH) - ratio);
            const sizeDelta = Math.abs(candW - width) + Math.abs(candH - height);
            const score = ratioError * 10000 + sizeDelta;

            if (score < bestScore) {
                bestScore = score;
                bestW = candW;
                bestH = candH;
            }
        }
    }

    return { width: bestW, height: bestH };
}

function resizeImageToDimensions(file: File, width: number, height: number): Promise<File> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new window.Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                URL.revokeObjectURL(url);
                reject(new Error('Failed to create canvas context'));
                return;
            }

            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, width, height);

            canvas.toBlob((blob) => {
                URL.revokeObjectURL(url);
                if (!blob) {
                    reject(new Error('Failed to encode resized image'));
                    return;
                }
                const outFile = new File([blob], file.name, { type: file.type || 'image/png' });
                resolve(outFile);
            }, file.type || 'image/png', 0.98);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load image for resize'));
        };
        img.src = url;
    });
}

export const QwenAnglePage = ({ modelId }: QwenAnglePageProps) => {
    const SCENE_COUNT = 6;
    const STRICT_DENOISE_FRONT = 0.76;
    const STRICT_DENOISE_SIDE = 0.84;
    const STRICT_DENOISE_REAR = 0.9;
    const STRICT_DENOISE_HIGH_ANGLE = 0.88;
    const STRICT_CFGNORM_STRENGTH = 0.88;
    const STRICT_LIGHTNING_LORA_STRENGTH = 0.85;
    const STRICT_MULTIANGLE_LORA_STRENGTH = 0.9;
    const DEFAULT_DENOISE = 1.0;
    const MIN_PER_ANGLE_SEED_STEP = 97;
    const { queueWorkflow } = useComfyExecution();
    const { toast } = useToast();

    const [isGenerating, setIsGenerating] = useState(false);
    const [selectedAngle, setSelectedAngle] = useState(0);
    const [inputImage, setInputImage] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [angles, setAngles] = useState<AngleConfig[]>(PRESETS['MLS Photoreal Clean']);
    const [incomingImageUrl, setIncomingImageUrl] = useState<string | null>(() => localStorage.getItem('qwen_input_image_url'));
    const [resolutionInfo, setResolutionInfo] = useState<ResolutionInfo | null>(null);
    const [generatedImages, setGeneratedImages] = useState<string[]>(() => {
        const saved = localStorage.getItem(`gallery_${modelId}`);
        return saved ? JSON.parse(saved) : [];
    });
    const [lockSeedConsistency, setLockSeedConsistency] = usePersistentState('qwen_angle_lock_seed_consistency', true);
    const [baseSeed, setBaseSeed] = usePersistentState('qwen_angle_base_seed', Math.floor(Math.random() * 1000000000000000));
    const [seedStep, setSeedStep] = usePersistentState('qwen_angle_seed_step', 0);
    const [qualityPreset, setQualityPreset] = usePersistentState<QualityPresetKey>('qwen_angle_quality_preset', 'Quality');
    const [ultraCleanMode, setUltraCleanMode] = usePersistentState('qwen_angle_ultra_clean_mode', true);
    const [strictPreserveScene, setStrictPreserveScene] = usePersistentState('qwen_angle_strict_preserve_scene', true);

    const getStrictDenoiseForAngle = (angle: AngleConfig) => {
        const h = ((angle.horizontal % 360) + 360) % 360;
        const rearDistance = Math.min(Math.abs(h - 180), 360 - Math.abs(h - 180));
        const frontDistance = Math.min(h, 360 - h);

        // High vertical views need more denoise to actually change perspective.
        if (Math.abs(angle.vertical) >= 20) return STRICT_DENOISE_HIGH_ANGLE;

        // Rear and near-rear views need strongest change.
        if (rearDistance <= 50) return STRICT_DENOISE_REAR;

        // Side views.
        if (frontDistance >= 55 && frontDistance <= 125) return STRICT_DENOISE_SIDE;

        // Front / near-front views.
        return STRICT_DENOISE_FRONT;
    };

    const handleImageSelected = async (file: File) => {
        setInputImage(file);
        setPreviewUrl(URL.createObjectURL(file));
        setIncomingImageUrl(null);
        try { localStorage.removeItem('qwen_input_image_url'); } catch { /* ignore */ }

        try {
            const { width, height } = await getImageDimensions(file);
            const target = nearestCompatibleDimensions(width, height, COMPAT_MULTIPLE);
            setResolutionInfo({
                sourceWidth: width,
                sourceHeight: height,
                targetWidth: target.width,
                targetHeight: target.height,
                wasAdjusted: width !== target.width || height !== target.height,
            });
        } catch {
            setResolutionInfo(null);
        }
    };

    useEffect(() => {
        const onIncoming = (event: Event) => {
            const custom = event as CustomEvent<{ url?: string }>;
            const nextUrl = custom.detail?.url || localStorage.getItem('qwen_input_image_url');
            if (!nextUrl) return;
            setIncomingImageUrl(nextUrl);
        };

        window.addEventListener('fedda:qwen-input', onIncoming as EventListener);
        return () => window.removeEventListener('fedda:qwen-input', onIncoming as EventListener);
    }, []);

    const handleClearImage = () => {
        setInputImage(null);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
    };

    const updateAngle = (index: number, patch: Partial<AngleConfig>) => {
        setAngles((prev) =>
            prev.map((angle, i) => {
                if (i !== index) return angle;

                const horizontal = patch.horizontal ?? angle.horizontal;
                const vertical = patch.vertical ?? angle.vertical;
                const zoom = patch.zoom ?? angle.zoom;

                return {
                    ...angle,
                    ...patch,
                    label: getAngleLabel(horizontal, vertical, zoom),
                };
            })
        );
    };

    const applyPreset = (name: string) => {
        setAngles(PRESETS[name]);
        setSelectedAngle(0);
    };

    const applyMlsPhotorealClean = () => {
        applyPreset('MLS Photoreal Clean');
        setLockSeedConsistency(true);
        setSeedStep(MIN_PER_ANGLE_SEED_STEP);
        setQualityPreset('Quality');
        setUltraCleanMode(false);
        toast('Applied MLS Photoreal Clean preset', 'success');
    };

    const applyMlsUltraClean = () => {
        applyPreset('MLS Ultra Clean');
        setLockSeedConsistency(true);
        setSeedStep(MIN_PER_ANGLE_SEED_STEP);
        setQualityPreset('Quality');
        setUltraCleanMode(true);
        toast('Applied MLS Ultra Clean preset', 'success');
    };

    const handleGenerate = async () => {
        if (!inputImage) {
            toast('Upload a reference image first', 'error');
            return;
        }

        setIsGenerating(true);

        try {
            const response = await fetch('/workflows/qwen-multiangle.json');
            if (!response.ok) throw new Error('Failed to load qwen-multiangle workflow');

            const workflow = await response.json();
            const quality = QUALITY_PRESETS[qualityPreset];

            let fileForWorkflow = inputImage;
            let sourceWidth = 0;
            let sourceHeight = 0;
            let targetWidth = 0;
            let targetHeight = 0;
            let wasAdjusted = false;

            try {
                const dims = await getImageDimensions(inputImage);
                sourceWidth = dims.width;
                sourceHeight = dims.height;
                const target = nearestCompatibleDimensions(dims.width, dims.height, COMPAT_MULTIPLE);
                targetWidth = target.width;
                targetHeight = target.height;
                wasAdjusted = dims.width !== target.width || dims.height !== target.height;

                if (wasAdjusted) {
                    fileForWorkflow = await resizeImageToDimensions(inputImage, target.width, target.height);
                }

                setResolutionInfo({
                    sourceWidth,
                    sourceHeight,
                    targetWidth,
                    targetHeight,
                    wasAdjusted,
                });
            } catch {
                // Fallback to original file if dimension/resize analysis fails.
            }

            // Node 41 is the input image for this workflow.
            const uploadedPrepared = await comfyService.uploadImage(fileForWorkflow);
            workflow['41'].inputs.image = uploadedPrepared.name;

            // Global consistency knobs.
            // Strict mode intentionally reduces creative freedom to preserve geometry/materials.
            if (workflow['107']?.inputs) {
                workflow['107'].inputs.strength_model = strictPreserveScene
                    ? STRICT_LIGHTNING_LORA_STRENGTH
                    : 1.0;
            }
            if (workflow['111']?.inputs) {
                workflow['111'].inputs.strength_model = strictPreserveScene
                    ? STRICT_MULTIANGLE_LORA_STRENGTH
                    : 1.0;
            }

            // Set each pipeline's camera config and seed strategy.
            const effectiveSeedStep = lockSeedConsistency
                ? (seedStep === 0 ? MIN_PER_ANGLE_SEED_STEP : seedStep)
                : seedStep;
            PIPELINES.slice(0, SCENE_COUNT).forEach((pipe, i) => {
                const angle = angles[i];
                workflow[pipe.camera].inputs.horizontal_angle = angle.horizontal;
                workflow[pipe.camera].inputs.vertical_angle = angle.vertical;
                workflow[pipe.camera].inputs.zoom = angle.zoom;
                workflow[pipe.sampler].inputs.seed = lockSeedConsistency
                    ? (baseSeed + (i * effectiveSeedStep))
                    : Math.floor(Math.random() * 1000000000000000);
                workflow[pipe.sampler].inputs.steps = quality.steps;
                workflow[pipe.sampler].inputs.cfg = quality.cfg;
                workflow[pipe.sampler].inputs.sampler_name = quality.sampler;
                workflow[pipe.sampler].inputs.scheduler = quality.scheduler;
                workflow[pipe.sampler].inputs.denoise = strictPreserveScene
                    ? getStrictDenoiseForAngle(angle)
                    : DEFAULT_DENOISE;

                const samplerPrefix = pipe.sampler.split(':')[0];
                const negativePromptNode = workflow[`${samplerPrefix}:109`];
                if (negativePromptNode?.inputs) {
                    const baseNegativePrompt = ultraCleanMode ? MLS_ULTRA_NEGATIVE_PROMPT : MLS_NEGATIVE_PROMPT;
                    negativePromptNode.inputs.prompt = strictPreserveScene
                        ? `${baseNegativePrompt}, ${MLS_STRICT_PRESERVE_NEGATIVE_PROMPT}`
                        : baseNegativePrompt;
                }

                const cfgNormNode = workflow[`${samplerPrefix}:100`];
                if (cfgNormNode?.inputs && typeof cfgNormNode.inputs.strength !== 'undefined') {
                    cfgNormNode.inputs.strength = strictPreserveScene
                        ? STRICT_CFGNORM_STRENGTH
                        : 1.0;
                }
            });

            await queueWorkflow(workflow);
            toast(
                wasAdjusted
                    ? `Generating ${SCENE_COUNT} angles (${sourceWidth}x${sourceHeight} -> ${targetWidth}x${targetHeight})`
                    : `Generating ${SCENE_COUNT} camera angles`,
                'success'
            );
        } catch (error: any) {
            console.error('Qwen angle generation failed:', error);
            toast(error?.message || 'Generation failed', 'error');
            setIsGenerating(false);
        }
    };

    const selected = angles[selectedAngle];

    return (
        <WorkbenchShell
            leftWidthClassName="w-[500px]"
            leftPaneClassName="p-4"
            leftPane={
                <>
                    <ModelDownloader modelGroup="qwen-angle" />

                    <div className="px-4 mt-4 space-y-4">
                        <CatalogCard className="p-6 shadow-xl">
                            <ImageUpload
                                onImageSelected={handleImageSelected}
                                previewUrl={previewUrl}
                                onClear={handleClearImage}
                                label="Reference Image"
                                initialUrl={incomingImageUrl}
                            />
                        </CatalogCard>

                        <CatalogCard className="p-3">
                            <button
                                onClick={applyMlsPhotorealClean}
                                className="w-full mb-2 py-2 text-[10px] font-bold uppercase tracking-wider rounded-lg bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 hover:bg-emerald-500/30 transition-all"
                            >
                                Apply MLS Photoreal Clean (Locked)
                            </button>
                            <button
                                onClick={applyMlsUltraClean}
                                className="w-full mb-2 py-2 text-[10px] font-bold uppercase tracking-wider rounded-lg bg-cyan-500/20 border border-cyan-400/40 text-cyan-200 hover:bg-cyan-500/30 transition-all"
                            >
                                Apply MLS Ultra Clean (Strict)
                            </button>
                            <div className="flex gap-2">
                                {Object.keys(PRESETS).map((name) => (
                                    <button
                                        key={name}
                                        onClick={() => applyPreset(name)}
                                        className="flex-1 py-2 text-[10px] font-bold uppercase tracking-wider rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-all"
                                    >
                                        {name}
                                    </button>
                                ))}
                            </div>
                        </CatalogCard>

                        <CatalogCard className="p-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Consistency Controls</div>
                                    <div className="text-[10px] text-slate-600">Keep style/materials stable across all angles</div>
                                </div>
                                <label className="flex items-center gap-2 text-xs text-slate-400">
                                    <input
                                        type="checkbox"
                                        checked={lockSeedConsistency}
                                        onChange={(e) => setLockSeedConsistency(e.target.checked)}
                                        className="rounded border-white/20 bg-black/40"
                                    />
                                    Lock Seed
                                </label>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => setStrictPreserveScene((prev) => !prev)}
                                    className={`py-2 text-[10px] font-bold uppercase tracking-wider rounded-lg border transition-all ${strictPreserveScene
                                        ? 'bg-fuchsia-500/20 border-fuchsia-400/40 text-fuchsia-200'
                                        : 'bg-white/5 border-white/10 text-slate-400 hover:text-white hover:bg-white/10'
                                        }`}
                                >
                                    {strictPreserveScene ? 'Strict Preserve Scene ON' : 'Strict Preserve Scene OFF'}
                                </button>
                                <div className="py-2 px-3 text-[10px] font-bold uppercase tracking-wider rounded-lg border border-white/10 bg-white/5 text-slate-300 flex items-center justify-center">
                                    Scenes Locked: {SCENE_COUNT}
                                </div>
                            </div>
                            {resolutionInfo && (
                                <div className={`text-[10px] rounded-lg px-3 py-2 border ${resolutionInfo.wasAdjusted
                                    ? 'text-cyan-200 bg-cyan-500/10 border-cyan-400/30'
                                    : 'text-slate-300 bg-white/5 border-white/10'
                                    }`}>
                                    Source: {resolutionInfo.sourceWidth}x{resolutionInfo.sourceHeight}
                                    {' -> '}
                                    Workflow: {resolutionInfo.targetWidth}x{resolutionInfo.targetHeight}
                                    {' '}({COMPAT_MULTIPLE}px grid)
                                </div>
                            )}
                            {strictPreserveScene && (
                                <div className="text-[10px] text-fuchsia-200/90 bg-fuchsia-500/10 border border-fuchsia-400/30 rounded-lg px-3 py-2">
                                    Strict mode lowers denoise and model strength to reduce invented objects and keep the original scene more intact.
                                </div>
                            )}
                            {lockSeedConsistency && seedStep === 0 && (
                                <div className="text-[10px] text-amber-200/90 bg-amber-500/10 border border-amber-400/30 rounded-lg px-3 py-2">
                                    Seed step is 0, so FEDDA auto-applies a per-angle offset ({MIN_PER_ANGLE_SEED_STEP}) to avoid identical outputs.
                                </div>
                            )}

                            <div className="grid grid-cols-3 gap-2">
                                <div className="col-span-2">
                                    <div className="text-[10px] text-slate-500 uppercase mb-1">Base Seed</div>
                                    <input
                                        type="number"
                                        value={baseSeed}
                                        onChange={(e) => setBaseSeed(parseInt(e.target.value || '0'))}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                                    />
                                </div>
                                <div>
                                    <div className="text-[10px] text-slate-500 uppercase mb-1">Seed Step</div>
                                    <input
                                        type="number"
                                        value={seedStep}
                                        onChange={(e) => setSeedStep(parseInt(e.target.value || '0'))}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                                    />
                                </div>
                            </div>

                            <button
                                onClick={() => setBaseSeed(Math.floor(Math.random() * 1000000000000000))}
                                className="w-full py-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold text-white"
                            >
                                Randomize Base Seed
                            </button>

                            <div>
                                <div className="text-[10px] text-slate-500 uppercase mb-1">Quality Mode</div>
                                <select
                                    value={qualityPreset}
                                    onChange={(e) => setQualityPreset(e.target.value as QualityPresetKey)}
                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                                >
                                    {(Object.keys(QUALITY_PRESETS) as QualityPresetKey[]).map((name) => (
                                        <option key={name} value={name}>{name}</option>
                                    ))}
                                </select>
                                <div className="mt-1 text-[10px] text-slate-600">
                                    {QUALITY_PRESETS[qualityPreset].steps} steps, cfg {QUALITY_PRESETS[qualityPreset].cfg}, {QUALITY_PRESETS[qualityPreset].sampler}
                                </div>
                            </div>
                        </CatalogCard>

                        <CatalogCard className="p-3">
                            <div className="grid grid-cols-3 gap-2">
                                {angles.map((angle, i) => (
                                    <button
                                        key={i}
                                        onClick={() => setSelectedAngle(i)}
                                        className={`flex flex-col items-center gap-1 p-2 rounded-xl border transition-all ${selectedAngle === i
                                            ? 'bg-white/10 border-white/30'
                                            : 'bg-[#121218] border-white/5 hover:border-white/15'
                                            }`}
                                    >
                                        <AngleCompass
                                            horizontal={angle.horizontal}
                                            vertical={angle.vertical}
                                            zoom={angle.zoom}
                                            size={40}
                                        />
                                        <span className="text-[9px] text-slate-400 font-medium truncate w-full text-center">
                                            {angle.label}
                                        </span>
                                        <span className="text-[8px] text-slate-600">{angle.horizontal} deg</span>
                                    </button>
                                ))}
                            </div>
                        </CatalogCard>

                        <CatalogCard className="p-5 shadow-xl space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-xs text-slate-400 uppercase tracking-wider font-bold">
                                    Angle {selectedAngle + 1}: {selected.label}
                                </h3>
                                <Camera className="w-3.5 h-3.5 text-slate-500" />
                            </div>

                            <div className="flex justify-center">
                                <AngleCompass
                                    horizontal={selected.horizontal}
                                    vertical={selected.vertical}
                                    zoom={selected.zoom}
                                    size={120}
                                    onClick={(h) => updateAngle(selectedAngle, { horizontal: h })}
                                />
                            </div>

                            <div className="grid grid-cols-4 gap-1.5">
                                {QUICK_PICKS.map((qp) => (
                                    <button
                                        key={qp.label}
                                        onClick={() => updateAngle(selectedAngle, { horizontal: qp.h, vertical: qp.v })}
                                        className={`py-1.5 text-[10px] font-bold rounded-lg transition-all ${selected.horizontal === qp.h && selected.vertical === qp.v
                                            ? 'bg-white text-black'
                                            : 'bg-white/5 text-slate-400 hover:bg-white/10 border border-white/5'
                                            }`}
                                    >
                                        {qp.label}
                                    </button>
                                ))}
                            </div>

                            <div className="space-y-3">
                                <div>
                                    <label className="flex justify-between text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                                        <span>Horizontal</span>
                                        <span>{selected.horizontal} deg</span>
                                    </label>
                                    <input
                                        type="range"
                                        min="0"
                                        max="359"
                                        value={selected.horizontal}
                                        onChange={(e) => updateAngle(selectedAngle, { horizontal: parseInt(e.target.value) })}
                                        className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                                    />
                                </div>

                                <div>
                                    <label className="flex justify-between text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                                        <span>Vertical</span>
                                        <span>{selected.vertical} deg</span>
                                    </label>
                                    <input
                                        type="range"
                                        min="-30"
                                        max="60"
                                        value={selected.vertical}
                                        onChange={(e) => updateAngle(selectedAngle, { vertical: parseInt(e.target.value) })}
                                        className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-400"
                                    />
                                </div>

                                <div>
                                    <label className="flex justify-between text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                                        <span>Zoom</span>
                                        <span>{selected.zoom}</span>
                                    </label>
                                    <input
                                        type="range"
                                        min="0"
                                        max="10"
                                        value={selected.zoom}
                                        onChange={(e) => updateAngle(selectedAngle, { zoom: parseInt(e.target.value) })}
                                        className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-400"
                                    />
                                </div>
                            </div>
                        </CatalogCard>

                        <button
                            onClick={handleGenerate}
                            disabled={isGenerating || !inputImage}
                            className="w-full py-3.5 bg-white text-black font-bold text-sm rounded-xl hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                        >
                            <Camera className="w-4 h-4" />
                            {isGenerating ? `Generating ${SCENE_COUNT} angles...` : `Generate all ${SCENE_COUNT} angles`}
                        </button>
                    </div>
                </>
            }
            rightPane={
                <div className="flex-1 p-5 overflow-y-auto custom-scrollbar">
                    <ImageGallery
                        generatedImages={generatedImages}
                        setGeneratedImages={setGeneratedImages}
                        isGenerating={isGenerating}
                        setIsGenerating={setIsGenerating}
                        galleryKey={modelId}
                    />
                </div>
            }
        />
    );
};





