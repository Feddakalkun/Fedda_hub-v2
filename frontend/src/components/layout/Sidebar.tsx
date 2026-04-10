// Sidebar Navigation Component — expandable multi-level menu
import { useEffect, useMemo, useState } from 'react';
import {
  Video,
  Music,
  Sparkles,
  Terminal,
  MessageSquare,
  Images,
  Film,
  Wand2,
  LayoutDashboard,
  ChevronDown,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import { APP_CONFIG } from '../../config/api';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  subitems?: NavNode[];
}

interface NavNode {
  id: string;
  label: string;
  subitems?: NavNode[];
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    label: 'CREATE',
    items: [
      { id: 'chat',      label: 'Agent Chat',   icon: MessageSquare },
      { 
        id: 'image',     
        label: 'Image Studio', 
        icon: Sparkles,
        subitems: [
          {
            id: 'z-image',
            label: 'Z-Image',
            subitems: [
              { id: 'z-image-txt2img', label: 'Txt2Img' },
            ],
          },
          {
            id: 'flux',
            label: 'FLUX2-KLEIN',
            subitems: [
              { id: 'flux-txt2img', label: 'Txt2Img' },
            ],
          },
          {
            id: 'qwen',
            label: 'Qwen',
            subitems: [
              { id: 'qwen-txt2img', label: 'Txt2Img' },
              { id: 'qwen-image-ref', label: 'Image Reference' },
              { id: 'qwen-multi-angle', label: 'Multi Angles' },
            ],
          },
          { id: 'image-other', label: 'Other' }
        ]
      },
      {
        id: 'video',
        label: 'Video Studio',
        icon: Video,
        subitems: [
          { id: 'wan22-vid2vid', label: 'WAN 2.2 — Vid2Vid' },
          { id: 'wan22-img2vid', label: 'WAN 2.2 — Img2Vid' },
          { id: 'ltx-flf',       label: 'LTX — First/Last Frame' },
          { id: 'ltx-img-audio', label: 'LTX — Img + Audio Lipsync' },
        ]
      },
      { id: 'audio',     label: 'Audio / SFX',  icon: Music },
    ],
  },
  {
    label: 'EXPLORE',
    items: [
      { id: 'gallery',   label: 'Gallery',      icon: Images },
      { id: 'videos',    label: 'Videos',       icon: Film },
      { id: 'library',   label: 'LoRA Library', icon: LayoutDashboard },
      { id: 'workflows', label: 'Workflows',    icon: Wand2 },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { id: 'logs',      label: 'Console Logs', icon: Terminal },
    ],
  },
];

const SIDEBAR_EXPAND_KEY = 'fedda_sidebar_expand_v1';

function collectExpandableIds(items: NavItem[]): string[] {
  const ids: string[] = [];
  const walk = (nodes: NavNode[]) => {
    nodes.forEach((node) => {
      if (node.subitems && node.subitems.length > 0) {
        ids.push(node.id);
        walk(node.subitems);
      }
    });
  };
  items.forEach((item) => {
    if (item.subitems && item.subitems.length > 0) {
      ids.push(item.id);
      walk(item.subitems);
    }
  });
  return ids;
}

function hasActiveInTree(node: NavNode, activeTab: string): boolean {
  if (node.id === activeTab) return true;
  return !!node.subitems?.some((child) => hasActiveInTree(child, activeTab));
}

function firstLeafId(node: NavNode): string {
  if (!node.subitems || node.subitems.length === 0) return node.id;
  return firstLeafId(node.subitems[0]);
}

function firstLeafFromItem(item: NavItem): string {
  if (!item.subitems || item.subitems.length === 0) return item.id;
  return firstLeafId(item.subitems[0]);
}

