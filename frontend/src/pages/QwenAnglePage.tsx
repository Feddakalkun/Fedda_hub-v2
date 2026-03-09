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

interface AngleConfig {
    horizontal: number;
    vertical: number;
    zoom: number;
    label: string;
}

// Node IDs per pipeline in the workflow
const PIPELINES = [
    { camera: '93', sampler: '197:108' },
    { camera: '218', sampler: '213:108' },
    { camera: '226', sampler: '221:108' },
    { camera: '234', sampler: '229:108' },
    { camera: '242', sampler: '237:108' },
    { camera: '250', sampler: '245:108' },
];

const PRESETS: Record<string, AngleConfig[]> = {
    'Character Sheet': [
        { horizontal: 0, vertical: 0, zoom: 5, label: 'Front' },
        { horizontal: 90, vertical: 0, zoom: 5, label: 'Right' },
        { horizontal: 180, vertical: 0, zoom: 5, label: 'Back' },
        { horizontal: 270, vertical: 0, zoom: 5, label: 'Left' },
        { horizontal: 45, vertical: 0, zoom: 5, label: '3/4 Right' },
        { horizontal: 0, vertical: 30, zoom: 1, label: 'Close-up' },
    ],
    'Product Spin': [
        { horizontal: 0, vertical: 15, zoom: 5, label: '0 deg' },
        { horizontal: 60, vertical: 15, zoom: 5, label: '60 deg' },
        { horizontal: 120, vertical: 15, zoom: 5, label: '120 deg' },
        { horizontal: 180, vertical: 15, zoom: 5, label: '180 deg' },
        { horizontal: 240, vertical: 15, zoom: 5, label: '240 deg' },
        { horizontal: 300, vertical: 15, zoom: 5, label: '300 deg' },
    ],
    'Dynamic Angles': [
        { horizontal: 90, vertical: 0, zoom: 5, label: 'Right' },
        { horizontal: 0, vertical: -30, zoom: 5, label: 'Low Front' },
        { horizontal: 0, vertical: 30, zoom: 5, label: 'High Front' },
        { horizontal: 135, vertical: 60, zoom: 5, label: "Bird's Eye" },
        { horizontal: 225, vertical: 0, zoom: 8, label: 'Wide Back Left' },
        { horizontal: 0, vertical: 30, zoom: 1, label: 'Close High' },
    ],
    'MLS Photoreal Clean': [
        { horizontal: 0, vertical: 2, zoom: 7, label: 'Front Hero' },
        { horizontal: 35, vertical: 4, zoom: 7, label: '3/4 Right' },
        { horizontal: 325, vertical: 4, zoom: 7, label: '3/4 Left' },
        { horizontal: 90, vertical: 2, zoom: 8, label: 'Right Side' },
        { horizontal: 270, vertical: 2, zoom: 8, label: 'Left Side' },
        { horizontal: 180, vertical: 3, zoom: 8, label: 'Rear' },
    ],
    'MLS Ultra Clean': [
        { horizontal: 0, vertical: 2, zoom: 8, label: 'Front Hero Wide' },
        { horizontal: 30, vertical: 3, zoom: 8, label: '3/4 Right Wide' },
        { horizontal: 330, vertical: 3, zoom: 8, label: '3/4 Left Wide' },
        { horizontal: 90, vertical: 2, zoom: 9, label: 'Right Side Wide' },
        { horizontal: 270, vertical: 2, zoom: 9, label: 'Left Side Wide' },
        { horizontal: 180, vertical: 3, zoom: 9, label: 'Rear Wide' },
    ],
};

const MLS_NEGATIVE_PROMPT = 'low quality, blurry, noisy, grainy, oversharpened, cgi, 3d render, cartoon, plastic texture, waxy walls, warped windows, distorted roof lines';
const MLS_ULTRA_NEGATIVE_PROMPT = 'low quality, blurry, noisy, grainy, oversharpened, cgi, 3d render, cartoon, anime, game render, plastic texture, waxy walls, fake grass, fake sky, warped windows, distorted roof lines, texture flicker, banding, halos';

const QUALITY_PRESETS = {
    Fast: { steps: 4, cfg: 1.0, scheduler: 'simple' },
    Balanced: { steps: 8, cfg: 1.2, scheduler: 'normal' },
    Quality: { steps: 12, cfg: 1.3, scheduler: 'normal' },
} as const;

type QualityPresetKey = keyof typeof QUALITY_PRESETS;

const QUICK_PICKS = [
    { label: 'Front', h: 0, v: 0 },
    { label: '3/4 R', h: 45, v: 0 },
    { label: 'Right', h: 90, v: 0 },
    { label: 'Back', h: 180, v: 0 },
    { label: '3/4 L', h: 315, v: 0 },
    { label: 'Left', h: 270, v: 0 },
    { label: 'Top', h: 0, v: 60 },
    { label: 'Low', h: 0, v: -30 },
];

