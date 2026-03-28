import { useState } from 'react';
import { Camera, Sparkles } from 'lucide-react';
import { comfyService } from '../services/comfyService';
import { useComfyExecution } from '../contexts/ComfyExecutionContext';
import { useToast } from '../components/ui/Toast';
import { usePersistentState } from '../hooks/usePersistentState';
import { WorkbenchShell } from '../components/layout/WorkbenchShell';
import { CatalogCard } from '../components/layout/CatalogShell';
import { ImageGallery } from '../components/image/ImageGallery';
import { ImageUpload } from '../components/image/ImageUpload';
import { AngleCompass } from '../components/image/AngleCompass';
import { PRESETS, QUICK_PICKS, getAngleLabel, type AngleConfig } from '../config/anglePresets';

interface Flux2KleinPageProps {
    modelId: string;
    modelLabel: string;
}

type Flux2KleinMode =
    | 'flux2klein-txt2img9b'
    | 'flux2klein-image-edit'
    | 'flux2klein-2-referenceimg'
    | 'flux2klein-multiangle';

interface WorkflowSpec {
    path: string;
    promptNode?: string;
    promptNodes?: string[];
    negativePromptNode?: string;
    styleNode?: string;
    stepsNode?: string;
    stepsNodes?: string[];
    cfgNode?: string;
    cfgNodes?: string[];
    seedNode?: string;
    seedNodes?: string[];
    aspectNode?: string;
    requiredImageNodes: string[];
}

const WORKFLOW_MAP: Record<Flux2KleinMode, WorkflowSpec> = {
    'flux2klein-txt2img9b': {
        path: '/workflows/FLUX2KLEIN-txt2img.json',
        promptNode: '180',
        negativePromptNode: '205:189',
        styleNode: '202',
        stepsNode: '204',
        cfgNode: '205:185',
        seedNode: '192',
        aspectNode: '199',
        requiredImageNodes: [],
    },
    'flux2klein-image-edit': {
        path: '/workflows/FLUX2KLEIN-image-edit.json',
        promptNode: '221',
        styleNode: '222',
        stepsNode: '225',
        cfgNode: '226:215',
        seedNode: '228',
        aspectNode: '223',
        requiredImageNodes: ['113'],
    },
    'flux2klein-2-referenceimg': {
        path: '/workflows/FLUX2KLEIN-2-referenceimg.json',
        promptNode: '251',
        styleNode: '248',
        stepsNode: '250',
        cfgNode: '254:231',
        seedNode: '249',
        aspectNode: '247',
        requiredImageNodes: ['111', '112'],
    },
    'flux2klein-multiangle': {
        path: '/workflows/FLUX2KLEIN-multiangle.json',
        stepsNodes: ['163:62', '328:62', '330:62', '332:62', '334:62', '336:62'],
        cfgNodes: ['163:63', '328:63', '330:63', '332:63', '334:63', '336:63'],
        seedNodes: ['163:73', '328:73', '330:73', '332:73', '334:73', '336:73'],
        requiredImageNodes: ['161'],
    },
};

const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'];
const FLUX2K_MULTIANGLE_CAMERA_NODES = ['291', '322', '323', '324', '325', '326'];

