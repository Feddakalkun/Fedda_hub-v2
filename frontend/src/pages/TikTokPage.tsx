// TikTok Page - Download, Library, Frames, Recreate
import { useState, useCallback, useEffect } from 'react';
import { Download, FolderOpen, Grid3X3, Wand2 } from 'lucide-react';
import { DownloadTab } from '../components/tiktok/DownloadTab';
import { LibraryTab } from '../components/tiktok/LibraryTab';
import { FramesTab } from '../components/tiktok/FramesTab';
import { RecreateTab } from '../components/tiktok/RecreateTab';
import { WorkbenchShell } from '../components/layout/WorkbenchShell';
import { PageTabs } from '../components/layout/PageTabs';
import { BACKEND_API } from '../config/api';

type TikTokMode = 'download' | 'library' | 'frames' | 'recreate';

const TABS: { id: TikTokMode; label: string; icon: React.ElementType }[] = [
    { id: 'download', label: 'DOWNLOAD', icon: Download },
    { id: 'library', label: 'LIBRARY', icon: FolderOpen },
    { id: 'frames', label: 'FRAMES', icon: Grid3X3 },
    { id: 'recreate', label: 'RECREATE', icon: Wand2 },
];

interface FrameData {
    path: string;
    url: string;
    caption: string;
}

interface TikTokPageProps {
    onSendToImg2Img?: (imageUrl: string, caption: string) => void;
    onSendToInpaint?: (imageUrl: string) => void;
}

export const TikTokPage = ({ onSendToImg2Img, onSendToInpaint }: TikTokPageProps) => {
    const [activeMode, setActiveMode] = useState<TikTokMode>(() => {
        const saved = localStorage.getItem('tiktok_active_mode');
        return (saved && TABS.some((t) => t.id === saved)) ? (saved as TikTokMode) : 'download';
    });
    const [libraryRefreshKey, setLibraryRefreshKey] = useState(0);

    const [selectedVideoPath, setSelectedVideoPath] = useState<string | null>(null);
    const [selectedVideoName, setSelectedVideoName] = useState<string | null>(null);
    const [recreateFrames, setRecreateFrames] = useState<FrameData[]>([]);


    useEffect(() => {
        localStorage.setItem('tiktok_active_mode', activeMode);
    }, [activeMode]);
    const handleExtractFrames = useCallback((videoPath: string, videoName: string) => {
        setSelectedVideoPath(videoPath);
        setSelectedVideoName(videoName);
        setActiveMode('frames');
    }, []);

    const handleDownloadComplete = useCallback(() => {
        setLibraryRefreshKey((k) => k + 1);
    }, []);

    const handleSendToRecreate = useCallback((frames: FrameData[]) => {
        setRecreateFrames(frames);
        setActiveMode('recreate');
    }, []);

    return (
        <WorkbenchShell
            topBar={<PageTabs tabs={TABS} activeTab={activeMode} onChange={setActiveMode} />}
            leftPane={
                <>
                    <div style={{ display: activeMode === 'download' ? undefined : 'none' }}>
                        <DownloadTab onDownloadComplete={handleDownloadComplete} />
                    </div>
                    <div style={{ display: activeMode === 'library' ? undefined : 'none' }}>
                        <LibraryTab key={libraryRefreshKey} onExtractFrames={handleExtractFrames} />
                    </div>
                    <div style={{ display: activeMode === 'frames' ? undefined : 'none' }}>
                        <FramesTab
                            videoPath={selectedVideoPath}
                            videoName={selectedVideoName}
                            onSendToImg2Img={onSendToImg2Img}
                            onSendToInpaint={onSendToInpaint}
                            onSendToRecreate={handleSendToRecreate}
                        />
                    </div>
                    <div style={{ display: activeMode === 'recreate' ? undefined : 'none' }}>
                        <RecreateTab frames={recreateFrames} />
                    </div>
                </>
            }
            rightPane={
                <div className="flex-1 flex items-center justify-center p-8">
                    {selectedVideoPath && (activeMode === 'library' || activeMode === 'frames') ? (
                        <div className="max-w-full max-h-full flex flex-col items-center gap-4">
                            <video
                                key={selectedVideoPath}
                                src={`${BACKEND_API.BASE_URL}/api/tiktok/serve/${encodeURIComponent(selectedVideoPath)}`}
                                className="max-w-full max-h-[70vh] rounded-lg shadow-[0_0_80px_rgba(255,255,255,0.08)]"
                                controls
                                loop
                            />
                            <div className="text-xs text-slate-500 font-mono">{selectedVideoName}</div>
                        </div>
                    ) : (
                        <div className="text-center opacity-20 flex flex-col items-center gap-4">
                            <Download className="w-16 h-16" />
                            <p className="tracking-[0.2em] font-light uppercase text-sm">TikTok Studio</p>
                            <p className="text-xs text-slate-500 max-w-xs">
                                Download TikTok videos, extract frames, caption them, and recreate scenes with your own LoRAs
                            </p>
                        </div>
                    )}
                </div>
            }
        />
    );
};


