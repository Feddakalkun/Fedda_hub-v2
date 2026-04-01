import { useState } from 'react';
import { X, ChevronRight, ImageIcon } from 'lucide-react';
import { Button } from '../ui/Button';
import { useComfyExecution } from '../../contexts/ComfyExecutionContext';
import { comfyService } from '../../services/comfyService';
import { GalleryModal } from '../GalleryModal';
import { useToast } from '../ui/Toast';
import { usePersistentState } from '../../hooks/usePersistentState';

type PresetTier = 'fast' | 'balanced' | 'quality';
type MotionPresetKey = 'hula-hoop' | 'jump-rope';
type MotionUseCase = 'general' | 'talking' | 'action' | 'product' | 'cinematic';

const PRESETS: Record<PresetTier, { label: string; description: string; steps: number; cfg: number; denoise: number }> = {
    fast: { label: 'Fast', description: 'Quick iterations', steps: 12, cfg: 4, denoise: 0.6 },
    balanced: { label: 'Balanced', description: 'Good quality + sound', steps: 20, cfg: 4, denoise: 0.6 },
    quality: { label: 'Quality', description: 'Best AV output', steps: 28, cfg: 4, denoise: 0.5 },
};

const MOTION_PRESETS: Record<MotionPresetKey, { label: string; prompt: string; negativeSuffix: string; denoise: number; steps: number; cfg: number }> = {
    'hula-hoop': {
        label: 'Hula Hoop Motion',
        prompt: 'Full-body performance, a person smoothly spins a hula hoop around the waist with rhythmic hip movement and natural arm balance. Keep anatomy stable, maintain subject identity, and keep camera mostly steady with subtle handheld micro-movement.',
        negativeSuffix: 'warped hoop, broken hoop geometry, disconnected hoop, extra limbs, duplicated arms, deformed hands, jittery body motion, identity drift',
        denoise: 0.62,
        steps: 20,
        cfg: 4.0,
    },
    'jump-rope': {
        label: 'Jump Rope Motion',
        prompt: 'Full-body athletic shot, a person performs jump rope with clear rope loops, synchronized foot hops, natural shoulder and wrist movement, realistic timing, and stable body proportions. Keep camera mostly fixed and subject centered.',
        negativeSuffix: 'warped rope, disconnected rope, missing rope loops, extra legs, extra arms, deformed hands, flickering rope, identity drift',
        denoise: 0.64,
        steps: 22,
        cfg: 4.2,
    },
};

