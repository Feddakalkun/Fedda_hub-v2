// Sidebar Navigation Component — clean flat layout, no submenus
import {
  Video,
  Music,
  Sparkles,
  Settings,
  Terminal,
  MessageSquare,
  Images,
  Film,
  Wand2,
  LayoutDashboard,
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
  subitems?: { id: string; label: string }[];
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
          { id: 'z-image', label: 'Z-Image' },
          { id: 'flux', label: 'Flux' },
          { id: 'qwen', label: 'Qwen' },
          { id: 'image-other', label: 'Other' }
        ]
      },
      {
        id: 'video',
        label: 'Video Studio',
        icon: Video,
        subitems: [
          { id: 'wan22-vid2vid', label: 'WAN 2.2 Vid2Vid' },
          { id: 'wan22-img2vid', label: 'WAN 2.2 Img2Vid' },
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
      { id: 'settings',  label: 'Settings',     icon: Settings },
    ],
  },
];

export const Sidebar = ({ activeTab, onTabChange }: SidebarProps) => {
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
                      onClick={() => onTabChange(item.subitems ? item.subitems[0].id : item.id)} // Default to first subitem if parent clicked
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
                    </button>
                    
                    {/* Subitems */}
                    {item.subitems && isActive && (
                      <div className="pl-11 pr-3 py-1 space-y-0.5 border-l-2 border-white/5 ml-5 mt-1 mb-2">
                        {item.subitems.map(subitem => {
                          const isSubActive = activeTab === subitem.id;
                          return (
                            <button
                              key={subitem.id}
                              onClick={() => onTabChange(subitem.id)}
                              className={`w-full text-left px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                                isSubActive
                                  ? 'bg-white/10 text-white shadow-sm'
                                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                              }`}
                            >
                              {subitem.label}
                            </button>
                          );
                        })}
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