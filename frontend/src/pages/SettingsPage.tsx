import { ModelDownloader } from '../components/ui/ModelDownloader';
import { Settings, HardDrive, Download, Info } from 'lucide-react';

export const SettingsPage = () => {
  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-10 bg-[#08080b]">
      <div className="max-w-4xl mx-auto space-y-12">
        
        {/* Header */}
        <div className="space-y-2">
            <h1 className="text-3xl font-black text-white uppercase tracking-[0.1em] flex items-center gap-3">
                <Settings className="w-8 h-8 text-slate-500" />
                Settings
            </h1>
            <p className="text-slate-500 text-sm">
                Manage system preferences, model dependencies, and cloud integrations.
            </p>
        </div>

        {/* Section: Model Packs */}
        <section className="space-y-6 animate-slide-up">
            <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                <Download className="w-4 h-4 text-slate-400" />
                <h2 className="text-xs font-black uppercase tracking-widest text-slate-400">Model Pack Sync</h2>
            </div>
            
            <div className="grid gap-3">
                <ModelDownloader 
                    label="Z-Image Turbo Celeb Pack" 
                    repo="pmczip/Z-Image-Turbo_Models" 
                    subfolder="zimage_turbo" 
                />
                <ModelDownloader 
                    label="FLUX2KLEIN Celeb Pack" 
                    repo="pmczip/FLUX.2-klein-9B_Models" 
                    subfolder="flux2klein" 
                />
                <ModelDownloader 
                    label="LTX 2.3 Motion Track Pack" 
                    repo="pmczip/SDXL_Models" 
                    subfolder="sdxl" 
                />
            </div>
            
            <p className="text-[10px] text-slate-600 italic">
                Packs are synced from HuggingFace to <code className="bg-white/5 px-1 rounded text-red-300">ComfyUI/models/loras/&lt;subfolder&gt;</code>.
            </p>
        </section>

        {/* Section: System */}
        <section className="space-y-6 animate-slide-up" style={{ animationDelay: '0.1s' }}>
            <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                <HardDrive className="w-4 h-4 text-slate-400" />
                <h2 className="text-xs font-black uppercase tracking-widest text-slate-400">System Preferences</h2>
            </div>
            
            <div className="p-8 bg-white/5 border border-white/10 rounded-2xl space-y-8">
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <label className="text-sm font-bold text-white uppercase tracking-tight">NSFW Safe Mode</label>
                        <p className="text-xs text-slate-500">Enable safety filters on AI generated content.</p>
                    </div>
                    <button className="w-12 h-6 bg-slate-800 rounded-full relative p-1 transition-colors">
                        <div className="w-4 h-4 bg-slate-400 rounded-full" />
                    </button>
                </div>

                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <label className="text-sm font-bold text-white uppercase tracking-tight">Cloud Compute (RunPod)</label>
                        <p className="text-xs text-slate-500">Offload heavy generation jobs to cloud GPUs.</p>
                    </div>
                    <button className="w-12 h-6 bg-slate-800 rounded-full relative p-1 transition-colors">
                        <div className="w-4 h-4 bg-slate-400 rounded-full" />
                    </button>
                </div>
            </div>
        </section>

        {/* Info */}
        <div className="p-6 bg-blue-500/5 border border-blue-500/10 rounded-2xl flex gap-4">
            <Info className="w-5 h-5 text-blue-500 flex-shrink-0" />
            <div className="space-y-2">
                <h4 className="text-xs font-bold text-blue-300 uppercase tracking-widest">About Fedda UI</h4>
                <p className="text-[11px] text-blue-200/50 leading-relaxed">
                    Fedda UI is a premium open-source generation platform optimized for high-performance creative workflows.
                    For support, join the official community discord.
                </p>
            </div>
        </div>

      </div>
    </div>
  );
};
