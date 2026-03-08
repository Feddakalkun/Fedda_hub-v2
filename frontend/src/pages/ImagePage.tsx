// Image Generation Page — Tab Container
import { useState, useCallback } from 'react';
import { Sparkles, Image, Paintbrush, Layers, FileText } from 'lucide-react';
import { ModelDownloader } from '../components/ModelDownloader';
import { ImageGallery } from '../components/image/ImageGallery';
import { GenerateTab } from '../components/image/GenerateTab';
import { HQPortraitTab } from '../components/image/HQPortraitTab';
import { Img2ImgTab } from '../components/image/Img2ImgTab';
import { InpaintTab } from '../components/image/InpaintTab';
import { MetadataTab } from '../components/image/MetadataTab';

type ImageMode = 'generate' | 'hq' | 'img2img' | 'inpaint' | 'metadata';

const TABS: { id: ImageMode; label: string; icon: React.ElementType }[] = [
    { id: 'generate', label: 'GENERATE', icon: Sparkles },
    { id: 'hq', label: 'HQ PORTRAIT', icon: Layers },
    { id: 'img2img', label: 'IMG2IMG', icon: Image },
    { id: 'inpaint', label: 'INPAINT', icon: Paintbrush },
    { id: 'metadata', label: 'METADATA', icon: FileText },
];

interface ImagePageProps {
    modelId: string;
    modelLabel: string;
}

export const ImagePage = ({ modelId }: ImagePageProps) => {
    const [activeMode, setActiveMode] = useState<ImageMode>('generate');
    const [isGenerating, setIsGenerating] = useState(false);
    const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null);
    const [generatedImages, setGeneratedImages] = useState<string[]>(() => {
        const saved = localStorage.getItem(`gallery_${modelId}`);
        return saved ? JSON.parse(saved) : [];
    });

    const handleSendToTab = useCallback((tab: string, imageUrl: string) => {
        setPendingImageUrl(imageUrl);
        setActiveMode(tab as ImageMode);
    }, []);

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Model Downloader (fixed at top) */}
            <ModelDownloader modelGroup="z-image" />

            {/* Tab Bar */}
            <div className="px-8 pt-4 pb-0 flex gap-2">
                {TABS.map(({ id, label, icon: Icon }) => (
                    <button
                        key={id}
                        onClick={() => setActiveMode(id)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-t-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 border border-b-0 ${
                            activeMode === id
                                ? 'bg-[#121218] text-white border-white/10'
                                : 'bg-transparent text-slate-500 border-transparent hover:text-slate-300 hover:bg-white/5'
                        }`}
                    >
                        <Icon className="w-3.5 h-3.5" />
                        {label}
                    </button>
                ))}
            </div>

            {/* Content Area */}
            <div className="p-8 pt-0 grid grid-cols-1 lg:grid-cols-2 gap-8 h-full overflow-y-auto custom-scrollbar">
                {/* Left: Tab Controls */}
                <div className="lg:col-span-1">
                    <div style={{ display: activeMode === 'generate' ? undefined : 'none' }}>
                        <GenerateTab isGenerating={isGenerating} setIsGenerating={setIsGenerating} />
                    </div>
                    <div style={{ display: activeMode === 'hq' ? undefined : 'none' }}>
                        <HQPortraitTab isGenerating={isGenerating} setIsGenerating={setIsGenerating} />
                    </div>
                    <div style={{ display: activeMode === 'img2img' ? undefined : 'none' }}>
                        <Img2ImgTab
                            isGenerating={isGenerating}
                            setIsGenerating={setIsGenerating}
                            initialImageUrl={activeMode === 'img2img' ? pendingImageUrl : null}
                            onConsumeImage={() => setPendingImageUrl(null)}
                        />
                    </div>
                    <div style={{ display: activeMode === 'inpaint' ? undefined : 'none' }}>
                        <InpaintTab
                            isGenerating={isGenerating}
                            setIsGenerating={setIsGenerating}
                            initialImageUrl={activeMode === 'inpaint' ? pendingImageUrl : null}
                            onConsumeImage={() => setPendingImageUrl(null)}
                        />
                    </div>
                    <div style={{ display: activeMode === 'metadata' ? undefined : 'none' }}>
                        <MetadataTab
                            isGenerating={isGenerating}
                            setIsGenerating={setIsGenerating}
                            initialImageUrl={activeMode === 'metadata' ? pendingImageUrl : null}
                            onConsumeImage={() => setPendingImageUrl(null)}
                        />
                    </div>
                </div>

                {/* Right: Shared Gallery */}
                <ImageGallery
                    generatedImages={generatedImages}
                    setGeneratedImages={setGeneratedImages}
                    isGenerating={isGenerating}
                    setIsGenerating={setIsGenerating}
                    galleryKey={modelId}
                    onSendToTab={handleSendToTab}
                />
            </div>
        </div>
    );
};
