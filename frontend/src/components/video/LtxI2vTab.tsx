import { useEffect, useMemo, useState } from 'react';
import { X, ChevronRight, ImageIcon } from 'lucide-react';
import { Button } from '../ui/Button';
import { useComfyExecution } from '../../contexts/ComfyExecutionContext';
import { comfyService } from '../../services/comfyService';
import { GalleryModal } from '../GalleryModal';
import { useToast } from '../ui/Toast';
import { usePersistentState } from '../../hooks/usePersistentState';
import { BACKEND_API } from '../../config/api';

type PresetTier = 'fast' | 'balanced' | 'quality';
type ModelBackendType = 'safetensors' | 'gguf';
type ImageDims = { width: number; height: number };
type MotionPresetKey = 'hula-hoop' | 'jump-rope';
type MotionUseCase = 'general' | 'talking' | 'action' | 'product' | 'cinematic';

const PRESETS: Record<PresetTier, { label: string; description: string; steps: number; cfg: number; denoise: number; longEdge: number; fps: number }> = {
    fast: { label: 'Fast', description: 'Quick iterations, lower cost', steps: 12, cfg: 3.6, denoise: 0.65, longEdge: 768, fps: 16 },
    balanced: { label: 'Balanced', description: 'Good quality, medium speed', steps: 18, cfg: 4.0, denoise: 0.6, longEdge: 1024, fps: 20 },
    quality: { label: 'Quality', description: 'Best detail, slowest render', steps: 28, cfg: 4.0, denoise: 0.55, longEdge: 1408, fps: 24 },
};

