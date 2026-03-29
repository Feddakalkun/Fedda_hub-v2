// Sidebar Navigation Component
import { useState } from 'react';
import {
    Video,
    Music,
    Sparkles,
    Box,
    Settings,
    Terminal,
    ChevronRight,
    MessageSquare,
    Images,
    Film,
    Package,
    Download,
} from 'lucide-react';
import { SystemMonitor } from '../SystemMonitor';
import { StatusIndicator } from '../ui/StatusIndicator';
import { APP_CONFIG, MODELS } from '../../config/api';

interface SidebarProps {
    activeTab: string;
    activeSubTab: string | null;
    onTabChange: (tab: string, subTab?: string) => void;
}

type ModelEntry = { id: string; label: string; icon: string; category?: string; source?: string; mapsTo?: string };
type SidebarItem = {
    id: string;
    label: string;
    icon: any;
    models?: ModelEntry[];
    targetTab?: string;
    targetSubTab?: string;
};

function groupByCategory(models: ModelEntry[]): { category: string | null; items: ModelEntry[] }[] {
    const groups: { category: string | null; items: ModelEntry[] }[] = [];
    let currentCategory: string | null | undefined = undefined;
    for (const model of models) {
        const cat = model.category ?? null;
        if (cat !== currentCategory) {
            groups.push({ category: cat, items: [model] });
            currentCategory = cat;
        } else {
            groups[groups.length - 1].items.push(model);
        }
    }
    return groups;
}

export const Sidebar = ({ activeTab, activeSubTab, onTabChange }: SidebarProps) => {
    const [collapsedMenus, setCollapsedMenus] = useState<Record<string, boolean>>({});

    const sections = [
        {
            label: 'CREATE',
            items: [
                { id: 'chat', label: 'Agent Chat', icon: MessageSquare },
                { id: 'image', label: 'Z-Image', icon: Sparkles, models: MODELS.IMAGE },
                { id: 'qwen', label: 'QWEN', icon: Box, models: MODELS.QWEN },
                { id: 'flux2klein', label: 'FLUX2KLEIN', icon: Sparkles, models: MODELS.FLUX2KLEIN },
                { id: 'ltxhub', label: 'LTX Hub', icon: Video, models: MODELS.LTXHUB },
                { id: 'video', label: 'Video', icon: Video, models: MODELS.VIDEO },
                { id: 'audio', label: 'Audio/SFX', icon: Music, models: MODELS.AUDIO },
            ] as SidebarItem[],
        },
        {
            label: 'MANAGE',
            items: [
                { id: 'gallery', label: 'Gallery', icon: Images },
                { id: 'tiktok', label: 'TikTok Studio', icon: Download },
                { id: 'videos', label: 'Videos', icon: Film },
                { id: 'library', label: 'LoRA Library', icon: Package },
            ] as SidebarItem[],
        },
        {
            label: 'SYSTEM',
            items: [
                { id: 'logs', label: 'Console Logs', icon: Terminal },
                { id: 'settings', label: 'Settings', icon: Settings },
            ] as SidebarItem[],
        },
    ];

    return (
        <aside className="w-72 bg-[#0a0a0f] border-r border-white/5 flex flex-col shadow-2xl z-10">
            {/* Header / Logo */}
            <div className="p-8 pb-10">
                <h1 className="text-3xl font-bold bg-gradient-to-br from-white via-slate-200 to-slate-400 bg-clip-text text-transparent tracking-tighter">
                    {APP_CONFIG.NAME}<span className="text-white">.</span>
                </h1>
                <p className="text-[10px] text-slate-500 font-bold tracking-widest mt-1 uppercase">
                    {APP_CONFIG.DESCRIPTION}
                </p>
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-4 overflow-y-auto">
                {sections.map((section, idx) => (
                    <div key={section.label} className={idx > 0 ? 'mt-6' : ''}>
                        <div className="px-4 mb-2">
                            <span className="text-[9px] font-bold text-slate-600 uppercase tracking-[0.2em]">
                                {section.label}
                            </span>
                        </div>
                        <div className="space-y-1">
                            {section.items.map((item) => (
                                <div key={item.id}>
                                    {(() => {
                                        const isActive = activeTab === item.id;
                                        const isCollapsed = !!collapsedMenus[item.id];
                                        const isExpanded = isActive && !isCollapsed;

                                        return (
                                    <button
                                        onClick={() => {
                                            if (item.targetTab) {
                                                onTabChange(item.targetTab, item.targetSubTab);
                                                return;
                                            }

                                            if (item.models) {
                                                if (isActive && !isCollapsed) {
                                                    setCollapsedMenus((prev) => ({ ...prev, [item.id]: true }));
                                                    return;
                                                }

                                                setCollapsedMenus((prev) => ({ ...prev, [item.id]: false }));
                                                const targetSubTab = isActive && activeSubTab
                                                    ? activeSubTab
                                                    : item.models[0]?.id;
                                                onTabChange(item.id, targetSubTab);
                                                return;
                                            }

                                            onTabChange(item.id);
                                        }}
                                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-200 group ${isActive
                                            ? 'bg-white text-black shadow-lg'
                                            : 'text-slate-400 hover:text-white hover:bg-white/5'
                                            }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <item.icon
                                                className={`w-5 h-5 ${isActive
                                                    ? 'text-black'
                                                    : 'text-slate-500 group-hover:text-slate-300'
                                                    } transition-colors`}
                                            />
                                            <span className="font-medium text-sm tracking-tight">{item.label}</span>
                                        </div>
                                        {item.models && (
                                            <ChevronRight
                                                className={`w-4 h-4 text-slate-600 transition-transform duration-200 ${isExpanded ? 'rotate-90 text-black' : ''
                                                    }`}
                                            />
                                        )}
                                    </button>
                                        );
                                    })()}

                                    {/* Sub-menu (grouped by category when available) */}
                                    {activeTab === item.id && item.models && !collapsedMenus[item.id] && (
                                        <div className="pl-8 pr-2 py-2 animate-in slide-in-from-top-2 fade-in duration-200">
                                            {groupByCategory(item.models).map((group) => (
                                                <div key={group.category ?? '__ungrouped'}>
                                                    {group.category && (
                                                        <div className="px-3 pt-2 pb-1">
                                                            <span className="text-[9px] font-bold text-slate-600 uppercase tracking-[0.15em]">
                                                                {group.category}
                                                            </span>
                                                        </div>
                                                    )}
                                                    <div className="space-y-0.5">
                                                        {group.items.map((model) => (
                                                            <button
                                                                key={model.id}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    onTabChange(item.id, model.id);
                                                                }}
                                                                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                                                                    activeSubTab === model.id
                                                                        ? 'bg-white/10 text-white'
                                                                        : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                                                                }`}
                                                            >
                                                                <span className={`text-[8px] ${activeSubTab === model.id ? 'text-white' : 'text-slate-600'}`}>●</span>
                                                                <span className="font-medium">{model.label}</span>
                                                                {model.source && (
                                                                    <span className="ml-auto text-[9px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded border border-white/10 text-slate-400">
                                                                        {model.source}
                                                                    </span>
                                                                )}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </nav>

            {/* Status Footer */}
            <div className="p-4 border-t border-white/5 space-y-4">
                <SystemMonitor />
                <StatusIndicator />
            </div>
        </aside>
    );
};
