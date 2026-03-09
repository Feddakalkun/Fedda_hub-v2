import { useEffect, useState } from 'react';
import { Camera, Building2 } from 'lucide-react';
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
    'Street Hero 6-Pack': [
        { horizontal: 0, vertical: 8, zoom: 5, label: 'Front Hero' },
        { horizontal: 35, vertical: 8, zoom: 5, label: 'Front 3/4 Right' },
        { horizontal: 325, vertical: 8, zoom: 5, label: 'Front 3/4 Left' },
        { horizontal: 90, vertical: 8, zoom: 5, label: 'Right Side' },
        { horizontal: 270, vertical: 8, zoom: 5, label: 'Left Side' },
        { horizontal: 180, vertical: 8, zoom: 5, label: 'Back Yard' },
    ],
    'Twilight Listing Set': [
        { horizontal: 0, vertical: 8, zoom: 5, label: 'Front Twilight' },
        { horizontal: 30, vertical: 8, zoom: 5, label: 'Front 3/4 Warm' },
        { horizontal: 330, vertical: 8, zoom: 5, label: 'Front 3/4 Cool' },
        { horizontal: 90, vertical: 10, zoom: 5, label: 'Side Lit' },
        { horizontal: 270, vertical: 10, zoom: 5, label: 'Side Lit 2' },
        { horizontal: 180, vertical: 10, zoom: 5, label: 'Back Twilight' },
    ],
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
};

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

const IDENTITY_LOCK_PROMPT = 'same exact property identity, same architecture, same facade materials, same windows and doors, same roof shape and color, same landscaping footprint, only camera angle changes';

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
    const [angles, setAngles] = useState<AngleConfig[]>(PRESETS['Street Hero 6-Pack']);
    const [incomingImageUrl, setIncomingImageUrl] = useState<string | null>(() => localStorage.getItem('qwen_input_image_url'));
    const [generatedImages, setGeneratedImages] = useState<string[]>(() => {
        const saved = localStorage.getItem(`gallery_${modelId}`);
        return saved ? JSON.parse(saved) : [];
    });

    const [lockSeedConsistency, setLockSeedConsistency] = usePersistentState('qwen_angle_lock_seed_consistency', true);
    const [baseSeed, setBaseSeed] = usePersistentState('qwen_angle_base_seed', Math.floor(Math.random() * 1000000000000000));
    const [seedStep, setSeedStep] = usePersistentState('qwen_angle_seed_step', 0);

    const [brokerMode, setBrokerMode] = usePersistentState('qwen_angle_broker_mode', true);
    const [preserveArchitectureIdentity, setPreserveArchitectureIdentity] = usePersistentState('qwen_angle_identity_lock', true);
    const [styleBrief, setStyleBrief] = usePersistentState(
        'qwen_angle_style_brief',
        'premium real estate listing photo, clean lines, natural daylight, photoreal, MLS-ready composition'
    );

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

    const applyBrokerDefaults = () => {
        setBrokerMode(true);
        setLockSeedConsistency(true);
        setSeedStep(0);
        applyPreset('Street Hero 6-Pack');
        toast('Broker defaults applied: strict consistency + street hero angles', 'success');
    };

    const buildGlobalInstruction = (): string => {
        const base = brokerMode
            ? 'real estate listing photography, photoreal, high-detail, straight verticals, professional composition'
            : 'photoreal reference-preserving view generation';

        const identity = preserveArchitectureIdentity ? IDENTITY_LOCK_PROMPT : '';
        return [base, styleBrief.trim(), identity].filter(Boolean).join(', ');
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

            // Node 41 is the input image for this workflow.
            workflow['41'].inputs.image = uploaded.name;

            const effectiveLock = brokerMode ? true : lockSeedConsistency;
            const effectiveSeedStep = brokerMode ? 0 : seedStep;
            const globalInstruction = buildGlobalInstruction();

            // Set each pipeline's camera config and seed strategy.
            PIPELINES.forEach((pipe, i) => {
                const angle = angles[i];
                workflow[pipe.camera].inputs.horizontal_angle = angle.horizontal;
                workflow[pipe.camera].inputs.vertical_angle = angle.vertical;
                workflow[pipe.camera].inputs.zoom = angle.zoom;
                workflow[pipe.sampler].inputs.seed = effectiveLock
                    ? (baseSeed + (i * effectiveSeedStep))
                    : Math.floor(Math.random() * 1000000000000000);
            });

            // Inject shared instruction on all editable text encoder nodes with string prompt.
            Object.values(workflow).forEach((node: any) => {
                if (node?.class_type !== 'TextEncodeQwenImageEditPlus') return;
                if (!node.inputs || typeof node.inputs.prompt !== 'string') return;
                node.inputs.prompt = globalInstruction;
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
            leftWidthClassName="w-[520px]"
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

                        <CatalogCard className="p-4 space-y-3 border border-emerald-500/20">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Building2 className="w-4 h-4 text-emerald-400" />
                                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-300">Broker Mode</div>
                                </div>
                                <label className="flex items-center gap-2 text-xs text-slate-400">
                                    <input
                                        type="checkbox"
                                        checked={brokerMode}
                                        onChange={(e) => setBrokerMode(e.target.checked)}
                                        className="rounded border-white/20 bg-black/40"
                                    />
                                    ON
                                </label>
                            </div>

                            <label className="flex items-center gap-2 text-xs text-slate-400">
                                <input
                                    type="checkbox"
                                    checked={preserveArchitectureIdentity}
                                    onChange={(e) => setPreserveArchitectureIdentity(e.target.checked)}
                                    className="rounded border-white/20 bg-black/40"
                                />
                                Preserve Architecture Identity
                            </label>

                            <div>
                                <div className="text-[10px] text-slate-500 uppercase mb-1">Style Brief</div>
                                <textarea
                                    value={styleBrief}
                                    onChange={(e) => setStyleBrief(e.target.value)}
                                    rows={3}
                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                                />
                            </div>

                            <button
                                onClick={applyBrokerDefaults}
                                className="w-full py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-xs font-semibold text-emerald-300"
                            >
                                Apply Broker Defaults
                            </button>
                        </CatalogCard>

                        <CatalogCard className="p-3">
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