export const Sidebar = ({ activeTab, onTabChange }: SidebarProps) => {
  const expandableIds = useMemo(() => collectExpandableIds(SECTIONS.flatMap((s) => s.items)), []);

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_EXPAND_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return { image: true, video: true, 'z-image': true };
  });

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_EXPAND_KEY, JSON.stringify(expanded));
    } catch {}
  }, [expanded]);

  useEffect(() => {
    const next = { ...expanded };
    let changed = false;
    SECTIONS.forEach((section) => {
      section.items.forEach((item) => {
        const isActive = item.id === activeTab || item.subitems?.some((node) => hasActiveInTree(node, activeTab));
        if (isActive && item.subitems && !next[item.id]) {
          next[item.id] = true;
          changed = true;
        }
        item.subitems?.forEach((node) => {
          const nodeActive = hasActiveInTree(node, activeTab);
          if (nodeActive && node.subitems && !next[node.id]) {
            next[node.id] = true;
            changed = true;
          }
        });
      });
    });
    if (changed) setExpanded(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const toggleExpanded = (id: string) => {
    if (!expandableIds.includes(id)) return;
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleParentClick = (item: NavItem) => {
    if (!item.subitems || item.subitems.length === 0) {
      onTabChange(item.id);
      return;
    }
    const currentlyOpen = !!expanded[item.id];
    toggleExpanded(item.id);
    if (!currentlyOpen) {
      const subtreeHasActive = item.subitems.some((node) => hasActiveInTree(node, activeTab));
      if (!subtreeHasActive) onTabChange(firstLeafFromItem(item));
    }
  };

  const renderNode = (node: NavNode, level: 1 | 2) => {
    const hasChildren = !!(node.subitems && node.subitems.length > 0);
    const isOpen = !!expanded[node.id];
    const isActive = hasActiveInTree(node, activeTab);
    const isExact = activeTab === node.id;

    return (
      <div key={node.id} className="space-y-0.5">
        <button
          onClick={() => {
            if (!hasChildren) {
              onTabChange(node.id);
              return;
            }
            const currentlyOpen = !!expanded[node.id];
            toggleExpanded(node.id);
            if (!currentlyOpen) {
              const subtreeHasActive = node.subitems!.some((child) => hasActiveInTree(child, activeTab));
              if (!subtreeHasActive) onTabChange(firstLeafId(node));
            }
          }}
          className={`w-full flex items-center justify-between rounded-lg px-3 py-1.5 text-left transition-colors ${
            isExact
              ? 'bg-white/10 text-white shadow-sm'
              : isActive
                ? 'bg-white/[0.04] text-slate-100'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
          } ${level === 1 ? 'text-[13px] font-medium' : 'text-[12px] font-medium'}`}
        >
          <span className="truncate">{node.label}</span>
          {hasChildren && (
            isOpen ? <ChevronDown className="h-3 w-3 text-white/35" /> : <ChevronRight className="h-3 w-3 text-white/25" />
          )}
        </button>

        {hasChildren && isOpen && (
          <div className={`${level === 1 ? 'ml-3 pl-2.5 border-l border-white/5' : 'ml-2 pl-2 border-l border-white/5'} space-y-0.5`}>
            {node.subitems!.map((child) => renderNode(child, 2))}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="w-64 theme-bg-sidebar border-r border-white/5 flex flex-col shadow-2xl z-10 relative">
      {/* Top accent line */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      {/* Logo / Header */}
      <div className="px-6 py-8">
        <h1 className="text-3xl font-bold bg-gradient-to-br from-white via-slate-200 to-slate-400 bg-clip-text text-transparent tracking-tighter leading-none">
          {APP_CONFIG.NAME}<span className="text-white">.</span>
        </h1>
        <p className="text-[10px] text-slate-600 font-bold tracking-[0.18em] mt-2 uppercase">
          {APP_CONFIG.DESCRIPTION}
        </p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 pb-4 overflow-y-auto custom-scrollbar">
        {SECTIONS.map((section, idx) => (
          <div key={section.label} className={idx > 0 ? 'mt-6' : ''}>
            {/* Section label */}
            <div className="px-3 mb-2">
              <span className="text-[9px] font-bold text-slate-600 uppercase tracking-[0.22em]">
                {section.label}
              </span>
            </div>

            {/* Items */}
              {section.items.map((item) => {
                const isActive = activeTab === item.id || item.subitems?.some(sub => sub.id === activeTab);
                const isExactActive = activeTab === item.id;
                
                return (
                  <div key={item.id} className="space-y-0.5">
                    <button
                      id={`nav-${item.id}`}
                      onClick={() => handleParentClick(item)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                        isExactActive || (isActive && !item.subitems)
                          ? 'theme-active-tab shadow-md'
                          : isActive 
                            ? 'text-white bg-white/5' 
                            : 'text-slate-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <item.icon
                        className={`w-4 h-4 flex-shrink-0 transition-colors ${
                          isActive ? 'text-white' : 'text-slate-600 group-hover:text-slate-300'
                        }`}
                      />
                      <span className="tracking-tight">{item.label}</span>
                      {item.subitems && (
                        <span className="ml-auto">
                          {expanded[item.id] ? (
                            <ChevronDown className="w-3.5 h-3.5 text-white/40" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-white/30" />
                          )}
                        </span>
                      )}
                    </button>
                    
                    {/* Subitems */}
                    {item.subitems && expanded[item.id] && (
                      <div className="pl-11 pr-3 py-1 space-y-0.5 border-l-2 border-white/5 ml-5 mt-1 mb-2">
                        {item.subitems.map(subitem => renderNode(subitem, 1))}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        ))}
      </nav>

      {/* Footer version tag */}
      <div className="px-6 py-4 border-t border-white/5">
        <span className="text-[9px] font-mono text-slate-700 tracking-widest">
          v{APP_CONFIG.VERSION}
        </span>
      </div>
    </aside>
  );
};
