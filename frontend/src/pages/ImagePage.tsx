// Image Generation Page - Tab Container
import { useState, useCallback, useEffect } from 'react';
import { Sparkles, Image, Paintbrush, Layers, FileText, Sun } from 'lucide-react';
import { ModelDownloader } from '../components/ModelDownloader';
import { ImageGallery } from '../components/image/ImageGallery';
import { GenerateTab } from '../components/image/GenerateTab';
import { HQPortraitTab } from '../components/image/HQPortraitTab';
import { Img2ImgTab } from '../components/image/Img2ImgTab';
import { MoodEditTab } from '../components/image/MoodEditTab';
import { InpaintTab } from '../components/image/InpaintTab';
import { MetadataTab } from '../components/image/MetadataTab';
import { WorkbenchShell } from '../components/layout/WorkbenchShell';
import { PageTabs } from '../components/layout/PageTabs';

type ImageMode = 'generate' | 'hq' | 'img2img' | 'mood-edit' | 'inpaint' | 'metadata';

const TABS: { id: ImageMode; label: string; icon: React.ElementType }[] = [
    { id: 'generate', label: 'GENERATE', icon: Sparkles },
    { id: 'hq', label: 'HQ PORTRAIT', icon: Layers },
    { id: 'img2img', label: 'IMG2IMG', icon: Image },
    { id: 'mood-edit', label: 'MOOD EDIT', icon: Sun },
    { id: 'inpaint', label: 'INPAINT', icon: Paintbrush },
    { id: 'metadata', label: 'METADATA', icon: FileText },
];

interface ImagePageProps {
    modelId: string;
    modelLabel: string;
}

export const ImagePage = ({ modelId }: ImagePageProps) => {
    const [activeMode, setActiveMode] = useState<ImageMode>(() => {
        const saved = localStorage.getItem('image_active_mode');
        return (saved && TABS.some((t) => t.id === saved)) ? (saved as ImageMode) : 'generate';
    });
    const [isGenerating, setIsGenerating] = useState(false);
    const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null);
    const [generatedImages, setGeneratedImages] = useState<string[]>(() => {
        const saved = localStorage.getItem(`gallery_${modelId}`);
        return saved ? JSON.parse(saved) : [];
    });

    useEffect(() => {
        localStorage.setItem('image_active_mode', activeMode);
    }, [activeMode]);

    const handleSendToTab = useCallback((tab: string, imageUrl: string) => {
        setPendingImageUrl(imageUrl);
        setActiveMode(tab as ImageMode);
    }, []);

    return (
        <WorkbenchShell
            topBar={<PageTabs tabs={TABS} activeTab={activeMode} onChange={setActiveMode} />}
            leftWidthClassName="w-[520px]"
            leftPaneClassName="p-4"
            leftPane={
                <>
                    <ModelDownloader modelGroup="z-image" />

                    <div className="px-4 mt-4">
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
                        <div style={{ display: activeMode === 'mood-edit' ? undefined : 'none' }}>
                            <MoodEditTab
                                isGenerating={isGenerating}
                                setIsGenerating={setIsGenerating}
                                initialImageUrl={activeMode === 'mood-edit' ? pendingImageUrl : null}
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
                </>
            }
            rightPane={
                <div className="flex-1 p-5 overflow-y-auto custom-scrollbar">
                    <ImageGallery
                        generatedImages={generatedImages}
                        setGeneratedImages={setGeneratedImages}
                        isGenerating={isGenerating}
                        setIsGenerating={setIsGenerating}
                        galleryKey={modelId}
                        onSendToTab={handleSendToTab}
                    />
                </div>
            }
        />
    );
};
