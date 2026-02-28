import { useState, useEffect, useCallback } from 'react';
import { Download, CheckCircle2, Info } from 'lucide-react';

interface ModelInfo {
    id: string;
    name: string;
    exists: boolean;
    size_gb: number;
    progress: {
        status: string;
        downloaded: number;
        total: number;
        name: string;
        error?: string;
    };
}

interface ModelDownloaderProps {
    modelGroup?: string;
    onReady?: () => void;
}

export const ModelDownloader = ({ modelGroup = "z-image", onReady }: ModelDownloaderProps) => {
    const [modelStatus, setModelStatus] = useState<ModelInfo[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isDownloading, setIsDownloading] = useState(false);

    const checkStatus = useCallback(async () => {
        try {
            const resp = await fetch(`http://localhost:8000/api/models/status?group=${modelGroup}`);
            const data = await resp.json();
            if (data.success) {
                setModelStatus(data.models);

                // If all exist, notify parent
                if (data.models.every((m: ModelInfo) => m.exists) && onReady) {
                    onReady();
                }

                // If any are downloading, continue polling
                const downloading = data.models.some((m: ModelInfo) => m.progress.status === 'downloading');
                setIsDownloading(downloading);
            }
        } catch (e) {
            console.error('Status check failed:', e);
        } finally {
            setIsLoading(false);
        }
    }, [modelGroup, onReady]);

    useEffect(() => {
        checkStatus();
        let interval: any;
        if (isDownloading || !modelStatus.every(m => m.exists)) {
            interval = setInterval(checkStatus, 2000);
        }
        return () => clearInterval(interval);
    }, [checkStatus, isDownloading, modelStatus]);

    const handleDownload = async (modelId: string) => {
        try {
            await fetch(`http://localhost:8000/api/models/download?model_id=${modelId}&group=${modelGroup}`, { method: 'POST' });
            setIsDownloading(true);
        } catch (e) {
            console.error('Download trigger failed:', e);
        }
    };

    if (isLoading) return null;

    // Show nothing if all models exist
    if (modelStatus.every(m => m.exists)) return null;

    return (
        <div className="mx-8 mt-6 overflow-hidden bg-[#18181b]/40 backdrop-blur-xl border border-amber-500/20 rounded-2xl shadow-2xl animate-in slide-in-from-top-4 duration-500 ring-1 ring-white/5">
            <div className="flex flex-col lg:flex-row items-stretch">
                {/* Left Info Panel */}
                <div className="lg:w-[340px] p-6 bg-gradient-to-br from-amber-500/10 to-transparent flex flex-col justify-center gap-4 border-b lg:border-b-0 lg:border-r border-white/5">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
                            <Download className="w-5 h-5 text-amber-500" />
                        </div>
                        <div>
                            <h2 className="text-sm font-bold text-white uppercase tracking-tight">Downloader Engaged</h2>
                            <p className="text-[10px] font-bold text-amber-500/60 uppercase tracking-widest">Required Assets Missing</p>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <p className="text-xs text-slate-400 leading-relaxed font-medium">
                            The professional flux model (~19GB) is not detected in your local ComfyUI directory.
                        </p>
                        <div className="flex items-center gap-2 text-[10px] text-slate-500 py-1 px-2.5 rounded-lg bg-black/20 border border-white/5 w-fit">
                            <Info className="w-3 h-3 text-amber-500/50" />
                            <span>Destination: /ComfyUI/models/</span>
                        </div>
                    </div>
                </div>

                {/* Right Progress/Action Panel */}
                <div className="flex-1 p-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                    {modelStatus.map(m => {
                        const isInstalling = m.progress.status === 'downloading';
                        const percent = m.progress.total > 0 ? (m.progress.downloaded / m.progress.total) * 100 : 0;

                        return (
                            <div key={m.id} className="group relative bg-black/20 border border-white/5 rounded-xl p-4 flex flex-col justify-between transition-all hover:border-amber-500/20">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex flex-col">
                                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{m.id}</span>
                                        <span className="text-xs font-bold text-slate-200 truncate max-w-[120px]">{m.name}</span>
                                    </div>
                                    <span className="text-[10px] text-slate-600 font-mono">~{m.size_gb}GB</span>
                                </div>

                                <div className="space-y-3">
                                    {m.exists ? (
                                        <div className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold transition-all animate-in zoom-in-95">
                                            <CheckCircle2 className="w-3.5 h-3.5" />
                                            Ready
                                        </div>
                                    ) : (
                                        <>
                                            {isInstalling ? (
                                                <div className="space-y-2 animate-in fade-in">
                                                    <div className="flex justify-between text-[10px] font-mono text-blue-400">
                                                        <span>Downloading...</span>
                                                        <span>{Math.round(percent)}%</span>
                                                    </div>
                                                    <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                                                        <div
                                                            className="h-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.3)] transition-all duration-300"
                                                            style={{ width: `${percent}%` }}
                                                        />
                                                    </div>
                                                    <p className="text-[9px] text-slate-600 truncate">{Math.round(m.progress.downloaded / (1024 * 1024))} / {Math.round(m.progress.total / (1024 * 1024))} MB</p>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => handleDownload(m.id)}
                                                    className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-[11px] font-bold transition-all active:scale-95 shadow-lg shadow-amber-500/10"
                                                >
                                                    <Download className="w-3.5 h-3.5" />
                                                    Get Model
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Bottom Glow */}
            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-amber-500/20 to-transparent" />
        </div>
    );
};