export const Flux2KleinPage = ({ modelId, modelLabel }: Flux2KleinPageProps) => {
    const { queueWorkflow } = useComfyExecution();
    const { toast } = useToast();
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedImages, setGeneratedImages] = useState<string[]>(() => {
        const saved = localStorage.getItem(`gallery_${modelId}`);
        return saved ? JSON.parse(saved) : [];
    });

    const [prompt, setPrompt] = usePersistentState('flux2klein_prompt', 'portrait');
    const [negativePrompt, setNegativePrompt] = usePersistentState('flux2klein_negative', '');
    const [style, setStyle] = usePersistentState('flux2klein_style', 'Painting | Digital');
    const [steps, setSteps] = usePersistentState('flux2klein_steps', 7);
    const [cfg, setCfg] = usePersistentState('flux2klein_cfg', 4.0);
    const [seed, setSeed] = usePersistentState('flux2klein_seed', Math.floor(Math.random() * 1000000000000000));
    const [aspectRatio, setAspectRatio] = usePersistentState('flux2klein_aspect', '1:1');
    const [lockSeed, setLockSeed] = usePersistentState('flux2klein_lock_seed', true);

    const [imageA, setImageA] = useState<File | null>(null);
    const [previewA, setPreviewA] = useState<string | null>(null);
    const [imageB, setImageB] = useState<File | null>(null);
    const [previewB, setPreviewB] = useState<string | null>(null);
    const [selectedAngle, setSelectedAngle] = useState(0);
    const [multiAngles, setMultiAngles] = useState<AngleConfig[]>(
        PRESETS['Dynamic Angles'].map((angle) => ({ ...angle }))
    );

    const mode = (modelId in WORKFLOW_MAP ? modelId : 'flux2klein-txt2img9b') as Flux2KleinMode;
    const spec = WORKFLOW_MAP[mode];
    const supportsPrompt = Boolean(spec.promptNode || spec.promptNodes);
    const supportsStyle = Boolean(spec.styleNode);
    const supportsAspect = Boolean(spec.aspectNode);
    const supportsNegativePrompt = Boolean(spec.negativePromptNode);
    const requiresOneImage = spec.requiredImageNodes.length === 1;
    const requiresTwoImages = spec.requiredImageNodes.length === 2;
    const isMultiAngleMode = mode === 'flux2klein-multiangle';
    const selectedMultiAngle = multiAngles[selectedAngle] || multiAngles[0];

    const clearImageA = () => {
        setImageA(null);
        if (previewA) URL.revokeObjectURL(previewA);
        setPreviewA(null);
    };
    const clearImageB = () => {
        setImageB(null);
        if (previewB) URL.revokeObjectURL(previewB);
        setPreviewB(null);
    };

    const uploadRequiredImages = async (workflow: Record<string, any>) => {
        if (requiresOneImage || requiresTwoImages) {
            if (!imageA) {
                throw new Error('Reference image 1 is required for this workflow');
            }
            const uploadedA = await comfyService.uploadImage(imageA);
            workflow[spec.requiredImageNodes[0]].inputs.image = uploadedA.name;
        }
        if (requiresTwoImages) {
            if (!imageB) {
                throw new Error('Reference image 2 is required for this workflow');
            }
            const uploadedB = await comfyService.uploadImage(imageB);
            workflow[spec.requiredImageNodes[1]].inputs.image = uploadedB.name;
        }
    };

    const updateAngle = (index: number, patch: Partial<AngleConfig>) => {
        setMultiAngles((prev) =>
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

    const applyCameraPreset = (presetName: keyof typeof PRESETS) => {
        setMultiAngles(PRESETS[presetName].map((angle) => ({ ...angle })));
        setSelectedAngle(0);
        toast(`Applied camera preset: ${presetName}`, 'success');
    };

    const handleGenerate = async () => {
        try {
            setIsGenerating(true);
            const response = await fetch(spec.path);
            if (!response.ok) {
                throw new Error(`Failed to load workflow: ${spec.path}`);
            }

            const workflow = await response.json();
            const sanitizedWorkflow = Object.fromEntries(
                Object.entries(workflow).filter(([, node]: any) => node && typeof node === 'object' && node.class_type)
            ) as Record<string, any>;
            const activeSeed = lockSeed ? seed : Math.floor(Math.random() * 1000000000000000);

            await uploadRequiredImages(sanitizedWorkflow);

            if (isMultiAngleMode) {
                FLUX2K_MULTIANGLE_CAMERA_NODES.forEach((nodeId, idx) => {
                    const angle = multiAngles[idx];
                    if (!angle || !sanitizedWorkflow[nodeId]?.inputs) return;
                    sanitizedWorkflow[nodeId].inputs.horizontal_angle = angle.horizontal;
                    sanitizedWorkflow[nodeId].inputs.vertical_angle = angle.vertical;
                    sanitizedWorkflow[nodeId].inputs.zoom = angle.zoom;
                });
            }

            if (spec.promptNode && sanitizedWorkflow[spec.promptNode]?.inputs) {
                sanitizedWorkflow[spec.promptNode].inputs.value = prompt;
            }
            if (spec.promptNodes) {
                for (const nodeId of spec.promptNodes) {
                    if (sanitizedWorkflow[nodeId]?.inputs) {
                        sanitizedWorkflow[nodeId].inputs.value = prompt;
                    }
                }
            }
            if (spec.negativePromptNode && sanitizedWorkflow[spec.negativePromptNode]?.inputs) {
                sanitizedWorkflow[spec.negativePromptNode].inputs.text = negativePrompt;
            }
            if (spec.styleNode && sanitizedWorkflow[spec.styleNode]?.inputs) {
                sanitizedWorkflow[spec.styleNode].inputs.styles = style;
            }
            if (spec.stepsNode && sanitizedWorkflow[spec.stepsNode]?.inputs) {
                sanitizedWorkflow[spec.stepsNode].inputs.value = Math.max(1, Math.min(50, steps));
            }
            if (spec.stepsNodes) {
                for (const nodeId of spec.stepsNodes) {
                    if (sanitizedWorkflow[nodeId]?.inputs) {
                        sanitizedWorkflow[nodeId].inputs.steps = Math.max(1, Math.min(50, steps));
                    }
                }
            }
            if (spec.cfgNode && sanitizedWorkflow[spec.cfgNode]?.inputs) {
                sanitizedWorkflow[spec.cfgNode].inputs.cfg = Math.max(1, Math.min(12, cfg));
            }
            if (spec.cfgNodes) {
                for (const nodeId of spec.cfgNodes) {
                    if (sanitizedWorkflow[nodeId]?.inputs) {
                        sanitizedWorkflow[nodeId].inputs.cfg = Math.max(1, Math.min(12, cfg));
                    }
                }
            }
            if (spec.seedNode && sanitizedWorkflow[spec.seedNode]?.inputs) {
                sanitizedWorkflow[spec.seedNode].inputs.noise_seed = activeSeed;
            }
            if (spec.seedNodes) {
                for (const nodeId of spec.seedNodes) {
                    if (sanitizedWorkflow[nodeId]?.inputs) {
                        sanitizedWorkflow[nodeId].inputs.noise_seed = activeSeed;
                    }
                }
            }
            if (spec.aspectNode && sanitizedWorkflow[spec.aspectNode]?.inputs) {
                sanitizedWorkflow[spec.aspectNode].inputs.aspect_ratio = aspectRatio;
            }

            await queueWorkflow(sanitizedWorkflow);
            toast(`Queued ${modelLabel}`, 'success');
        } catch (error: any) {
            console.error('FLUX2KLEIN generation failed:', error);
            toast(error?.message || 'Generation failed', 'error');
            setIsGenerating(false);
        }
    };

    return (
        <WorkbenchShell
            leftWidthClassName="w-[500px]"
            leftPaneClassName="p-4"
            leftPane={
                <div className="px-4 mt-4 space-y-4">
                    {(requiresOneImage || requiresTwoImages) && (
                        <CatalogCard className="p-5 shadow-xl space-y-3">
                            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Reference Images</div>
                            <ImageUpload
                                onImageSelected={(file) => { setImageA(file); setPreviewA(URL.createObjectURL(file)); }}
                                previewUrl={previewA}
                                onClear={clearImageA}
                                label={requiresTwoImages ? 'Reference Image A' : 'Reference Image'}
                            />
                            {requiresTwoImages && (
                                <ImageUpload
                                    onImageSelected={(file) => { setImageB(file); setPreviewB(URL.createObjectURL(file)); }}
                                    previewUrl={previewB}
                                    onClear={clearImageB}
                                    label="Reference Image B"
                                />
                            )}
                        </CatalogCard>
                    )}

                    {isMultiAngleMode && (
                        <>
                            <CatalogCard className="p-3 space-y-2">
                                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Camera Modes</div>
                                <div className="grid grid-cols-2 gap-2">
                                    {(['Character Sheet', 'Product Spin', 'Dynamic Angles', 'MLS Photoreal Clean', 'MLS Ultra Clean'] as (keyof typeof PRESETS)[]).map((presetName) => (
                                        <button
                                            key={presetName}
                                            onClick={() => applyCameraPreset(presetName)}
                                            className="py-2 text-[10px] font-bold uppercase tracking-wider rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10"
                                        >
                                            {presetName}
                                        </button>
                                    ))}
                                </div>
                            </CatalogCard>

                            <CatalogCard className="p-3">
                                <div className="grid grid-cols-3 gap-2">
                                    {multiAngles.map((angle, i) => (
                                        <button
                                            key={`${angle.label}_${i}`}
                                            onClick={() => setSelectedAngle(i)}
                                            className={`flex flex-col items-center gap-1 p-2 rounded-xl border transition-all ${selectedAngle === i
                                                ? 'bg-white/10 border-white/30'
                                                : 'bg-[#121218] border-white/5 hover:border-white/15'
                                                }`}
                                        >
                                            <AngleCompass horizontal={angle.horizontal} vertical={angle.vertical} zoom={angle.zoom} size={40} />
                                            <span className="text-[9px] text-slate-400 font-medium truncate w-full text-center">
                                                {angle.label}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </CatalogCard>

                            {selectedMultiAngle && (
                                <CatalogCard className="p-5 shadow-xl space-y-4">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-xs text-slate-400 uppercase tracking-wider font-bold">
                                            Angle {selectedAngle + 1}: {selectedMultiAngle.label}
                                        </h3>
                                        <Camera className="w-3.5 h-3.5 text-slate-500" />
                                    </div>

                                    <div className="flex justify-center">
                                        <AngleCompass
                                            horizontal={selectedMultiAngle.horizontal}
                                            vertical={selectedMultiAngle.vertical}
                                            zoom={selectedMultiAngle.zoom}
                                            size={120}
                                            onClick={(h) => updateAngle(selectedAngle, { horizontal: h })}
                                        />
                                    </div>

                                    <div className="grid grid-cols-4 gap-1.5">
                                        {QUICK_PICKS.map((qp) => (
                                            <button
                                                key={qp.label}
                                                onClick={() => updateAngle(selectedAngle, { horizontal: qp.h, vertical: qp.v })}
                                                className={`py-1.5 text-[10px] font-bold rounded-lg transition-all ${selectedMultiAngle.horizontal === qp.h && selectedMultiAngle.vertical === qp.v
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
                                                <span>{selectedMultiAngle.horizontal} deg</span>
                                            </label>
                                            <input
                                                type="range"
                                                min="0"
                                                max="359"
                                                value={selectedMultiAngle.horizontal}
                                                onChange={(e) => updateAngle(selectedAngle, { horizontal: parseInt(e.target.value, 10) })}
                                                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                                            />
                                        </div>

                                        <div>
                                            <label className="flex justify-between text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                                                <span>Vertical</span>
                                                <span>{selectedMultiAngle.vertical} deg</span>
                                            </label>
                                            <input
                                                type="range"
                                                min="-30"
                                                max="60"
                                                value={selectedMultiAngle.vertical}
                                                onChange={(e) => updateAngle(selectedAngle, { vertical: parseInt(e.target.value, 10) })}
                                                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-400"
                                            />
                                        </div>

                                        <div>
                                            <label className="flex justify-between text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                                                <span>Zoom</span>
                                                <span>{selectedMultiAngle.zoom}</span>
                                            </label>
                                            <input
                                                type="range"
                                                min="0"
                                                max="10"
                                                value={selectedMultiAngle.zoom}
                                                onChange={(e) => updateAngle(selectedAngle, { zoom: parseInt(e.target.value, 10) })}
                                                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-400"
                                            />
                                        </div>
                                    </div>
                                </CatalogCard>
                            )}
                        </>
                    )}

                    <CatalogCard className="p-5 shadow-xl space-y-3">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                            {modelLabel}
                        </div>
                        {supportsPrompt && (
                            <div>
                                <label className="block text-[10px] text-slate-500 uppercase mb-1">Prompt</label>
                                <textarea
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    className="w-full h-28 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                                />
                            </div>
                        )}
                        {supportsNegativePrompt && (
                            <div>
                                <label className="block text-[10px] text-slate-500 uppercase mb-1">Negative Prompt</label>
                                <textarea
                                    value={negativePrompt}
                                    onChange={(e) => setNegativePrompt(e.target.value)}
                                    className="w-full h-20 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                                />
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="block text-[10px] text-slate-500 uppercase mb-1">Steps</label>
                                <input
                                    type="number"
                                    min={1}
                                    max={50}
                                    value={steps}
                                    onChange={(e) => setSteps(parseInt(e.target.value || '1', 10))}
                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] text-slate-500 uppercase mb-1">CFG</label>
                                <input
                                    type="number"
                                    min={1}
                                    max={12}
                                    step={0.1}
                                    value={cfg}
                                    onChange={(e) => setCfg(parseFloat(e.target.value || '1'))}
                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            {supportsAspect && (
                                <div>
                                    <label className="block text-[10px] text-slate-500 uppercase mb-1">Aspect Ratio</label>
                                    <select
                                        value={aspectRatio}
                                        onChange={(e) => setAspectRatio(e.target.value)}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                                    >
                                        {ASPECT_RATIOS.map((ratio) => (
                                            <option key={ratio} value={ratio}>{ratio}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            {supportsStyle && (
                                <div>
                                    <label className="block text-[10px] text-slate-500 uppercase mb-1">Style Preset</label>
                                    <input
                                        type="text"
                                        value={style}
                                        onChange={(e) => setStyle(e.target.value)}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                                    />
                                </div>
                            )}
                        </div>
                    </CatalogCard>

                    <CatalogCard className="p-4 space-y-2">
                        <div className="flex items-center justify-between">
                            <div className="text-[10px] text-slate-500 uppercase">Seed</div>
                            <label className="flex items-center gap-2 text-xs text-slate-400">
                                <input
                                    type="checkbox"
                                    checked={lockSeed}
                                    onChange={(e) => setLockSeed(e.target.checked)}
                                    className="rounded border-white/20 bg-black/40"
                                />
                                Lock Seed
                            </label>
                        </div>
                        <input
                            type="number"
                            value={seed}
                            onChange={(e) => setSeed(parseInt(e.target.value || '0', 10))}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                        />
                        <button
                            onClick={() => setSeed(Math.floor(Math.random() * 1000000000000000))}
                            className="w-full py-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold text-white"
                        >
                            Randomize Seed
                        </button>
                    </CatalogCard>

                    <button
                        onClick={handleGenerate}
                        disabled={isGenerating || (supportsPrompt && !prompt.trim())}
                        className="w-full py-3.5 bg-white text-black font-bold text-sm rounded-xl hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                    >
                        <Sparkles className="w-4 h-4" />
                        {isGenerating ? 'Generating...' : 'Generate FLUX2KLEIN'}
                    </button>
                </div>
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
