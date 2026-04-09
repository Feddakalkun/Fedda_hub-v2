import { useState, useEffect, useCallback } from 'react';
import { Check, Loader2, Users, Sparkles, X, DownloadCloud, ImageOff } from 'lucide-react';
import { FREE_LORAS } from '../config/loras';
import { BACKEND_API } from '../config/api';
import { CatalogShell, CatalogCard } from './layout/CatalogShell';

interface LoRAStatus {
    filename: string;
    installed: boolean;
    downloading: boolean;
    progress: number;
    error?: string;
}

type LoRAFamily =
    | 'z-image'
    | 'qwen'
    | 'flux2klein'
    | 'flux1dev'
    | 'sd15'
    | 'sd15_lycoris'
    | 'sdxl'
    | 'ltx'
    | 'wan'
    | 'ace-step';

interface LoRADownloaderProps {
    family?: LoRAFamily;
}

interface PackConfig {
    key: string;
    title: string;
    subtitle: string;
}

interface CatalogItem {
    name: string;
    file: string;
    installed: boolean;
    size_mb?: number | null;
    preview_url?: string | null;
}

const FAMILY_PACKS: Record<LoRAFamily, PackConfig[]> = {
    'z-image':    [
        { key: 'zimage_turbo', title: 'Z-Image Turbo Celeb Pack', subtitle: 'pmczip/Z-Image-Turbo_Models' },
        { key: 'zimage_nsfw', title: 'Z-Image NSFW Pack', subtitle: 'qqnyanddld/nsfw-z-image-lora' },
    ],
    qwen:         [],
    flux2klein:   [
        { key: 'flux2klein', title: 'FLUX2KLEIN Celeb Pack',  subtitle: 'pmczip/FLUX.2-klein-9B_Models' },
        { key: 'flux1dev',   title: 'FLUX.1-dev Celeb Pack',  subtitle: 'pmczip/FLUX.1-dev_Models' },
    ],
    flux1dev:     [{ key: 'flux1dev', title: 'FLUX.1-dev Celeb Pack', subtitle: 'pmczip/FLUX.1-dev_Models' }],
    sd15:         [
        { key: 'sd15',         title: 'SD1.5 LoRA Pack',     subtitle: 'pmczip/SD1.5_LoRa_Models' },
        { key: 'sd15_lycoris', title: 'SD1.5 LyCORIS Pack',  subtitle: 'pmczip/SD1.5_LyCORIS_Models' },
    ],
    sd15_lycoris: [{ key: 'sd15_lycoris', title: 'SD1.5 LyCORIS Pack', subtitle: 'pmczip/SD1.5_LyCORIS_Models' }],
    sdxl:         [{ key: 'sdxl', title: 'SDXL LoRA Pack', subtitle: 'pmczip/SDXL_Models' }],
    ltx:          [],
    wan:          [
        { key: 'wan22_nsfw', title: 'WAN 2.2 NSFW Pack', subtitle: 'lkzd7/WAN2.2_LoraSet_NSFW' },
    ],
    'ace-step':   [],
};

const FAMILY_LABELS: Record<string, string> = {
    'z-image':    'Z-Image',
    qwen:         'QWEN',
    flux2klein:   'FLUX2KLEIN',
    flux1dev:     'FLUX.1-dev',
    sd15:         'SD1.5',
    sd15_lycoris: 'SD1.5 LyCORIS',
    sdxl:         'SDXL',
    wan:          'WAN 2.2',
};

