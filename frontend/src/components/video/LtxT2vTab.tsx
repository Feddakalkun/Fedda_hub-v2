import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '../ui/Button';
import { useComfyExecution } from '../../contexts/ComfyExecutionContext';
import { comfyService } from '../../services/comfyService';
import { useToast } from '../ui/Toast';
import { usePersistentState } from '../../hooks/usePersistentState';

type PresetTier = 'fast' | 'balanced' | 'quality';

const PRESETS: Record<PresetTier, { label: string; description: string; steps: number; cfg: number; fps: number }> = {
    fast: { label: 'Fast', description: 'Quick iterations', steps: 12, cfg: 3.8, fps: 16 },
    balanced: { label: 'Balanced', description: 'Social-ready quality', steps: 18, cfg: 4.2, fps: 20 },
    quality: { label: 'Quality', description: 'Hero shots, best detail', steps: 28, cfg: 4.0, fps: 24 },
};

const RESOLUTIONS = [
    { label: '448x256', w: 448, h: 256, desc: 'Fast ideation' },
    { label: '512x288', w: 512, h: 288, desc: 'Draft wide' },
    { label: '576x320', w: 576, h: 320, desc: 'Balanced (upscale later)' },
    { label: '768x432', w: 768, h: 432, desc: 'High quality' },
    { label: '512x512', w: 512, h: 512, desc: 'Square' },
    { label: '320x576', w: 320, h: 576, desc: 'Portrait 9:16' },
];

