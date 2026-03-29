import { useState, useEffect } from 'react';
import { Download, Check, Loader2, AlertTriangle } from 'lucide-react';
import { FREE_LORAS, TOTAL_LORA_SIZE_MB } from '../config/loras';
import { BACKEND_API } from '../config/api';

interface LoRAStatus {
    filename: string;
    installed: boolean;
    downloading: boolean;
    progress: number;
    error?: string;
}

export const LoRADownloader = () => {
    const [loraStatus, setLoraStatus] = useState<Record<string, LoRAStatus>>({});
    const [isLoading, setIsLoading] = useState(true);
    const [importUrl, setImportUrl] = useState('');
    const [importJobId, setImportJobId] = useState<string | null>(null);
    const [importStatus, setImportStatus] = useState<string>('');

    const checkStatus = async () => {
        try {
            // Get installed LoRAs from backend
            const resp = await fetch(`${BACKEND_API.BASE_URL}/api/lora/installed`);
            const data = await resp.json();

            if (data.success) {
                const installed = data.installed || {};

                // Build status for each LoRA
                const status: Record<string, LoRAStatus> = {};
                for (const lora of FREE_LORAS) {
                    const isInstalled = lora.filename in installed;

                    // Check download progress if not installed
                    let downloadProgress = 0;
                    let isDownloading = false;
                    let error = undefined;

                    if (!isInstalled) {
                        try {
                            const progressResp = await fetch(`${BACKEND_API.BASE_URL}/api/lora/download-status/${lora.filename}`);
                            const progressData = await progressResp.json();

                            if (progressData.status === 'downloading') {
                                isDownloading = true;
                                downloadProgress = progressData.progress || 0;
                            } else if (progressData.status === 'error') {
                                error = progressData.message;
                            }
                        } catch (e) {
                            // Ignore progress check errors
                        }
                    }

                    status[lora.id] = {
                        filename: lora.filename,
                        installed: isInstalled,
                        downloading: isDownloading,
                        progress: downloadProgress,
                        error,
                    };
                }

                setLoraStatus(status);
            }
        } catch (e) {
            console.error('Failed to check LoRA status:', e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        checkStatus();
        const interval = setInterval(checkStatus, 3000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (!importJobId) return;
        const interval = setInterval(async () => {
            try {
                const resp = await fetch(`${BACKEND_API.BASE_URL}${BACKEND_API.ENDPOINTS.LORA_IMPORT_STATUS}/${importJobId}`);
                const data = await resp.json();
                if (!data?.success) return;
                if (data.status === 'completed') {
                    setImportStatus(`Imported ${data.filename}`);
                    setImportJobId(null);
                    checkStatus();
                    return;
                }
                if (data.status === 'error') {
                    setImportStatus(`Import failed: ${data.message || 'unknown error'}`);
                    setImportJobId(null);
                    return;
                }
                const pct = Number(data.progress || 0);
                setImportStatus(`Importing ${data.filename}... ${pct}%`);
            } catch {
                // ignore transient polling errors
            }
        }, 1500);
        return () => clearInterval(interval);
    }, [importJobId]);

    const handleImportUrl = async () => {
        const trimmed = importUrl.trim();
        if (!trimmed) return;
        setImportStatus('Starting import...');
        try {
            const resp = await fetch(`${BACKEND_API.BASE_URL}${BACKEND_API.ENDPOINTS.LORA_IMPORT_URL}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: trimmed, provider: 'auto' }),
            });
            const data = await resp.json();
            if (!resp.ok || !data?.success) throw new Error(data?.detail || data?.error || 'Import failed');
            setImportJobId(data.job_id);
        } catch (e: any) {
            setImportStatus(e?.message || 'Import failed');
            setImportJobId(null);
        }
    };

    const handleDownloadAll = async () => {
        for (const lora of FREE_LORAS) {
            const status = loraStatus[lora.id];
            if (!status?.installed && !status?.downloading) {
                try {
                    await fetch(`${BACKEND_API.BASE_URL}/api/lora/install`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            url: lora.url,
                            filename: lora.filename,
                        }),
                    });
                } catch (e) {
                    console.error(`Failed to start download for ${lora.name}:`, e);
                }
            }
        }
        // Refresh status after triggering downloads
        setTimeout(checkStatus, 500);
    };

    const handleDownloadSingle = async (loraId: string) => {
        const lora = FREE_LORAS.find(l => l.id === loraId);
        if (!lora) return;

        try {
            await fetch(`${BACKEND_API.BASE_URL}/api/lora/install`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: lora.url,
                    filename: lora.filename,
                }),
            });
            setTimeout(checkStatus, 500);
        } catch (e) {
            console.error(`Failed to download ${lora.name}:`, e);
        }
    };

    if (isLoading) return null;

    const allInstalled = FREE_LORAS.every(lora => loraStatus[lora.id]?.installed);
    const anyDownloading = Object.values(loraStatus).some(s => s.downloading);
    const hasErrors = Object.values(loraStatus).some(s => s.error);

    if (allInstalled) {
        return (
            <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-xl">
                <Check className="w-5 h-5 text-green-400" />
                <span className="text-sm text-green-300">All LoRAs installed ({TOTAL_LORA_SIZE_MB} MB)</span>
            </div>
        );
    }

    return (
        <div className="bg-[#121218] border border-white/10 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center border border-violet-500/20">
                        {anyDownloading ? (
                            <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
                        ) : hasErrors ? (
                            <AlertTriangle className="w-5 h-5 text-red-400" />
                        ) : (
                            <Download className="w-5 h-5 text-violet-400" />
                        )}
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-white">Free Character LoRA Pack</h3>
                        <p className="text-xs text-slate-400">
                            {anyDownloading ? 'Downloading...' : `${FREE_LORAS.length} LoRAs available (~${TOTAL_LORA_SIZE_MB} MB total)`}
                        </p>
                    </div>
                </div>

                {!allInstalled && !anyDownloading && (
                    <button
                        onClick={handleDownloadAll}
                        className="px-5 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-lg transition-all"
                    >
                        Download All
                    </button>
                )}
            </div>

            {/* Individual LoRAs */}
            <div className="divide-y divide-white/5">
                {FREE_LORAS.map(lora => {
                    const status = loraStatus[lora.id];
                    if (!status) return null;

                    return (
                        <div key={lora.id} className="px-6 py-4 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                            <div className="flex items-center gap-4 flex-1">
                                <span className="text-3xl">{lora.emoji}</span>
                                <div className="flex-1">
                                    <div className="flex items-center gap-3">
                                        <h4 className="text-sm font-semibold text-white">{lora.name}</h4>
                                        <span className="text-xs text-slate-500">~{lora.size_mb} MB</span>
                                    </div>
                                    <p className="text-xs text-slate-400 mt-0.5">{lora.description}</p>

                                    {status.downloading && (
                                        <div className="mt-2 flex items-center gap-3">
                                            <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden max-w-[200px]">
                                                <div
                                                    className="h-full bg-violet-500 transition-all duration-300"
                                                    style={{ width: `${status.progress}%` }}
                                                />
                                            </div>
                                            <span className="text-xs text-slate-400 font-mono">{status.progress}%</span>
                                        </div>
                                    )}

                                    {status.error && (
                                        <p className="text-xs text-red-400 mt-1">Error: {status.error}</p>
                                    )}
                                </div>
                            </div>

                            {status.installed ? (
                                <div className="flex items-center gap-2 text-green-400 text-sm">
                                    <Check className="w-4 h-4" />
                                    <span>Installed</span>
                                </div>
                            ) : status.downloading ? (
                                <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
                            ) : (
                                <button
                                    onClick={() => handleDownloadSingle(lora.id)}
                                    className="px-4 py-1.5 bg-white/5 hover:bg-white/10 text-white text-xs rounded-lg transition-all border border-white/10"
                                >
                                    Download
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="p-5 border-t border-white/10 bg-black/20">
                <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold text-white">Import LoRA from URL</h4>
                    <span className="text-[10px] text-slate-500">HuggingFace / Civitai / direct</span>
                </div>
                <div className="flex gap-2">
                    <input
                        value={importUrl}
                        onChange={(e) => setImportUrl(e.target.value)}
                        placeholder="Paste model URL..."
                        className="flex-1 bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-white/20"
                    />
                    <button
                        onClick={handleImportUrl}
                        disabled={Boolean(importJobId)}
                        className="px-3 py-2 bg-white text-black text-xs font-semibold rounded-lg disabled:opacity-60"
                    >
                        {importJobId ? 'Importing...' : 'Import'}
                    </button>
                </div>
                {importStatus && <p className="text-xs text-slate-400 mt-2">{importStatus}</p>}
            </div>
        </div>
    );
};