const USE_CASE_PROFILES: Record<MotionUseCase, { label: string; positiveBlock: string; negativeBlock: string; stepsBias: number; cfgBias: number; denoiseBias: number }> = {
    general: {
        label: 'General Motion',
        positiveBlock: 'Keep motion natural and continuous, preserve subject identity and body proportions, keep temporal consistency frame-to-frame.',
        negativeBlock: 'identity drift, temporal inconsistency, jitter flicker, unstable anatomy',
        stepsBias: 0,
        cfgBias: 0,
        denoiseBias: 0,
    },
    talking: {
        label: 'Talking / Presenter',
        positiveBlock: 'Prioritize facial expression, lip articulation, subtle head nods, natural hand gestures, and stable torso movement.',
        negativeBlock: 'frozen face, rubber mouth, lip desync, exaggerated gestures, unstable eyes',
        stepsBias: 2,
        cfgBias: 0.2,
        denoiseBias: -0.04,
    },
    action: {
        label: 'Action / Exercise',
        positiveBlock: 'Prioritize full-body dynamics, clear limb trajectories, realistic momentum, and physically coherent movement arcs.',
        negativeBlock: 'motion stutter, broken limbs, duplicated body parts, disconnected props, impossible physics',
        stepsBias: 3,
        cfgBias: 0.1,
        denoiseBias: 0.06,
    },
    product: {
        label: 'Product Demo',
        positiveBlock: 'Keep object geometry locked and clean, emphasize controlled hand interaction, smooth pacing, and minimal camera drift.',
        negativeBlock: 'warped product, label deformation, shape drift, object morphing, unstable edges',
        stepsBias: 2,
        cfgBias: 0.3,
        denoiseBias: -0.06,
    },
    cinematic: {
        label: 'Cinematic',
        positiveBlock: 'Use intentional cinematic pacing, layered depth, controlled camera energy, and coherent lighting continuity.',
        negativeBlock: 'random camera spikes, exposure flicker, chaotic framing, temporal noise buildup',
        stepsBias: 4,
        cfgBias: 0.2,
        denoiseBias: 0.02,
    },
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const Ltx2I2vSoundTab = () => {
    const { queueWorkflow } = useComfyExecution();
    const { toast } = useToast();

    // Image
    const [sourceImage, setSourceImage] = useState<string | null>(null);
    const [sourceImageName, setSourceImageName] = useState<string | null>(null);
    const [showGalleryModal, setShowGalleryModal] = useState(false);

    // Parameters
    const [prompt, setPrompt] = usePersistentState('ltx2_i2vs_prompt', 'A woman talking with happy mood, natural body language and expressive gestures.');
    const [negativePrompt, setNegativePrompt] = usePersistentState('ltx2_i2vs_negative', 'blurry, low quality, still frame, watermark, overlay, titles, subtitles');
    const [motionUseCase, setMotionUseCase] = usePersistentState<MotionUseCase>('ltx2_i2vs_motion_use_case', 'general');
    const [preset, setPreset] = usePersistentState<PresetTier>('ltx2_i2vs_preset', 'balanced');
    const [duration, setDuration] = usePersistentState('ltx2_i2vs_duration', 8);
    const [steps, setSteps] = usePersistentState('ltx2_i2vs_steps', PRESETS.balanced.steps);
    const [cfg, setCfg] = usePersistentState('ltx2_i2vs_cfg', PRESETS.balanced.cfg);
    const [denoise, setDenoise] = usePersistentState('ltx2_i2vs_denoise', PRESETS.balanced.denoise);
    const [seed, setSeed] = usePersistentState('ltx2_i2vs_seed', -1);
    const [showAdvanced, setShowAdvanced] = usePersistentState('ltx2_i2vs_show_advanced', false);
    const [isGenerating, setIsGenerating] = useState(false);

    const targetFps = 24;
    const targetFrames = duration * targetFps;

    const applyPreset = (tier: PresetTier) => {
        setPreset(tier);
        setSteps(PRESETS[tier].steps);
        setCfg(PRESETS[tier].cfg);
        setDenoise(PRESETS[tier].denoise);
    };

    const applyMotionPreset = (key: MotionPresetKey) => {
        const presetData = MOTION_PRESETS[key];
        setMotionUseCase('action');
        setPrompt(presetData.prompt);
        setSteps(presetData.steps);
        setCfg(presetData.cfg);
        setDenoise(presetData.denoise);
        if (!negativePrompt.toLowerCase().includes(presetData.negativeSuffix.toLowerCase())) {
            const mergedNegative = negativePrompt.trim().length > 0
                ? `${negativePrompt}, ${presetData.negativeSuffix}`
                : presetData.negativeSuffix;
            setNegativePrompt(mergedNegative);
        }
        toast(`Applied ${presetData.label} preset`, 'success');
    };

    const buildTunedParams = () => {
        const profile = USE_CASE_PROFILES[motionUseCase];
        const promptLower = prompt.toLowerCase();
        const complexityHits = ['running', 'jump', 'dance', 'fight', 'spinning', 'hoop', 'rope', 'rapid', 'athletic']
            .filter((k) => promptLower.includes(k)).length;
        const durationBias = duration >= 10 ? 2 : duration >= 6 ? 1 : 0;
        const complexityBias = complexityHits >= 3 ? 2 : complexityHits >= 1 ? 1 : 0;
        const tunedSteps = clamp(Math.round(steps + profile.stepsBias + durationBias + complexityBias), 8, 50);
        const tunedCfg = clamp(Number((cfg + profile.cfgBias).toFixed(1)), 1, 10);
        const tunedDenoise = clamp(Number((denoise + profile.denoiseBias + (complexityBias > 0 ? 0.02 : 0)).toFixed(2)), 0.1, 1.0);
        return { tunedSteps, tunedCfg, tunedDenoise, profile };
    };

    const handleGenerate = async () => {
        if (!sourceImage) {
            toast('Please upload a source image', 'error');
            return;
        }

        setIsGenerating(true);
        try {
            // Upload source image
            let imageFilename = sourceImageName || 'source.png';
            if (sourceImage.startsWith('http') || sourceImage.startsWith('blob:')) {
                const imgRes = await fetch(sourceImage).catch(() => null);
                if (!imgRes) {
                    throw new Error('Failed to fetch source image. Re-select the image and try again (connection or browser blob URL issue).');
                }
                const blob = await imgRes.blob();
                const file = new File([blob], imageFilename, { type: blob.type });
                const uploadRes = await comfyService.uploadImage(file);
                imageFilename = uploadRes.name;
            }

            // Load LTX-2 I2V+Sound workflow
            const response = await fetch(`/workflows/LTX2img2vidsound.json?v=${Date.now()}`);
            if (!response.ok) throw new Error('Failed to load LTX-2 I2V+Sound workflow');
            const workflow = await response.json();

            const activeSeed = seed === -1 ? Math.floor(Math.random() * 1000000000000000) : seed;
            const runTag = Date.now().toString(36);
            const { tunedSteps, tunedCfg, tunedDenoise, profile } = buildTunedParams();
            if (tunedSteps !== steps) setSteps(tunedSteps);
            if (tunedCfg !== cfg) setCfg(tunedCfg);
            if (tunedDenoise !== denoise) setDenoise(tunedDenoise);

            const positivePrompt = [
                prompt,
                profile.positiveBlock,
                'Preserve identity, face, hairstyle, clothing, and scene geometry from the source image.',
            ].join('\n\n');
            const tunedNegativePrompt = `${negativePrompt}, ${profile.negativeBlock}, no camera zoom, no static frozen subject, random background-only motion, major composition drift`;

            // Remove HuggingFaceDownloader + ShowText nodes (we handle downloads separately)
            delete workflow['139'];
            delete workflow['143'];
            delete workflow['455'];

            // Remove orphan LTXVGemmaCLIPModelLoader (unused, causes errors)
            delete workflow['243'];

            // Node 240: LoadImage (source image)
            if (workflow['240']) workflow['240'].inputs.image = imageFilename;

            // Node 236: Positive prompt
            if (workflow['236']) workflow['236'].inputs.value = positivePrompt;

            // Node 237: Negative prompt
            if (workflow['237']) workflow['237'].inputs.text = tunedNegativePrompt;

            // Node 238: Duration in seconds
            if (workflow['238']) workflow['238'].inputs.value = duration;

            // Node 239: RandomNoise (seed - stage 1)
            if (workflow['239']) workflow['239'].inputs.noise_seed = activeSeed;

            // Node 389:373: RandomNoise (seed - stage 2 refinement)
            if (workflow['389:373']) workflow['389:373'].inputs.noise_seed = activeSeed + 1;

            // Node 310:296: RandomNoise (seed - upscale pass)
            if (workflow['310:296']) workflow['310:296'].inputs.noise_seed = activeSeed + 2;

            // Node 389:366: LTXVScheduler (steps - stage 1)
            if (workflow['389:366']) workflow['389:366'].inputs.steps = tunedSteps;

            // Node 389:367: CFGGuider (cfg - stage 1)
            if (workflow['389:367']) workflow['389:367'].inputs.cfg = tunedCfg;

            // Node 389:362: LTXVImgToVideoInplace (denoise strength)
            if (workflow['389:362']) workflow['389:362'].inputs.strength = tunedDenoise;

            // Node 281: VHS_VideoCombine (output filename)
            if (workflow['281']) workflow['281'].inputs.filename_prefix = `VIDEO/LTX2/I2VS_${runTag}`;

            // Node 468: SaveImage last frame
            if (workflow['468']) workflow['468'].inputs.filename_prefix = `VIDEO/LTX2/I2VS_LAST_${runTag}`;

            await queueWorkflow(workflow);
            toast('LTX-2 I2V + Sound queued!', 'success');
        } catch (error: any) {
            console.error('LTX-2 I2V+Sound generation failed:', error);
            const message = String(error?.message || 'Generation failed');
            if (message.toLowerCase().includes('failed to fetch')) {
                toast('Failed to fetch required resource. Check that Backend/ComfyUI are online and re-select the source image.', 'error');
            } else {
                toast(message, 'error');
            }
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <>
            <GalleryModal
                isOpen={showGalleryModal}
                onClose={() => setShowGalleryModal(false)}
                onSelect={(url, filename) => {
                    setSourceImage(url);
                    setSourceImageName(filename);
                    setShowGalleryModal(false);
                }}
            />

            <div className="space-y-5">
                {/* Source Image Upload */}
                <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-2">Source Image</label>
                    <div className="flex gap-2 mb-2">
                        <button
                            onClick={() => setShowGalleryModal(true)}
                            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[10px] text-slate-400 hover:text-white transition-colors"
                        >
                            From Gallery
                        </button>
                    </div>
                    <div
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                            e.preventDefault();
                            const file = e.dataTransfer.files[0];
                            if (file && file.type.startsWith('image/')) {
                                setSourceImage(URL.createObjectURL(file));
                                setSourceImageName(file.name);
                            }
                        }}
                        className={`relative border-2 border-dashed rounded-xl h-44 transition-all overflow-hidden ${
                            sourceImage ? 'border-white/20 bg-black' : 'border-white/10 hover:border-white/20 bg-white/[0.02]'
                        }`}
                    >
                        {sourceImage ? (
                            <>
                                <img src={sourceImage} alt="Source" className="w-full h-full object-contain" />
                                <button
                                    onClick={() => { setSourceImage(null); setSourceImageName(null); }}
                                    className="absolute top-2 right-2 p-1 bg-black/60 hover:bg-red-500/80 rounded-lg text-white/70 hover:text-white transition-colors"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </>
                        ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                                <ImageIcon className="w-8 h-8 text-slate-600" />
                                <p className="text-[10px] text-slate-600">Drop image or click to upload</p>
                            </div>
                        )}
                        <input
                            type="file" accept="image/*"
                            className="absolute inset-0 opacity-0 cursor-pointer"
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                    setSourceImage(URL.createObjectURL(file));
                                    setSourceImageName(file.name);
                                }
                            }}
                        />
                    </div>
                </div>

                {/* Prompt */}
                <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-2">Motion + Sound Prompt</label>
                    <p className="text-[10px] text-slate-600 mb-1.5">Describe motion, speech, and ambient sounds. LTX-2 generates synchronized audio.</p>
                    <div className="mb-2">
                        <label className="block text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1.5">Motion Use-Case</label>
                        <select
                            value={motionUseCase}
                            onChange={(e) => setMotionUseCase(e.target.value as MotionUseCase)}
                            className="w-full bg-[#0a0a0f] border border-white/10 rounded-md px-2 py-2 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-white/20"
                        >
                            {(Object.keys(USE_CASE_PROFILES) as MotionUseCase[]).map((key) => (
                                <option key={key} value={key}>{USE_CASE_PROFILES[key].label}</option>
                            ))}
                        </select>
                    </div>
                    <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="A woman talking with happy mood and saying..."
                        className="w-full h-24 bg-[#0a0a0f] border border-white/10 rounded-xl p-3 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-white/20 resize-none"
                    />
                    <div className="mt-2">
                        <div className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1.5">One-Click Motion Presets</div>
                        <div className="grid grid-cols-2 gap-2">
                            {(Object.keys(MOTION_PRESETS) as MotionPresetKey[]).map((key) => (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => applyMotionPreset(key)}
                                    className="px-2 py-2 rounded-lg text-xs border bg-black text-slate-300 border-white/10 hover:border-white/30 hover:text-white transition-colors"
                                >
                                    {MOTION_PRESETS[key].label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Preset Picker */}
                <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-2">Quality Preset</label>
                    <div className="flex gap-1 bg-black/40 rounded-lg p-1 border border-white/5">
                        {(Object.keys(PRESETS) as PresetTier[]).map((tier) => (
                            <button
                                key={tier}
                                onClick={() => applyPreset(tier)}
                                className={`flex-1 px-3 py-2 rounded-md text-xs font-medium transition-all ${
                                    preset === tier ? 'bg-white text-black' : 'text-slate-500 hover:text-white'
                                }`}
                            >
                                <div>{PRESETS[tier].label}</div>
                                <div className={`text-[9px] mt-0.5 ${preset === tier ? 'text-black/60' : 'text-slate-600'}`}>
                                    {PRESETS[tier].description}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Duration */}
                <div className="bg-[#0a0a0f] border border-white/10 rounded-xl p-4">
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                        <span>Duration</span>
                        <span className="text-white font-mono">{duration}s ({targetFrames} frames @ {targetFps}fps)</span>
                    </div>
                    <input
                        type="range" min="2" max="16" value={duration}
                        onChange={(e) => setDuration(parseInt(e.target.value))}
                        className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-white"
                    />
                </div>

                {/* Advanced Settings */}
                <div className="border border-white/5 rounded-xl overflow-hidden">
                    <button
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        className="w-full flex items-center justify-between p-3 bg-black/20 hover:bg-black/40 transition-colors text-xs font-medium text-slate-400 hover:text-white"
                    >
                        <span>Advanced Settings</span>
                        <ChevronRight className={`w-3 h-3 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} />
                    </button>
                    {showAdvanced && (
                        <div className="p-4 bg-[#0a0a0f] space-y-4">
                            <div>
                                <div className="flex justify-between text-xs text-slate-400 mb-1">
                                    <span>Steps</span>
                                    <span className="text-white font-mono">{steps}</span>
                                </div>
                                <input
                                    type="range" min="8" max="50" value={steps}
                                    onChange={(e) => setSteps(parseInt(e.target.value))}
                                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-white"
                                />
                            </div>
                            <div>
                                <div className="flex justify-between text-xs text-slate-400 mb-1">
                                    <span>CFG</span>
                                    <span className="text-white font-mono">{cfg.toFixed(1)}</span>
                                </div>
                                <input
                                    type="range" min="1" max="10" step="0.1" value={cfg}
                                    onChange={(e) => setCfg(parseFloat(e.target.value))}
                                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-white"
                                />
                            </div>
                            <div>
                                <div className="flex justify-between text-xs text-slate-400 mb-1">
                                    <span>Denoise Strength</span>
                                    <span className="text-white font-mono">{denoise.toFixed(2)}</span>
                                </div>
                                <input
                                    type="range" min="0.1" max="1.0" step="0.05" value={denoise}
                                    onChange={(e) => setDenoise(parseFloat(e.target.value))}
                                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-white"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Seed (-1 = random)</label>
                                <input
                                    type="number" value={seed}
                                    onChange={(e) => setSeed(parseInt(e.target.value))}
                                    className="w-full bg-black border border-white/5 rounded-lg p-2 text-xs font-mono text-slate-300 focus:outline-none focus:border-white/20"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Negative Prompt</label>
                                <textarea
                                    value={negativePrompt}
                                    onChange={(e) => setNegativePrompt(e.target.value)}
                                    className="w-full h-16 bg-black border border-white/5 rounded-lg p-2 text-[10px] text-slate-400 focus:outline-none focus:border-white/20 resize-none"
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Generate */}
                <Button
                    variant="primary"
                    size="lg"
                    className="w-full h-12"
                    onClick={handleGenerate}
                    isLoading={isGenerating}
                    disabled={isGenerating}
                >
                    {isGenerating ? 'Rendering...' : 'Generate Video + Sound'}
                </Button>
            </div>
        </>
    );
};
