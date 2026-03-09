// LoRA Library / Store Page
import { useState, useRef, useEffect, useCallback } from 'react';
import { Download, CheckCircle2, Package, Search, Loader2, Trash2, RotateCw, CloudDownload, Crown } from 'lucide-react';
import { useToast } from '../components/ui/Toast';
import { BACKEND_API } from '../config/api';
import { CatalogShell, CatalogCard } from '../components/layout/CatalogShell';
import { LORA_CATALOG, LORA_CATEGORIES, type LoraEntry } from '../config/loras';

const api = (endpoint: string) => `${BACKEND_API.BASE_URL}${endpoint}`;

export const LibraryPage = () => {
    const { toast } = useToast();
    const [loras, setLoras] = useState<LoraEntry[]>(LORA_CATALOG);
    const [filterCategory, setFilterCategory] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [downloading, setDownloading] = useState<Record<string, number>>({}); // id -> progress %
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);

    const filteredLoras = loras
        .filter(l => filterCategory === 'all' || l.category === filterCategory)
        .filter(l => l.name.toLowerCase().includes(searchTerm.toLowerCase()) || l.description.toLowerCase().includes(searchTerm.toLowerCase()));

    const installedCount = loras.filter(l => l.installed).length;
    const premiumCount = loras.filter(l => l.isPremium).length;

    // Check which LoRAs are already installed on mount
    useEffect(() => {
        const checkInstalled = async () => {
            try {
                const res = await fetch(api(BACKEND_API.ENDPOINTS.LORA_INSTALLED));
                if (!res.ok) return;
                const data = await res.json();
                if (data.installed) {
                    setLoras(prev => prev.map(l => ({
                        ...l,
                        installed: l.filename in data.installed,
                        fileSize: l.filename in data.installed ? `${data.installed[l.filename]} MB` : l.fileSize,
                    })));
                }
            } catch {
                // Backend might not be running yet
            }
        };
        checkInstalled();
    }, []);

    // Poll download progress for active downloads
    const pollTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

    useEffect(() => {
        return () => {
            pollTimers.current.forEach(timer => clearInterval(timer));
        };
    }, []);

    const startProgressPoll = useCallback((lora: LoraEntry) => {
        const timer = setInterval(async () => {
            try {
                const res = await fetch(api(`${BACKEND_API.ENDPOINTS.LORA_DOWNLOAD_STATUS}/${lora.filename}`));
                const data = await res.json();

                if (data.status === 'completed') {
                    clearInterval(timer);
                    pollTimers.current.delete(lora.id);
                    setDownloading(prev => {
                        const next = { ...prev };
                        delete next[lora.id];
                        return next;
                    });
                    setLoras(ls => ls.map(l => l.id === lora.id ? { ...l, installed: true } : l));
                    toast(`${lora.name} installed successfully!`, 'success');
                } else if (data.status === 'error') {
                    clearInterval(timer);
                    pollTimers.current.delete(lora.id);
                    setDownloading(prev => {
                        const next = { ...prev };
                        delete next[lora.id];
                        return next;
                    });
                    toast(`Download failed: ${data.message || lora.name}`, 'error');
                } else {
                    setDownloading(prev => ({ ...prev, [lora.id]: data.progress ?? 0 }));
                }
            } catch {
                // Silently retry on next poll
            }
        }, 1000);

        pollTimers.current.set(lora.id, timer);
    }, [toast]);

    const handleDownload = async (lora: LoraEntry) => {
        if (!lora.downloadUrl && !lora.isPremium) {
            toast('No download URL configured for this LoRA', 'error');
            return;
        }

        setDownloading(prev => ({ ...prev, [lora.id]: 0 }));

        try {
            if (lora.isPremium) {
                // Premium LoRAs use the sync endpoint
                const res = await fetch(api(BACKEND_API.ENDPOINTS.LORA_SYNC_PREMIUM), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                });
                if (!res.ok) throw new Error('Sync failed');
                toast(`Downloading ${lora.name} from Premium vault...`, 'info');
            } else {
                const res = await fetch(api(BACKEND_API.ENDPOINTS.LORA_INSTALL), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: lora.downloadUrl, filename: lora.filename })
                });
                if (!res.ok) throw new Error('Failed to start download');
                toast(`Downloading ${lora.name}...`, 'info');
            }

            startProgressPoll(lora);
        } catch (error) {
            toast(`Failed to download ${lora.name}`, 'error');
            setDownloading(prev => {
                const next = { ...prev };
                delete next[lora.id];
                return next;
            });
        }
    };

    const handleSyncAll = async () => {
        setIsSyncing(true);
        try {
            const res = await fetch(api(BACKEND_API.ENDPOINTS.LORA_SYNC_PREMIUM), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            if (!res.ok) throw new Error('Sync failed');
            const data = await res.json();

            if (data.status === 'error') {
                toast(data.message, 'error');
                return;
            }

            const downloadCount = data.downloading?.length ?? 0;
            const skipCount = data.skipped?.length ?? 0;

            if (downloadCount === 0 && skipCount > 0) {
                toast(`All ${skipCount} premium LoRAs already installed!`, 'success');
            } else {
                toast(`Downloading ${downloadCount} LoRAs (${skipCount} already installed)...`, 'info');

                // Start polling for each downloading file
                for (const filename of (data.downloading || [])) {
                    const lora = loras.find(l => l.filename === filename);
                    if (lora) {
                        setDownloading(prev => ({ ...prev, [lora.id]: 0 }));
                        startProgressPoll(lora);
                    }
                }
            }
        } catch (error) {
            toast('Failed to sync premium LoRAs. Is the backend running?', 'error');
        } finally {
            setIsSyncing(false);
        }
    };

    const handleRefreshModels = async () => {
        setIsRefreshing(true);
        try {
            const res = await fetch(api(BACKEND_API.ENDPOINTS.COMFY_REFRESH_MODELS));
            if (!res.ok) throw new Error('Refresh failed');
            toast('ComfyUI model list refreshed!', 'success');
        } catch {
            toast('Failed to refresh ComfyUI models', 'error');
        } finally {
            setIsRefreshing(false);
        }
    };

    const handleUninstall = (lora: LoraEntry) => {
        if (!confirm(`Uninstall ${lora.name}? This will remove the file from disk.`)) return;
        setLoras(ls => ls.map(l => l.id === lora.id ? { ...l, installed: false } : l));
        toast(`${lora.name} uninstalled`, 'info');
    };

    const categoryColors: Record<string, string> = {
        character: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
        style: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
        concept: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
        clothing: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
    };

    return (
        <CatalogShell
            title="LoRA Library"
            subtitle={`${filteredLoras.length} available � ${installedCount} installed � ${premiumCount} premium`}
            icon={Package}
            actions={
                <>
                    <button
                        onClick={handleSyncAll}
                        disabled={isSyncing}
                        className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-amber-500/20 to-orange-500/20 hover:from-amber-500/30 hover:to-orange-500/30 border border-amber-500/30 rounded-xl text-sm font-bold text-amber-300 transition-all disabled:opacity-50"
                    >
                        {isSyncing ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <CloudDownload className="w-4 h-4" />
                        )}
                        Sync All Premium
                    </button>
                    <button
                        onClick={handleRefreshModels}
                        disabled={isRefreshing}
                        className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm text-slate-300 transition-colors disabled:opacity-50"
                    >
                        <RotateCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                        Refresh ComfyUI
                    </button>
                </>
            }
        >
            {/* Filters */}
            <CatalogCard className="p-6 space-y-4">
                <div className="flex flex-col md:flex-row gap-4">
                    {/* Search */}
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                        <input
                            type="text"
                            placeholder="Search LoRAs..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 bg-[#0a0a0f] border border-white/10 rounded-lg text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-white/20"
                        />
                    </div>

                    {/* Category Tabs */}
                    <div className="flex bg-[#0a0a0f] p-1 rounded-xl border border-white/10">
                        {LORA_CATEGORIES.map(cat => (
                            <button
                                key={cat.id}
                                onClick={() => setFilterCategory(cat.id)}
                                className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                                    filterCategory === cat.id
                                        ? 'bg-white text-black shadow-lg'
                                        : 'text-slate-400 hover:text-white'
                                }`}
                            >
                                {cat.label}
                            </button>
                        ))}
                    </div>
                </div>
            </CatalogCard>
            {/* LoRA Grid */}
            {filteredLoras.length === 0 ? (
                <div className="text-center text-slate-500 py-20">No LoRAs match your search</div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                    {filteredLoras.map((lora) => {
                        const isDownloading = lora.id in downloading;
                        const progress = downloading[lora.id] ?? 0;

                        return (
                            <div
                                key={lora.id}
                                className={`bg-[#121218] border rounded-2xl overflow-hidden transition-all hover:border-white/20 ${
                                    lora.installed ? 'border-emerald-500/20' : lora.isPremium ? 'border-amber-500/10' : 'border-white/5'
                                }`}
                            >
                                {/* Thumbnail placeholder */}
                                <div className={`h-32 flex items-center justify-center relative ${
                                    lora.isPremium
                                        ? 'bg-gradient-to-br from-amber-500/10 to-orange-500/5'
                                        : 'bg-gradient-to-br from-white/5 to-white/[0.02]'
                                }`}>
                                    <span className="text-5xl opacity-20">
                                        {lora.category === 'character' ? '👤' : lora.category === 'style' ? '🎨' : lora.category === 'concept' ? '💡' : '👗'}
                                    </span>

                                    {/* Category badge */}
                                    <span className={`absolute top-3 left-3 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${categoryColors[lora.category]}`}>
                                        {lora.category}
                                    </span>

                                    {/* Premium badge */}
                                    {lora.isPremium && (
                                        <span className="absolute top-3 right-3 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                                            <Crown className="w-3 h-3" /> Premium
                                        </span>
                                    )}

                                    {/* Installed badge */}
                                    {lora.installed && !lora.isPremium && (
                                        <span className="absolute top-3 right-3 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                            <CheckCircle2 className="w-3 h-3" /> Installed
                                        </span>
                                    )}

                                    {/* Premium + Installed */}
                                    {lora.installed && lora.isPremium && (
                                        <span className="absolute top-3 right-3 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                            <CheckCircle2 className="w-3 h-3" /> Installed
                                        </span>
                                    )}
                                </div>

                                {/* Card Body */}
                                <div className="p-5 space-y-3">
                                    <div>
                                        <h3 className="text-lg font-bold text-white">{lora.name}</h3>
                                        <p className="text-xs text-slate-400 mt-1 leading-relaxed line-clamp-2">
                                            {lora.description}
                                        </p>
                                    </div>

                                    {/* Meta */}
                                    <div className="flex items-center gap-3 text-xs text-slate-500">
                                        {lora.fileSize && <span>{lora.fileSize}</span>}
                                        <span className="text-slate-700">&bull;</span>
                                        <span className="font-mono text-slate-600">{lora.filename}</span>
                                    </div>

                                    {/* Download Progress */}
                                    {isDownloading && (
                                        <div className="space-y-1">
                                            <div className="flex justify-between text-xs">
                                                <span className="text-blue-400">Downloading...</span>
                                                <span className="text-white">{Math.round(progress)}%</span>
                                            </div>
                                            <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-blue-500 rounded-full transition-all duration-300"
                                                    style={{ width: `${progress}%` }}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Action Button */}
                                    {!isDownloading && (
                                        lora.installed ? (
                                            <button
                                                onClick={() => handleUninstall(lora)}
                                                className="w-full py-2.5 flex items-center justify-center gap-2 text-sm font-medium rounded-xl bg-white/5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 border border-white/5 hover:border-red-500/20 transition-all"
                                            >
                                                <Trash2 className="w-4 h-4" /> Uninstall
                                            </button>
                                        ) : (
                                            <button
                                                onClick={() => handleDownload(lora)}
                                                className={`w-full py-2.5 flex items-center justify-center gap-2 text-sm font-bold rounded-xl transition-all shadow-lg ${
                                                    lora.isPremium
                                                        ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-black hover:from-amber-400 hover:to-orange-400'
                                                        : 'bg-white text-black hover:bg-slate-200'
                                                }`}
                                            >
                                                <Download className="w-4 h-4" /> {lora.isPremium ? 'Download Premium' : 'Download'}
                                            </button>
                                        )
                                    )}

                                    {isDownloading && (
                                        <button
                                            disabled
                                            className="w-full py-2.5 flex items-center justify-center gap-2 text-sm font-medium rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20"
                                        >
                                            <Loader2 className="w-4 h-4 animate-spin" /> Installing...
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </CatalogShell>
    );
};

