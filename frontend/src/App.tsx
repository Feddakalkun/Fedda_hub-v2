import { useState } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { ToastProvider } from './components/ui/Toast';
import {
  MessageSquare,
  Sparkles,
  Video,
  Music,
  Images,
  Film,
  LayoutDashboard,
  Wand2,
  Terminal,
  Settings,
} from 'lucide-react';

const VALID_TABS = new Set([
  'chat',
  'image',
  'video',
  'audio',
  'gallery',
  'videos',
  'library',
  'workflows',
  'logs',
  'settings',
]);

const PAGE_META: Record<string, { label: string; description: string; Icon: any }> = {
  chat:      { label: 'Agent Chat',    description: 'Your AI assistant and creative collaborator.',         Icon: MessageSquare  },
  image:     { label: 'Image Studio',  description: 'Generate and edit images with advanced AI models.',    Icon: Sparkles       },
  video:     { label: 'Video Studio',  description: 'Create and animate video sequences with LTX & WAN.',  Icon: Video          },
  audio:     { label: 'Audio / SFX',   description: 'Generate music, voice, and sound effects.',           Icon: Music          },
  gallery:   { label: 'Gallery',       description: 'Browse and manage your generated images.',             Icon: Images         },
  videos:    { label: 'Videos',        description: 'View and manage your generated video files.',          Icon: Film           },
  library:   { label: 'LoRA Library',  description: 'Manage your installed LoRA models.',                  Icon: LayoutDashboard },
  workflows: { label: 'Workflows',     description: 'Build and run custom ComfyUI generation pipelines.',  Icon: Wand2          },
  logs:      { label: 'Console Logs',  description: 'Monitor backend logs and debug information.',          Icon: Terminal       },
  settings:  { label: 'Settings',      description: 'Configure models, API keys, and system preferences.', Icon: Settings       },
};

function readActiveTab(): string {
  try {
    const raw = localStorage.getItem('fedda_active_tab');
    if (raw && VALID_TABS.has(raw)) return raw;
  } catch {}
  return 'chat';
}

function FeddaApp() {
  const [activeTab, setActiveTab] = useState<string>(readActiveTab);

  const handleTabChange = (tab: string) => {
    if (!VALID_TABS.has(tab)) return;
    setActiveTab(tab);
    try { localStorage.setItem('fedda_active_tab', tab); } catch {}
  };

  const meta = PAGE_META[activeTab] ?? PAGE_META['chat'];

  return (
    <div className="flex h-screen theme-bg-app text-white overflow-hidden font-sans selection:bg-white/20">
      <Sidebar activeTab={activeTab} onTabChange={handleTabChange} />

      <main className="flex-1 flex flex-col overflow-hidden theme-bg-main">
        {/* Top header bar */}
        <header className="h-16 border-b border-white/5 flex items-center px-8 shrink-0 z-10">
          <div className="flex items-center gap-3">
            <meta.Icon className="w-5 h-5 text-slate-400" />
            <h2 className="text-lg font-semibold text-white tracking-tight">{meta.label}</h2>
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-auto">
          <PlaceholderPage
            label={meta.label}
            description={meta.description}
            icon={<meta.Icon className="w-8 h-8" />}
          />
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <FeddaApp />
    </ToastProvider>
  );
}