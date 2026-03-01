// Image Generation Page
import { useState, useEffect } from 'react';
import { Sparkles, ChevronRight, Maximize2, X, Loader2, Eye, Upload, Trash2, Video, BookOpen } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { comfyService } from '../services/comfyService';
import { assistantService } from '../services/assistantService';
import { ollamaService } from '../services/ollamaService';
import { useComfyExecution } from '../contexts/ComfyExecutionContext';
import { useToast } from '../components/ui/Toast';
import { PromptLibrary } from '../components/PromptLibrary';
import { ModelDownloader } from '../components/ModelDownloader';

interface ImagePageProps {
    modelId: string;
    modelLabel: string;
}

export const ImagePage = ({ modelId }: ImagePageProps) => {
    const { state: execState, progress: execProgress, currentNodeName, lastCompletedPromptId, queueWorkflow } = useComfyExecution();
    const { toast } = useToast();
    const [prompt, setPrompt] = useState('');
    const [negativePrompt, setNegativePrompt] = useState('blurry, low quality, distorted, bad anatomy, flat lighting');
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedImages, setGeneratedImages] = useState<string[]>(() => {
        // Load from localStorage on mount
        const saved = localStorage.getItem(`gallery_${modelId}`);
        return saved ? JSON.parse(saved) : [];
    });
    const [selectedImage, setSelectedImage] = useState<string | null>(null);

    // Advanced settings state
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [steps, setSteps] = useState(9);
    const [cfg, setCfg] = useState(1);
    const [dimensions, setDimensions] = useState('1504x1504');
    // State for multiple LoRAs
    interface SelectedLora {
        name: string;
        strength: number;
    }
    const [selectedLoras, setSelectedLoras] = useState<SelectedLora[]>([]);
    const [currentLora, setCurrentLora] = useState('');
    const [currentLoraStrength, setCurrentLoraStrength] = useState(1.0);

    // Gallery Toggle State
    const [showGallery, setShowGallery] = useState(true);

    // Prompt Library state
    const [showPromptLibrary, setShowPromptLibrary] = useState(false);
    const [dualPersonMode, setDualPersonMode] = useState(false);
    interface PersonConfig {
        lora: string;
        strength: number;
        description: string;
        label: string;
    }
    const [personA, setPersonA] = useState<PersonConfig>({ lora: '', strength: 0.95, description: '', label: 'man' });
    const [personB, setPersonB] = useState<PersonConfig>({ lora: '', strength: 0.95, description: '', label: 'woman' });
    const [showPersonALoraList, setShowPersonALoraList] = useState(false);
    const [showPersonBLoraList, setShowPersonBLoraList] = useState(false);
    const [personALoraSearch, setPersonALoraSearch] = useState('');
    const [personBLoraSearch, setPersonBLoraSearch] = useState('');

    // Prompt Enhancer State
    const [isEnhancing, setIsEnhancing] = useState(false);
    const [loraDescriptions, setLoraDescriptions] = useState<Record<string, string>>({});

    const selectPersonALora = (lora: string) => {
        const desc = loraDescriptions[lora] || '';
        setPersonA(prev => ({ ...prev, lora, description: prev.description || desc }));
        setPersonALoraSearch('');
        setShowPersonALoraList(false);
    };

    const selectPersonBLora = (lora: string) => {
        const desc = loraDescriptions[lora] || '';
        setPersonB(prev => ({ ...prev, lora, description: prev.description || desc }));
        setPersonBLoraSearch('');
        setShowPersonBLoraList(false);
    };

    const enhancePrompt = async () => {
        if (!prompt.trim() || isEnhancing) return;
        setIsEnhancing(true);
        try {
            const models = await ollamaService.getModels();
            const model = models.find(m => m.name.includes('qwen') || m.name.includes('goonsai'))?.name || models[0]?.name;
            if (!model) {
                toast('No Ollama model available for prompt enhancement', 'error');
                return;
            }

            const personContext = dualPersonMode
                ? `\nThe image contains two people. Person A: ${personA.description || personA.label}. Person B: ${personB.description || personB.label}.`
                : '';

            const system = `You are a prompt enhancer for AI image generation with Z-Image Turbo (a Flux-based model). Take the user's short description and expand it into a detailed, photorealistic prompt. Include realistic lighting, setting details, camera angle, skin texture, clothing details, atmosphere. Keep it under 150 words. Output ONLY the enhanced prompt text, nothing else. No quotes, no labels, no explanations.${personContext}`;

            const enhanced = await ollamaService.generate(model, prompt, system);
            if (enhanced) {
                setPrompt(enhanced);
            }

            // Free VRAM for ComfyUI
            await ollamaService.unloadModel(model);
        } catch (err) {
            console.error('Prompt enhancement failed:', err);
        } finally {
            setIsEnhancing(false);
        }
    };

    // Model Download State
    const [isDownloadingModels, setIsDownloadingModels] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState('');

    const addLora = () => {
        if (!currentLora) return;
        if (selectedLoras.some(l => l.name === currentLora)) return; // Prevent duplicates
        setSelectedLoras([...selectedLoras, { name: currentLora, strength: currentLoraStrength }]);
        setCurrentLora('');
        setCurrentLoraStrength(1.0);
        setShowLoraList(false);
    };

    const removeLora = (index: number) => {
        setSelectedLoras(selectedLoras.filter((_, i) => i !== index));
    };

    // Restored State & Effects
    const [style, setStyle] = useState('No Style');
    const [seed, setSeed] = useState(-1);
    const [availableLoras, setAvailableLoras] = useState<string[]>([]);
    const [availableStyles, setAvailableStyles] = useState<string[]>(['No Style', 'FEDDA Ultra Real', 'FEDDA Portrait Master', 'Photographic', 'Cinematic', 'Anime']);
    const [showLoraList, setShowLoraList] = useState(false);

    const filteredLoras = availableLoras.filter(l =>
        l.toLowerCase().includes(currentLora.toLowerCase())
    );

    useEffect(() => {
        const loadInitialData = async () => {
            try {
                const [loras, styles] = await Promise.all([
                    comfyService.getLoras(),
                    comfyService.getStyles()
                ]);
                setAvailableLoras(loras);
                if (styles && styles.length > 0) {
                    setAvailableStyles(styles);
                }

                // Load LoRA descriptions for auto-fill
                try {
                    const descResp = await fetch('/api/lora/descriptions');
                    if (descResp.ok) {
                        const descData = await descResp.json();
                        if (descData.descriptions) {
                            setLoraDescriptions(descData.descriptions);
                        }
                    }
                } catch (e) {
                    console.warn('Could not load LoRA descriptions:', e);
                }
            } catch (err) {
                console.error("Failed to load initial data", err);
            }
        };
        loadInitialData();
    }, []);

    // Validate and clean up localStorage images on mount
    useEffect(() => {
        const validateImages = async () => {
            if (generatedImages.length === 0) return;

            const validImages: string[] = [];

            for (const imageUrl of generatedImages) {
                try {
                    // Try to fetch the image
                    const response = await fetch(imageUrl, { method: 'HEAD' });
                    if (response.ok) {
                        validImages.push(imageUrl);
                    } else {
                        console.log('🗑️ Removed dead image from gallery:', imageUrl);
                    }
                } catch (error) {
                    console.log('🗑️ Removed dead image from gallery:', imageUrl);
                }
            }

            // Update if any images were removed
            if (validImages.length !== generatedImages.length) {
                setGeneratedImages(validImages);
                localStorage.setItem(`gallery_${modelId}`, JSON.stringify(validImages));
            }
        };

        validateImages();
    }, []); // Run once on mount

    // Save generated images to localStorage when they change
    useEffect(() => {
        if (generatedImages.length > 0) {
            localStorage.setItem(`gallery_${modelId}`, JSON.stringify(generatedImages));
        }
    }, [generatedImages, modelId]);

    // Fetch results when execution completes
    useEffect(() => {
        if (!lastCompletedPromptId) return;

        const fetchResults = async () => {
            try {
                // Small delay to let ComfyUI finalize
                await new Promise(r => setTimeout(r, 800));
                const history = await comfyService.getHistory(lastCompletedPromptId);
                const results = history[lastCompletedPromptId];
                if (results?.outputs) {
                    const images: string[] = [];
                    Object.values(results.outputs).forEach((nodeOutputAny: any) => {
                        if (nodeOutputAny.images) {
                            nodeOutputAny.images.forEach((img: any) => {
                                const url = comfyService.getImageUrl(img.filename, img.subfolder, img.type);
                                images.push(`${url}&t=${Date.now()}`);
                            });
                        }
                    });
                    if (images.length > 0) {
                        setGeneratedImages(prev => [...images, ...prev]);
                    }
                }
            } catch (err) {
                console.error("Results fetch error:", err);
            } finally {
                setIsGenerating(false);
            }
        };

        fetchResults();
    }, [lastCompletedPromptId]);

    const generateSeed = () => Math.floor(Math.random() * 1000000000000000);

    // AI Assist
    const handleEnhancePrompt = async () => {
        if (!prompt.trim()) return;
        setIsEnhancing(true);

        try {
            // Find a suitable text model
            const models = await ollamaService.getModels();
            // Simple heuristic: find a model that IS NOT vision/llava, or default to first available
            const textModel = models.find(m => !m.name.includes('vision') && !m.name.includes('llava')) || models[0];

            if (!textModel) {
                toast('No Ollama text models found! Download one in Settings.', 'error');
                return;
            }

            console.log('🤖 Enhancing prompt using model:', textModel.name);
            const enhanced = await assistantService.enhancePrompt(textModel.name, prompt);
            setPrompt(enhanced);
        } catch (error) {
            console.error('Enhance failed:', error);
            toast('Failed to enhance prompt. Ensure Ollama is running.', 'error');
        } finally {
            setIsEnhancing(false);
        }
    };

    // Face Detailer State
    const [useFaceDetailer, setUseFaceDetailer] = useState(true);

    const handleGenerate = async () => {
        if (!prompt.trim()) return;

        setIsGenerating(true);

        try {
            // Load workflow based on selected model
            const isDual = dualPersonMode && personA.lora && personB.lora;
            let workflowFile: string;
            if (isDual) {
                workflowFile = 'z-image-dual.json';
            } else if (modelId === 'flux' || modelId === 'qwen') {
                workflowFile = 'z-image.json';
            } else {
                workflowFile = `${modelId}.json`;
            }
            const response = await fetch(`/workflows/${workflowFile}`);
            if (!response.ok) throw new Error('Failed to load workflow template');
            const workflow = await response.json();

            // Always generate a fresh random seed for variation
            const activeSeed = generateSeed();

            // Expand wildcards if any exist in the prompt
            let finalPrompt = prompt;
            if (prompt.includes('__')) {
                try {
                    const expandResp = await fetch(`http://localhost:8000/api/wildcards/expand?text=${encodeURIComponent(prompt)}`);
                    const expandData = await expandResp.json();
                    if (expandData.success) {
                        finalPrompt = expandData.expanded;
                        console.log('✨ Expanded Wildcards:', finalPrompt);
                    }
                } catch (e) {
                    console.warn('Wildcard expansion failed, using raw prompt:', e);
                }
            }

            console.log('🚀 Preparing Generation:', {
                model: modelId,
                prompt: finalPrompt,
                style: style,
                seed: activeSeed,
                dualPerson: isDual,
                loras: isDual ? { personA, personB } : selectedLoras
            });

            if (isDual) {
                // === DUAL PERSON WORKFLOW (z-image-dual.json) ===
                const [w, h] = dimensions.split('x').map(Number);

                // KSampler
                workflow["46"].inputs.seed = activeSeed;
                workflow["46"].inputs.steps = steps;
                workflow["46"].inputs.cfg = cfg;

                // Dimensions
                workflow["19"].inputs.width = w;
                workflow["19"].inputs.height = h;

                // Prompt
                workflow["146"].inputs.wildcard_text = finalPrompt;
                workflow["146"].inputs.populated_text = finalPrompt;
                workflow["146"].inputs.seed = activeSeed;
                workflow["118"].inputs.text = "";
                workflow["121"].inputs.text_0 = finalPrompt;
                workflow["122"].inputs.text_0 = finalPrompt;

                // Negative
                workflow["6"].inputs.text = negativePrompt;

                // Person A LoRA (main gen chain + detailer)
                workflow["125"].inputs.lora_name = personA.lora;
                workflow["125"].inputs.strength_model = personA.strength;
                workflow["125"].inputs.strength_clip = personA.strength;
                workflow["207"].inputs.lora_name = personA.lora;
                workflow["207"].inputs.strength_model = personA.strength;
                workflow["207"].inputs.strength_clip = personA.strength;

                // Person B LoRA (main gen chain + detailer)
                workflow["211"].inputs.lora_name = personB.lora;
                workflow["211"].inputs.strength_model = personB.strength;
                workflow["211"].inputs.strength_clip = personB.strength;
                workflow["124"].inputs.lora_name = personB.lora;
                workflow["124"].inputs.strength_model = personB.strength;
                workflow["124"].inputs.strength_clip = personB.strength;

                // Person A detailer description + label
                workflow["208"].inputs.text = personA.description + ", detailed skin pores, 8k uhd";
                workflow["200"].inputs.text_input = personA.label;
                workflow["200"].inputs.seed = generateSeed();

                // Person B detailer description + label
                workflow["119"].inputs.text = personB.description + ", detailed skin pores, 8k uhd";
                workflow["53"].inputs.text_input = personB.label;
                workflow["53"].inputs.seed = generateSeed();

                // Detailer seeds
                workflow["102"].inputs.seed = generateSeed();
                workflow["209"].inputs.seed = generateSeed();

                // Save prefix
                const now = new Date();
                const dateFolder = now.toISOString().split('T')[0];
                workflow["145"].inputs.filename_prefix = `z-image-dual/${dateFolder}/${now.getTime()}_`;
                // Node 147: Save - delete folder for dual
                workflow["147"].inputs.filename_prefix = "delete/pre_dual";

            } else {
                // === SINGLE PERSON WORKFLOW (z-image.json) ===

                // === WILDCARD EXPANSION ===
                let processedPrompt = finalPrompt;
                try {
                    console.log('🔍 Expanding Wildcards for Prompt:', finalPrompt);
                    const expandResp = await fetch(`http://localhost:8000/api/wildcards/expand?text=${encodeURIComponent(finalPrompt)}`);
                    const expandData = await expandResp.json();
                    if (expandData.success && expandData.expanded) {
                        processedPrompt = expandData.expanded;
                        console.log('✨ Expanded Prompt:', processedPrompt);
                    }
                } catch (e) {
                    console.error('Wildcard expansion failed, using fallback:', e);
                }

                // Node 3: KSampler (Seed, Steps, CFG)
                if (workflow["3"]) {
                    workflow["3"].inputs.seed = activeSeed;
                    workflow["3"].inputs.steps = steps;
                    workflow["3"].inputs.cfg = cfg;
                }

                // Updated Nodes with PROCESSED (expanded) prompt
                if (workflow["33"]) {
                    workflow["33"].inputs.string = processedPrompt;
                }
                if (workflow["6"]) {
                    workflow["6"].inputs.text = processedPrompt;
                }

                // Node 34: Negative Prompt
                if (workflow["34"]) {
                    workflow["34"].inputs.string = negativePrompt;
                }

                // Node 30: Dimensions
                if (workflow["30"]) {
                    const [w, h] = dimensions.split('x').map(Number);
                    workflow["30"].inputs.width = w;
                    workflow["30"].inputs.height = h;
                }

                // Node 31: Style (CSV Loader)
                if (workflow["31"]) {
                    workflow["31"].inputs.styles = style;
                    workflow["31"].inputs.csv_file_path = "styles.csv";
                }

                // Node 126: Multiple LoRAs (Power Lora Loader)
                if (workflow["126"]) {
                    if (selectedLoras.length > 0) {
                        selectedLoras.slice(0, 5).forEach((l, index) => {
                            workflow["126"].inputs[`lora_${index + 1}`] = {
                                on: true,
                                lora: l.name,
                                strength: l.strength
                            };
                        });
                    }
                }

                // Face Detailer resolution fix
                if (workflow["181"]) {
                    const [w, h] = dimensions.split('x').map(Number);
                    const maxDim = Math.max(w, h);
                    workflow["181"].inputs.guide_size = maxDim;
                    workflow["181"].inputs.max_size = maxDim;
                }

                // Node 9: SaveImage - date-based folder
                if (workflow["9"]) {
                    const now = new Date();
                    const dateFolder = now.toISOString().split('T')[0];
                    workflow["9"].inputs.filename_prefix = `${modelId}/${dateFolder}/${now.getTime()}_`;
                }
            }

            console.log('📝 Modified Workflow sent to ComfyUI:', workflow);
            const promptId = await queueWorkflow(workflow);
            console.log('✅ Queued:', promptId);

        } catch (error: any) {
            console.error('❌ Generation failed:', error);
            toast(error?.message || 'Generation failed! Check console for details.', 'error');
            setIsGenerating(false);
        }
    };


    // I2T Assist (Vision)
    const [isDescribing, setIsDescribing] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [showScanModal, setShowScanModal] = useState(false);

    // Handle Image Analysis
    const processImage = async (file: File) => {
        setIsDescribing(true);
        try {
            const models = await ollamaService.getModels();
            const visionModel = models.find(m =>
                m.name.toLowerCase().includes('vision') ||
                m.name.toLowerCase().includes('llava') ||
                m.name.toLowerCase().includes('joycaption')
            );

            if (!visionModel) {
                toast('No Ollama VISION model found! Download one in Settings.', 'error');
                return;
            }

            console.log('👁️ Analyzing image with:', visionModel.name);

            const reader = new FileReader();
            reader.onload = async (e) => {
                const base64 = e.target?.result as string;
                if (!base64) return;

                try {
                    const description = await assistantService.describeImage(visionModel.name, base64);
                    setPrompt(description);
                } catch (err) {
                    console.error(err);
                    toast('Failed to get description from Ollama.', 'error');
                } finally {
                    setIsDescribing(false);
                }
            };
            reader.readAsDataURL(file);

        } catch (err) {
            console.error(err);
            setIsDescribing(false);
        }
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            await processImage(file);
        }
    };

    const handleDeleteImage = async (imageUrl: string, index: number) => {
        try {
            // Extract filename from URL
            const urlParams = new URLSearchParams(imageUrl.split('?')[1]);
            const filename = urlParams.get('filename');
            const subfolder = urlParams.get('subfolder') || '';

            if (!filename) {
                console.error('Could not extract filename from URL');
                return;
            }

            // Delete from disk via backend
            const { BACKEND_API } = await import('../config/api');
            const response = await fetch(`${BACKEND_API.BASE_URL}${BACKEND_API.ENDPOINTS.FILES_DELETE}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename, subfolder, type: 'output' })
            });

            if (!response.ok) {
                throw new Error('Failed to delete image from disk');
            }

            // Remove from UI and localStorage
            setGeneratedImages(prev => prev.filter((_, i) => i !== index));
            console.log('✅ Image deleted from disk:', filename);
        } catch (error) {
            console.error('❌ Delete failed:', error);
            toast('Failed to delete image. Is backend server running?', 'error');
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Model Downloader stays fixed at the top if models are missing */}
            <ModelDownloader modelGroup="z-image" />

            <div className={`p-8 grid grid-cols-1 ${showGallery ? 'lg:grid-cols-3' : 'lg:grid-cols-1 w-full'} gap-8 h-full transition-all duration-500 overflow-y-auto custom-scrollbar`}>
                {/* Left: Controls */}
                <div className={`space-y-6 ${showGallery ? 'lg:col-span-1' : 'w-full max-w-full'}`}>

                    {/* Prompt Container (Drag Target) */}
                    <div
                        className={`bg-[#121218] border transition-all duration-300 rounded-2xl p-6 shadow-xl relative overflow-hidden group/prompt ${isDragging ? 'border-white/50 bg-white/5' : 'border-white/5'}`}
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={handleDrop}
                    >
                        {/* Drag Overlay */}
                        <div className={`absolute inset-0 z-50 flex items-center justify-center bg-[#121218]/90 backdrop-blur-sm transition-opacity duration-300 pointer-events-none ${isDragging ? 'opacity-100' : 'opacity-0'}`}>
                            <div className="text-white font-bold text-lg animate-bounce flex flex-col items-center gap-2">
                                <Upload className="w-8 h-8" />
                                Drop Image to Analyze
                            </div>
                        </div>

                        <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-3">
                            Prompt
                        </label>

                        <textarea
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                    e.preventDefault();
                                    handleGenerate();
                                }
                            }}
                            className="w-full h-40 bg-[#0a0a0f] border border-white/10 rounded-xl p-4 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-white/20 resize-none transition-all"
                            placeholder={`Describe what you want to create... (Ctrl + Enter to generate)\nOr Drag & Drop an Image here to Capture`}
                        />

                        <div className="flex items-center justify-between mt-2">
                            <p className="text-xs text-slate-500 flex items-center gap-2">
                                <Eye className="w-3 h-3" />
                                <span>Tip: Drag an image to auto-generate a prompt</span>
                            </p>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setShowPromptLibrary(true)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-white/5 border border-white/10 text-white hover:bg-white/15 transition-all"
                                >
                                    <BookOpen className="w-3 h-3" />
                                    Library
                                </button>
                                <button
                                    onClick={enhancePrompt}
                                    disabled={isEnhancing || !prompt.trim()}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-white text-black hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                                >
                                    {isEnhancing ? (
                                        <><Loader2 className="w-3 h-3 animate-spin" /> Enhancing...</>
                                    ) : (
                                        <><Sparkles className="w-3 h-3" /> Enhance Prompt</>
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Scan Image Modal */}
                        {showScanModal && (
                            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                                <div className="bg-[#18181b] border border-white/10 rounded-2xl p-8 max-w-md w-full shadow-2xl relative">
                                    <button
                                        onClick={() => setShowScanModal(false)}
                                        className="absolute top-4 right-4 text-slate-500 hover:text-white"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>

                                    <div className="text-center space-y-4">
                                        <div className="mx-auto w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center">
                                            <Eye className="w-8 h-8 text-blue-400" />
                                        </div>
                                        <h3 className="text-xl font-bold text-white">Scan Image to Prompt</h3>
                                        <p className="text-sm text-slate-400">
                                            Drag & drop an image here, or click to browse your files.
                                            The AI will analyze it and write a prompt for you.
                                        </p>

                                        <div
                                            className="border-2 border-dashed border-white/10 hover:border-blue-500/50 hover:bg-blue-500/5 rounded-xl p-10 cursor-pointer transition-all"
                                            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                            onDrop={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                const file = e.dataTransfer.files[0];
                                                if (file && file.type.startsWith('image/')) {
                                                    processImage(file);
                                                    setShowScanModal(false);
                                                }
                                            }}
                                            onClick={() => document.getElementById('modal-upload-trigger')?.click()}
                                        >
                                            <Upload className="w-8 h-8 text-slate-500 mx-auto mb-2" />
                                            <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">Drop Image Here</span>
                                        </div>
                                        <input
                                            type="file"
                                            id="modal-upload-trigger"
                                            className="hidden"
                                            accept="image/*"
                                            onChange={(e) => {
                                                if (e.target.files?.[0]) {
                                                    processImage(e.target.files[0]);
                                                    setShowScanModal(false);
                                                }
                                            }}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="mt-6">
                            <Button
                                variant="primary"
                                size="lg"
                                className="w-full bg-white hover:bg-slate-200 text-black border-none shadow-lg transition-all duration-300 rounded-xl font-bold tracking-wide"
                                isLoading={isGenerating}
                                onClick={handleGenerate}
                                disabled={!prompt.trim()}
                            >
                                {isGenerating ? 'Generating...' : 'Generate'}
                            </Button>
                        </div>
                    </div>

                    {/* Advanced Settings (Collapsible) */}
                    <div className="bg-[#121218] border border-white/5 rounded-2xl p-6 shadow-xl leading-relaxed">
                        <button
                            onClick={() => setShowAdvanced(!showAdvanced)}
                            className="w-full flex items-center justify-between text-sm font-medium text-slate-300 hover:text-white transition-colors"
                        >
                            <span>Advanced Settings</span>
                            <ChevronRight
                                className={`w-4 h-4 transition-transform duration-200 ${showAdvanced ? 'rotate-90' : ''
                                    }`}
                            />
                        </button>

                        {showAdvanced && (
                            <div className="mt-4 space-y-4 animate-in slide-in-from-top-2 fade-in duration-200">
                                {/* Face Detailer Toggle */}
                                <div className="flex items-center justify-between border-b border-white/5 pb-4">
                                    <label className="text-xs text-slate-400 uppercase tracking-wider">
                                        Face Detailer (Auto-Fix)
                                    </label>
                                    <button
                                        onClick={() => setUseFaceDetailer(!useFaceDetailer)}
                                        className={`w-12 h-6 rounded-full transition-colors duration-200 flex items-center px-1 ${useFaceDetailer ? 'bg-blue-600' : 'bg-slate-700'
                                            }`}
                                    >
                                        <div
                                            className={`w-4 h-4 bg-white rounded-full transition-transform duration-200 ${useFaceDetailer ? 'translate-x-6' : 'translate-x-0'
                                                }`}
                                        />
                                    </button>
                                </div>
                                <div className="flex items-center justify-between border-b border-white/5 pb-4">
                                    <label className="text-xs text-slate-400 uppercase tracking-wider">
                                        Dual Person Mode
                                    </label>
                                    <button
                                        onClick={() => setDualPersonMode(!dualPersonMode)}
                                        className={`w-12 h-6 rounded-full transition-colors duration-200 flex items-center px-1 ${dualPersonMode ? 'bg-purple-600' : 'bg-slate-700'}`}
                                    >
                                        <div className={`w-4 h-4 bg-white rounded-full transition-transform duration-200 ${dualPersonMode ? 'translate-x-6' : 'translate-x-0'}`} />
                                    </button>
                                </div>

                                {/* Dual Person Cards */}
                                {dualPersonMode && (
                                    <div className="space-y-4 border-b border-white/5 pb-4">
                                        {/* Person A */}
                                        <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-4 space-y-3">
                                            <label className="block text-xs font-bold text-purple-300 uppercase tracking-wider">Person A</label>
                                            <div className="relative">
                                                <input
                                                    type="text"
                                                    value={personA.lora ? personA.lora : personALoraSearch}
                                                    onChange={(e) => { setPersonALoraSearch(e.target.value); setPersonA({ ...personA, lora: '' }); setShowPersonALoraList(true); }}
                                                    onFocus={() => setShowPersonALoraList(true)}
                                                    onBlur={() => setTimeout(() => setShowPersonALoraList(false), 200)}
                                                    placeholder="Select LoRA..."
                                                    className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                                                />
                                                {personA.lora && (
                                                    <button onClick={() => setPersonA({ ...personA, lora: '' })} className="absolute right-2 top-2 text-slate-500 hover:text-red-400">
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                )}
                                                {showPersonALoraList && (
                                                    <div className="absolute z-50 w-full mt-1 bg-[#1a1a24] border border-white/10 rounded-xl shadow-2xl max-h-40 overflow-y-auto custom-scrollbar">
                                                        {availableLoras.filter(l => l.toLowerCase().includes(personALoraSearch.toLowerCase())).map((l, idx) => (
                                                            <button key={idx} onClick={() => selectPersonALora(l)}
                                                                className="w-full text-left px-4 py-2 text-sm text-slate-300 hover:bg-white/10 hover:text-white transition-colors">{l}</button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="text-xs text-slate-500 w-8">Str</span>
                                                <input type="range" min="0" max="2" step="0.05" value={personA.strength}
                                                    onChange={(e) => setPersonA({ ...personA, strength: parseFloat(e.target.value) })}
                                                    className="flex-1 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-purple-400" />
                                                <span className="text-xs text-slate-400 w-8 text-right">{personA.strength}</span>
                                            </div>
                                            <input type="text" value={personA.label} onChange={(e) => setPersonA({ ...personA, label: e.target.value })}
                                                placeholder="Florence2 label (e.g. man)"
                                                className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-500/30" />
                                            <textarea value={personA.description} onChange={(e) => setPersonA({ ...personA, description: e.target.value })}
                                                placeholder="Person A face description for detailer..."
                                                className="w-full h-16 bg-[#0a0a0f] border border-white/10 rounded-lg p-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-purple-500/30 resize-none" />
                                        </div>

                                        {/* Person B */}
                                        <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 space-y-3">
                                            <label className="block text-xs font-bold text-blue-300 uppercase tracking-wider">Person B</label>
                                            <div className="relative">
                                                <input
                                                    type="text"
                                                    value={personB.lora ? personB.lora : personBLoraSearch}
                                                    onChange={(e) => { setPersonBLoraSearch(e.target.value); setPersonB({ ...personB, lora: '' }); setShowPersonBLoraList(true); }}
                                                    onFocus={() => setShowPersonBLoraList(true)}
                                                    onBlur={() => setTimeout(() => setShowPersonBLoraList(false), 200)}
                                                    placeholder="Select LoRA..."
                                                    className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                                                />
                                                {personB.lora && (
                                                    <button onClick={() => setPersonB({ ...personB, lora: '' })} className="absolute right-2 top-2 text-slate-500 hover:text-red-400">
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                )}
                                                {showPersonBLoraList && (
                                                    <div className="absolute z-50 w-full mt-1 bg-[#1a1a24] border border-white/10 rounded-xl shadow-2xl max-h-40 overflow-y-auto custom-scrollbar">
                                                        {availableLoras.filter(l => l.toLowerCase().includes(personBLoraSearch.toLowerCase())).map((l, idx) => (
                                                            <button key={idx} onClick={() => selectPersonBLora(l)}
                                                                className="w-full text-left px-4 py-2 text-sm text-slate-300 hover:bg-white/10 hover:text-white transition-colors">{l}</button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="text-xs text-slate-500 w-8">Str</span>
                                                <input type="range" min="0" max="2" step="0.05" value={personB.strength}
                                                    onChange={(e) => setPersonB({ ...personB, strength: parseFloat(e.target.value) })}
                                                    className="flex-1 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-400" />
                                                <span className="text-xs text-slate-400 w-8 text-right">{personB.strength}</span>
                                            </div>
                                            <input type="text" value={personB.label} onChange={(e) => setPersonB({ ...personB, label: e.target.value })}
                                                placeholder="Florence2 label (e.g. woman)"
                                                className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
                                            <textarea value={personB.description} onChange={(e) => setPersonB({ ...personB, description: e.target.value })}
                                                placeholder="Person B face description for detailer..."
                                                className="w-full h-16 bg-[#0a0a0f] border border-white/10 rounded-lg p-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-none" />
                                        </div>
                                    </div>
                                )}

                                {/* LoRA Stack (hidden in dual mode) */}
                                {!dualPersonMode && (
                                    <div className="space-y-4 border-b border-white/5 pb-4">
                                        <label className="block text-xs text-slate-400 uppercase tracking-wider">
                                            LoRA Stack
                                        </label>

                                        {/* LoRA Builder Input */}
                                        <div className="space-y-3 bg-black/20 p-3 rounded-lg border border-white/5">
                                            <div className="relative">
                                                <input
                                                    type="text"
                                                    value={currentLora}
                                                    onChange={(e) => {
                                                        setCurrentLora(e.target.value);
                                                        setShowLoraList(true);
                                                    }}
                                                    onFocus={() => setShowLoraList(true)}
                                                    onBlur={() => setTimeout(() => setShowLoraList(false), 200)}
                                                    placeholder="Select LoRA..."
                                                    className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg pl-3 pr-8 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-white/20"
                                                />
                                                {showLoraList && filteredLoras.length > 0 && (
                                                    <div className="absolute z-50 w-full mt-1 bg-[#1a1a24] border border-white/10 rounded-xl shadow-2xl max-h-40 overflow-y-auto custom-scrollbar">
                                                        {filteredLoras.map((l, idx) => (
                                                            <button
                                                                key={idx}
                                                                onClick={() => {
                                                                    setCurrentLora(l);
                                                                    setShowLoraList(false);
                                                                }}
                                                                className="w-full text-left px-4 py-2 text-sm text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
                                                            >
                                                                {l}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="flex items-center gap-3">
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="2"
                                                    step="0.1"
                                                    value={currentLoraStrength}
                                                    onChange={(e) => setCurrentLoraStrength(parseFloat(e.target.value))}
                                                    className="flex-1 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-white"
                                                />
                                                <span className="text-xs text-slate-400 w-8 text-right">{currentLoraStrength}</span>
                                                <Button
                                                    size="sm"
                                                    variant="secondary"
                                                    onClick={addLora}
                                                    disabled={!currentLora}
                                                    className="h-7 text-xs"
                                                >
                                                    Add
                                                </Button>
                                            </div>
                                        </div>

                                        {/* Selected LoRAs List */}
                                        {selectedLoras.length > 0 && (
                                            <div className="space-y-2">
                                                {selectedLoras.map((l, idx) => (
                                                    <div key={idx} className="flex items-center justify-between bg-white/5 px-3 py-2 rounded-lg text-sm border border-white/5">
                                                        <div className="flex flex-col">
                                                            <span className="text-slate-200 truncate max-w-[150px]" title={l.name}>{l.name}</span>
                                                            <span className="text-xs text-slate-500">Str: {l.strength}</span>
                                                        </div>
                                                        <button
                                                            onClick={() => removeLora(idx)}
                                                            className="text-slate-500 hover:text-red-400 transition-colors"
                                                        >
                                                            <X className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Negative Prompt */}
                                <div>
                                    <label className="block text-xs text-slate-400 mb-2 uppercase tracking-wider">
                                        Negative Prompt
                                    </label>
                                    <textarea
                                        value={negativePrompt}
                                        onChange={(e) => setNegativePrompt(e.target.value)}
                                        className="w-full h-24 bg-[#0a0a0f] border border-white/10 rounded-xl p-3 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-white/20 resize-none transition-all"
                                        placeholder="Things to avoid... (e.g. blurry, low quality)"
                                    />
                                </div>

                                {/* Steps */}
                                <div>
                                    <label className="block text-xs text-slate-400 mb-2">
                                        Steps: {steps}
                                    </label>
                                    <input
                                        type="range"
                                        min="1"
                                        max="50"
                                        value={steps}
                                        onChange={(e) => setSteps(parseInt(e.target.value))}
                                        className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-white"
                                    />
                                </div>

                                {/* CFG Scale */}
                                <div>
                                    <label className="block text-xs text-slate-400 mb-2">
                                        CFG Scale: {cfg}
                                    </label>
                                    <input
                                        type="range"
                                        min="1"
                                        max="20"
                                        step="0.5"
                                        value={cfg}
                                        onChange={(e) => setCfg(parseFloat(e.target.value))}
                                        className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-white"
                                    />
                                </div>

                                {/* Dimensions */}
                                <div>
                                    <label className="block text-xs text-slate-400 mb-2">
                                        Dimensions
                                    </label>
                                    <select
                                        value={dimensions}
                                        onChange={(e) => setDimensions(e.target.value)}
                                        className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-white/20"
                                    >
                                        <option value="1504x1504">1504x1504 (1:1)</option>
                                        <option value="1920x1080">1920x1080 (16:9)</option>
                                        <option value="1080x1920">1080x1920 (9:16)</option>
                                        <option value="1024x1024">1024x1024 (1:1)</option>
                                    </select>
                                </div>

                                {/* Style */}
                                <div>
                                    <label className="block text-xs text-slate-400 mb-2">
                                        Style
                                    </label>
                                    <select
                                        value={style}
                                        onChange={(e) => setStyle(e.target.value)}
                                        className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-white/20"
                                    >
                                        {availableStyles.map((s) => (
                                            <option key={s} value={s}>{s}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* Seed */}
                                <div>
                                    <label className="block text-xs text-slate-400 mb-2">
                                        Seed (-1 for random)
                                    </label>
                                    <input
                                        type="number"
                                        value={seed}
                                        onChange={(e) => setSeed(parseInt(e.target.value))}
                                        className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-white/20"
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right: Gallery / Preview */}
                {showGallery && (
                    <div className="lg:col-span-2 bg-[#121218] border border-white/5 rounded-2xl p-1 flex flex-col items-center justify-center relative overflow-hidden group min-h-[600px] animate-in slide-in-from-right-4 duration-500">
                        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none"></div>

                        {isGenerating || execState === 'executing' ? (
                            <div className="z-10 w-full max-w-md p-8 text-center space-y-6">
                                <div className="relative w-24 h-24 mx-auto">
                                    <div className="absolute inset-0 border-4 border-white/20 rounded-full animate-pulse"></div>
                                    <div className="absolute inset-0 border-t-4 border-white rounded-full animate-spin"></div>
                                    <Sparkles className="absolute inset-0 m-auto w-8 h-8 text-white animate-bounce" />
                                </div>

                                <div className="space-y-2">
                                    <p className="text-white font-medium text-lg tracking-tight">{currentNodeName || 'Initializing...'}</p>
                                    {execProgress > 0 && <p className="text-white font-bold text-2xl">{execProgress}%</p>}
                                </div>

                                {execProgress > 0 && (
                                    <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-white transition-all duration-300 shadow-[0_0_10px_rgba(255,255,255,0.3)]"
                                            style={{ width: `${execProgress}%` }}
                                        ></div>
                                    </div>
                                )}

                                <p className="text-slate-500 text-sm animate-pulse">Processing your vision...</p>
                            </div>
                        ) : generatedImages.length === 0 ? (
                            <div className="text-center">
                                <div className="w-24 h-24 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-500">
                                    <Sparkles className="w-10 h-10 text-slate-600" />
                                </div>
                                <p className="text-slate-500 font-medium">Ready for input</p>
                                <p className="text-xs text-slate-600 mt-1">Generate a masterpiece</p>
                            </div>
                        ) : (
                            <div className="w-full h-full p-4 overflow-y-auto custom-scrollbar">
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                    {generatedImages.map((img, idx) => (
                                        <div
                                            key={idx}
                                            className="group relative aspect-square bg-black/20 rounded-xl overflow-hidden border border-white/10 hover:border-white/50 transition-all duration-300"
                                        >
                                            <img
                                                src={img}
                                                alt={`Generated ${idx}`}
                                                className="w-full h-full object-cover cursor-pointer transition-transform duration-500 group-hover:scale-110"
                                                onClick={() => setSelectedImage(img)}
                                            />

                                            {/* Hover Actions */}
                                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-300 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-3">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setSelectedImage(img);
                                                    }}
                                                    className="p-3 bg-white/10 hover:bg-white/20 rounded-full backdrop-blur-sm transition-all"
                                                >
                                                    <Maximize2 className="w-5 h-5 text-white" />
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        localStorage.setItem('active_input_image', img);
                                                        toast('Image selected for Video generation! Go to Video tab.', 'success');
                                                    }}
                                                    className="p-3 bg-blue-500/20 hover:bg-blue-500/30 rounded-full backdrop-blur-sm transition-all"
                                                    title="Use as input for Video (LTX)"
                                                >
                                                    <Video className="w-5 h-5 text-blue-400" />
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (confirm('Delete this image permanently?')) {
                                                            handleDeleteImage(img, idx);
                                                        }
                                                    }}
                                                    className="p-3 bg-red-500/20 hover:bg-red-500/30 rounded-full backdrop-blur-sm transition-all"
                                                >
                                                    <Trash2 className="w-5 h-5 text-red-400" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Prompt Library Drawer */}
                <PromptLibrary
                    isOpen={showPromptLibrary}
                    onClose={() => setShowPromptLibrary(false)}
                    onSelect={(positive, negative) => {
                        setPrompt(positive);
                        if (negative) setNegativePrompt(negative);
                    }}
                />

                {/* Lightbox / Fullscreen Preview */}
                {selectedImage && (
                    <div
                        className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm flex items-center justify-center p-4 md:p-8 animate-in fade-in duration-200"
                        onClick={() => setSelectedImage(null)}
                    >
                        <button
                            onClick={() => setSelectedImage(null)}
                            className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
                        >
                            <X className="w-6 h-6" />
                        </button>

                        <img
                            src={selectedImage}
                            alt="Full size"
                            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-300"
                            onClick={(e) => e.stopPropagation()}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};
