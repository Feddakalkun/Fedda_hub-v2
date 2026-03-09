import { useState, useEffect, useCallback, useRef } from 'react';
import { Download, Loader2, AlertTriangle } from 'lucide-react';
import { BACKEND_API } from '../config/api';

interface ModelInfo {
    id: string;
    name: string;
    exists: boolean;
    is_corrupt?: boolean;
    actual_size_gb?: number;
    size_gb: number;
    progress: {
        status: string;
        downloaded: number;
        total: number;
    };
}

interface ModelDownloaderProps {
    modelGroup?: string;
    onModelsReady?: () => void;
}

const MODEL_GROUP_LABELS: Record<string, string> = {
    'z-image': 'Z-Image Turbo',
    'ace-step': 'ACE-Step 1.5',
    'qwen-angle': 'Qwen Angle',
};

export const ModelDownloader = ({ modelGroup = 'z-image', onModelsReady }: ModelDownloaderProps) => {
    const [modelStatus, setModelStatus] = useState<ModelInfo[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isDownloading, setIsDownloading] = useState(false);
    const didNotifyReadyRef = useRef(false);

    const checkStatus = useCallback(async () => {
        try {
            const resp = await fetch(`${BACKEND_API.BASE_URL}/api/models/status?group=${modelGroup}`);
            const data = await resp.json();
            if (data.success && Array.isArray(data.models)) {
                setModelStatus(data.models);
                const downloading = data.models.some((m: ModelInfo) => m.progress?.status === 'downloading');
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
        const timer = isDownloading ? 2000 : 5000;
        const interval = setInterval(checkStatus, timer);
        return () => clearInterval(interval);
    }, [checkStatus, isDownloading]);

    const allInstalled = modelStatus.length > 0 && modelStatus.every((m) => m.exists);

    useEffect(() => {
        if (!onModelsReady) return;

        if (allInstalled && !didNotifyReadyRef.current) {
            didNotifyReadyRef.current = true;
            onModelsReady();
            return;
        }

        if (!allInstalled) {
            didNotifyReadyRef.current = false;
        }
    }, [allInstalled, onModelsReady]);

    const handleDownloadAll = async () => {
        setIsDownloading(true);
        const missing = modelStatus.filter((m) => !m.exists || m.progress.status === 'error');
        for (const m of missing) {
            try {
                await fetch(`${BACKEND_API.BASE_URL}/api/models/download?model_id=${m.id}&group=${modelGroup}`, { method: 'POST' });
            } catch (e) {
                console.error(`Failed to start download for ${m.id}`, e);
            }
        }
    };

    const handlePurge = async () => {
        if (!confirm('Are you sure? This will delete existing model files to allow a fresh download.')) return;
        try {
            await fetch(`${BACKEND_API.BASE_URL}/api/models/purge?group=${modelGroup}`, { method: 'POST' });
            await checkStatus();
        } catch (e) {
            console.error('Purge failed:', e);
        }
    };

    if (isLoading) return null;
    if (modelStatus.length === 0 && !isDownloading) return null;

    const groupLabel = MODEL_GROUP_LABELS[modelGroup] || modelGroup;
    const corruptModels = modelStatus.filter((m) => m.is_corrupt);
    const hasCorrupt = corruptModels.length > 0;
    const hasError = modelStatus.some((m) => m.progress.status === 'error');

    const totalRequiredGb = modelStatus.reduce((acc, m) => acc + (m.size_gb || 0), 0);
    const requiredSizeLabel = totalRequiredGb >= 10 ? totalRequiredGb.toFixed(0) : totalRequiredGb.toFixed(1);

    const mainMessage = hasCorrupt ? 'Corrupted File Detected' : hasError ? 'Download Corrupted' : 'Required Models Missing';
    const subMessage = hasCorrupt
        ? `One or more ${groupLabel} model files are incomplete. LoRAs are safe.`
        : hasError
            ? `The ${groupLabel} download was interrupted. Purge and restart for a clean copy.`
            : `${groupLabel} base models are required for generation (~${requiredSizeLabel}GB total)`;

    if (allInstalled && !isDownloading && !hasError && !hasCorrupt) {
        return (
            <div className="mx-8 mt-4 flex justify-end">
                <button
                    onClick={handlePurge}
                    className="text-[9px] text-slate-700 hover:text-slate-400 font-bold uppercase tracking-widest transition-colors flex items-center gap-2"
                >
                    [ Verify & Repair Cache ]
                </button>
            </div>
        );
    }

    const totalDownloaded = modelStatus.reduce((acc, m) => acc + (m.progress.downloaded || 0), 0);
    const totalSize = modelStatus.reduce((acc, m) => acc + (m.progress.total || 0), 0);
    const percent = totalSize > 0 ? (totalDownloaded / totalSize) * 100 : 0;

    return (
        <div className="mx-8 mt-6 bg-[#121218] border border-white/10 rounded-xl overflow-hidden animate-in slide-in-from-top-2 duration-300">
            <div className={`flex flex-col ${(hasError || hasCorrupt) ? 'bg-red-950/5' : ''}`}>
                <div className="flex items-center justify-between px-6 py-4">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center border border-white/10">
                            {isDownloading ? (
                                <Loader2 className="w-5 h-5 text-white animate-spin" />
                            ) : (hasError || hasCorrupt) ? (
                                <AlertTriangle className="w-5 h-5 text-slate-500" />
                            ) : (
                                <Download className="w-5 h-5 text-white/60" />
                            )}
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-white uppercase tracking-tight">
                                {mainMessage}
                            </h3>
                            <p className="text-[11px] text-slate-500 font-medium">
                                {subMessage}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-6">
                        {isDownloading ? (
                            <div className="flex flex-col items-end gap-1.5 min-w-[200px]">
                                <div className="flex justify-between w-full text-[10px] font-mono text-slate-400">
                                    <span>{totalSize > 0 ? `Downloading ${groupLabel}...` : 'Connecting...'}</span>
                                    {totalSize > 0 && <span>{Math.round(percent)}%</span>}
                                </div>
                                <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full bg-white transition-all duration-500 ${totalSize === 0 ? 'animate-pulse w-4' : ''}`}
                                        style={{ width: totalSize > 0 ? `${percent}%` : '5%' }}
                                    />
                                </div>
                            </div>
                        ) : (
                            <button
                                onClick={(hasError || hasCorrupt) ? handlePurge : handleDownloadAll}
                                className="px-6 py-2.5 bg-white hover:bg-slate-200 text-black text-[11px] font-bold uppercase tracking-wider rounded-lg transition-all active:scale-95"
                            >
                                {(hasError || hasCorrupt) ? 'Purge & Restart' : 'Download All Models'}
                            </button>
                        )}
                    </div>
                </div>

                {hasCorrupt && !isDownloading && (
                    <div className="px-6 pb-4 pt-2 border-t border-white/5 flex flex-wrap gap-4">
                        {corruptModels.map((m) => (
                            <div key={m.id} className="flex flex-col">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">{m.id}</span>
                                <span className="text-[11px] text-red-400 font-mono">
                                    {m.actual_size_gb}GB / {m.size_gb}GB (Incomplete)
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
