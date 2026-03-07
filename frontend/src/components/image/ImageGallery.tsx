import { useState, useEffect, useRef } from 'react';
import { Sparkles, Maximize2, X, Trash2, Video, FileText } from 'lucide-react';
import { comfyService } from '../../services/comfyService';
import { useComfyExecution } from '../../contexts/ComfyExecutionContext';
import { useToast } from '../ui/Toast';

interface ImageGalleryProps {
    generatedImages: string[];
    setGeneratedImages: React.Dispatch<React.SetStateAction<string[]>>;
    isGenerating: boolean;
    setIsGenerating: React.Dispatch<React.SetStateAction<boolean>>;
    galleryKey: string;
    onSendToTab?: (tab: string, imageUrl: string) => void;
}

export const ImageGallery = ({ generatedImages, setGeneratedImages, isGenerating, setIsGenerating, galleryKey, onSendToTab }: ImageGalleryProps) => {
    const { state: execState, progress: execProgress, currentNodeName, lastCompletedPromptId, outputReadyCount } = useComfyExecution();
    const { toast } = useToast();
    const [selectedImage, setSelectedImage] = useState<string | null>(null);

    // Validate images on mount
    useEffect(() => {
        const validateImages = async () => {
            if (generatedImages.length === 0) return;
            const validImages: string[] = [];
            for (const imageUrl of generatedImages) {
                try {
                    const response = await fetch(imageUrl, { method: 'HEAD' });
                    if (response.ok) validImages.push(imageUrl);
                } catch { /* skip dead images */ }
            }
            if (validImages.length !== generatedImages.length) {
                setGeneratedImages(validImages);
                localStorage.setItem(`gallery_${galleryKey}`, JSON.stringify(validImages));
            }
        };
        validateImages();
    }, []);

    // Save to localStorage when images change
    useEffect(() => {
        if (generatedImages.length > 0) {
            localStorage.setItem(`gallery_${galleryKey}`, JSON.stringify(generatedImages));
        }
    }, [generatedImages, galleryKey]);

    // Incrementally fetch images as each output node completes
    const knownFilenamesRef = useRef<Set<string>>(new Set());
    const lastFetchedPromptRef = useRef<string | null>(null);

    // Reset known filenames when a new prompt starts
    useEffect(() => {
        if (execState === 'executing' && lastCompletedPromptId !== lastFetchedPromptRef.current) {
            knownFilenamesRef.current.clear();
        }
    }, [execState]);

    // Fetch on every outputReadyCount change (each SaveImage node completion)
    useEffect(() => {
        if (outputReadyCount === 0) return;
        if (!lastCompletedPromptId) return;
        lastFetchedPromptRef.current = lastCompletedPromptId;

        const fetchResults = async () => {
            try {
                await new Promise(r => setTimeout(r, 300));
                const history = await comfyService.getHistory(lastCompletedPromptId);
                const results = history[lastCompletedPromptId];
                if (results?.outputs) {
                    const newImages: string[] = [];
                    Object.values(results.outputs).forEach((nodeOutputAny: any) => {
                        if (nodeOutputAny.images) {
                            nodeOutputAny.images.forEach((img: any) => {
                                // Deduplicate by filename — only add images we haven't seen
                                if (!knownFilenamesRef.current.has(img.filename)) {
                                    knownFilenamesRef.current.add(img.filename);
                                    const url = comfyService.getImageUrl(img.filename, img.subfolder, img.type);
                                    newImages.push(`${url}&t=${Date.now()}`);
                                }
                            });
                        }
                    });
                    if (newImages.length > 0) {
                        setGeneratedImages(prev => [...newImages, ...prev]);
                    }
                }
            } catch (err) {
                console.error("Results fetch error:", err);
            }
        };
        fetchResults();
    }, [outputReadyCount]);

    // Clear isGenerating when workflow finishes
    useEffect(() => {
        if (execState === 'done') {
            setIsGenerating(false);
        }
    }, [execState]);

    // Safety fallback: if execution finished but isGenerating is still stuck, force reset
    useEffect(() => {
        if (execState === 'done' && isGenerating) {
            const timer = setTimeout(() => {
                setIsGenerating(false);
            }, 6000);
            return () => clearTimeout(timer);
        }
    }, [execState, isGenerating]);

    const handleDeleteImage = async (imageUrl: string, index: number) => {
        try {
            const urlParams = new URLSearchParams(imageUrl.split('?')[1]);
            const filename = urlParams.get('filename');
            const subfolder = urlParams.get('subfolder') || '';
            if (!filename) return;

            const { BACKEND_API } = await import('../../config/api');
            const response = await fetch(`${BACKEND_API.BASE_URL}${BACKEND_API.ENDPOINTS.FILES_DELETE}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename, subfolder, type: 'output' })
            });
            if (!response.ok) throw new Error('Failed to delete image from disk');
            setGeneratedImages(prev => prev.filter((_, i) => i !== index));
        } catch (error) {
            console.error('Delete failed:', error);
            toast('Failed to delete image. Is backend server running?', 'error');
        }
    };

    return (
        <>
            <div className="lg:col-span-1 bg-[#121218] border border-white/5 rounded-2xl p-1 flex flex-col relative overflow-hidden group min-h-[400px] animate-in slide-in-from-right-4 duration-500">
                <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none"></div>

                {/* Compact generating indicator — stays at top, doesn't replace gallery */}
                {(isGenerating || execState === 'executing') && (
                    <div className="z-10 w-full px-4 py-3 bg-white/5 border-b border-white/10 flex items-center gap-3 shrink-0">
                        <div className="relative w-8 h-8 shrink-0">
                            <div className="absolute inset-0 border-2 border-white/20 rounded-full"></div>
                            <div className="absolute inset-0 border-t-2 border-white rounded-full animate-spin"></div>
                            <Sparkles className="absolute inset-0 m-auto w-3.5 h-3.5 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-white text-xs font-medium truncate">{currentNodeName || 'Initializing...'}</p>
                            {execProgress > 0 && (
                                <div className="w-full h-1 bg-white/10 rounded-full mt-1 overflow-hidden">
                                    <div className="h-full bg-white transition-all duration-300" style={{ width: `${execProgress}%` }}></div>
                                </div>
                            )}
                        </div>
                        {execProgress > 0 && <span className="text-white text-xs font-bold shrink-0">{execProgress}%</span>}
                    </div>
                )}

                {generatedImages.length === 0 && !(isGenerating || execState === 'executing') ? (
                    <div className="flex-1 flex items-center justify-center text-center">
                        <div>
                            <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform duration-500">
                                <Sparkles className="w-7 h-7 text-slate-600" />
                            </div>
                            <p className="text-slate-500 font-medium text-sm">Ready for input</p>
                            <p className="text-xs text-slate-600 mt-1">Generate a masterpiece</p>
                        </div>
                    </div>
                ) : (
                    <div className="w-full flex-1 p-3 overflow-y-auto custom-scrollbar">
                        <div className="grid grid-cols-2 gap-3">
                            {generatedImages.map((img, idx) => (
                                <div key={idx} className="group/card relative aspect-square bg-black/20 rounded-xl overflow-hidden border border-white/10 hover:border-white/50 transition-all duration-300">
                                    <img src={img} alt={`Generated ${idx}`} draggable className="w-full h-full object-cover cursor-pointer transition-transform duration-500 group-hover/card:scale-110" onClick={() => setSelectedImage(img)} />
                                    <div className="absolute inset-0 bg-black/0 group-hover/card:bg-black/40 transition-all duration-300 opacity-0 group-hover/card:opacity-100 flex items-center justify-center gap-1.5">
                                        <button onClick={(e) => { e.stopPropagation(); setSelectedImage(img); }} className="p-2 bg-white/10 hover:bg-white/20 rounded-full backdrop-blur-sm transition-all" title="View full size">
                                            <Maximize2 className="w-3.5 h-3.5 text-white" />
                                        </button>
                                        {onSendToTab && (
                                            <button onClick={(e) => { e.stopPropagation(); onSendToTab('metadata', img); }} className="p-2 bg-amber-500/20 hover:bg-amber-500/30 rounded-full backdrop-blur-sm transition-all" title="Read metadata">
                                                <FileText className="w-3.5 h-3.5 text-amber-400" />
                                            </button>
                                        )}
                                        <button onClick={(e) => { e.stopPropagation(); localStorage.setItem('active_input_image', img); toast('Image selected for Video generation! Go to Video tab.', 'success'); }} className="p-2 bg-blue-500/20 hover:bg-blue-500/30 rounded-full backdrop-blur-sm transition-all" title="Use as input for Video">
                                            <Video className="w-3.5 h-3.5 text-blue-400" />
                                        </button>
                                        <button onClick={(e) => { e.stopPropagation(); if (confirm('Delete this image permanently?')) handleDeleteImage(img, idx); }} className="p-2 bg-red-500/20 hover:bg-red-500/30 rounded-full backdrop-blur-sm transition-all" title="Delete">
                                            <Trash2 className="w-3.5 h-3.5 text-red-400" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Lightbox */}
            {selectedImage && (
                <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm flex items-center justify-center p-4 md:p-8 animate-in fade-in duration-200" onClick={() => setSelectedImage(null)}>
                    <button onClick={() => setSelectedImage(null)} className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors">
                        <X className="w-6 h-6" />
                    </button>
                    <img src={selectedImage} alt="Full size" className="max-w-full max-h-full object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-300" onClick={(e) => e.stopPropagation()} />
                </div>
            )}
        </>
    );
};
