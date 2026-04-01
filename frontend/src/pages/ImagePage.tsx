// Image Generation Page
import { useState, useCallback } from 'react';
import { ModelDownloader } from '../components/ModelDownloader';
import { ImageGallery } from '../components/image/ImageGallery';
import { GenerateTab } from '../components/image/GenerateTab';
import { HQPortraitTab } from '../components/image/HQPortraitTab';
import { Img2ImgTab } from '../components/image/Img2ImgTab';
import { MoodEditTab } from '../components/image/MoodEditTab';
import { InpaintTab } from '../components/image/InpaintTab';
import { MetadataTab } from '../components/image/MetadataTab';
import { WorkbenchShell } from '../components/layout/WorkbenchShell';

type ImageMode = 'image-generate' | 'image-hq' | 'image-img2img' | 'image-mood-edit' | 'image-inpaint' | 'image-metadata';

const TAB_ALIASES: Record<string, ImageMode> = {
    generate: 'image-generate',
    hq: 'image-hq',
    img2img: 'image-img2img',
    'mood-edit': 'image-mood-edit',
    inpaint: 'image-inpaint',
    metadata: 'image-metadata',
    'z-image': 'image-generate',
    'image-generate': 'image-generate',
    'image-hq': 'image-hq',
    'image-img2img': 'image-img2img',
    'image-mood-edit': 'image-mood-edit',
    'image-inpaint': 'image-inpaint',
    'image-metadata': 'image-metadata',
};

interface ImagePageProps {
    modelId: string;
    modelLabel: string;
}

export const ImagePage = ({ modelId }: ImagePageProps) => {
    const activeMode = TAB_ALIASES[modelId] || 'image-generate';
    const [isGenerating, setIsGenerating] = useState(false);
    const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null);
    const [generatedImages, setGeneratedImages] = useState<string[]>(() => {
        const saved = localStorage.getItem(`gallery_${modelId}`);
        return saved ? JSON.parse(saved) : [];
    });

    const handleSendToTab = useCallback((tab: string, imageUrl: string) => {
        setPendingImageUrl(imageUrl);
        const normalized = TAB_ALIASES[tab] || 'image-img2img';
        window.location.hash = `#image/${normalized}`;
    }, []);

    return (
        <WorkbenchShell
            leftWidthClassName="w-[520px]"
            leftPaneClassName="p-4"
            collapsible
            collapseKey="image_preview_collapsed"
            leftPane={
                <>
                    <ModelDownloader modelGroup="z-image" />

                    <div className="px-4 mt-4">
                        <div style={{ display: activeMode === 'image-generate' ? undefined : 'none' }}>
                            <GenerateTab isGenerating={isGenerating} setIsGenerating={setIsGenerating} />
                        </div>
                        <div style={{ display: activeMode === 'image-hq' ? undefined : 'none' }}>
                            <HQPortraitTab isGenerating={isGenerating} setIsGenerating={setIsGenerating} />
                        </div>
                        <div style={{ display: activeMode === 'image-img2img' ? undefined : 'none' }}>
                            <Img2ImgTab
                                isGenerating={isGenerating}
                                setIsGenerating={setIsGenerating}
                                initialImageUrl={activeMode === 'image-img2img' ? pendingImageUrl : null}
                                onConsumeImage={() => setPendingImageUrl(null)}
                            />
                        </div>
                        <div style={{ display: activeMode === 'image-mood-edit' ? undefined : 'none' }}>
                            <MoodEditTab
                                isGenerating={isGenerating}
                                setIsGenerating={setIsGenerating}
                                initialImageUrl={activeMode === 'image-mood-edit' ? pendingImageUrl : null}
                                onConsumeImage={() => setPendingImageUrl(null)}
                            />
                        </div>
                        <div style={{ display: activeMode === 'image-inpaint' ? undefined : 'none' }}>
                            <InpaintTab
                                isGenerating={isGenerating}
                                setIsGenerating={setIsGenerating}
                                initialImageUrl={activeMode === 'image-inpaint' ? pendingImageUrl : null}
                                onConsumeImage={() => setPendingImageUrl(null)}
                            />
                        </div>
                        <div style={{ display: activeMode === 'image-metadata' ? undefined : 'none' }}>
                            <MetadataTab
                                isGenerating={isGenerating}
                                setIsGenerating={setIsGenerating}
                                initialImageUrl={activeMode === 'image-metadata' ? pendingImageUrl : null}
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
