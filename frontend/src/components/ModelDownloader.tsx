import { useState, useEffect, useCallback } from 'react';
import { Download, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';

interface ModelInfo {
    id: string;
    name: string;
    exists: boolean;
    size_gb: number;
    progress: {
        status: string;
        downloaded: number;
        total: number;
    };
}

interface ModelDownloaderProps {
    modelGroup?: string;
}

export const ModelDownloader = ({ modelGroup = "z-image" }: ModelDownloaderProps) => {
    const [modelStatus, setModelStatus] = useState<ModelInfo[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isDownloading, setIsDownloading] = useState(false);

    const checkStatus = useCallback(async () => {
        try {
            const resp = await fetch(`http://localhost:8000/api/models/status?group=${modelGroup}`);
            const data = await resp.json();
            if (data.success) {
                setModelStatus(data.models);
                const results = data.models;
                const downloading = results.some((m: any) => m.progress.status === 'downloading');
                setIsDownloading(downloading);
            }
        } catch (e) {
            console.error('Status check failed:', e);
        } finally {
            setIsLoading(false);
        }
    }, [modelGroup]);

    useEffect(() => {
        checkStatus();
        let interval: any;
        if (isDownloading || !modelStatus.every(m => m.exists)) {
            interval = setInterval(checkStatus, 2000);
        }
        return () => clearInterval(interval);
    }, [checkStatus, isDownloading, modelStatus]);

    const handleDownloadAll = async () => {
        setIsDownloading(true);
        const missing = modelStatus.filter(m => !m.exists);
        for (const m of missing) {
            try {
                await fetch(`http://localhost:8000/api/models/download?model_id=${m.id}&group=${modelGroup}`, { method: 'POST' });
            } catch (e) {
                console.error(`Failed to start download for ${m.id}`, e);
            }
        }
    };

    if (isLoading) return null;
    const allInstalled = modelStatus.every(m => m.exists);
    if (allInstalled) return null;

    const totalDownloaded = modelStatus.reduce((acc, m) => acc + (m.progress.downloaded || 0), 0);
    const totalSize = modelStatus.reduce((acc, m) => acc + (m.progress.total || 0), 0);
    const percent = totalSize > 0 ? (totalDownloaded / totalSize) * 100 : 0;

    return (
        <div className="mx-8 mt-6 bg-[#121218] border border-white/10 rounded-xl overflow-hidden animate-in slide-in-from-top-2 duration-300">
            <div className="flex items-center justify-between px-6 py-4">
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center border border-white/10">
                        {isDownloading ? (
                            <Loader2 className="w-5 h-5 text-white animate-spin" />
                        ) : (
                            <Download className="w-5 h-5 text-white/60" />
                        )}
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-white uppercase tracking-tight">Required Models Missing</h3>
                        <p className="text-[11px] text-slate-500 font-medium">Flux base models are required for generation (~19.4GB total)</p>
                    </div>
                </div>

                <div className="flex items-center gap-6">
                    {isDownloading ? (
                        <div className="flex flex-col items-end gap-1.5 min-w-[200px]">
                            <div className="flex justify-between w-full text-[10px] font-mono text-slate-400">
                                <span>Downloading Assets...</span>
                                <span>{Math.round(percent)}%</span>
                            </div>
                            <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-white transition-all duration-500"
                                    style={{ width: `${percent}%` }}
                                />
                            </div>
                        </div>
                    ) : (
                        <button
                            onClick={handleDownloadAll}
                            className="px-6 py-2.5 bg-white hover:bg-slate-200 text-black text-[11px] font-bold uppercase tracking-wider rounded-lg transition-all active:scale-95"
                        >
                            Download All Models
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
