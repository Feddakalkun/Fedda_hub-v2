import { useState, useEffect } from 'react';
import { X, ChevronRight, Sparkles, ImageIcon } from 'lucide-react';
import { Button } from '../ui/Button';
import { useComfyExecution } from '../../contexts/ComfyExecutionContext';
import { comfyService } from '../../services/comfyService';
import { assistantService } from '../../services/assistantService';
import { ollamaService } from '../../services/ollamaService';
import { GalleryModal } from '../GalleryModal';
import { useToast } from '../ui/Toast';
import { usePersistentState } from '../../hooks/usePersistentState';

interface KeyframeImage {
    url: string | null;
    filename: string | null;
}

// LoRA definitions from the workflow — index matches lora_N in Power Lora Loader nodes
const WORKFLOW_LORAS = [
    { index: 1, highName: 'Oral-Ins-High.safetensors', lowName: 'Oral-Ins-Low.safetensors', label: 'Oral' },
    { index: 2, highName: 'CumShot-High.safetensors', lowName: 'CumShot-Low.safetensors', label: 'CumShot' },
    { index: 3, highName: 'wan-nsfw-e14-fixed.safetensors', lowName: 'wan-nsfw-e14-fixed.safetensors', label: 'NSFW Base' },
    { index: 4, highName: 'Wan2.2_Double-Penetration-High.safetensors', lowName: 'Wan2.2_Double-Penetration-Low.safetensors', label: 'Double Pen' },
    { index: 5, highName: 'PussyLoRA_HighNoise_Wan2.2_HearmemanAI.safetensors', lowName: 'PussyLoRA_LowNoise_Wan2.2_HearmemanAI.safetensors', label: 'Pussy' },
    { index: 6, highName: 'V3TWERKHIGH.safetensors', lowName: 'V3TWERKLOW.safetensors', label: 'Twerk' },
    { index: 7, highName: 'mql_casting_sex_reverse_cowgirl_lie_front_vagina_wan22_i2v_v1_high_noise.safetensors', lowName: 'mql_casting_sex_reverse_cowgirl_lie_front_vagina_wan22_i2v_v1_low_noise.safetensors', label: 'Rev Cowgirl' },
    { index: 8, highName: 'mql_casting_sex_doggy_kneel_diagonally_behind_vagina_wan22_i2v_v1_high_noise.safetensors', lowName: 'mql_casting_sex_doggy_kneel_diagonally_behind_vagina_wan22_i2v_v1_low_noise.safetensors', label: 'Doggy' },
    { index: 9, highName: 'Fingering-I2V.safetensors', lowName: 'Fingering-I2V.safetensors', label: 'Fingering' },
    { index: 10, highName: 'Wan2.1_I2V_14B_FusionX_LoRA.safetensors', lowName: 'Wan2.1_I2V_14B_FusionX_LoRA.safetensors', label: 'FusionX' },
    { index: 11, highName: 'SECRET_SAUCE_WAN2.1_14B_fp8.safetensors', lowName: 'SECRET_SAUCE_WAN2.1_14B_fp8.safetensors', label: 'Secret Sauce' },
    { index: 12, highName: 'KISSHIGH.safetensors', lowName: 'KISSLOW.safetensors', label: 'Kiss' },
    { index: 13, highName: 'mql_wink_wan22_i2v_v1_high_noise.safetensors', lowName: 'mql_wink_wan22_i2v_v1_low_noise.safetensors', label: 'Wink' },
    { index: 14, highName: 'WAN2.2-BreastRubv2_HighNoise.safetensors', lowName: 'WAN2.2-BreastRubv2_LowNoise.safetensors', label: 'Breast Rub' },
];