// ─── Character preview card ───────────────────────────────────────────────────
const CharacterCard = ({
    item,
    packKey,
    onDownload,
    busy,
}: {
    item: CatalogItem;
    packKey: string | null;
    onDownload: (packKey: string, file: string) => void;
    busy: string | null;
}) => {
    const [imgFailed, setImgFailed] = useState(false);

    return (
        <div className="group relative aspect-[3/4] rounded-2xl overflow-hidden border border-white/5 bg-[#0a0a0a]">
            {/* Preview image */}
            {item.preview_url && !imgFailed ? (
                <img
                    src={item.preview_url}
                    alt={item.name}
                    onError={() => setImgFailed(true)}
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-110 opacity-70 group-hover:opacity-100"
                />
            ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                    <ImageOff className="w-8 h-8 text-white/10" />
                </div>
            )}

            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />

            {/* Info + action */}
            <div className="absolute bottom-0 left-0 right-0 p-4">
                <p className="text-[11px] font-black text-white uppercase tracking-widest truncate leading-tight">
                    {item.name}
                </p>
                {item.size_mb && (
                    <p className="text-[9px] text-white/30 font-mono mt-0.5">{item.size_mb} MB</p>
                )}
                <div className="mt-3">
                    {item.installed ? (
                        <span className="inline-flex items-center gap-1.5 text-[9px] font-black text-emerald-400 uppercase tracking-widest">
                            <Check className="w-3 h-3" /> Ready
                        </span>
                    ) : packKey ? (
                        <button
                            disabled={busy === item.file}
                            onClick={() => onDownload(packKey, item.file)}
                            className="px-3 py-1.5 bg-white/10 hover:bg-white hover:text-black text-white rounded-lg text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-40"
                        >
                            {busy === item.file ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Download'}
                        </button>
                    ) : null}
                </div>
            </div>
        </div>
    );
};

// ─── Main component ───────────────────────────────────────────────────────────
export const LoRADownloader = ({ family = 'z-image' }: LoRADownloaderProps) => {
    const [loraStatus, setLoraStatus]         = useState<Record<string, LoRAStatus>>({});
    const [isLoading, setIsLoading]           = useState(true);
    const [importUrl, setImportUrl]           = useState('');
    const [importJobId, setImportJobId]       = useState<string | null>(null);
    const [importStatus, setImportStatus]     = useState<string>('');
    const [previewOpen, setPreviewOpen]       = useState(false);
    const [previewTitle, setPreviewTitle]     = useState('');
    const [previewItems, setPreviewItems]     = useState<CatalogItem[]>([]);
    const [activePreviewPack, setActivePack]  = useState<string | null>(null);
    const [busyFile, setBusyFile]             = useState<string | null>(null);
    const [packStatus, setPackStatus]         = useState<Record<string, any>>({});
    const [packCatalog, setPackCatalog]       = useState<Record<string, any>>({});
    const [previewSearch, setPreviewSearch]   = useState('');

    const isZImage = family === 'z-image';
    const packs    = FAMILY_PACKS[family] || [];
    const title    = FAMILY_LABELS[family] || 'Library';

    // ─── Status polling ───────────────────────────────────────────────────
    const checkStatus = useCallback(async () => {
        try {
            // Free starter pack status (Z-Image only)
            if (isZImage) {
                const resp = await fetch(`${BACKEND_API.BASE_URL}${BACKEND_API.ENDPOINTS.LORA_INSTALLED}`);
                const data = await resp.json();
                if (data.success) {
                    const installed: Record<string, any> = data.installed || {};
                    const status: Record<string, LoRAStatus> = {};
                    for (const lora of FREE_LORAS) {
                        const isInst = lora.filename in installed;
                        let progress = 0, downloading = false, error: string | undefined;
                        if (!isInst) {
                            try {
                                const pr = await fetch(`${BACKEND_API.BASE_URL}${BACKEND_API.ENDPOINTS.LORA_DOWNLOAD_STATUS}/${lora.filename}`);
                                const pd = await pr.json();
                                if (pd.status === 'downloading') { downloading = true; progress = pd.progress || 0; }
                                else if (pd.status === 'error') { error = pd.message; }
                            } catch { /**/ }
                        }
                        status[lora.id] = { filename: lora.filename, installed: isInst, downloading, progress, error };
                    }
                    setLoraStatus(status);
                }
            }

            // Premium pack status + catalog
            const statusEntries: [string, any][]  = [];
            const catalogEntries: [string, any][] = [];
            for (const pack of packs) {
                try {
                    const [sr, cr] = await Promise.all([
                        fetch(`${BACKEND_API.BASE_URL}/api/lora/pack/${pack.key}/status`),
                        fetch(`${BACKEND_API.BASE_URL}/api/lora/pack/${pack.key}/catalog?limit=1000`),
                    ]);
                    const [sd, cd] = await Promise.all([sr.json(), cr.json()]);
                    if (sd) statusEntries.push([pack.key, sd]);
                    if (cd) catalogEntries.push([pack.key, cd]);
                } catch { /**/ }
            }
            setPackStatus(Object.fromEntries(statusEntries));
            setPackCatalog(Object.fromEntries(catalogEntries));

        } catch { /**/ } finally {
            setIsLoading(false);
        }
    }, [family, isZImage, packs]);

    useEffect(() => {
        checkStatus();
        const id = setInterval(checkStatus, 8000);
        return () => clearInterval(id);
    }, [checkStatus]);

    // ─── Import job polling ───────────────────────────────────────────────
    useEffect(() => {
        if (!importJobId) return;
        const id = setInterval(async () => {
            try {
                const r = await fetch(`${BACKEND_API.BASE_URL}${BACKEND_API.ENDPOINTS.LORA_IMPORT_STATUS}/${importJobId}`);
                const d = await r.json();
                if (!d?.success) return;
                if (d.status === 'completed') {
                    setImportStatus(`Imported: ${d.filename}`);
                    setImportJobId(null);
                    checkStatus();
                } else if (d.status === 'error') {
                    setImportStatus(`Failed: ${d.message || 'error'}`);
                    setImportJobId(null);
                } else {
                    setImportStatus(`Importing... ${d.progress || 0}%`);
                }
            } catch { /**/ }
        }, 1500);
        return () => clearInterval(id);
    }, [importJobId, checkStatus]);

    // ─── Actions ──────────────────────────────────────────────────────────
    const handleImportUrl = async () => {
        if (!importUrl.trim()) return;
        setImportStatus('Queuing...');
        try {
            const r = await fetch(`${BACKEND_API.BASE_URL}${BACKEND_API.ENDPOINTS.LORA_IMPORT_URL}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: importUrl.trim() }),
            });
            const d = await r.json();
            if (d.success) setImportJobId(d.job_id);
            else setImportStatus(d.error || 'Failed');
        } catch (e: any) { setImportStatus(e.message); }
    };

    const handleInstallAllFree = async () => {
        try {
            await fetch(`${BACKEND_API.BASE_URL}/api/lora/install-all-free`, { method: 'POST' });
            setTimeout(checkStatus, 500);
        } catch { /**/ }
    };

    const handleSyncPack = async (packKey: string) => {
        await fetch(`${BACKEND_API.BASE_URL}/api/lora/pack/${packKey}/sync`, { method: 'POST' });
        setTimeout(checkStatus, 500);
    };

    const handleDownloadSingle = async (packKey: string, file: string) => {
        setBusyFile(file);
        try {
            await fetch(`${BACKEND_API.BASE_URL}/api/lora/pack/${packKey}/download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: file }),
            });
            setTimeout(checkStatus, 500);
        } catch { /**/ } finally { setBusyFile(null); }
    };

    const openStarterPreview = () => {
        setPreviewTitle('Starter Pack');
        setPreviewItems(FREE_LORAS.map(l => ({
            name: l.name, file: l.filename, installed: !!loraStatus[l.id]?.installed,
        })));
        setActivePack(null);
        setPreviewOpen(true);
    };

    const openPackPreview = (pack: PackConfig) => {
        const catalog = packCatalog[pack.key];
        setPreviewTitle(pack.title);
        setPreviewItems(catalog?.items || []);
        setActivePack(pack.key);
        setPreviewOpen(true);
    };

    if (isLoading) return (
        <div className="flex items-center justify-center h-40">
            <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
        </div>
    );

    const allStarterInstalled = isZImage && FREE_LORAS.every(l => loraStatus[l.id]?.installed);
    const starterCount        = isZImage ? FREE_LORAS.filter(l => loraStatus[l.id]?.installed).length : 0;
    const anyStarterLoading   = isZImage && FREE_LORAS.some(l => loraStatus[l.id]?.downloading);

    const filteredPreview = previewSearch.trim()
        ? previewItems.filter(i => i.name.toLowerCase().includes(previewSearch.toLowerCase()))
        : previewItems;

    return (
        <CatalogShell
            title={title}
            subtitle="Download character & style LoRAs for use in generation."
            icon={Users}
        >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

                {/* ── Starter pack card (Z-Image only) ── */}
                {isZImage && (
                    <CatalogCard
                        title="Character Starter Pack"
                        subtitle={`${starterCount}/${FREE_LORAS.length} models installed · Free`}
                        icon={allStarterInstalled ? Check : (anyStarterLoading ? Loader2 : Sparkles)}
                        iconClassName={anyStarterLoading ? 'animate-spin text-emerald-500' : allStarterInstalled ? 'text-emerald-500' : ''}
                        actionLabel={allStarterInstalled ? 'Ready' : (anyStarterLoading ? 'Installing...' : 'Install Free Pack')}
                        onAction={allStarterInstalled || anyStarterLoading ? undefined : handleInstallAllFree}
                        secondaryActionLabel="Preview"
                        onSecondaryAction={openStarterPreview}
                    />
                )}

                {/* ── Premium pack cards ── */}
                {packs.map(pack => {
                    const st   = packStatus[pack.key]  || {};
                    const cat  = packCatalog[pack.key] || {};
                    const busy = st.status === 'running';
                    const done = cat.total > 0 && cat.installed >= cat.total;

                    return (
                        <CatalogCard
                            key={pack.key}
                            title={pack.title}
                            subtitle={
                                cat.total
                                    ? `${cat.installed}/${cat.total} installed`
                                    : 'Loading catalog...'
                            }
                            icon={busy ? Loader2 : Users}
                            iconClassName={busy ? 'animate-spin text-emerald-500' : ''}
                            actionLabel={done ? 'Ready' : (busy ? 'Syncing...' : 'Sync All')}
                            onAction={done || busy ? undefined : () => handleSyncPack(pack.key)}
                            secondaryActionLabel="Preview"
                            onSecondaryAction={() => openPackPreview(pack)}
                            progress={cat.total > 0 ? (cat.installed / cat.total) * 100 : undefined}
                        />
                    );
                })}

                {/* ── Manual import ── */}
                <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-6 flex flex-col justify-between">
                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-2xl bg-white/5 flex items-center justify-center border border-white/10">
                                <DownloadCloud className="w-5 h-5 text-white/40" />
                            </div>
                            <h3 className="text-sm font-bold text-white/80">Import from URL</h3>
                        </div>
                        <input
                            value={importUrl}
                            onChange={e => setImportUrl(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleImportUrl()}
                            placeholder="HuggingFace or Civitai link..."
                            className="w-full bg-[#0a0a0f] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white/60 focus:outline-none focus:border-emerald-500/20"
                        />
                        {importStatus && (
                            <p className="text-[10px] text-slate-500 font-bold tracking-widest">{importStatus}</p>
                        )}
                    </div>
                    <button
                        onClick={handleImportUrl}
                        className="mt-4 w-full py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-white/50 transition-all"
                    >
                        {importJobId ? 'Processing...' : 'Import'}
                    </button>
                </div>

            </div>

            {/* ─── Preview modal ─────────────────────────────────────────────────── */}
            {previewOpen && (
                <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-xl flex items-center justify-center p-6">
                    <div className="w-full max-w-7xl h-full max-h-[90vh] bg-[#080808] border border-white/10 rounded-[2.5rem] overflow-hidden flex flex-col shadow-2xl">

                        {/* Header */}
                        <div className="px-8 py-6 border-b border-white/5 flex items-center gap-6 shrink-0">
                            <div className="flex-1 min-w-0">
                                <h3 className="text-lg font-black text-white uppercase tracking-widest truncate">
                                    {previewTitle}
                                </h3>
                                <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.3em] mt-1">
                                    {filteredPreview.length} of {previewItems.length} models
                                    {previewItems.filter(i => i.installed).length > 0 &&
                                        ` · ${previewItems.filter(i => i.installed).length} installed`}
                                </p>
                            </div>

                            {/* Search */}
                            <input
                                value={previewSearch}
                                onChange={e => setPreviewSearch(e.target.value)}
                                placeholder="Search characters..."
                                className="w-56 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-xs text-white/60 focus:outline-none focus:border-emerald-500/20"
                            />

                            {/* Download all in pack */}
                            {activePreviewPack && (
                                <button
                                    onClick={() => handleSyncPack(activePreviewPack)}
                                    className="px-5 py-2.5 bg-white text-black rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-400 transition-all shrink-0"
                                >
                                    Download All
                                </button>
                            )}

                            <button
                                onClick={() => { setPreviewOpen(false); setPreviewSearch(''); }}
                                className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 transition-all text-white/40 hover:text-white shrink-0"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Character grid */}
                        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                            {filteredPreview.length === 0 ? (
                                <div className="flex items-center justify-center h-40 text-white/20 text-sm font-bold uppercase tracking-widest">
                                    No results
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                                    {filteredPreview.map(item => (
                                        <CharacterCard
                                            key={item.file}
                                            item={item}
                                            packKey={activePreviewPack}
                                            onDownload={handleDownloadSingle}
                                            busy={busyFile}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

        </CatalogShell>
    );
};
