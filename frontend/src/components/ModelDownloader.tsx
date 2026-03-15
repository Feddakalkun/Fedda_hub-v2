import { useState, useEffect, useCallback, useRef } from 'react';
import { Download, Loader2, AlertTriangle } from 'lucide-react';
import { BACKEND_API } from '../config/api';
import { useToast } from './ui/Toast';
import { getStoredHFToken } from './HFTokenSettings';

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
        speed?: number;
        eta?: number;
        error?: string;
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
    'lipsync': 'Lipsync (WAN + LTX)',
    'scene-builder': 'Scene Builder (WAN)',
};

export const ModelDownloader = ({ modelGroup = 'z-image', onModelsReady }: ModelDownloaderProps) => {
    const { toast } = useToast();
    const [modelStatus, setModelStatus] = useState<ModelInfo[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isDownloading, setIsDownloading] = useState(false);
    const didNotifyReadyRef = useRef(false);
    const wasDownloadingRef = useRef(false);

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

    // Notify when download completes
    useEffect(() => {
        if (wasDownloadingRef.current && !isDownloading && modelStatus.length > 0) {
            const allInstalled = modelStatus.every((m) => m.exists);
            const anyError = modelStatus.some((m) => m.progress.status === 'error');

            if (allInstalled) {
                const groupLabel = MODEL_GROUP_LABELS[modelGroup] || modelGroup;
                toast(`✓ ${groupLabel} models installed successfully!`, 'success');
            } else if (anyError) {
                toast('Some model downloads failed. Check your connection and try again.', 'error');
            }
        }
        wasDownloadingRef.current = isDownloading;
    }, [isDownloading, modelStatus, modelGroup, toast]);

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

        if (missing.length === 0) {
            toast('All models already installed!', 'success');
            return;
        }

        const groupLabel = MODEL_GROUP_LABELS[modelGroup] || modelGroup;
        const totalSizeGB = missing.reduce((acc, m) => acc + (m.size_gb || 0), 0);
        toast(`Starting download of ${missing.length} model(s) for ${groupLabel} (~${totalSizeGB.toFixed(1)}GB total)...`, 'info');

        // Get HF token from localStorage if available
        const hfToken = getStoredHFToken();

        for (const m of missing) {
            try {
                // Build URL with optional HF token
                let url = `${BACKEND_API.BASE_URL}/api/models/download?model_id=${m.id}&group=${modelGroup}`;
                if (hfToken) {
                    url += `&hf_token=${encodeURIComponent(hfToken)}`;
                }

                const resp = await fetch(url, { method: 'POST' });
                const data = await resp.json();
                if (!data.success) {
                    console.error(`Failed to start download for ${m.id}:`, data.error);
                    toast(`Failed to start download for ${m.name}: ${data.error}`, 'error');
                }
            } catch (e) {
                console.error(`Failed to start download for ${m.id}`, e);
                toast(`Network error starting download for ${m.name}`, 'error');
            }
        }
    };

    const handlePurge = async () => {
        const groupLabel = MODEL_GROUP_LABELS[modelGroup] || modelGroup;
        if (!confirm(`Delete ${groupLabel} model files and restart download?\n\nThis will remove incomplete/corrupted files and start a fresh download.`)) return;

        try {
            toast(`Purging ${groupLabel} models...`, 'info');
            const resp = await fetch(`${BACKEND_API.BASE_URL}/api/models/purge?group=${modelGroup}`, { method: 'POST' });
            const data = await resp.json();

            if (!data.success) {
                toast(`Purge failed: ${data.error}`, 'error');
                return;
            }

            await checkStatus();

            // Auto-start download after purge
            toast(`Files purged. Starting fresh download...`, 'info');
            setTimeout(() => {
                handleDownloadAll();
            }, 1000);
        } catch (e) {
            console.error('Purge failed:', e);
            toast('Failed to purge model files. Is the backend running?', 'error');
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

    // Simplify UI: backend auto-purges corrupt files, so just show "missing"
    const hasMissing = modelStatus.some((m) => !m.exists);
    const mainMessage = hasMissing ? 'Required Models Missing' : 'Download Error';
    const subMessage = hasMissing
        ? `${groupLabel} base models are required for generation (~${requiredSizeLabel}GB total)`
        : `The ${groupLabel} download failed. Click to retry.`;

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
            <div className="flex flex-col">
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
                                onClick={handleDownloadAll}
                                className="px-6 py-2.5 bg-white hover:bg-slate-200 text-black text-[11px] font-bold uppercase tracking-wider rounded-lg transition-all active:scale-95"
                            >
                                Download All Models
                            </button>
                        )}
                    </div>
                </div>

                {/* Detailed model status breakdown */}
                {(isDownloading || !allInstalled) && (
                    <div className="px-6 pb-4 pt-2 border-t border-white/5 space-y-2">
                        <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-3">Model Status</div>
                        {modelStatus.map((m) => {
                            const isModelDownloading = m.progress?.status === 'downloading';
                            const modelPercent = m.progress?.total > 0 ? (m.progress.downloaded / m.progress.total) * 100 : 0;

                            return (
                                <div key={m.id} className="bg-black/20 rounded-lg p-3 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-bold text-white">
                                                {m.exists ? '✓' : isModelDownloading ? '⏳' : m.progress?.status === 'error' ? '🔴' : '❌'}
                                            </span>
                                            <span className="text-xs text-slate-300">{m.name}</span>
                                        </div>
                                        <div className="text-[10px] text-slate-500 font-mono">
                                            {m.exists ? (
                                                <span className="text-emerald-400">Installed</span>
                                            ) : isModelDownloading ? (
                                                <span className="text-blue-400">
                                                    {(m.progress.downloaded / (1024**3)).toFixed(2)}GB / {m.size_gb}GB ({Math.round(modelPercent)}%)
                                                    {m.progress.speed && m.progress.speed > 0 && (
                                                        <span className="text-slate-500 ml-2">
                                                            @ {(m.progress.speed / (1024**2)).toFixed(1)}MB/s
                                                            {m.progress.eta && m.progress.eta > 0 && (
                                                                <> · {Math.floor(m.progress.eta / 60)}m{Math.floor(m.progress.eta % 60)}s</>
                                                            )}
                                                        </span>
                                                    )}
                                                </span>
                                            ) : m.progress?.status === 'error' ? (
                                                <span className="text-red-400">Error{m.progress?.error ? `: ${m.progress.error.substring(0, 60)}` : ''}</span>
                                            ) : (
                                                <span className="text-slate-600">{m.size_gb}GB required</span>
                                            )}
                                        </div>
                                    </div>
                                    {isModelDownloading && (
                                        <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-blue-400 transition-all duration-500"
                                                style={{ width: `${modelPercent}%` }}
                                            />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};
