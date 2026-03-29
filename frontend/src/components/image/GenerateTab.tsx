import { useState, useEffect } from 'react';
import { ChevronRight } from 'lucide-react';
import { comfyService } from '../../services/comfyService';
import { useComfyExecution } from '../../contexts/ComfyExecutionContext';
import { useToast } from '../ui/Toast';
import { PromptInput } from './PromptInput';
import { LoraStack } from './LoraStack';
import type { SelectedLora } from './LoraStack';
import { DimensionSelector } from './DimensionSelector';
import { BACKEND_API } from '../../config/api';
import { usePersistentState } from '../../hooks/usePersistentState';

interface GenerateTabProps {
    isGenerating: boolean;
    setIsGenerating: (v: boolean) => void;
}

export const GenerateTab = ({ isGenerating, setIsGenerating }: GenerateTabProps) => {
    const { queueWorkflow } = useComfyExecution();
    const { toast } = useToast();

    const [prompt, setPrompt] = usePersistentState('image_generate_prompt', '');
    const [negativePrompt, setNegativePrompt] = usePersistentState('image_generate_negative', 'blurry, low quality, distorted, bad anatomy, flat lighting');
    const [showAdvanced, setShowAdvanced] = usePersistentState('image_generate_show_advanced', false);
    const [steps, setSteps] = usePersistentState('image_generate_steps', 20);
    const [cfg, setCfg] = usePersistentState('image_generate_cfg', 1);
    const [dimensions, setDimensions] = usePersistentState('image_generate_dimensions', '1024x1536');
    const [seed, setSeed] = usePersistentState('image_generate_seed', -1);
    const [batchCount, setBatchCount] = usePersistentState('image_generate_batch_count', 1);
    const [faceEnhance, setFaceEnhance] = usePersistentState('image_generate_face_enhance', true);
    const [selectedLoras, setSelectedLoras] = usePersistentState<SelectedLora[]>('image_generate_selected_loras', []);
    const [availableLoras, setAvailableLoras] = useState<string[]>([]);

    useEffect(() => {
        const load = async () => {
            try {
                const loras = await comfyService.getLoras();
                setAvailableLoras(loras);
            } catch (err) { console.error("Failed to load data", err); }
        };
        load();
    }, []);

    const handleGenerate = async () => {
        if (!prompt.trim()) return;
        setIsGenerating(true);
        try {
            const response = await fetch('/workflows/z-image-master.json');
            if (!response.ok) throw new Error('Failed to load workflow');
            const baseWorkflow = await response.json();

            for (let batch = 0; batch < batchCount; batch++) {
                const workflow = JSON.parse(JSON.stringify(baseWorkflow));
                const activeSeed = seed >= 0 && batchCount === 1 ? seed : Math.floor(Math.random() * 1000000000000000);

                // Expand wildcards (re-expand each batch for random wildcard variation)
                let finalPrompt = prompt;
                if (prompt.includes('__')) {
                    try {
                        const expandResp = await fetch(`${BACKEND_API.BASE_URL}/api/wildcards/expand?text=${encodeURIComponent(prompt)}`);
                        const expandData = await expandResp.json();
                        if (expandData.success) finalPrompt = expandData.expanded;
                    } catch { /* use raw prompt */ }
                }

                // Node 3: KSampler
                workflow["3"].inputs.seed = activeSeed;
                workflow["3"].inputs.steps = steps;
                workflow["3"].inputs.cfg = cfg;

                // Node 6: Positive Prompt (CLIPTextEncode)
                workflow["6"].inputs.text = finalPrompt;

                // Node 7: Negative Prompt (CLIPTextEncode)
                workflow["7"].inputs.text = negativePrompt;

                // Node 30: Dimensions
                const [w, h] = dimensions.split('x').map(Number);
                workflow["30"].inputs.width = w;
                workflow["30"].inputs.height = h;

                // Node 126: Power Lora Loader
                if (selectedLoras.length > 0) {
                    selectedLoras.slice(0, 5).forEach((l, index) => {
                        workflow["126"].inputs[`lora_${index + 1}`] = { on: true, lora: l.name, strength: l.strength };
                    });
                }

                // Node 181: FaceDetailer resolution (bypass if disabled)
                const maxDim = Math.max(w, h);
                workflow["181"].inputs.guide_size = maxDim;
                workflow["181"].inputs.max_size = maxDim;
                if (!faceEnhance) {
                    workflow["181"].inputs.bbox_threshold = 1.0; // impossibly high = no faces detected = skipped
                }

                await queueWorkflow(workflow);
            }

            if (batchCount > 1) toast(`Queued ${batchCount} images!`, 'success');
        } catch (error: any) {
            console.error('Generation failed:', error);
            toast(error?.message || 'Generation failed!', 'error');
            setIsGenerating(false);
        }
    };

    return (
        <div className="space-y-6">
            <PromptInput
                prompt={prompt} setPrompt={setPrompt}
                negativePrompt={negativePrompt} setNegativePrompt={setNegativePrompt}
                isGenerating={isGenerating} onGenerate={handleGenerate}
                showNegative={false}
            />

            {/* Advanced Settings */}
            <div className="bg-[#121218] border border-white/5 rounded-2xl p-6 shadow-xl">
                <button onClick={() => setShowAdvanced(!showAdvanced)} className="w-full flex items-center justify-between text-sm font-medium text-slate-300 hover:text-white transition-colors">
                    <span>Advanced Settings</span>
                    <ChevronRight className={`w-4 h-4 transition-transform duration-200 ${showAdvanced ? 'rotate-90' : ''}`} />
                </button>

                {showAdvanced && (
                    <div className="mt-4 space-y-4 animate-in slide-in-from-top-2 fade-in duration-200">
                        <LoraStack selectedLoras={selectedLoras} setSelectedLoras={setSelectedLoras} availableLoras={availableLoras} />

                        {/* Negative Prompt */}
                        <div>
                            <label className="block text-xs text-slate-400 mb-2 uppercase tracking-wider">Negative Prompt</label>
                            <textarea value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)}
                                className="w-full h-24 bg-[#0a0a0f] border border-white/10 rounded-xl p-3 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-white/20 resize-none transition-all"
                                placeholder="Things to avoid..." />
                        </div>

                        {/* Steps */}
                        <div>
                            <label className="block text-xs text-slate-400 mb-2">Steps: {steps}</label>
                            <input type="range" min="1" max="50" value={steps} onChange={(e) => setSteps(parseInt(e.target.value))} className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-white" />
                        </div>

                        {/* CFG */}
                        <div>
                            <label className="block text-xs text-slate-400 mb-2">CFG Scale: {cfg}</label>
                            <input type="range" min="1" max="4" step="0.1" value={cfg} onChange={(e) => setCfg(parseFloat(e.target.value))} className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-white" />
                            <p className="text-[10px] text-slate-600 mt-1">FLUX models work best at 1.0–2.0</p>
                        </div>

                        {/* Dimensions */}
                        <DimensionSelector dimensions={dimensions} setDimensions={setDimensions} />

                        {/* Face Enhancement Toggle */}
                        <div className="flex items-center justify-between">
                            <div>
                                <label className="block text-xs text-slate-400 uppercase tracking-wider">Face Enhancement</label>
                                <p className="text-[10px] text-slate-600 mt-0.5">Skip for non-portrait images to save time</p>
                            </div>
                            <button
                                onClick={() => setFaceEnhance(!faceEnhance)}
                                className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${faceEnhance ? 'bg-white' : 'bg-white/10'}`}
                            >
                                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform duration-200 ${faceEnhance ? 'translate-x-5 bg-black' : 'translate-x-0 bg-slate-400'}`} />
                            </button>
                        </div>

                        {/* Seed */}
                        <div className={batchCount > 1 ? 'opacity-40 pointer-events-none' : ''}>
                            <label className="block text-xs text-slate-400 mb-2">
                                Seed (-1 for random){batchCount > 1 && <span className="ml-2 text-slate-600 normal-case">— ignored in batch mode</span>}
                            </label>
                            <input type="number" value={seed} onChange={(e) => setSeed(parseInt(e.target.value))} className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-white/20" />
                        </div>

                        {/* Batch Count */}
                        <div>
                            <label className="block text-xs text-slate-400 mb-2">Batch Count: {batchCount}</label>
                            <div className="flex items-center gap-2">
                                {[1, 2, 4, 8].map(n => (
                                    <button
                                        key={n}
                                        onClick={() => setBatchCount(n)}
                                        className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${batchCount === n ? 'bg-white text-black' : 'bg-white/5 text-slate-400 hover:bg-white/10 border border-white/10'}`}
                                    >
                                        {n === 1 ? '×1' : `×${n}`}
                                    </button>
                                ))}
                            </div>
                            <p className="text-[10px] text-slate-600 mt-1">Queue multiple images with different seeds</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