function getAngleLabel(h: number, v: number, z: number): string {
    const dirs = ['Front', '3/4 R', 'Right', 'Back R', 'Back', 'Back L', 'Left', '3/4 L'];
    const idx = Math.round(((h % 360) / 360) * 8) % 8;
    let label = dirs[idx];

    if (v > 20) label += ' Hi';
    else if (v < -10) label += ' Lo';

    if (z <= 2) label = `Close ${label}`;
    else if (z >= 8) label = `Wide ${label}`;

    return label;
}

interface QwenAnglePageProps {
    modelId: string;
    modelLabel: string;
}

export const QwenAnglePage = ({ modelId }: QwenAnglePageProps) => {
    const { queueWorkflow } = useComfyExecution();
    const { toast } = useToast();

    const [isGenerating, setIsGenerating] = useState(false);
    const [selectedAngle, setSelectedAngle] = useState(0);
    const [inputImage, setInputImage] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [angles, setAngles] = useState<AngleConfig[]>(PRESETS['MLS Photoreal Clean']);
    const [incomingImageUrl, setIncomingImageUrl] = useState<string | null>(() => localStorage.getItem('qwen_input_image_url'));
    const [generatedImages, setGeneratedImages] = useState<string[]>(() => {
        const saved = localStorage.getItem(`gallery_${modelId}`);
        return saved ? JSON.parse(saved) : [];
    });
    const [lockSeedConsistency, setLockSeedConsistency] = usePersistentState('qwen_angle_lock_seed_consistency', true);
    const [baseSeed, setBaseSeed] = usePersistentState('qwen_angle_base_seed', Math.floor(Math.random() * 1000000000000000));
    const [seedStep, setSeedStep] = usePersistentState('qwen_angle_seed_step', 0);
    const [qualityPreset, setQualityPreset] = usePersistentState<QualityPresetKey>('qwen_angle_quality_preset', 'Quality');
    const [ultraCleanMode, setUltraCleanMode] = usePersistentState('qwen_angle_ultra_clean_mode', true);

    const handleImageSelected = (file: File) => {
        setInputImage(file);
        setPreviewUrl(URL.createObjectURL(file));
        setIncomingImageUrl(null);
        try { localStorage.removeItem('qwen_input_image_url'); } catch { /* ignore */ }
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
        setSeedStep(0);
        setQualityPreset('Quality');
        setUltraCleanMode(false);
        toast('Applied MLS Photoreal Clean preset', 'success');
    };

    const applyMlsUltraClean = () => {
        applyPreset('MLS Ultra Clean');
        setLockSeedConsistency(true);
        setSeedStep(0);
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
            const uploaded = await comfyService.uploadImage(inputImage);
            const response = await fetch('/workflows/qwen-multiangle.json');
            if (!response.ok) throw new Error('Failed to load qwen-multiangle workflow');

            const workflow = await response.json();
            const quality = QUALITY_PRESETS[qualityPreset];

            // Node 41 is the input image for this workflow.
            workflow['41'].inputs.image = uploaded.name;

            // Set each pipeline's camera config and seed strategy.
            PIPELINES.forEach((pipe, i) => {
                const angle = angles[i];
                workflow[pipe.camera].inputs.horizontal_angle = angle.horizontal;
                workflow[pipe.camera].inputs.vertical_angle = angle.vertical;
                workflow[pipe.camera].inputs.zoom = angle.zoom;
                workflow[pipe.sampler].inputs.seed = lockSeedConsistency
                    ? (baseSeed + (i * seedStep))
                    : Math.floor(Math.random() * 1000000000000000);
                workflow[pipe.sampler].inputs.steps = quality.steps;
                workflow[pipe.sampler].inputs.cfg = quality.cfg;
                workflow[pipe.sampler].inputs.scheduler = quality.scheduler;

                const samplerPrefix = pipe.sampler.split(':')[0];
                const negativePromptNode = workflow[`${samplerPrefix}:109`];
                if (negativePromptNode?.inputs) {
                    negativePromptNode.inputs.prompt = ultraCleanMode ? MLS_ULTRA_NEGATIVE_PROMPT : MLS_NEGATIVE_PROMPT;
                }
            });

            await queueWorkflow(workflow);
            toast('Generating 6 camera angles', 'success');
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

                    <div className="mt-4 space-y-4">
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
                                    {QUALITY_PRESETS[qualityPreset].steps} steps, cfg {QUALITY_PRESETS[qualityPreset].cfg}
                                </div>
                            </div>
                        </CatalogCard>

                        <CatalogCard className="p-3">
                            <div className="grid grid-cols-3 gap-2">
                                {angles.map((angle, i) => (
                                    <button
                                        key={i}
                                        onClick={() => setSelectedAngle(i)}
                                        className={`flex flex-col items-center gap-1 p-2 rounded-xl border transition-all ${
                                            selectedAngle === i
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
                                        className={`py-1.5 text-[10px] font-bold rounded-lg transition-all ${
                                            selected.horizontal === qp.h && selected.vertical === qp.v
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
                            {isGenerating ? 'Generating 6 angles...' : 'Generate all 6 angles'}
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