// Node IDs for each of the 6 segments
const SEGMENT_CONFIG = [
    {
        imageNode: '62',
        posPromptNode: '303:289',
        negPromptNode: '303:291',
        seedNode: '303:301',         // KSamplerAdvanced with add_noise: enable
        frameToVideoNode: '303:296', // WanFirstLastFrameToVideo
        highLoraNode: '170',
        lowLoraNode: '171',
    },
    {
        imageNode: '190',
        posPromptNode: '288:274',
        negPromptNode: '288:276',
        seedNode: '288:286',
        frameToVideoNode: '288:281',
        highLoraNode: '187',
        lowLoraNode: '188',
    },
    {
        imageNode: '194',
        posPromptNode: '273:259',
        negPromptNode: '273:261',
        seedNode: '273:271',
        frameToVideoNode: '273:266',
        highLoraNode: '191',
        lowLoraNode: '192',
    },
    {
        imageNode: '198',
        posPromptNode: '258:244',
        negPromptNode: '258:246',
        seedNode: '258:256',
        frameToVideoNode: '258:251',
        highLoraNode: '195',
        lowLoraNode: '196',
    },
    {
        imageNode: '202',
        posPromptNode: '243:229',
        negPromptNode: '243:231',
        seedNode: '243:241',
        frameToVideoNode: '243:236',
        highLoraNode: '199',
        lowLoraNode: '200',
    },
    {
        imageNode: '206',
        posPromptNode: '333:325',
        negPromptNode: '333:326',
        seedNode: '333:330',
        frameToVideoNode: '333:331',
        highLoraNode: '203',
        lowLoraNode: '204',
    },
];

