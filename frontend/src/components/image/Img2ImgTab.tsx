import { useState, useEffect } from 'react';
import { ChevronRight } from 'lucide-react';
import { comfyService } from '../../services/comfyService';
import { useComfyExecution } from '../../contexts/ComfyExecutionContext';
import { useToast } from '../ui/Toast';
import { PromptInput } from './PromptInput';
import { LoraStack } from './LoraStack';
import type { SelectedLora } from './LoraStack';
import { ImageUpload } from './ImageUpload';
import { BACKEND_API } from '../../config/api';
import { usePersistentState } from '../../hooks/usePersistentState';

interface Img2ImgTabProps {
    isGenerating: boolean;
    setIsGenerating: (v: boolean) => void;
    initialImageUrl?: string | null;
    onConsumeImage?: () => void;
}

export const Img2ImgTab = ({ isGenerating, setIsGenerating, initialImageUrl, onConsumeImage }: Img2ImgTabProps) => {
    const { queueWorkflow } = useComfyExecution();
    const { toast } = useToast();

    const [prompt, setPrompt] = usePersistentState('image_img2img_prompt', '');
    const [negativePrompt, setNegativePrompt] = usePersistentState('image_img2img_negative', 'blurry, low quality, distorted, bad anatomy, flat lighting');
    const [showAdvanced, setShowAdvanced] = usePersistentState('image_img2img_show_advanced', false);
    const [steps, setSteps] = usePersistentState('image_img2img_steps', 9);
    const [cfg, setCfg] = usePersistentState('image_img2img_cfg', 1);
    const [denoise, setDenoise] = usePersistentState('image_img2img_denoise', 0.5);
    const [selectedLoras, setSelectedLoras] = usePersistentState<SelectedLora[]>('image_img2img_selected_loras', []);
    const [availableLoras, setAvailableLoras] = useState<string[]>([]);

    const [inputImage, setInputImage] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    useEffect(() => {
        const load = async () => {
            try {
                const loras = await comfyService.getLoras();
                setAvailableLoras(loras);
            } catch (err) { console.error("Failed to load data", err); }
        };
        load();
    }, []);

    // Consume gallery image when sent from another tab
    useEffect(() => {
        if (initialImageUrl) {
            onConsumeImage?.();
        }
    }, [initialImageUrl, onConsumeImage]);

    const handleImageSelected = (file: File) => {
        setInputImage(file);
        setPreviewUrl(URL.createObjectURL(file));
    };

    const handleClearImage = () => {
        setInputImage(null);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
    };

    const handleGenerate = async () => {
        if (!prompt.trim() || !inputImage) {
            toast('Please provide both an image and a prompt', 'error');
            return;
        }
        setIsGenerating(true);
        try {
            // Upload image to ComfyUI first
            const uploaded = await comfyService.uploadImage(inputImage);

            const response = await fetch('/workflows/zimageimg2img.json');
            if (!response.ok) throw new Error('Failed to load workflow');
            const workflow = await response.json();

            const activeSeed = Math.floor(Math.random() * 1000000000000000);

            // Expand wildcards
            let finalPrompt = prompt;
            if (prompt.includes('__')) {
                try {
                    const expandResp = await fetch(`${BACKEND_API.BASE_URL}/api/wildcards/expand?text=${encodeURIComponent(prompt)}`);
                    const expandData = await expandResp.json();
                    if (expandData.success) finalPrompt = expandData.expanded;
                } catch { /* use raw */ }
            }

            // Node 49: KSampler
            workflow["49"].inputs.seed = activeSeed;
            workflow["49"].inputs.steps = steps;
            workflow["49"].inputs.cfg = cfg;
            workflow["49"].inputs.denoise = denoise;

            // Node 42: Positive Prompt (CLIPTextEncode)
            workflow["42"].inputs.text = finalPrompt;

            // Node 36: Negative Prompt (CLIPTextEncode)
            workflow["36"].inputs.text = negativePrompt;

            // Node 52: LoadImage
            workflow["52"].inputs.image = uploaded.name;

            // Node 127: Power Lora Loader
            if (selectedLoras.length > 0) {
                selectedLoras.slice(0, 5).forEach((l, index) => {
                    workflow["127"].inputs[`lora_${index + 1}`] = { on: true, lora: l.name, strength: l.strength };
                });
            }

            await queueWorkflow(workflow);
        } catch (error: any) {
            console.error('Generation failed:', error);
            toast(error?.message || 'Generation failed!', 'error');
            setIsGenerating(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Image Upload */}
            <div className="bg-[#121218] border border-white/5 rounded-2xl p-6 shadow-xl">
                <ImageUpload
                    onImageSelected={handleImageSelected}
                    previewUrl={previewUrl}
                    onClear={handleClearImage}
                    label="Input Image"
                    initialUrl={initialImageUrl}
                />
            </div>

            {/* Denoise Strength */}
            <div className="bg-[#121218] border border-white/5 rounded-2xl p-6 shadow-xl">
                <label className="block text-xs text-slate-400 mb-3 uppercase tracking-wider">
                    Denoise Strength: {denoise.toFixed(2)}
                </label>
                <input type="range" min="0" max="1" step="0.01" value={denoise}
                    onChange={(e) => setDenoise(parseFloat(e.target.value))}
                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-white" />
                <p className="text-xs text-slate-600 mt-2">Lower = closer to original, Higher = more creative</p>
            </div>

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

                        <div>
                            <label className="block text-xs text-slate-400 mb-2 uppercase tracking-wider">Negative Prompt</label>
                            <textarea value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)}
                                className="w-full h-24 bg-[#0a0a0f] border border-white/10 rounded-xl p-3 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-white/20 resize-none transition-all"
                                placeholder="Things to avoid..." />
                        </div>

                        <div>
                            <label className="block text-xs text-slate-400 mb-2">Steps: {steps}</label>
                            <input type="range" min="1" max="50" value={steps} onChange={(e) => setSteps(parseInt(e.target.value))} className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-white" />
                        </div>

                        <div>
                            <label className="block text-xs text-slate-400 mb-2">CFG Scale: {cfg}</label>
                            <input type="range" min="1" max="20" step="0.5" value={cfg} onChange={(e) => setCfg(parseFloat(e.target.value))} className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-white" />
                        </div>

                    </div>
                )}
            </div>
        </div>
    );
};

