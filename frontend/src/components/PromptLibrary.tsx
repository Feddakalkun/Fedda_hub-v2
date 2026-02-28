// PromptLibrary.tsx
// Searchable drawer panel that loads from the harvested prompt_library.json
// Props: onSelect(positive, negative) — called when user picks a prompt

import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, BookOpen, RefreshCw, ChevronDown, User, Tag, X, Zap } from 'lucide-react';

interface PromptEntry {
    id: number;
    title: string;
    positive: string;
    negative: string;
    characters: string[];
    category: string;
    source: string;
}

interface PromptLibraryData {
    total_prompts: number;
    categories: string[];
    characters: string[];
    prompts: PromptEntry[];
    generated_at: string;
}

interface PromptLibraryProps {
    onSelect: (positive: string, negative: string) => void;
    isOpen: boolean;
    onClose: () => void;
}

const CATEGORY_COLORS: Record<string, string> = {
    concert: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    duo: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    explicit: 'bg-red-500/20 text-red-300 border-red-500/30',
    general: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
    music: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
    portrait: 'bg-teal-500/20 text-teal-300 border-teal-500/30',
    pregnancy: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
    social: 'bg-green-500/20 text-green-300 border-green-500/30',
    train: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
    video: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
};

const PAGE_SIZE = 30;

