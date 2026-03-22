// Video Page - LTX I2V, LTX T2V, LTX-2 I2V+Sound, LTX-2 Lipsync, WAN Lipsync, Scene Builder
import { useState, useEffect, useRef } from 'react';
import { Film } from 'lucide-react';
import { ModelDownloader } from '../components/ModelDownloader';
import { LtxI2vTab } from '../components/video/LtxI2vTab';
import { LtxT2vTab } from '../components/video/LtxT2vTab';
import { Ltx2I2vSoundTab } from '../components/video/Ltx2I2vSoundTab';
import { Ltx2LipsyncTab } from '../components/video/Ltx2LipsyncTab';
import { LipsyncTab } from '../components/video/LipsyncTab';
import { SceneBuilderTab } from '../components/video/SceneBuilderTab';
import { useComfyExecution } from '../contexts/ComfyExecutionContext';
import { comfyService } from '../services/comfyService';
import { WorkbenchShell } from '../components/layout/WorkbenchShell';

interface VideoPageProps {
    modelId: string;
    modelLabel: string;
}

const PREFIX_MAP: Record<string, string> = {
    'ltx-i2v': 'VIDEO/LTX23/I2V',
    'ltx-t2v': 'VIDEO/LTX23/T2V',
    'ltx2-i2v-sound': 'VIDEO/LTX2/',
    'ltx2-lipsync': 'VIDEO/LTX2/',
};

export const VideoPage = ({ modelId }: VideoPageProps) => {
    const [videoUrls, setVideoUrls] = useState<string[]>([]);
    const [activeVideoIndex, setActiveVideoIndex] = useState(0);
    const [hasNewVideo, setHasNewVideo] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);

    const { lastCompletedPromptId, lastOutputVideos, outputReadyCount } = useComfyExecution();
    const expectedPrefix = PREFIX_MAP[modelId] ?? null;

    useEffect(() => {
        if (!lastCompletedPromptId) return;

        const fetchVideos = async () => {
            try {
                if (lastOutputVideos.length > 0) {
                    const scoped = expectedPrefix
                        ? lastOutputVideos.filter((v) => v.filename?.startsWith(expectedPrefix))
                        : lastOutputVideos;
                    const urls = scoped.map((v) =>
                        comfyService.getImageUrl(v.filename, v.subfolder, v.type)
                    );
                    if (urls.length > 0) {
                        setVideoUrls(urls);
                        setActiveVideoIndex(urls.length - 1);
                        setHasNewVideo(true);
                        return;
                    }
                }

                const history = await comfyService.getHistory(lastCompletedPromptId);
                const results = history[lastCompletedPromptId];
                if (results?.outputs) {
                    const urls: string[] = [];
                    Object.values(results.outputs).forEach((nodeOutput: any) => {
                        if (nodeOutput.gifs) {
                            nodeOutput.gifs.forEach((v: any) => {
                                if (expectedPrefix && !String(v.filename || '').startsWith(expectedPrefix)) return;
                                urls.push(comfyService.getImageUrl(v.filename, v.subfolder, v.type));
                            });
                        }
                        if (nodeOutput.videos) {
                            nodeOutput.videos.forEach((v: any) => {
                                if (expectedPrefix && !String(v.filename || '').startsWith(expectedPrefix)) return;
                                urls.push(comfyService.getImageUrl(v.filename, v.subfolder, v.type));
                            });
                        }
                    });
                    if (urls.length > 0) {
                        setVideoUrls(urls);
                        setActiveVideoIndex(urls.length - 1);
                        setHasNewVideo(true);
                    }
                }
            } catch (err) {
                console.error('Failed to fetch video results:', err);
            }
        };

        fetchVideos();
    }, [lastCompletedPromptId, outputReadyCount, lastOutputVideos, expectedPrefix]);

    // Reset forceExpand flag after it triggers
    useEffect(() => {
        if (hasNewVideo) {
            const t = setTimeout(() => setHasNewVideo(false), 500);
            return () => clearTimeout(t);
        }
    }, [hasNewVideo]);

    return (
        <WorkbenchShell
            leftWidthClassName="w-[520px]"
            collapsible
            collapseKey="video_preview_collapsed"
            forceExpand={hasNewVideo}
            leftPane={
                <>
                    <ModelDownloader modelGroup={modelId} />

                    <div className="px-4 mt-4">
                        <div style={{ display: modelId === 'ltx-i2v' ? undefined : 'none' }}>
                            <LtxI2vTab />
                        </div>
                        <div style={{ display: modelId === 'ltx-t2v' ? undefined : 'none' }}>
                            <LtxT2vTab />
                        </div>
                        <div style={{ display: modelId === 'ltx2-i2v-sound' ? undefined : 'none' }}>
                            <Ltx2I2vSoundTab />
                        </div>
                        <div style={{ display: modelId === 'ltx2-lipsync' ? undefined : 'none' }}>
                            <Ltx2LipsyncTab />
                        </div>
                        <div style={{ display: modelId === 'lipsync' ? undefined : 'none' }}>
                            <LipsyncTab />
                        </div>
                        <div style={{ display: modelId === 'scene-builder' ? undefined : 'none' }}>
                            <SceneBuilderTab />
                        </div>
                    </div>
                </>
            }
            rightPane={
                <>
                    <div className="flex-1 flex items-center justify-center p-8">
                        {videoUrls.length > 0 ? (
                            <div className="relative max-w-full max-h-full flex flex-col items-center gap-4">
                                <video
                                    ref={videoRef}
                                    key={videoUrls[activeVideoIndex]}
                                    src={videoUrls[activeVideoIndex]}
                                    className="max-w-full max-h-[70vh] rounded-lg shadow-[0_0_80px_rgba(255,255,255,0.08)]"
                                    controls
                                    loop
                                    autoPlay
                                />

                                {videoUrls.length > 1 && (
                                    <div className="flex gap-2 flex-wrap justify-center">
                                        {videoUrls.map((_url, idx) => (
                                            <button
                                                key={idx}
                                                onClick={() => setActiveVideoIndex(idx)}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all ${
                                                    idx === activeVideoIndex
                                                        ? 'bg-white text-black'
                                                        : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white'
                                                }`}
                                            >
                                                Clip {idx + 1}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="text-center opacity-20 flex flex-col items-center gap-4">
                                <Film className="w-16 h-16" />
                                <p className="tracking-[0.2em] font-light uppercase text-sm">Video Preview</p>
                                <p className="text-xs text-slate-500 max-w-xs">
                                    Generate a video to see the output here
                                </p>
                            </div>
                        )}
                    </div>

                    {videoUrls.length > 0 && (
                        <div className="h-8 border-t border-white/5 bg-[#0a0a0f] flex items-center px-4 text-[10px] text-slate-500 font-mono">
                            <span>{videoUrls.length} clip{videoUrls.length > 1 ? 's' : ''} generated</span>
                        </div>
                    )}
                </>
            }
        />
    );
};
