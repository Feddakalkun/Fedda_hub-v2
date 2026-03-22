import { useState } from 'react';
import { X, ChevronRight, ImageIcon } from 'lucide-react';
import { Button } from '../ui/Button';
import { useComfyExecution } from '../../contexts/ComfyExecutionContext';
import { comfyService } from '../../services/comfyService';
import { GalleryModal } from '../GalleryModal';
import { useToast } from '../ui/Toast';
import { usePersistentState } from '../../hooks/usePersistentState';

type PresetTier = 'fast' | 'balanced' | 'quality';

const PRESETS: Record<PresetTier, { label: string; description: string; steps: number; cfg: number; denoise: number }> = {
    fast: { label: 'Fast', description: 'Quick iterations', steps: 12, cfg: 4, denoise: 0.6 },
    balanced: { label: 'Balanced', description: 'Good quality + sound', steps: 20, cfg: 4, denoise: 0.6 },
    quality: { label: 'Quality', description: 'Best AV output', steps: 28, cfg: 4, denoise: 0.5 },
};

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
                const imgRes = await fetch(sourceImage);
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

            // Remove HuggingFaceDownloader + ShowText nodes (we handle downloads separately)
            delete workflow['139'];
            delete workflow['143'];
            delete workflow['455'];

            // Remove orphan LTXVGemmaCLIPModelLoader (unused, causes errors)
            delete workflow['243'];

            // Node 240: LoadImage (source image)
            if (workflow['240']) workflow['240'].inputs.image = imageFilename;

            // Node 236: Positive prompt
            if (workflow['236']) workflow['236'].inputs.value = prompt;

            // Node 237: Negative prompt
            if (workflow['237']) workflow['237'].inputs.text = negativePrompt;

            // Node 238: Duration in seconds
            if (workflow['238']) workflow['238'].inputs.value = duration;

            // Node 239: RandomNoise (seed - stage 1)
            if (workflow['239']) workflow['239'].inputs.noise_seed = activeSeed;

            // Node 389:373: RandomNoise (seed - stage 2 refinement)
            if (workflow['389:373']) workflow['389:373'].inputs.noise_seed = activeSeed + 1;

            // Node 310:296: RandomNoise (seed - upscale pass)
            if (workflow['310:296']) workflow['310:296'].inputs.noise_seed = activeSeed + 2;

            // Node 389:366: LTXVScheduler (steps - stage 1)
            if (workflow['389:366']) workflow['389:366'].inputs.steps = steps;

            // Node 389:367: CFGGuider (cfg - stage 1)
            if (workflow['389:367']) workflow['389:367'].inputs.cfg = cfg;

            // Node 389:362: LTXVImgToVideoInplace (denoise strength)
            if (workflow['389:362']) workflow['389:362'].inputs.strength = denoise;

            // Node 281: VHS_VideoCombine (output filename)
            if (workflow['281']) workflow['281'].inputs.filename_prefix = `VIDEO/LTX2/I2VS_${runTag}`;

            // Node 468: SaveImage last frame
            if (workflow['468']) workflow['468'].inputs.filename_prefix = `VIDEO/LTX2/I2VS_LAST_${runTag}`;

            await queueWorkflow(workflow);
            toast('LTX-2 I2V + Sound queued!', 'success');
        } catch (error: any) {
            console.error('LTX-2 I2V+Sound generation failed:', error);
            toast(error?.message || 'Generation failed', 'error');
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
                    <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="A woman talking with happy mood and saying..."
                        className="w-full h-24 bg-[#0a0a0f] border border-white/10 rounded-xl p-3 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-white/20 resize-none"
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