export function PromptLibrary({ onSelect, isOpen, onClose }: PromptLibraryProps) {
    const [data, setData] = useState<PromptLibraryData | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isHarvesting, setIsHarvesting] = useState(false);
    const [search, setSearch] = useState('');
    const [activeCategory, setActiveCategory] = useState<string>('all');
    const [activeChar, setActiveChar] = useState<string>('all');
    const [page, setPage] = useState(0);
    const [expandedId, setExpandedId] = useState<number | null>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    const loadLibrary = useCallback(async () => {
        setIsLoading(true);
        try {
            const resp = await fetch('http://localhost:8000/api/prompts/library');
            if (!resp.ok) throw new Error('Failed to load prompt library');
            const json = await resp.json();
            setData(json);
        } catch (e) {
            console.error('Prompt library load failed:', e);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isOpen && !data) {
            loadLibrary();
        }
        if (isOpen) {
            setTimeout(() => searchRef.current?.focus(), 100);
        }
    }, [isOpen, data, loadLibrary]);

    // Reset page when filters change
    useEffect(() => { setPage(0); }, [search, activeCategory, activeChar]);

    const handleHarvest = async () => {
        setIsHarvesting(true);
        try {
            const resp = await fetch('http://localhost:8000/api/prompts/harvest', { method: 'POST' });
            const json = await resp.json();
            if (json.success) {
                await loadLibrary();
            }
        } catch (e) {
            console.error('Harvest failed:', e);
        } finally {
            setIsHarvesting(false);
        }
    };

    const filtered = (data?.prompts ?? []).filter(p => {
        const matchSearch = !search ||
            p.positive.toLowerCase().includes(search.toLowerCase()) ||
            p.title.toLowerCase().includes(search.toLowerCase()) ||
            p.source.toLowerCase().includes(search.toLowerCase());
        const matchCat = activeCategory === 'all' || p.category === activeCategory;
        const matchChar = activeChar === 'all' || p.characters.includes(activeChar);
        return matchSearch && matchCat && matchChar;
    });

    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[200] flex items-stretch justify-end">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Drawer */}
            <div className="relative w-full max-w-2xl h-full bg-[#0d0d14] border-l border-white/5 flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
                            <BookOpen className="w-4 h-4 text-white" />
                        </div>
                        <div>
                            <h2 className="text-sm font-bold text-white">Prompt Library</h2>
                            <p className="text-xs text-slate-500">
                                {data ? `${data.total_prompts.toLocaleString()} prompts harvested` : 'Loading...'}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleHarvest}
                            disabled={isHarvesting}
                            title="Re-scan scripts and rebuild library"
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all disabled:opacity-40"
                        >
                            <RefreshCw className={`w-3 h-3 ${isHarvesting ? 'animate-spin' : ''}`} />
                            {isHarvesting ? 'Scanning...' : 'Refresh'}
                        </button>
                        <button
                            onClick={onClose}
                            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 text-slate-500 hover:text-white transition-all"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Search */}
                <div className="px-6 pt-4 pb-3 flex-shrink-0">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                        <input
                            ref={searchRef}
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search prompts, characters, scenes..."
                            className="w-full bg-[#121218] border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
                        />
                        {search && (
                            <button
                                onClick={() => setSearch('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        )}
                    </div>
                </div>

                {/* Filter Chips — Category */}
                {data && (
                    <div className="px-6 pb-2 flex-shrink-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <Tag className="w-3 h-3 text-slate-600 flex-shrink-0" />
                            <button
                                onClick={() => setActiveCategory('all')}
                                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${activeCategory === 'all'
                                        ? 'bg-white/15 text-white border-white/20'
                                        : 'bg-transparent text-slate-500 border-white/5 hover:border-white/20 hover:text-slate-300'
                                    }`}
                            >
                                All
                            </button>
                            {data.categories.map(cat => (
                                <button
                                    key={cat}
                                    onClick={() => setActiveCategory(cat === activeCategory ? 'all' : cat)}
                                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all capitalize ${activeCategory === cat
                                            ? CATEGORY_COLORS[cat] ?? 'bg-white/15 text-white border-white/20'
                                            : 'bg-transparent text-slate-500 border-white/5 hover:border-white/20 hover:text-slate-300'
                                        }`}
                                >
                                    {cat}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Filter Chips — Character */}
                {data && data.characters.length > 0 && (
                    <div className="px-6 pb-3 flex-shrink-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <User className="w-3 h-3 text-slate-600 flex-shrink-0" />
                            <button
                                onClick={() => setActiveChar('all')}
                                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${activeChar === 'all'
                                        ? 'bg-white/15 text-white border-white/20'
                                        : 'bg-transparent text-slate-500 border-white/5 hover:border-white/20 hover:text-slate-300'
                                    }`}
                            >
                                All
                            </button>
                            {data.characters.map(char => (
                                <button
                                    key={char}
                                    onClick={() => setActiveChar(char === activeChar ? 'all' : char)}
                                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${activeChar === char
                                            ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                                            : 'bg-transparent text-slate-500 border-white/5 hover:border-white/20 hover:text-slate-300'
                                        }`}
                                >
                                    {char}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Results count */}
                <div className="px-6 pb-2 flex-shrink-0">
                    <p className="text-xs text-slate-600">
                        {isLoading ? 'Loading...' : `${filtered.length.toLocaleString()} results`}
                        {filtered.length > 0 && ` · page ${page + 1} of ${totalPages}`}
                    </p>
                </div>

                {/* Prompt List */}
                <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-2 custom-scrollbar">
                    {isLoading && (
                        <div className="flex items-center justify-center py-20 text-slate-500">
                            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                            Loading library...
                        </div>
                    )}

                    {!isLoading && filtered.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-20 text-slate-500 gap-2">
                            <BookOpen className="w-8 h-8 opacity-30" />
                            <p className="text-sm">No prompts match your search</p>
                        </div>
                    )}

                    {pageItems.map(entry => (
                        <div
                            key={entry.id}
                            className="group bg-[#121218] border border-white/5 rounded-xl overflow-hidden hover:border-white/15 transition-all"
                        >
                            {/* Collapsed row */}
                            <div
                                className="flex items-start gap-3 p-3 cursor-pointer"
                                onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                            >
                                {/* Category dot */}
                                <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${CATEGORY_COLORS[entry.category]?.split(' ')[0].replace('bg-', 'bg-').replace('/20', '/80') ?? 'bg-slate-500'
                                    }`} />

                                {/* Title + meta */}
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs text-slate-200 font-medium leading-relaxed line-clamp-2">
                                        {entry.title}
                                    </p>
                                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border capitalize ${CATEGORY_COLORS[entry.category] ?? 'bg-slate-500/20 text-slate-300 border-slate-500/30'
                                            }`}>
                                            {entry.category}
                                        </span>
                                        {entry.characters.slice(0, 3).map(c => (
                                            <span key={c} className="text-[10px] text-indigo-400">{c}</span>
                                        ))}
                                        <span className="text-[10px] text-slate-600 truncate">{entry.source}</span>
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-1 flex-shrink-0">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onSelect(entry.positive, entry.negative);
                                            onClose();
                                        }}
                                        className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-1 bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-bold rounded-lg transition-all"
                                    >
                                        <Zap className="w-3 h-3" />
                                        Use
                                    </button>
                                    <ChevronDown
                                        className={`w-4 h-4 text-slate-600 transition-transform ${expandedId === entry.id ? 'rotate-180' : ''
                                            }`}
                                    />
                                </div>
                            </div>

                            {/* Expanded */}
                            {expandedId === entry.id && (
                                <div className="px-4 pb-4 border-t border-white/5 pt-3 space-y-3 animate-in slide-in-from-top-2 fade-in duration-150">
                                    <div>
                                        <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Positive Prompt</p>
                                        <p className="text-xs text-slate-300 leading-relaxed bg-black/30 rounded-lg p-3 max-h-48 overflow-y-auto custom-scrollbar">
                                            {entry.positive}
                                        </p>
                                    </div>
                                    {entry.negative && (
                                        <div>
                                            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Negative Prompt</p>
                                            <p className="text-xs text-slate-500 leading-relaxed bg-black/20 rounded-lg p-3 line-clamp-3">
                                                {entry.negative}
                                            </p>
                                        </div>
                                    )}
                                    <button
                                        onClick={() => {
                                            onSelect(entry.positive, entry.negative);
                                            onClose();
                                        }}
                                        className="w-full flex items-center justify-center gap-2 py-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white text-xs font-bold rounded-xl transition-all"
                                    >
                                        <Zap className="w-3 h-3" />
                                        Load This Prompt
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between px-6 py-3 border-t border-white/5 flex-shrink-0">
                        <button
                            disabled={page === 0}
                            onClick={() => setPage(p => p - 1)}
                            className="px-3 py-1.5 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            ← Prev
                        </button>
                        <span className="text-xs text-slate-600">{page + 1} / {totalPages}</span>
                        <button
                            disabled={page >= totalPages - 1}
                            onClick={() => setPage(p => p + 1)}
                            className="px-3 py-1.5 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            Next →
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