const MOTION_PRESETS: Record<MotionPresetKey, { label: string; prompt: string; negativeSuffix: string; denoise: number; steps: number; cfg: number }> = {
    'hula-hoop': {
        label: 'Hula Hoop Motion',
        prompt: 'Full-body performance, a person smoothly spins a hula hoop around the waist with rhythmic hip movement and natural arm balance. Keep anatomy stable, maintain subject identity, and keep camera mostly steady with subtle handheld micro-movement.',
        negativeSuffix: 'warped hoop, broken hoop geometry, disconnected hoop, extra limbs, duplicated arms, deformed hands, jittery body motion, identity drift',
        denoise: 0.62,
        steps: 18,
        cfg: 4.0,
    },
    'jump-rope': {
        label: 'Jump Rope Motion',
        prompt: 'Full-body athletic shot, a person performs jump rope with clear rope loops, synchronized foot hops, natural shoulder and wrist movement, realistic timing, and stable body proportions. Keep camera mostly fixed and subject centered.',
        negativeSuffix: 'warped rope, disconnected rope, missing rope loops, extra legs, extra arms, deformed hands, flickering rope, identity drift',
        denoise: 0.64,
        steps: 20,
        cfg: 4.1,
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

const RES_MULTIPLE = 32;

const snapToMultiple = (value: number, multiple: number) => Math.max(multiple, Math.round(value / multiple) * multiple);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const getAutoResolution = (dims: ImageDims | null, longEdge: number): ImageDims => {
    if (!dims || !dims.width || !dims.height) return { width: 960, height: 544 };
    const aspect = dims.width / dims.height;
    if (aspect >= 1) {
        const width = snapToMultiple(longEdge, RES_MULTIPLE);
        const height = snapToMultiple(longEdge / aspect, RES_MULTIPLE);
        return { width, height };
    }
    const height = snapToMultiple(longEdge, RES_MULTIPLE);
    const width = snapToMultiple(longEdge * aspect, RES_MULTIPLE);
    return { width, height };
};

export const LtxI2vTab = () => {
    const { queueWorkflow } = useComfyExecution();
    const { toast } = useToast();

    // Image
    const [sourceImage, setSourceImage] = useState<string | null>(null);
    const [sourceImageName, setSourceImageName] = useState<string | null>(null);
    const [sourceDims, setSourceDims] = useState<ImageDims | null>(null);
    const [showGalleryModal, setShowGalleryModal] = useState(false);

    // Parameters
    const [prompt, setPrompt] = usePersistentState('ltx_i2v_prompt', 'A woman slowly turns her head toward the camera with a soft smile, her hair gently swaying in the breeze. The background is a warm golden-hour setting with bokeh lights.');
    const [negativePrompt, setNegativePrompt] = usePersistentState('ltx_i2v_negative_prompt', 'blurry, low quality, still frame, watermark, overlay, titles, subtitles');
    const [preset, setPreset] = usePersistentState<PresetTier>('ltx_i2v_preset', 'balanced');
    const [duration, setDuration] = usePersistentState('ltx_i2v_duration', 8);
    const [steps, setSteps] = usePersistentState('ltx_i2v_steps', PRESETS.balanced.steps);
    const [cfg, setCfg] = usePersistentState('ltx_i2v_cfg', PRESETS.balanced.cfg);
    const [denoise, setDenoise] = usePersistentState('ltx_i2v_denoise', PRESETS.balanced.denoise);
    const [seed, setSeed] = usePersistentState('ltx_i2v_seed', -1);
    const [showAdvanced, setShowAdvanced] = usePersistentState('ltx_i2v_show_advanced', false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisDescription, setAnalysisDescription] = useState('');
    const [analysisSuggestions, setAnalysisSuggestions] = useState<string[]>([]);
    const [visionModels, setVisionModels] = useState<string[]>(['llava']);
    const [visionModel, setVisionModel] = usePersistentState('ltx_i2v_vision_model', 'llava');
    const [motionUseCase, setMotionUseCase] = usePersistentState<MotionUseCase>('ltx_i2v_motion_use_case', 'general');
    const [prioritizeSubjectMotion, setPrioritizeSubjectMotion] = usePersistentState('ltx_i2v_prioritize_subject_motion', true);
    const [lockSeedAcrossRuns, setLockSeedAcrossRuns] = usePersistentState('ltx_i2v_lock_seed', true);
    const [safeModeCpuLoader, setSafeModeCpuLoader] = usePersistentState('ltx_i2v_safe_mode_cpu_loader', false);
    const [modelBackend, setModelBackend] = usePersistentState<ModelBackendType>('ltx_i2v_model_backend', 'safetensors');

    const targetResolution = useMemo(
        () => getAutoResolution(sourceDims, PRESETS[preset].longEdge),
        [sourceDims, preset]
    );
    const targetFps = PRESETS[preset].fps;
    const targetFrames = duration * targetFps + 1;
    const sourceOrientation = sourceDims ? (sourceDims.width >= sourceDims.height ? 'Landscape' : 'Portrait') : 'Unknown';

    useEffect(() => {
        const copilotPrompt = localStorage.getItem('ltx_copilot_prompt');
        if (!copilotPrompt) return;
        setPrompt(copilotPrompt);
        const neg = localStorage.getItem('ltx_copilot_negative');
        const st = localStorage.getItem('ltx_copilot_steps');
        const cg = localStorage.getItem('ltx_copilot_cfg');
        const dn = localStorage.getItem('ltx_copilot_denoise');
        const dur = localStorage.getItem('ltx_copilot_duration');
        if (neg) setNegativePrompt(neg);
        if (st) setSteps(Number(st));
        if (cg) setCfg(Number(cg));
        if (dn) setDenoise(Number(dn));
        if (dur) setDuration(Number(dur));
        localStorage.removeItem('ltx_copilot_prompt');
        localStorage.removeItem('ltx_copilot_negative');
        localStorage.removeItem('ltx_copilot_steps');
        localStorage.removeItem('ltx_copilot_cfg');
        localStorage.removeItem('ltx_copilot_denoise');
        localStorage.removeItem('ltx_copilot_duration');
        localStorage.removeItem('ltx_copilot_fps');
    }, [setPrompt, setNegativePrompt, setSteps, setCfg, setDenoise, setDuration]);

    const setSourceImageWithMeta = (url: string, filename: string) => {
        setSourceImage(url);
        setSourceImageName(filename);
        const img = new Image();
        img.onload = () => setSourceDims({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => setSourceDims(null);
        img.src = url;
    };

    useEffect(() => {
        const loadVisionModels = async () => {
            try {
                const resp = await fetch(`${BACKEND_API.BASE_URL}${BACKEND_API.ENDPOINTS.OLLAMA_VISION_MODELS}`);
                const data = await resp.json();
                if (!resp.ok || !data?.success) return;

                const models = Array.isArray(data.models) && data.models.length > 0 ? data.models : ['llava'];
                setVisionModels(models);
                if (!models.includes(visionModel)) {
                    setVisionModel(data.default && models.includes(data.default) ? data.default : models[0]);
                }
            } catch {
                // Silent fallback; manual model input not needed in MVP.
            }
        };
        loadVisionModels();
    }, [visionModel, setVisionModel]);

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

    const handleImageDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            setSourceImageWithMeta(URL.createObjectURL(file), file.name);
        }
    };

    const handleGenerate = async () => {
        if (!sourceImage) {
            toast('Please upload a source image', 'error');
            return;
        }

        setIsGenerating(true);

        try {
            // Intentionally keep models in memory between runs for faster iteration.

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

            // Load official LTX-2.3 single-stage workflow
            const response = await fetch(`/workflows/ltx23-single-stage-api.json?v=${Date.now()}`);
            if (!response.ok) throw new Error('Failed to load LTX 2.3 I2V workflow');
            const workflow = await response.json();

            let backendForRun: ModelBackendType = modelBackend;
            if (modelBackend === 'gguf') {
                const hasGgufNode = (await comfyService.getNodeInputOptions('UnetLoaderGGUF', 'unet_name')).length > 0;
                const checkpoints = await comfyService.getCheckpoints();
                const hasLtxGguf = checkpoints.some((c) => /ltx.*\.gguf$/i.test(c));
                if (!hasGgufNode || !hasLtxGguf) {
                    backendForRun = 'safetensors';
                    toast('GGUF is not fully available for this LTX workflow on your install. Falling back to Safetensors.', 'error');
                } else {
                    toast('GGUF selected, but this workflow currently uses safetensors node graph. Running compatibility fallback.', 'error');
                    backendForRun = 'safetensors';
                }
            }

            let activeSeed = seed;
            if (seed === -1) {
                if (lockSeedAcrossRuns) {
                    activeSeed = Math.floor(Math.random() * 1000000000000000);
                    setSeed(activeSeed);
                } else {
                    activeSeed = Math.floor(Math.random() * 1000000000000000);
                }
            }

            const { tunedSteps, tunedCfg, tunedDenoise, profile } = buildTunedParams();
            if (tunedSteps !== steps) setSteps(tunedSteps);
            if (tunedCfg !== cfg) setCfg(tunedCfg);
            if (tunedDenoise !== denoise) setDenoise(tunedDenoise);

            const positivePrompt = [
                prompt,
                profile.positiveBlock,
                'Preserve identity, face, hairstyle, clothing, and scene geometry from the source image.',
                prioritizeSubjectMotion
                    ? 'The subject must actively move throughout the shot: natural body movement, posture shifts, head turns, eye movement, and hand/shoulder motion. Keep camera mostly steady.'
                    : 'Keep camera movement controlled and avoid unnecessary reframing.',
            ].join('\n\n');
            const negativeWithAntiZoom = `${negativePrompt}, ${profile.negativeBlock}, no camera zoom, no dolly zoom, no static frozen subject, no random background-only motion, hard scene drift, major composition change`;

            // --- Inject parameters into LTX-2.3 workflow ---

            // Node 2004: LoadImage (source image)
            if (workflow['2004']) workflow['2004'].inputs.image = imageFilename;

            // Node 4977: bypass_i2v = false (enable image conditioning for I2V)
            if (workflow['4977']) workflow['4977'].inputs.value = false;

            // Node 2483: CLIPTextEncode (positive prompt)
            if (workflow['2483']) workflow['2483'].inputs.text = positivePrompt;

            // Node 2612: CLIPTextEncode (negative prompt)
            if (workflow['2612']) workflow['2612'].inputs.text = negativeWithAntiZoom;

            // Node 4960: LTXAVTextEncoderLoader
            // Safe mode can force CPU loading to avoid occasional Windows torch access violations.
            if (workflow['4960']) workflow['4960'].inputs.device = safeModeCpuLoader ? 'cpu' : 'default';
            if (backendForRun === 'safetensors' && workflow['4960']) {
                workflow['4960'].inputs.ckpt_name = 'ltx-2.3-22b-dev.safetensors';
            }

            // Node 4979: Number of frames (duration * fps)
            if (workflow['4979']) workflow['4979'].inputs.value = targetFrames;

            // Node 4978: frame rate
            if (workflow['4978']) workflow['4978'].inputs.value = targetFps;

            // Node 3059: latent resolution (auto from source orientation)
            if (workflow['3059']) {
                workflow['3059'].inputs.width = targetResolution.width;
                workflow['3059'].inputs.height = targetResolution.height;
                workflow['3059'].inputs.length = targetFrames;
            }

            // Node 4981: preprocess resize long-edge follows selected quality
            if (workflow['4981']) workflow['4981'].inputs.size = PRESETS[preset].longEdge;

            // Node 4814: RandomNoise (seed - distilled pass)
            if (workflow['4814']) workflow['4814'].inputs.noise_seed = activeSeed;

            // Node 4832: RandomNoise (seed - full pass)
            if (workflow['4832']) workflow['4832'].inputs.noise_seed = activeSeed + 1;

            // Node 4964: GuiderParameters VIDEO (cfg)
            if (workflow['4964']) workflow['4964'].inputs.cfg = tunedCfg;

            // Node 4966: LTXVScheduler (steps)
            if (workflow['4966']) workflow['4966'].inputs.steps = tunedSteps;

            // Node 3159: LTXVImgToVideoConditionOnly (denoise strength)
            if (workflow['3159']) workflow['3159'].inputs.strength = tunedDenoise;

            const runTag = Date.now().toString(36);

            // Route all presets through the stable CFG branch to avoid MultimodalGuider AV unpack errors.
            if (workflow['4852']) {
                workflow['4852'].inputs.video = ['4849', 0];
                workflow['4852'].inputs.filename_prefix = preset === 'fast'
                    ? `VIDEO/LTX23/I2V_FAST_${runTag}`
                    : `VIDEO/LTX23/I2V_${runTag}`;
            }

            // Remove duplicate SaveVideo node — keep only primary output (4852)
            delete workflow['4823'];

            await queueWorkflow(workflow);
            toast('LTX Image-to-Video queued!', 'success');

        } catch (error: any) {
            console.error('LTX I2V generation failed:', error);
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

    const handleAnalyzeImage = async () => {
        if (!sourceImage) {
            toast('Please upload a source image first', 'error');
            return;
        }

        setIsAnalyzing(true);
        try {
            const imageResp = await fetch(sourceImage);
            const blob = await imageResp.blob();
            const filename = sourceImageName || 'source.png';
            const file = new File([blob], filename, { type: blob.type || 'image/png' });

            const formData = new FormData();
            formData.append('image', file);
            formData.append('model', visionModel);

            const resp = await fetch(`${BACKEND_API.BASE_URL}${BACKEND_API.ENDPOINTS.VIDEO_ANALYZE_PROMPT}`, {
                method: 'POST',
                body: formData,
            });

            const data = await resp.json();
            if (!resp.ok || !data?.success) {
                throw new Error(data?.detail || data?.error || 'Image analysis failed');
            }

            setAnalysisDescription(data.description || '');
            const suggestions = Array.isArray(data.suggestions) ? data.suggestions.slice(0, 3) : [];
            setAnalysisSuggestions(suggestions);
            if (suggestions.length > 0) setPrompt(suggestions[0]);
            toast(`Image analyzed with ${visionModel}. Prompt suggestions ready.`, 'success');
        } catch (error: any) {
            console.error('I2V image analysis failed:', error);
            toast(error?.message || 'Failed to analyze image', 'error');
        } finally {
            setIsAnalyzing(false);
        }
    };

    return (
        <>
                <GalleryModal
                isOpen={showGalleryModal}
                onClose={() => setShowGalleryModal(false)}
                onSelect={(url, filename) => {
                    setSourceImageWithMeta(url, filename);
                    setShowGalleryModal(false);
                }}
            />

            <div className="space-y-5">
                {/* Source Image Upload */}
                <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-2">Source Image</label>
                    <div
                        onDrop={handleImageDrop}
                        onDragOver={(e) => e.preventDefault()}
                        className={`relative border-2 border-dashed rounded-xl h-52 transition-all overflow-hidden ${
                            sourceImage ? 'border-white/20 bg-black' : 'border-white/10 hover:border-white/20 bg-white/[0.02]'
                        }`}
                    >
                        {sourceImage ? (
                            <>
                                <img src={sourceImage} alt="Source" className="w-full h-full object-contain" />
                                <button
                                    onClick={() => { setSourceImage(null); setSourceImageName(null); setSourceDims(null); }}
                                    className="absolute top-2 right-2 p-1 bg-black/60 hover:bg-red-500/80 rounded-lg text-white/70 hover:text-white transition-colors"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </>
                        ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                                <div className="p-3 rounded-full bg-white/5">
                                    <ImageIcon className="w-6 h-6 text-white/30" />
                                </div>
                                <p className="text-xs text-slate-500">Drag & drop source image</p>
                                <Button size="sm" variant="ghost" onClick={() => setShowGalleryModal(true)}>
                                    Browse Gallery
                                </Button>
                            </div>
                        )}
                        <input
                            type="file"
                            accept="image/*"
                            className="absolute inset-0 opacity-0 cursor-pointer"
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                    setSourceImageWithMeta(URL.createObjectURL(file), file.name);
                                }
                            }}
                        />
                    </div>
                </div>

                {/* Prompt */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <label className="block text-[10px] text-slate-500 uppercase tracking-widest font-bold">Motion Prompt</label>
                        <div className="flex items-center gap-2">
                            <select
                                value={visionModel}
                                onChange={(e) => setVisionModel(e.target.value)}
                                className="bg-[#0a0a0f] border border-white/10 rounded-md px-2 py-1 text-[11px] text-slate-300 focus:outline-none focus:ring-1 focus:ring-white/20"
                            >
                                {visionModels.map((m) => (
                                    <option key={m} value={m}>{m}</option>
                                ))}
                            </select>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={handleAnalyzeImage}
                                isLoading={isAnalyzing}
                                disabled={isAnalyzing || !sourceImage}
                            >
                                {isAnalyzing ? 'Analyzing...' : 'Analyze Image'}
                            </Button>
                        </div>
                    </div>
                    <p className="text-[10px] text-slate-600 mb-1.5">Describe the motion and what happens next. Long, detailed prompts work best.</p>
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
                        placeholder="Describe the motion, camera movement, and scene dynamics in detail..."
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
                    {(analysisDescription || analysisSuggestions.length > 0) && (
                        <div className="mt-3 space-y-2">
                            {analysisDescription && (
                                <div className="bg-black/30 border border-white/5 rounded-lg p-2">
                                    <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Image Description</div>
                                    <div className="text-xs text-slate-300">{analysisDescription}</div>
                                </div>
                            )}
                            {analysisSuggestions.length > 0 && (
                                <div className="bg-black/30 border border-white/5 rounded-lg p-2">
                                    <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Motion Suggestions</div>
                                    <div className="space-y-1.5">
                                        {analysisSuggestions.map((suggestion, idx) => (
                                            <button
                                                key={`${idx}-${suggestion.slice(0, 20)}`}
                                                onClick={() => setPrompt(suggestion)}
                                                className="w-full text-left text-xs text-slate-300 hover:text-white bg-black/40 hover:bg-black/60 border border-white/5 rounded-md px-2 py-1.5 transition-colors"
                                            >
                                                {idx + 1}. {suggestion}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
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

                {/* Render Plan */}
                <div className="bg-[#0a0a0f] border border-white/10 rounded-xl p-3">
                    <label className="block text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-2">Render Plan</label>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div className="bg-black/40 rounded-lg px-2 py-1.5">
                            <div className="text-slate-500">Source</div>
                            <div className="text-slate-200 font-mono">
                                {sourceDims ? `${sourceDims.width}x${sourceDims.height}` : 'Select image'}
                            </div>
                        </div>
                        <div className="bg-black/40 rounded-lg px-2 py-1.5">
                            <div className="text-slate-500">Orientation</div>
                            <div className="text-slate-200">{sourceOrientation}</div>
                        </div>
                        <div className="bg-black/40 rounded-lg px-2 py-1.5">
                            <div className="text-slate-500">Output Res</div>
                            <div className="text-slate-200 font-mono">{targetResolution.width}x{targetResolution.height}</div>
                        </div>
                        <div className="bg-black/40 rounded-lg px-2 py-1.5">
                            <div className="text-slate-500">Frames</div>
                            <div className="text-slate-200 font-mono">{targetFrames} @ {targetFps}fps</div>
                        </div>
                        <div className="bg-black/40 rounded-lg px-2 py-1.5">
                            <div className="text-slate-500">Steps</div>
                            <div className="text-slate-200 font-mono">{steps}</div>
                        </div>
                        <div className="bg-black/40 rounded-lg px-2 py-1.5">
                            <div className="text-slate-500">Long Edge</div>
                            <div className="text-slate-200 font-mono">{PRESETS[preset].longEdge}px</div>
                        </div>
                        <div className="bg-black/40 rounded-lg px-2 py-1.5">
                            <div className="text-slate-500">Pass Mode</div>
                            <div className="text-slate-200">{preset === 'fast' ? 'Distilled only' : 'Distilled + Refine'}</div>
                        </div>
                        <div className="bg-black/40 rounded-lg px-2 py-1.5">
                            <div className="text-slate-500">Seed Mode</div>
                            <div className="text-slate-200">{lockSeedAcrossRuns ? 'Locked across runs' : 'Random each run'}</div>
                        </div>
                    </div>
                </div>

                {/* Duration */}
                <div className="bg-[#0a0a0f] border border-white/10 rounded-xl p-4">
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                        <span>Duration</span>
                        <span className="text-white font-mono">{duration}s</span>
                    </div>
                    <input
                        type="range" min="2" max="20" value={duration}
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
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => setPrioritizeSubjectMotion(!prioritizeSubjectMotion)}
                                    className={`px-2 py-2 rounded-lg text-xs border transition-colors ${
                                        prioritizeSubjectMotion
                                            ? 'bg-white text-black border-white'
                                            : 'bg-black text-slate-300 border-white/10 hover:border-white/30'
                                    }`}
                                >
                                    Subject Motion {prioritizeSubjectMotion ? 'ON' : 'OFF'}
                                </button>
                                <button
                                    onClick={() => setLockSeedAcrossRuns(!lockSeedAcrossRuns)}
                                    className={`px-2 py-2 rounded-lg text-xs border transition-colors ${
                                        lockSeedAcrossRuns
                                            ? 'bg-white text-black border-white'
                                            : 'bg-black text-slate-300 border-white/10 hover:border-white/30'
                                    }`}
                                >
                                    Seed Lock {lockSeedAcrossRuns ? 'ON' : 'OFF'}
                                </button>
                                <button
                                    onClick={() => setSafeModeCpuLoader(!safeModeCpuLoader)}
                                    className={`px-2 py-2 rounded-lg text-xs border transition-colors ${
                                        safeModeCpuLoader
                                            ? 'bg-white text-black border-white'
                                            : 'bg-black text-slate-300 border-white/10 hover:border-white/30'
                                    }`}
                                >
                                    Safe Mode CPU Loader {safeModeCpuLoader ? 'ON' : 'OFF'}
                                </button>
                            </div>
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
                                <div className="flex items-center justify-between mb-1">
                                    <label className="block text-xs text-slate-400">Seed (-1 = random)</label>
                                    <button
                                        onClick={() => setSeed(Math.floor(Math.random() * 1000000000000000))}
                                        className="text-[10px] text-slate-400 hover:text-white"
                                    >
                                        Randomize
                                    </button>
                                </div>
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
                    {isGenerating ? 'Rendering...' : 'Generate Video'}
                </Button>
            </div>

            {/* Model Backend */}
            <div className="bg-[#0a0a0f] border border-white/10 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                    <label className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Model Backend</label>
                    <span className="text-[10px] text-amber-400">GGUF = experimental</span>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => setModelBackend('safetensors')}
                        className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                            modelBackend === 'safetensors'
                                ? 'bg-white text-black border-white'
                                : 'bg-black text-slate-300 border-white/10 hover:border-white/30'
                        }`}
                    >
                        Safetensors
                    </button>
                    <button
                        onClick={() => setModelBackend('gguf')}
                        className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                            modelBackend === 'gguf'
                                ? 'bg-white text-black border-white'
                                : 'bg-black text-slate-300 border-white/10 hover:border-white/30'
                        }`}
                    >
                        GGUF
                    </button>
                </div>
            </div>
        </>
    );
};
