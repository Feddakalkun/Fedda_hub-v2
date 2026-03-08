import { useState, useEffect } from 'react';
import { ChevronRight } from 'lucide-react';
import { comfyService } from '../../services/comfyService';
import { useComfyExecution } from '../../contexts/ComfyExecutionContext';
import { useToast } from '../ui/Toast';
import { PromptInput } from './PromptInput';
import { LoraStack } from './LoraStack';
import type { SelectedLora } from './LoraStack';
import { ImageUpload } from './ImageUpload';
import { DimensionSelector } from './DimensionSelector';

interface InpaintTabProps {
    isGenerating: boolean;
    setIsGenerating: (v: boolean) => void;
    initialImageUrl?: string | null;
    onConsumeImage?: () => void;
}

export const InpaintTab = ({ isGenerating, setIsGenerating, initialImageUrl, onConsumeImage }: InpaintTabProps) => {
    const { queueWorkflow } = useComfyExecution();
    const { toast } = useToast();

    const [prompt, setPrompt] = useState('');
    const [negativePrompt, setNegativePrompt] = useState('blurry, low quality, distorted');
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [steps, setSteps] = useState(6);
    const [cfg, setCfg] = useState(1);
    const [denoise, setDenoise] = useState(0.77);
    const [dimensions, setDimensions] = useState('1024x1024');
    const [selectedLoras, setSelectedLoras] = useState<SelectedLora[]>([]);
    const [availableLoras, setAvailableLoras] = useState<string[]>([]);

    // Mask regions (from PersonMaskUltra node 173)
    const [maskFace, setMaskFace] = useState(true);
    const [maskHair, setMaskHair] = useState(true);
    const [maskBody, setMaskBody] = useState(false);
    const [maskClothes, setMaskClothes] = useState(false);
    const [maskAccessories, setMaskAccessories] = useState(false);
    const [maskBackground, setMaskBackground] = useState(false);

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
            // Upload image to ComfyUI
            const uploaded = await comfyService.uploadImage(inputImage);

            const response = await fetch('/workflows/zimage-inpaint-automask.json');
            if (!response.ok) throw new Error('Failed to load workflow');
            const workflow = await response.json();

            const activeSeed = Math.floor(Math.random() * 1000000000000000);

            // Expand wildcards
            let finalPrompt = prompt;
            if (prompt.includes('__')) {
                try {
                    const expandResp = await fetch(`http://localhost:8000/api/wildcards/expand?text=${encodeURIComponent(prompt)}`);
                    const expandData = await expandResp.json();
                    if (expandData.success) finalPrompt = expandData.expanded;
                } catch { /* use raw */ }
            }

            // Node 169: KSampler
            workflow["169"].inputs.seed = activeSeed;
            workflow["169"].inputs.steps = steps;
            workflow["169"].inputs.cfg = cfg;
            workflow["169"].inputs.denoise = denoise;

            // Node 171: Positive Prompt (CLIPTextEncode)
            workflow["171"].inputs.text = finalPrompt;

            // Node 164: LoadImage
            workflow["164"].inputs.image = uploaded.name;

            // Node 161: Negative Prompt (CLIPTextEncode)
            workflow["161"].inputs.text = negativePrompt;

            // Node 173: PersonMaskUltra — mask regions
            workflow["173"].inputs.face = maskFace;
            workflow["173"].inputs.hair = maskHair;
            workflow["173"].inputs.body = maskBody;
            workflow["173"].inputs.clothes = maskClothes;
            workflow["173"].inputs.accessories = maskAccessories;
            workflow["173"].inputs.background = maskBackground;

            // Node 159: Inpaint Crop and Stitch — output target dimensions
            const [w, h] = dimensions.split('x').map(Number);
            workflow["159"].inputs.output_target_width = w;
            workflow["159"].inputs.output_target_height = h;

            // Node 170: Power Lora Loader
            if (selectedLoras.length > 0) {
                selectedLoras.slice(0, 5).forEach((l, index) => {
                    workflow["170"].inputs[`lora_${index + 1}`] = { on: true, lora: l.name, strength: l.strength };
                });
            }

            await queueWorkflow(workflow);
        } catch (error: any) {
            console.error('Generation failed:', error);
            toast(error?.message || 'Generation failed!', 'error');
            setIsGenerating(false);
        }
    };

    const maskRegions = [
        { label: 'Face', value: maskFace, set: setMaskFace },
        { label: 'Hair', value: maskHair, set: setMaskHair },
        { label: 'Body', value: maskBody, set: setMaskBody },
        { label: 'Clothes', value: maskClothes, set: setMaskClothes },
        { label: 'Accessories', value: maskAccessories, set: setMaskAccessories },
        { label: 'Background', value: maskBackground, set: setMaskBackground },
    ];

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

            {/* Mask Region Selection */}
            <div className="bg-[#121218] border border-white/5 rounded-2xl p-6 shadow-xl">
                <label className="block text-xs text-slate-400 mb-4 uppercase tracking-wider">Auto-Mask Regions</label>
                <p className="text-xs text-slate-600 mb-3">Select which parts of the image to mask and regenerate</p>
                <div className="grid grid-cols-3 gap-2">
                    {maskRegions.map(({ label, value, set }) => (
                        <button key={label} onClick={() => set(!value)}
                            className={`px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all border ${value
                                ? 'bg-white/10 border-white/30 text-white'
                                : 'bg-transparent border-white/5 text-slate-600 hover:border-white/15 hover:text-slate-400'
                            }`}>
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Denoise Strength */}
            <div className="bg-[#121218] border border-white/5 rounded-2xl p-6 shadow-xl">
                <label className="block text-xs text-slate-400 mb-3 uppercase tracking-wider">
                    Denoise Strength: {denoise.toFixed(2)}
                </label>
                <input type="range" min="0" max="1" step="0.01" value={denoise}
                    onChange={(e) => setDenoise(parseFloat(e.target.value))}
                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-white" />
                <p className="text-xs text-slate-600 mt-2">Lower = subtle changes, Higher = full regen of masked area</p>
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

                        {/* Output Dimensions */}
                        <DimensionSelector dimensions={dimensions} setDimensions={setDimensions} />
                    </div>
                )}
            </div>
        </div>
    );
};
