// PromptLibrary.tsx
// Two-tab system: "Prompt Builder" (Wildcards) and "Library" (Legacy/Harvested)
// High-quality Flux prompts and wildcard composition

import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, BookOpen, RefreshCw, ChevronDown, Tag, X, Zap, Sparkles, Wand2, MousePointer2 } from 'lucide-react';

interface PromptEntry {
    id: number;
    title: string;
    positive: string;
    negative: string;
    characters: string[];
    category: string;
    source: string;
}

interface Wildcard {
    name: string;
    count: number;
    preview: string[];
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
    concert: 'bg-white/5 text-slate-300 border-white/10',
    duo: 'bg-white/5 text-slate-300 border-white/10',
    explicit: 'bg-white/5 text-slate-300 border-white/10',
    general: 'bg-white/5 text-slate-300 border-white/10',
    music: 'bg-white/5 text-slate-300 border-white/10',
    portrait: 'bg-white/5 text-slate-300 border-white/10',
    pregnancy: 'bg-white/5 text-slate-300 border-white/10',
    social: 'bg-white/5 text-slate-300 border-white/10',
    train: 'bg-white/5 text-slate-300 border-white/10',
    video: 'bg-white/5 text-slate-300 border-white/10',
};

// High-quality hardcoded templates for Flux
const FLUX_TEMPLATES = [
    {
        title: "Cinematic Candid Portrait",
        prompt: "A raw, candid, ultra-detailed 35mm film photograph of a woman, __atmosphere__, __cinemax_lighting__, focusing on __skin_texture__. She is wearing __outfit_high_end__, __backgrounds__, shallow depth of field, shot on Kodak Portra 400."
    },
    {
        title: "Hyper-Real Studio Close-up",
        prompt: "Ultra-extreme close up portrait, __skin_texture__, __cinemax_lighting__. Natural freckles, peach fuzz and skin pores clearly visible. Subject is posing and looking at camera. Studio lighting, soft bokeh, high-end photography."
    },
    {
        title: "Vibrant Urban Lifestyle",
        prompt: "A wide angle lifestyle shot of a woman walking through __backgrounds__, wearing __outfit_high_end__. __cinemax_lighting__, sharp focus, vibrant atmosphere. __camera_gear__."
    },
    {
        title: "Dark Moody Aesthetic",
        prompt: "A moody and atmospheric capture, __cinemax_lighting__, __atmosphere__. Subject wearing __outfit_high_end__ in a __backgrounds__. __camera_gear__, heavy grain, high contrast, film aesthetic."
    }
];

const PAGE_SIZE = 25;

