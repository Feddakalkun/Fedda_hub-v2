import { useState, useEffect } from 'react';
import { Loader2, Sparkles, Image, Paintbrush, AlertCircle } from 'lucide-react';
import { BACKEND_API } from '../../config/api';
import { useToast } from '../ui/Toast';
import { usePersistentState } from '../../hooks/usePersistentState';

interface FrameData {
    path: string;
    url: string;
    caption: string;
}

interface FramesTabProps {
    videoPath: string | null;
    videoName: string | null;
    onSendToImg2Img?: (imageUrl: string, caption: string) => void;
    onSendToInpaint?: (imageUrl: string) => void;
    onSendToRecreate?: (frames: FrameData[]) => void;
}

export const FramesTab = ({ videoPath, videoName, onSendToImg2Img, onSendToInpaint, onSendToRecreate }: FramesTabProps) => {
    const { toast } = useToast();
    const [frames, setFrames] = useState<FrameData[]>([]);
    const [frameCount, setFrameCount] = usePersistentState('tiktok_frames_count', 6);
    const [extracting, setExtracting] = useState(false);
    const [captioning, setCaptioning] = useState(false);
    const [captionProgress, setCaptionProgress] = useState<{ done: number; total: number } | null>(null);
    const [captionMethod, setCaptionMethod] = usePersistentState<'ollama' | 'comfy'>('tiktok_frames_caption_method', 'ollama');
    const [captionModel, setCaptionModel] = usePersistentState('tiktok_frames_caption_model', 'llava');
    const [extractError, setExtractError] = useState<string | null>(null);

    const extractFrames = async () => {
        if (!videoPath) return;
        setExtracting(true);
        setFrames([]);
        setExtractError(null);
        try {
            const res = await fetch(`${BACKEND_API.BASE_URL}/api/tiktok/extract-frames`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ video_path: videoPath, count: frameCount }),
            });
            const data = await res.json();
            if (!res.ok) {
                const msg = data.detail || `Server error ${res.status}`;
                setExtractError(msg);
                toast(`Frame extraction failed: ${msg}`, 'error');
                return;
            }
            if (data.frames && data.frames.length > 0) {
                setFrames(data.frames.map((f: { path: string }) => ({
                    path: f.path,
                    url: `${BACKEND_API.BASE_URL}/api/tiktok/serve/${encodeURIComponent(f.path)}`,
                    caption: '',
                })));
                toast(`Extracted ${data.frames.length} frames`, 'success');
            } else {
                setExtractError('No frames were extracted. Check that ffmpeg is installed.');
                toast('No frames extracted — is ffmpeg installed?', 'error');
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setExtractError(msg);
            toast(`Frame extraction failed: ${msg}`, 'error');
        } finally {
            setExtracting(false);
        }
    };

    // Auto-extract when videoPath changes
    useEffect(() => {
        if (videoPath) extractFrames();
    }, [videoPath]);

    const handleCaptionAll = async () => {
        if (frames.length === 0) return;
        setCaptioning(true);
        setCaptionProgress({ done: 0, total: frames.length });
        try {
            const res = await fetch(`${BACKEND_API.BASE_URL}/api/tiktok/caption-frames`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    frame_paths: frames.map(f => f.path),
                    method: captionMethod,
                    model: captionModel,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                const msg = data.detail || `Server error ${res.status}`;
                toast(`Captioning failed: ${msg}`, 'error');
                setCaptioning(false);
                return;
            }

            if (data.job_id) {
                // Poll for completion
                const poll = setInterval(async () => {
                    try {
                        const statusRes = await fetch(`${BACKEND_API.BASE_URL}/api/tiktok/caption-status/${data.job_id}`);
                        const statusData = await statusRes.json();

                        // Update progress
                        if (statusData.done !== undefined) {
                            setCaptionProgress({ done: statusData.done, total: statusData.total || frames.length });
                        }

                        if (statusData.status === 'done' || statusData.status === 'completed') {
                            clearInterval(poll);
                            setCaptioning(false);
                            setCaptionProgress(null);
                            if (statusData.captions) {
                                setFrames(prev => prev.map(f => ({
                                    ...f,
                                    caption: statusData.captions[f.path] || f.caption,
                                })));
                                toast('All frames captioned!', 'success');
                            }
                        } else if (statusData.status === 'error') {
                            clearInterval(poll);
                            setCaptioning(false);
                            setCaptionProgress(null);
                            const msg = statusData.error || 'Unknown captioning error';
                            toast(`Captioning error: ${msg}`, 'error');
                        }
                    } catch {
                        // keep polling
                    }
                }, 2000);
            } else if (data.captions) {
                // Synchronous response
                setFrames(prev => prev.map(f => ({
                    ...f,
                    caption: data.captions[f.path] || f.caption,
                })));
                setCaptioning(false);
                setCaptionProgress(null);
                toast('Captioning complete!', 'success');
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            toast(`Captioning failed: ${msg}`, 'error');
            setCaptioning(false);
            setCaptionProgress(null);
        }
    };

    const updateCaption = (index: number, caption: string) => {
        setFrames(prev => prev.map((f, i) => i === index ? { ...f, caption } : f));
    };

    if (!videoPath) {
        return (
            <div className="text-center py-12 text-slate-500">
                <Image className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No video selected</p>
                <p className="text-xs mt-1">Select a video from the Library tab to extract frames</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Controls */}
            <div className="bg-[#121218] border border-white/5 rounded-2xl p-4 space-y-3">
                <div className="text-xs text-slate-400 truncate">
                    Video: <span className="text-white">{videoName || videoPath}</span>
                </div>
                <div className="flex gap-3 items-center">
                    <label className="text-xs text-slate-500">Frames:</label>
                    <input
                        type="number"
                        min={2}
                        max={12}
                        value={frameCount}
                        onChange={e => setFrameCount(parseInt(e.target.value) || 6)}
                        className="w-16 bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white text-center focus:outline-none"
                    />
                    <button
                        onClick={extractFrames}
                        disabled={extracting}
                        className="flex-1 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-white/10 text-white hover:bg-white/20 disabled:opacity-30 transition-all"
                    >
                        {extracting ? <Loader2 className="w-3.5 h-3.5 inline animate-spin mr-1" /> : null}
                        {extracting ? 'Extracting...' : 'Re-Extract'}
                    </button>
                </div>
            </div>

            {/* Extract error */}
            {extractError && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                    <div className="text-xs text-red-300">{extractError}</div>
                </div>
            )}

            {/* Caption Controls */}
            {frames.length > 0 && (
                <div className="bg-[#121218] border border-white/5 rounded-2xl p-4 space-y-3">
                    <div className="flex gap-2 items-center">
                        <select
                            value={captionMethod}
                            onChange={e => setCaptionMethod(e.target.value as 'ollama' | 'comfy')}
                            className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none"
                        >
                            <option value="ollama">Ollama Vision</option>
                            <option value="comfy">ComfyUI Caption</option>
                        </select>
                        {captionMethod === 'ollama' && (
                            <input
                                value={captionModel}
                                onChange={e => setCaptionModel(e.target.value)}
                                placeholder="Model name (e.g. llava)"
                                className="w-32 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none"
                            />
                        )}
                    </div>
                    <button
                        onClick={handleCaptionAll}
                        disabled={captioning}
                        className="w-full py-2.5 rounded-xl font-bold text-sm tracking-wider uppercase transition-all bg-white text-black hover:bg-slate-200 disabled:opacity-30"
                    >
                        {captioning ? <Loader2 className="w-3.5 h-3.5 inline animate-spin mr-1" /> : <Sparkles className="w-3.5 h-3.5 inline mr-1" />}
                        {captioning
                            ? captionProgress
                                ? `Captioning ${captionProgress.done}/${captionProgress.total}...`
                                : 'Captioning...'
                            : 'Auto-Caption All'}
                    </button>
                    {captioning && captionProgress && (
                        <div className="w-full h-0.5 bg-white/5 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-emerald-500 transition-all"
                                style={{ width: `${(captionProgress.done / captionProgress.total) * 100}%` }}
                            />
                        </div>
                    )}
                </div>
            )}

            {/* Frame Grid */}
            {frames.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                    {frames.map((frame, idx) => (
                        <div key={idx} className="bg-[#121218] border border-white/5 rounded-xl overflow-hidden">
                            <img
                                src={frame.url}
                                alt={`Frame ${idx + 1}`}
                                className="w-full aspect-video object-cover"
                                onError={e => { (e.target as HTMLImageElement).src = ''; }}
                            />
                            <div className="p-2 space-y-1.5">
                                <textarea
                                    value={frame.caption}
                                    onChange={e => updateCaption(idx, e.target.value)}
                                    placeholder="Caption..."
                                    rows={2}
                                    className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-white placeholder-slate-600 focus:outline-none focus:border-white/20 resize-none"
                                />
                                <div className="flex gap-1">
                                    {onSendToImg2Img && (
                                        <button
                                            onClick={() => onSendToImg2Img(frame.url, frame.caption)}
                                            className="flex-1 text-[9px] text-slate-500 hover:text-white py-1 rounded bg-white/5 hover:bg-white/10 transition-colors flex items-center justify-center gap-1"
                                        >
                                            <Image className="w-2.5 h-2.5" />
                                            Img2Img
                                        </button>
                                    )}
                                    {onSendToInpaint && (
                                        <button
                                            onClick={() => onSendToInpaint(frame.url)}
                                            className="flex-1 text-[9px] text-slate-500 hover:text-white py-1 rounded bg-white/5 hover:bg-white/10 transition-colors flex items-center justify-center gap-1"
                                        >
                                            <Paintbrush className="w-2.5 h-2.5" />
                                            Inpaint
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Send All to Recreate */}
            {frames.length > 0 && frames.some(f => f.caption) && onSendToRecreate && (
                <button
                    onClick={() => onSendToRecreate(frames)}
                    className="w-full py-3 rounded-xl font-bold text-sm tracking-wider uppercase bg-white text-black hover:bg-slate-200 transition-all"
                >
                    Send All to Recreate
                </button>
            )}
        </div>
    );
};