export const LtxT2vTab = () => {
    const { queueWorkflow } = useComfyExecution();
    const { toast } = useToast();

    // Parameters
    const [prompt, setPrompt] = usePersistentState('ltx_t2v_prompt', 'A cinematic wide shot of a vast desert landscape at golden hour. The camera slowly tracks forward as sand dunes ripple in the warm wind. Dust particles catch the sunlight, creating a dreamlike atmosphere. The sky transitions from deep amber to soft violet at the horizon.');
    const [negativePrompt, setNegativePrompt] = usePersistentState('ltx_t2v_negative_prompt', 'blurry, low quality, still frame, watermark, overlay, titles, subtitles');
    const [preset, setPreset] = usePersistentState<PresetTier>('ltx_t2v_preset', 'balanced');
    const [duration, setDuration] = usePersistentState('ltx_t2v_duration', 8);
    const [resolutionIdx, setResolutionIdx] = usePersistentState('ltx_t2v_resolution_idx', 2);
    const [steps, setSteps] = usePersistentState('ltx_t2v_steps', PRESETS.balanced.steps);
    const [cfg, setCfg] = usePersistentState('ltx_t2v_cfg', PRESETS.balanced.cfg);
    const [seed, setSeed] = usePersistentState('ltx_t2v_seed', -1);
    const [showAdvanced, setShowAdvanced] = usePersistentState('ltx_t2v_show_advanced', false);
    const [safeModeCpuLoader, setSafeModeCpuLoader] = usePersistentState('ltx_t2v_safe_mode_cpu_loader', false);
    const [isGenerating, setIsGenerating] = useState(false);

    const resolution = RESOLUTIONS[resolutionIdx] || RESOLUTIONS[2];
    const targetFps = PRESETS[preset].fps;
    const targetFrames = duration * targetFps + 1;

    const applyPreset = (tier: PresetTier) => {
        setPreset(tier);
        setSteps(PRESETS[tier].steps);
        setCfg(PRESETS[tier].cfg);
    };

    const handleGenerate = async () => {
        if (!prompt.trim()) {
            toast('Please enter a prompt', 'error');
            return;
        }

        setIsGenerating(true);

        try {
            // Intentionally keep models in memory between runs for faster iteration.

            // Load official LTX-2.3 single-stage workflow (same as I2V, but with bypass_i2v=true)
            const response = await fetch(`/workflows/ltx23-single-stage-api.json?v=${Date.now()}`);
            if (!response.ok) throw new Error('Failed to load LTX 2.3 workflow');
            const workflow = await response.json();

            const activeSeed = seed === -1 ? Math.floor(Math.random() * 1000000000000000) : seed;

            // --- Inject parameters into LTX-2.3 workflow ---

            // Node 4977: bypass_i2v = true (skip image conditioning for T2V)
            if (workflow['4977']) workflow['4977'].inputs.value = true;

            // Node 3059: EmptyLTXVLatentVideo (resolution)
            if (workflow['3059']) {
                workflow['3059'].inputs.width = resolution.w;
                workflow['3059'].inputs.height = resolution.h;
            }

            // Node 2483: CLIPTextEncode (positive prompt)
            if (workflow['2483']) workflow['2483'].inputs.text = prompt;

            // Node 2612: CLIPTextEncode (negative prompt)
            if (workflow['2612']) workflow['2612'].inputs.text = negativePrompt;

            // Node 4960: LTXAVTextEncoderLoader
            // Safe mode can force CPU loading to avoid occasional Windows torch access violations.
            if (workflow['4960']) workflow['4960'].inputs.device = safeModeCpuLoader ? 'cpu' : 'default';

            // Node 4978/4979: fps + number of frames
            if (workflow['4978']) workflow['4978'].inputs.value = targetFps;
            if (workflow['4979']) workflow['4979'].inputs.value = targetFrames;

            // Node 4814: RandomNoise (seed - distilled pass)
            if (workflow['4814']) workflow['4814'].inputs.noise_seed = activeSeed;

            // Node 4832: RandomNoise (seed - full pass)
            if (workflow['4832']) workflow['4832'].inputs.noise_seed = activeSeed + 1;

            // Node 4964: GuiderParameters VIDEO (cfg)
            if (workflow['4964']) workflow['4964'].inputs.cfg = cfg;

            // Node 4966: LTXVScheduler (steps)
            if (workflow['4966']) workflow['4966'].inputs.steps = steps;

            // Fast preset: skip expensive refinement branch by saving distilled pass output.
            if (preset === 'fast') {
                if (workflow['4852']) {
                    workflow['4852'].inputs.video = ['4819', 0];
                    workflow['4852'].inputs.filename_prefix = 'VIDEO/LTX23/T2V_FAST';
                }
                if (workflow['4823']) workflow['4823'].inputs.filename_prefix = 'VIDEO/LTX23/T2V_FAST_ALT';
            } else {
                if (workflow['4852']) {
                    workflow['4852'].inputs.video = ['4849', 0];
                    workflow['4852'].inputs.filename_prefix = 'VIDEO/LTX23/T2V';
                }
                if (workflow['4823']) workflow['4823'].inputs.filename_prefix = 'VIDEO/LTX23/T2V_ALT';
            }

            await queueWorkflow(workflow);
            toast('LTX Text-to-Video queued!', 'success');

        } catch (error: any) {
            console.error('LTX T2V generation failed:', error);
            toast(error?.message || 'Generation failed', 'error');
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="space-y-5">
            {/* Prompt */}
            <div>
                <label className="block text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-2">Video Prompt</label>
                <p className="text-[10px] text-slate-600 mb-1.5">Write a detailed paragraph describing the scene, camera movement, lighting, and action.</p>
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="A cinematic tracking shot of..."
                    className="w-full h-32 bg-[#0a0a0f] border border-white/10 rounded-xl p-3 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-white/20 resize-none"
                />
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

            {/* Resolution */}
            <div>
                <label className="block text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-2">Resolution</label>
                <div className="grid grid-cols-3 gap-1.5">
                    {RESOLUTIONS.map((res, idx) => (
                        <button
                            key={res.label}
                            onClick={() => setResolutionIdx(idx)}
                            className={`px-2 py-2 rounded-lg text-xs transition-all ${
                                resolutionIdx === idx
                                    ? 'bg-white text-black font-medium'
                                    : 'bg-white/5 text-slate-500 hover:bg-white/10 hover:text-white border border-white/5'
                            }`}
                        >
                            <div className="font-mono text-[10px]">{res.label}</div>
                            <div className={`text-[8px] mt-0.5 ${resolutionIdx === idx ? 'text-black/50' : 'text-slate-600'}`}>
                                {res.desc}
                            </div>
                        </button>
                    ))}
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
                        <div>
                            <button
                                onClick={() => setSafeModeCpuLoader(!safeModeCpuLoader)}
                                className={`px-3 py-2 rounded-lg text-xs border transition-colors ${
                                    safeModeCpuLoader
                                        ? 'bg-white text-black border-white'
                                        : 'bg-black text-slate-300 border-white/10 hover:border-white/30'
                                }`}
                            >
                                Safe Mode CPU Loader {safeModeCpuLoader ? 'ON' : 'OFF'}
                            </button>
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
    );
};