export function PromptLibrary({ onSelect, isOpen, onClose }: PromptLibraryProps) {
    const [activeTab, setActiveTab] = useState<'builder' | 'library'>('builder');
    const [data, setData] = useState<PromptLibraryData | null>(null);
    const [wildcards, setWildcards] = useState<Wildcard[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isHarvesting, setIsHarvesting] = useState(false);

    // Library search/filter state
    const [search, setSearch] = useState('');
    const [activeCategory, setActiveCategory] = useState<string>('all');
    const [activeChar, setActiveChar] = useState<string>('all');
    const [page, setPage] = useState(0);
    const [expandedId, setExpandedId] = useState<number | null>(null);

    // Builder state
    const [builderPrompt, setBuilderPrompt] = useState('');

    const searchRef = useRef<HTMLInputElement>(null);

    const loadData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [libResp, wildResp] = await Promise.all([
                fetch('http://localhost:8000/api/prompts/library'),
                fetch('http://localhost:8000/api/wildcards/list')
            ]);

            if (libResp.ok) {
                const json = await libResp.json();
                setData(json);
            }

            if (wildResp.ok) {
                const json = await wildResp.json();
                setWildcards(json.wildcards);
            }
        } catch (e) {
            console.error('Data load failed:', e);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isOpen) {
            loadData();
            if (activeTab === 'library') {
                setTimeout(() => searchRef.current?.focus(), 100);
            }
        }
    }, [isOpen, activeTab, loadData]);

    const handleHarvest = async () => {
        setIsHarvesting(true);
        try {
            const resp = await fetch('http://localhost:8000/api/prompts/harvest', { method: 'POST' });
            const json = await resp.json();
            if (json.success) {
                await loadData();
            }
        } catch (e) {
            console.error('Harvest failed:', e);
        } finally {
            setIsHarvesting(false);
        }
    };

    const insertWildcard = (name: string) => {
        const tag = `__${name}__`;
        setBuilderPrompt(p => p + (p && !p.endsWith(' ') ? ' ' : '') + tag);
    };

    const filteredLibrary = (data?.prompts ?? []).filter(p => {
        const matchSearch = !search ||
            p.positive.toLowerCase().includes(search.toLowerCase()) ||
            p.title.toLowerCase().includes(search.toLowerCase()) ||
            p.source.toLowerCase().includes(search.toLowerCase());
        const matchCat = activeCategory === 'all' || p.category === activeCategory;
        const matchChar = activeChar === 'all' || p.characters.includes(activeChar);
        return matchSearch && matchCat && matchChar;
    });

    const totalPages = Math.ceil(filteredLibrary.length / PAGE_SIZE);
    const pageItems = filteredLibrary.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[200] flex items-stretch justify-end">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Drawer */}
            <div className="relative w-full max-w-2xl h-full bg-[#0d0d14] border-l border-white/5 flex flex-col shadow-2xl animate-in slide-in-from-right duration-300 overflow-hidden">

                {/* Header */}
                <div className="flex flex-col flex-shrink-0 bg-[#121218]/50 backdrop-blur-md">
                    <div className="flex items-center justify-between px-6 py-4">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center border border-white/10">
                                <Sparkles className="w-4 h-4 text-white" />
                            </div>
                            <h2 className="text-sm font-bold text-white tracking-tight uppercase">Flux Prompt Forge</h2>
                        </div>
                        <button
                            onClick={onClose}
                            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 text-slate-500 hover:text-white transition-all"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Tabs */}
                    <div className="flex px-6 border-b border-white/5">
                        <button
                            onClick={() => setActiveTab('builder')}
                            className={`flex items-center gap-2 px-4 py-3 text-xs font-bold transition-all border-b-2 ${activeTab === 'builder'
                                ? 'border-white text-white'
                                : 'border-transparent text-slate-500 hover:text-slate-300'
                                }`}
                        >
                            <Wand2 className="w-3.5 h-3.5" />
                            Prompt Builder
                        </button>
                        <button
                            onClick={() => setActiveTab('library')}
                            className={`flex items-center gap-2 px-4 py-3 text-xs font-bold transition-all border-b-2 ${activeTab === 'library'
                                ? 'border-white text-white'
                                : 'border-transparent text-slate-500 hover:text-slate-300'
                                }`}
                        >
                            <BookOpen className="w-3.5 h-3.5" />
                            Script Library
                        </button>
                    </div>
                </div>

                {/* Tab Content */}
                <div className="flex-1 overflow-y-auto custom-scrollbar">

                    {/* TAB 1: PROMPT BUILDER */}
                    {activeTab === 'builder' && (
                        <div className="p-6 space-y-8 animate-in fade-in duration-300">

                            {/* Master Templates */}
                            <section className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Master Templates</h3>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    {FLUX_TEMPLATES.map((t, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => setBuilderPrompt(t.prompt)}
                                            className="group text-left bg-[#1a1a24] hover:bg-white/5 border border-white/5 hover:border-white/20 rounded-xl p-4 transition-all"
                                        >
                                            <h4 className="text-xs font-bold text-slate-300 group-hover:text-white transition-colors mb-2">{t.title}</h4>
                                            <p className="text-[10px] text-slate-500 line-clamp-2 leading-relaxed">{t.prompt}</p>
                                        </button>
                                    ))}
                                </div>
                            </section>

                            {/* Composition Area */}
                            <section className="space-y-4">
                                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Composition Pad</h3>
                                <div className="relative group">
                                    <textarea
                                        value={builderPrompt}
                                        onChange={(e) => setBuilderPrompt(e.target.value)}
                                        placeholder="Start typing your prompt or click wildcards below..."
                                        className="w-full h-40 bg-[#07070a] border border-white/10 rounded-2xl p-4 text-sm text-slate-200 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all placeholder:text-slate-700"
                                    />
                                    {builderPrompt && (
                                        <button
                                            onClick={() => setBuilderPrompt('')}
                                            className="absolute right-4 top-4 text-slate-600 hover:text-red-400 transition-colors"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>

                                <div className="flex gap-3">
                                    <button
                                        disabled={!builderPrompt.trim()}
                                        onClick={() => {
                                            onSelect(builderPrompt, "");
                                            onClose();
                                        }}
                                        className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-white hover:bg-slate-200 disabled:opacity-30 disabled:hover:bg-white text-black text-xs font-bold rounded-xl shadow-xl transition-all active:scale-95"
                                    >
                                        <Zap className="w-3.5 h-3.5" />
                                        Apply to Generation
                                    </button>
                                </div>
                            </section>

                            {/* Wildcard Inventory */}
                            <section className="space-y-4">
                                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Flux Wildcard Inventory</h3>
                                <div className="grid grid-cols-1 gap-4">
                                    {wildcards.map(wild => (
                                        <div key={wild.name} className="bg-[#121218] border border-white/5 rounded-xl p-4 hover:border-white/15 transition-all">
                                            <div className="flex items-center justify-between mb-3">
                                                <div className="flex items-center gap-2">
                                                    <Tag className="w-3.5 h-3.5 text-slate-400" />
                                                    <span className="text-xs font-bold text-slate-300 capitalize">{wild.name.replace(/_/g, ' ')}</span>
                                                    <span className="text-[9px] bg-white/5 text-slate-500 px-1.5 py-0.5 rounded uppercase font-bold tracking-tight">
                                                        {wild.count} variations
                                                    </span>
                                                </div>
                                                <button
                                                    onClick={() => insertWildcard(wild.name)}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-[10px] font-bold text-white rounded-lg border border-white/10 transition-all"
                                                >
                                                    <MousePointer2 className="w-3 h-3" />
                                                    Use Dynamic Tag
                                                </button>
                                            </div>

                                            <div className="grid grid-cols-1 gap-1.5 pl-3 border-l border-white/5">
                                                {wild.preview.map((line, idx) => (
                                                    <p key={idx} className="text-[10px] text-slate-500 italic line-clamp-1">"{line}"</p>
                                                ))}
                                                {wild.count > 5 && <p className="text-[9px] text-slate-700 italic mt-1">... and {wild.count - 5} more</p>}
                                            </div>
                                        </div>
                                    ))}

                                    {wildcards.length === 0 && !isLoading && (
                                        <div className="py-20 text-center space-y-3 opacity-30">
                                            <X className="w-8 h-8 mx-auto" />
                                            <p className="text-xs">No wildcard files found in ComfyUI/wildcards</p>
                                        </div>
                                    )}
                                </div>
                            </section>
                        </div>
                    )}

                    {/* TAB 2: SCRIPT LIBRARY (LEGACY) */}
                    {activeTab === 'library' && (
                        <div className="flex flex-col h-full animate-in slide-in-from-left-4 fade-in duration-300">

                            {/* Filter controls */}
                            <div className="p-6 pb-2 space-y-4 bg-[#0d0d14] sticky top-0 z-10 border-b border-white/5">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                                    <input
                                        ref={searchRef}
                                        type="text"
                                        value={search}
                                        onChange={e => setSearch(e.target.value)}
                                        placeholder="Search harvested prompts..."
                                        className="w-full bg-[#121218] border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                                    />
                                </div>

                                <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[10px] font-bold text-slate-600 uppercase mr-2.5">Category:</span>
                                    <button
                                        onClick={() => setActiveCategory('all')}
                                        className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all ${activeCategory === 'all' ? 'bg-white text-black border-white' : 'bg-white/5 text-slate-500 border-white/5'
                                            }`}
                                    >
                                        All
                                    </button>
                                    {data?.categories.map(cat => (
                                        <button
                                            key={cat}
                                            onClick={() => setActiveCategory(cat)}
                                            className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all capitalize ${activeCategory === cat ? 'bg-white/20 text-white border-white/40' : 'bg-white/5 text-slate-500 border-white/5'
                                                }`}
                                        >
                                            {cat}
                                        </button>
                                    ))}
                                </div>

                                <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[10px] font-bold text-slate-600 uppercase mr-2.5">Character:</span>
                                    <button
                                        onClick={() => setActiveChar('all')}
                                        className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all ${activeChar === 'all' ? 'bg-white text-black border-white' : 'bg-white/5 text-slate-500 border-white/5'
                                            }`}
                                    >
                                        All
                                    </button>
                                    {data?.characters.map(char => (
                                        <button
                                            key={char}
                                            onClick={() => setActiveChar(char)}
                                            className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all ${activeChar === char ? 'bg-white/20 text-white border-white/40' : 'bg-white/5 text-slate-500 border-white/5'
                                                }`}
                                        >
                                            {char}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* List */}
                            <div className="flex-1 px-6 py-4 space-y-3">
                                {isLoading && (
                                    <div className="flex items-center justify-center py-20 text-slate-500">
                                        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                                        Accessing library...
                                    </div>
                                )}

                                {!isLoading && filteredLibrary.length === 0 && (
                                    <div className="text-center py-20 text-slate-600 italic">No matches found in library.</div>
                                )}

                                {pageItems.map(entry => (
                                    <div key={entry.id} className="bg-[#121218] border border-white/5 rounded-xl overflow-hidden group">
                                        <div
                                            className="p-4 cursor-pointer hover:bg-white/5 transition-all"
                                            onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                                        >
                                            <div className="flex items-start justify-between">
                                                <div className="flex-1 pr-4">
                                                    <h4 className="text-[11px] font-bold text-slate-300 leading-normal line-clamp-2 mb-2">{entry.title}</h4>
                                                    <div className="flex items-center gap-2">
                                                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${CATEGORY_COLORS[entry.category] ?? ''}`}>{entry.category}</span>
                                                        {entry.characters.map(c => <span key={c} className="text-[9px] text-indigo-400 font-bold">{c}</span>)}
                                                    </div>
                                                </div>
                                                <div className="flex flex-col items-end gap-2">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onSelect(entry.positive, entry.negative);
                                                            onClose();
                                                        }}
                                                        className="opacity-0 group-hover:opacity-100 px-2.5 py-1 bg-white text-black text-[10px] font-bold rounded-lg transition-all"
                                                    >
                                                        Use
                                                    </button>
                                                    <ChevronDown className={`w-3.5 h-3.5 text-slate-600 transition-all ${expandedId === entry.id ? 'rotate-180' : ''}`} />
                                                </div>
                                            </div>
                                        </div>
                                        {expandedId === entry.id && (
                                            <div className="px-4 pb-4 border-t border-white/5 pt-3 animate-in fade-in duration-200">
                                                <p className="text-[10px] text-slate-400 italic bg-black/40 p-3 rounded-lg leading-relaxed mb-1">"{entry.positive}"</p>
                                                <p className="text-[9px] text-slate-600 text-right">Source: {entry.source}</p>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {/* Pagination */}
                            {totalPages > 1 && (
                                <div className="flex items-center justify-between px-6 py-4 border-t border-white/5 bg-[#0d0d14]">
                                    <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="text-xs text-slate-400 disabled:opacity-20">← Previous</button>
                                    <span className="text-xs font-bold text-slate-600">{page + 1} / {totalPages}</span>
                                    <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="text-xs text-slate-400 disabled:opacity-20">Next →</button>
                                </div>
                            )}

                            {/* Bottom Actions */}
                            <div className="px-6 py-4 flex gap-2 border-t border-white/5">
                                <button
                                    onClick={handleHarvest}
                                    disabled={isHarvesting}
                                    className="w-full flex items-center justify-center gap-2 py-3 bg-white/5 hover:bg-white/10 text-slate-400 text-[10px] font-bold uppercase tracking-wider rounded-xl transition-all"
                                >
                                    <RefreshCw className={`w-3.5 h-3.5 ${isHarvesting ? 'animate-spin' : ''}`} />
                                    {isHarvesting ? 'Updating Library...' : 'Update Legacy Library'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