export const SceneBuilderTab = () => {
    const { queueWorkflow } = useComfyExecution();
    const { toast } = useToast();

    // Keyframes
    const [keyframes, setKeyframes] = useState<KeyframeImage[]>(
        Array(6).fill(null).map(() => ({ url: null, filename: null }))
    );
    const [activeKeyframeSlot, setActiveKeyframeSlot] = useState<number | null>(null);
    const [showGalleryModal, setShowGalleryModal] = useState(false);

    // Preset system
    const [usePresetMode, setUsePresetMode] = usePersistentState('video_scene_use_preset_mode', false);
    const [presetDescription, setPresetDescription] = usePersistentState('video_scene_preset_description', '');
    const [presetLora, setPresetLora] = usePersistentState('video_scene_preset_lora', '');
    const [availableLoras, setAvailableLoras] = useState<string[]>([]);
    const [ollamaModels, setOllamaModels] = useState<any[]>([]);
    const [selectedOllamaModel, setSelectedOllamaModel] = usePersistentState('video_scene_selected_ollama_model', '');
    const [isGeneratingPreset, setIsGeneratingPreset] = useState(false);

    // Video parameters
    const [prompt, setPrompt] = usePersistentState('video_scene_prompt', 'cinematic motion');
    const [seed, setSeed] = usePersistentState('video_scene_seed', -1);
    const [resolution, setResolution] = usePersistentState('video_scene_resolution', 720);
    const [frameLength, setFrameLength] = usePersistentState('video_scene_frame_length', 81);
    const [showAdvanced, setShowAdvanced] = usePersistentState('video_scene_show_advanced', false);
    const [isGenerating, setIsGenerating] = useState(false);

    // LoRA toggles (14 slots, all off by default)
    const [loraEnabled, setLoraEnabled] = usePersistentState<boolean[]>('video_scene_lora_enabled', WORKFLOW_LORAS.map(() => false));
    const [loraStrengths, setLoraStrengths] = usePersistentState<number[]>('video_scene_lora_strengths', WORKFLOW_LORAS.map(l => {
        // Use default strengths from workflow
        if (l.label === 'Twerk') return 0.6;
        if (l.label === 'Rev Cowgirl') return 0.7;
        if (l.label === 'Doggy') return 0.5;
        return 1;
    }));

    useEffect(() => {
        const loadData = async () => {
            try {
                const [loraList, models] = await Promise.all([
                    comfyService.getLoras(),
                    ollamaService.getModels(),
                ]);
                setAvailableLoras(loraList);
                setOllamaModels(models);
                if (models.length > 0) setSelectedOllamaModel(models[0].name);
            } catch {}
        };
        loadData();
    }, []);

    const handleKeyframeDrop = (index: number, e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            const newKeyframes = [...keyframes];
            newKeyframes[index] = { url: URL.createObjectURL(file), filename: file.name };
            setKeyframes(newKeyframes);
        }
    };

    const clearKeyframe = (index: number) => {
        const newKeyframes = [...keyframes];
        newKeyframes[index] = { url: null, filename: null };
        setKeyframes(newKeyframes);
    };

    const toggleLora = (index: number) => {
        const updated = [...loraEnabled];
        updated[index] = !updated[index];
        setLoraEnabled(updated);
    };

    // AI Preset: generate 6 keyframe images
    const handleGeneratePreset = async () => {
        if (!presetDescription.trim()) {
            toast('Describe your scene first', 'error');
            return;
        }
        if (!selectedOllamaModel) {
            toast('No Ollama model available', 'error');
            return;
        }

        setIsGeneratingPreset(true);

        try {
            // Clear VRAM for Ollama
            try { await comfyService.freeMemory(false, true); } catch {}

            toast('AI is writing 6 keyframe prompts...', 'info');
            const result = await assistantService.generateScenePrompts(
                selectedOllamaModel,
                presetDescription,
                presetLora
            );

            toast('Queuing 6 keyframe images...', 'info');

            // Queue z-image-master.json 6 times with shared seed
            for (let i = 0; i < 6; i++) {
                const response = await fetch(`/workflows/z-image-master.json?v=${Date.now()}`);
                if (!response.ok) throw new Error('Failed to load image workflow');
                const workflow = await response.json();

                // Inject prompt
                if (workflow['6']) workflow['6'].inputs.text = result.prompts[i];

                // Inject shared seed
                if (workflow['3']) workflow['3'].inputs.seed = result.seed;

                // Inject LoRA if selected
                if (presetLora && workflow['126']) {
                    workflow['126'].inputs.lora_1 = { on: true, lora: presetLora, strength: 1.0 };
                }

                // Set resolution to 720x720 (square, matching scene builder)
                if (workflow['30']) {
                    workflow['30'].inputs.width = 720;
                    workflow['30'].inputs.height = 720;
                }

                await queueWorkflow(workflow);
            }

            toast('All 6 keyframes queued! Pick them from the gallery when done.', 'success');

        } catch (error: any) {
            console.error('Preset generation failed:', error);
            toast(error?.message || 'Preset generation failed', 'error');
        } finally {
            setIsGeneratingPreset(false);
        }
    };

    // Generate the 6-frame video
    const handleGenerate = async () => {
        const missing = keyframes.filter(kf => !kf.url).length;
        if (missing > 0) {
            toast(`${missing} keyframe${missing > 1 ? 's' : ''} missing — need all 6`, 'error');
            return;
        }

        setIsGenerating(true);

        try {
            // Clear VRAM
            try { await comfyService.freeMemory(true, true); } catch {}

            // Upload all 6 images
            const uploadedFilenames: string[] = [];
            for (const kf of keyframes) {
                let filename = kf.filename || 'keyframe.png';
                if (kf.url!.startsWith('http') || kf.url!.startsWith('blob:')) {
                    const imgRes = await fetch(kf.url!);
                    const blob = await imgRes.blob();
                    const file = new File([blob], filename, { type: blob.type });
                    const uploadRes = await comfyService.uploadImage(file);
                    filename = uploadRes.name;
                }
                uploadedFilenames.push(filename);
            }

            // Load workflow
            const response = await fetch(`/workflows/wan22-6frames-long.json?v=${Date.now()}`);
            if (!response.ok) throw new Error('Failed to load scene workflow');
            const workflow = await response.json();

            const activeSeed = seed === -1 ? Math.floor(Math.random() * 1000000000000000) : seed;

            // Inject per-segment parameters
            SEGMENT_CONFIG.forEach((seg, idx) => {
                // Image
                if (workflow[seg.imageNode]) {
                    workflow[seg.imageNode].inputs.image = uploadedFilenames[idx];
                }

                // Positive prompt
                if (workflow[seg.posPromptNode]) {
                    workflow[seg.posPromptNode].inputs.text = prompt;
                }

                // Seed (KSamplerAdvanced first-stage with add_noise: enable)
                if (workflow[seg.seedNode]) {
                    workflow[seg.seedNode].inputs.noise_seed = activeSeed;
                }

                // Resolution + frame length (WanFirstLastFrameToVideo)
                if (workflow[seg.frameToVideoNode]) {
                    workflow[seg.frameToVideoNode].inputs.width = resolution;
                    workflow[seg.frameToVideoNode].inputs.height = resolution;
                    workflow[seg.frameToVideoNode].inputs.length = frameLength;
                }

                // LoRA toggles — set on/off for each of the 14 lora slots
                WORKFLOW_LORAS.forEach((lora, loraIdx) => {
                    const key = `lora_${lora.index}`;
                    if (workflow[seg.highLoraNode]?.inputs?.[key]) {
                        workflow[seg.highLoraNode].inputs[key] = {
                            ...workflow[seg.highLoraNode].inputs[key],
                            on: loraEnabled[loraIdx],
                            strength: loraStrengths[loraIdx],
                        };
                    }
                    if (workflow[seg.lowLoraNode]?.inputs?.[key]) {
                        workflow[seg.lowLoraNode].inputs[key] = {
                            ...workflow[seg.lowLoraNode].inputs[key],
                            on: loraEnabled[loraIdx],
                            strength: loraStrengths[loraIdx],
                        };
                    }
                });
            });

            await queueWorkflow(workflow);
            toast('Scene video queued!', 'success');

        } catch (error: any) {
            console.error('Scene generation failed:', error);
            toast(error?.message || 'Generation failed', 'error');
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <>
            <GalleryModal
                isOpen={showGalleryModal}
                onClose={() => { setShowGalleryModal(false); setActiveKeyframeSlot(null); }}
                onSelect={(url, filename) => {
                    if (activeKeyframeSlot !== null) {
                        const updated = [...keyframes];
                        updated[activeKeyframeSlot] = { url, filename };
                        setKeyframes(updated);
                    }
                    setShowGalleryModal(false);
                    setActiveKeyframeSlot(null);
                }}
            />

            <div className="space-y-5">
                {/* Mode Toggle */}
                <div className="flex gap-1 bg-black/40 rounded-lg p-1 border border-white/5">
                    <button
                        onClick={() => setUsePresetMode(false)}
                        className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                            !usePresetMode ? 'bg-white text-black' : 'text-slate-500 hover:text-white'
                        }`}
                    >
                        Manual Upload
                    </button>
                    <button
                        onClick={() => setUsePresetMode(true)}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                            usePresetMode ? 'bg-white text-black' : 'text-slate-500 hover:text-white'
                        }`}
                    >
                        <Sparkles className="w-3 h-3" /> AI Preset
                    </button>
                </div>

                {/* AI Preset Panel */}
                {usePresetMode && (
                    <div className="space-y-3 p-4 bg-[#0d0d14] border border-white/10 rounded-xl">
                        <textarea
                            value={presetDescription}
                            onChange={(e) => setPresetDescription(e.target.value)}
                            placeholder="Describe your scene (e.g., 'a woman dancing in a nightclub, neon lights, 6 dynamic poses')"
                            className="w-full h-20 bg-[#0a0a0f] border border-white/10 rounded-lg p-3 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-white/20 resize-none"
                        />

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-[10px] text-slate-600 mb-1">Style LoRA</label>
                                <select
                                    value={presetLora}
                                    onChange={(e) => setPresetLora(e.target.value)}
                                    className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none"
                                >
                                    <option value="">None</option>
                                    {availableLoras.map(l => <option key={l} value={l}>{l}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-[10px] text-slate-600 mb-1">AI Model</label>
                                <select
                                    value={selectedOllamaModel}
                                    onChange={(e) => setSelectedOllamaModel(e.target.value)}
                                    className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none"
                                >
                                    {ollamaModels.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                                </select>
                            </div>
                        </div>

                        <Button
                            variant="secondary"
                            size="md"
                            className="w-full"
                            onClick={handleGeneratePreset}
                            isLoading={isGeneratingPreset}
                            disabled={isGeneratingPreset}
                        >
                            {isGeneratingPreset ? 'Generating...' : 'Generate 6 Keyframes with AI'}
                        </Button>
                    </div>
                )}

                {/* 6 Image Slots */}
                <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-2">
                        Keyframes ({keyframes.filter(k => k.url).length}/6)
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                        {keyframes.map((kf, index) => (
                            <div
                                key={index}
                                onDrop={(e) => handleKeyframeDrop(index, e)}
                                onDragOver={(e) => e.preventDefault()}
                                className={`relative aspect-square border-2 border-dashed rounded-xl overflow-hidden transition-all cursor-pointer ${
                                    kf.url
                                        ? 'border-emerald-500/40 bg-black'
                                        : 'border-white/10 hover:border-white/20 bg-white/[0.02]'
                                }`}
                            >
                                {kf.url ? (
                                    <>
                                        <img src={kf.url} alt={`Frame ${index + 1}`} className="w-full h-full object-cover" />
                                        <button
                                            onClick={(e) => { e.stopPropagation(); clearKeyframe(index); }}
                                            className="absolute top-1 right-1 p-0.5 bg-black/60 hover:bg-red-500/80 rounded text-white/70 hover:text-white transition-colors"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-1">
                                            <span className="text-[10px] text-white/80 font-mono">#{index + 1}</span>
                                        </div>
                                    </>
                                ) : (
                                    <div
                                        className="absolute inset-0 flex flex-col items-center justify-center gap-1"
                                        onClick={() => { setActiveKeyframeSlot(index); setShowGalleryModal(true); }}
                                    >
                                        <ImageIcon className="w-5 h-5 text-white/20" />
                                        <span className="text-[10px] text-slate-600">Frame {index + 1}</span>
                                    </div>
                                )}
                                <input
                                    type="file"
                                    accept="image/*"
                                    className="absolute inset-0 opacity-0 cursor-pointer"
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) {
                                            const updated = [...keyframes];
                                            updated[index] = { url: URL.createObjectURL(file), filename: file.name };
                                            setKeyframes(updated);
                                        }
                                    }}
                                />
                            </div>
                        ))}
                    </div>
                </div>

                {/* Video Prompt */}
                <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-2">Motion Prompt</label>
                    <input
                        type="text"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="Describe the motion between frames..."
                        className="w-full bg-[#0a0a0f] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-white/20"
                    />
                </div>

                {/* LoRA Toggles */}
                <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-2">LoRA Stack</label>
                    <div className="grid grid-cols-3 gap-1.5">
                        {WORKFLOW_LORAS.map((lora, idx) => (
                            <button
                                key={idx}
                                onClick={() => toggleLora(idx)}
                                className={`px-2 py-1.5 rounded-lg text-[10px] font-medium transition-all ${
                                    loraEnabled[idx]
                                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                        : 'bg-white/[0.03] text-slate-500 border border-white/5 hover:border-white/10 hover:text-slate-300'
                                }`}
                            >
                                {lora.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Advanced */}
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
                                    <span>Resolution</span>
                                    <span className="text-white font-mono">{resolution}x{resolution}</span>
                                </div>
                                <input
                                    type="range" min="512" max="1024" step="16" value={resolution}
                                    onChange={(e) => setResolution(parseInt(e.target.value))}
                                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-white"
                                />
                            </div>
                            <div>
                                <div className="flex justify-between text-xs text-slate-400 mb-1">
                                    <span>Frames / Segment</span>
                                    <span className="text-white font-mono">{frameLength} (~{(frameLength / 24).toFixed(1)}s)</span>
                                </div>
                                <input
                                    type="range" min="41" max="161" step="8" value={frameLength}
                                    onChange={(e) => setFrameLength(parseInt(e.target.value))}
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

                            {/* Per-LoRA strength sliders (only for enabled LoRAs) */}
                            {loraEnabled.some(Boolean) && (
                                <div className="space-y-2 pt-2 border-t border-white/5">
                                    <label className="block text-[10px] text-slate-500 uppercase">LoRA Strengths</label>
                                    {WORKFLOW_LORAS.map((lora, idx) => loraEnabled[idx] && (
                                        <div key={idx} className="flex items-center gap-3">
                                            <span className="text-[10px] text-slate-400 w-20 truncate">{lora.label}</span>
                                            <input
                                                type="range" min="0" max="2" step="0.1"
                                                value={loraStrengths[idx]}
                                                onChange={(e) => {
                                                    const updated = [...loraStrengths];
                                                    updated[idx] = parseFloat(e.target.value);
                                                    setLoraStrengths(updated);
                                                }}
                                                className="flex-1 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-400"
                                            />
                                            <span className="text-[10px] text-white font-mono w-6 text-right">{loraStrengths[idx]}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
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
                    {isGenerating ? 'Rendering Scene...' : 'Generate Scene Video'}
                </Button>
            </div>
        </>
    );
};

