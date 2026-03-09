import { useEffect, useMemo, useState } from 'react';
import { Camera, RefreshCw } from 'lucide-react';

interface AlbumItem {
    url: string;
    source: string;
}

interface GlobalAlbumDockProps {
    onSendToQwen: (imageUrl: string) => void;
}

const GALLERY_KEY_PREFIX = 'gallery_';
const MAX_ITEMS = 30;

const parseGallery = (value: string | null): string[] => {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((item) => typeof item === 'string' && item.trim().length > 0);
    } catch {
        return [];
    }
};

const loadAlbumItems = (): AlbumItem[] => {
    const keys = Object.keys(localStorage).filter((key) => key.startsWith(GALLERY_KEY_PREFIX));
    const merged: AlbumItem[] = [];
    const seen = new Set<string>();

    keys.forEach((key) => {
        const source = key.replace(GALLERY_KEY_PREFIX, '');
        const urls = parseGallery(localStorage.getItem(key));
        urls.forEach((url) => {
            if (seen.has(url)) return;
            seen.add(url);
            merged.push({ url, source });
        });
    });

    return merged.slice(0, MAX_ITEMS);
};

export const GlobalAlbumDock = ({ onSendToQwen }: GlobalAlbumDockProps) => {
    const [items, setItems] = useState<AlbumItem[]>([]);

    const refresh = () => setItems(loadAlbumItems());

    useEffect(() => {
        refresh();

        const timer = window.setInterval(refresh, 2500);
        const onFocus = () => refresh();
        const onStorage = () => refresh();
        const onGalleryUpdate = () => refresh();

        window.addEventListener('focus', onFocus);
        window.addEventListener('storage', onStorage);
        window.addEventListener('fedda:gallery-updated', onGalleryUpdate as EventListener);

        return () => {
            window.clearInterval(timer);
            window.removeEventListener('focus', onFocus);
            window.removeEventListener('storage', onStorage);
            window.removeEventListener('fedda:gallery-updated', onGalleryUpdate as EventListener);
        };
    }, []);

    const hasItems = items.length > 0;
    const title = useMemo(() => `Album (${items.length})`, [items.length]);

    return (
        <aside className="hidden lg:flex lg:w-[280px] border-l border-white/5 bg-[#0b0b11] flex-col">
            <div className="px-3 py-3 border-b border-white/5 flex items-center justify-between">
                <div>
                    <div className="text-xs font-bold uppercase tracking-widest text-slate-400">{title}</div>
                    <div className="text-[10px] text-slate-600">Cross-tab image bridge</div>
                </div>
                <button
                    onClick={refresh}
                    className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400"
                    title="Refresh album"
                >
                    <RefreshCw className="w-3.5 h-3.5" />
                </button>
            </div>

            {!hasItems ? (
                <div className="flex-1 flex items-center justify-center text-center px-4">
                    <p className="text-xs text-slate-600">No generated images yet</p>
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-2">
                    {items.map((item, index) => (
                        <div key={`${item.url}_${index}`} className="bg-black/30 border border-white/5 rounded-xl overflow-hidden">
                            <img src={item.url} alt={`album-${index}`} className="w-full h-28 object-cover" loading="lazy" />
                            <div className="p-2 space-y-2">
                                <div className="text-[10px] text-slate-500 truncate">{item.source}</div>
                                <button
                                    onClick={() => onSendToQwen(item.url)}
                                    className="w-full py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-[11px] font-semibold text-white flex items-center justify-center gap-1"
                                >
                                    <Camera className="w-3 h-3" />
                                    Send To Qwen Angle
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </aside>
    );
};

