import { useState, useRef, useEffect } from 'react';
import { 
  Sparkles, Download, Maximize2, Loader2, Image as ImageIcon,
  Settings2, Sliders, Hash, Layers, RefreshCw, Plus, X, Box
} from 'lucide-react';
import { useToast } from '../../components/ui/Toast';
import { BACKEND_API } from '../../config/api';

interface GenerationStatus {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: number;
  image?: string;
  error?: string;
}

interface LoraState {
  name: string;
  weight: number;
}

export const ZImageTxt2Img = () => {
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('blurry, ugly, bad proportions, low quality, artifacts');
  
  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentJob, setCurrentJob] = useState<GenerationStatus | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  
  // Parameters
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1024);
  const [steps, setSteps] = useState(8);
  const [cfg, setCfg] = useState(1.5);
  const [seed, setSeed] = useState(-1);
  const [loras, setLoras] = useState<LoraState[]>([]);
  
  const { toast } = useToast();
  const statusInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const addLora = () => {
    setLoras([...loras, { name: 'new_lora', weight: 1.0 }]);
  };

  const removeLora = (index: number) => {
    setLoras(loras.filter((_, i) => i !== index));
  };

  const updateLora = (index: number, field: keyof LoraState, value: any) => {
    const newLoras = [...loras];
    newLoras[index] = { ...newLoras[index], [field]: value };
    setLoras(newLoras);
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || isGenerating) return;

    setIsGenerating(true);
    setCurrentJob({ id: 'local-init', status: 'pending' });

    try {
      // In the future this will use the Z-Image API format
      const response = await fetch(BACKEND_API.ENDPOINTS.GENERATE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_id: 'z-image', // Fallback until user provides actual workflow
          params: {
            prompt,
            negative: negativePrompt,
            width,
            height,
            seed: seed === -1 ? Math.floor(Math.random() * 10000000000) : seed,
            steps,
            cfg,
            loras: loras.reduce((acc, curr) => ({ ...acc, [curr.name]: curr.weight }), {})
          }
        })
      });

      const data = await response.json();
      if (data.success) {
        toast('Warming up models...', 'success');
        startPolling(data.prompt_id);
      } else {
        throw new Error(data.detail || 'Failed to start generation');
      }
    } catch (error: any) {
      console.error('Generation Error:', error);
      setCurrentJob(null);
      toast(error.message || 'Generation failed', 'error');
      setIsGenerating(false);
    }
  };

  const startPolling = (promptId: string) => {
    if (statusInterval.current) clearInterval(statusInterval.current);

    statusInterval.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/generate/status/${promptId}`);
        const data = await res.json();

        if (data.success) {
          if (data.status === 'completed' && data.images?.length > 0) {
            const imageUrl = `/comfy/view?filename=${data.images[0].filename}&subfolder=${data.images[0].subfolder}&type=${data.images[0].type}`;
            setCurrentJob({ id: promptId, status: 'completed', image: imageUrl });
            setHistory(prev => [imageUrl, ...prev.slice(0, 19)]);
            setIsGenerating(false);
            toast('Generation complete!', 'success');
            if (statusInterval.current) clearInterval(statusInterval.current);
          } else if (data.status === 'running') {
            setCurrentJob(prev => prev ? { ...prev, status: 'running' } : null);
          }
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 2000);
  };

  useEffect(() => {
    return () => {
      if (statusInterval.current) clearInterval(statusInterval.current);
    };
  }, []);

  return (
    <div className="flex h-full bg-[#050505]">
      {/* ─── LEFT PARAMETERS PANEL ─── */}
      <div className="w-[380px] flex flex-col border-r border-white/5 bg-[#0a0a0c]/80 backdrop-blur-2xl z-10 shrink-0">
        <div className="h-14 flex items-center px-6 border-b border-white/5 shrink-0">
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-white/80 flex items-center gap-2">
            <Box className="w-4 h-4 text-emerald-400" />
            Z-Image Engine
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-8">
          
          {/* Prompts Section */}
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center justify-between">
                <span>Prompt</span>
                <span className="text-white/20">{prompt.length}</span>
              </label>
              <div className="relative group">
                <div className="absolute -inset-[1px] bg-gradient-to-r from-emerald-500/0 via-emerald-500/20 to-transparent rounded-xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-500" />
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="A cinematic portrait, high detail, volumetric lighting..."
                  className="w-full relative bg-white/[0.02] border border-white/10 rounded-xl p-4 text-sm tracking-wide text-white/90 placeholder-white/20 resize-none min-h-[120px] focus:outline-none focus:bg-white/[0.04] transition-all"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                Negative Rules
              </label>
              <textarea
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                className="w-full bg-black/40 border border-white/5 rounded-xl p-3 text-xs tracking-wide text-white/60 focus:outline-none focus:border-white/20 transition-all resize-none min-h-[80px]"
              />
            </div>
          </div>

          <div className="h-px bg-white/5" />

          {/* Model Settings */}
          <div className="space-y-6">
            <h3 className="text-[10px] font-bold text-emerald-400/50 uppercase tracking-widest mb-4">Core Architecture</h3>
            
            {/* Resolution */}
            <div className="space-y-3">
              <label className="text-[10px] text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <Maximize2 className="w-3 h-3" /> Base Dimension
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Square', w: 1024, h: 1024, icon: '■' },
                  { label: 'Portrait', w: 1024, h: 1536, icon: '▯' },
                  { label: 'Landscape', w: 1536, h: 1024, icon: '▭' },
                  { label: 'Vertical', w: 896, h: 1152, icon: '▯' }
                ].map((res) => (
                  <button
                    key={res.label}
                    onClick={() => { setWidth(res.w); setHeight(res.h); }}
                    className={`flex items-center gap-2 p-3 rounded-lg border transition-all duration-300 ${
                      width === res.w && height === res.h 
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
                        : 'bg-white/[0.02] border-white/5 text-slate-400 hover:bg-white-[0.05] hover:border-white/10'
                    }`}
                  >
                    <span className="text-lg opacity-50">{res.icon}</span>
                    <div className="text-left">
                      <div className="text-xs font-bold">{res.label}</div>
                      <div className="text-[9px] opacity-60 font-mono mt-0.5">{res.w}×{res.h}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Sliders */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3">
                <label className="text-[10px] text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <Hash className="w-3 h-3" /> Sampling Steps
                </label>
                <div className="relative group">
                  <input 
                    type="range" min="1" max="20" step="1"
                    value={steps} onChange={e => setSteps(Number(e.target.value))}
                    className="w-full accent-emerald-500 bg-white/10 rounded-full h-1 appearance-none outline-none"
                  />
                  <div className="flex justify-between text-[9px] text-slate-500 mt-2 font-mono">
                    <span>1</span>
                    <span className="text-white font-bold">{steps}</span>
                    <span>20</span>
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <label className="text-[10px] text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <Sliders className="w-3 h-3" /> CFG Scale
                </label>
                <div className="relative group">
                  <input 
                    type="range" min="1.0" max="4.0" step="0.1"
                    value={cfg} onChange={e => setCfg(Number(e.target.value))}
                    className="w-full accent-emerald-500 bg-white/10 rounded-full h-1 appearance-none outline-none"
                  />
                  <div className="flex justify-between text-[9px] text-slate-500 mt-2 font-mono">
                    <span>1.0</span>
                    <span className="text-white font-bold">{cfg.toFixed(1)}</span>
                    <span>4.0</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Seed */}
            <div className="space-y-3">
              <label className="text-[10px] text-slate-400 uppercase tracking-widest flex justify-between items-center">
                <span className="flex items-center gap-2"><Settings2 className="w-3 h-3" /> Seed Noise</span>
                {seed === -1 && <span className="text-[9px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded font-mono">RANDOM</span>}
              </label>
              <div className="flex gap-2">
                <input 
                  type="number" 
                  value={seed} 
                  onChange={(e) => setSeed(parseInt(e.target.value))}
                  placeholder="Random (-1)"
                  className="flex-1 bg-black/40 border border-white/5 rounded-lg py-2.5 px-3 text-xs font-mono focus:border-emerald-500/30 outline-none transition-colors"
                />
                <button 
                  onClick={() => setSeed(-1)}
                  className="px-3 bg-black/40 border border-white/5 rounded-lg hover:border-white/20 hover:bg-white/5 transition-all text-slate-400 hover:text-white"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          <div className="h-px bg-white/5" />

          {/* LoRAs Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-bold text-emerald-400/50 uppercase tracking-widest">LoRA Networks</h3>
              <button 
                onClick={addLora}
                className="flex items-center gap-1 text-[10px] uppercase font-bold text-slate-400 hover:text-emerald-400 transition-colors"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>

            {loras.length === 0 ? (
              <div className="text-center p-6 border border-dashed border-white/5 rounded-xl bg-white/[0.01]">
                <Layers className="w-6 h-6 text-white/10 mx-auto mb-2" />
                <p className="text-[10px] text-slate-500 uppercase tracking-widest">No LoRAs Active</p>
              </div>
            ) : (
              <div className="space-y-2">
                {loras.map((lora, idx) => (
                  <div key={idx} className="flex gap-2 items-center bg-white/[0.02] border border-white/5 rounded-lg p-2 group">
                    <input 
                      type="text" 
                      value={lora.name}
                      onChange={(e) => updateLora(idx, 'name', e.target.value)}
                      placeholder="lora_filename"
                      className="flex-1 min-w-0 bg-black/40 border border-white/5 rounded px-2 py-1.5 text-xs text-white placeholder-slate-600 focus:border-emerald-500/30 outline-none"
                    />
                    <input 
                      type="number"
                      step="0.05"
                      value={lora.weight}
                      onChange={(e) => updateLora(idx, 'weight', parseFloat(e.target.value))}
                      className="w-16 bg-black/40 border border-white/5 rounded px-2 py-1.5 text-xs text-white text-center focus:border-emerald-500/30 outline-none"
                    />
                    <button 
                      onClick={() => removeLora(idx)}
                      className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-4 pb-8">
             <button
                disabled={!prompt.trim() || isGenerating}
                onClick={handleGenerate}
                className={`w-full py-4 rounded-xl font-black text-sm uppercase tracking-widest transition-all duration-500 flex items-center justify-center gap-3 relative overflow-hidden ${
                  !prompt.trim() || isGenerating 
                    ? 'bg-white/5 text-white/20 cursor-not-allowed'
                    : 'bg-emerald-500 text-black hover:bg-emerald-400 hover:shadow-[0_0_40px_rgba(16,185,129,0.3)]'
                }`}
              >
                {isGenerating && (
                   <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent w-[200%] animate-[shimmer_2s_infinite]" style={{ transform: 'skewX(-20deg)' }} />
                )}
                {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                {isGenerating ? 'Synthesizing...' : 'Initialize Pipeline'}
              </button>
          </div>
        </div>
      </div>

      {/* ─── MAIN CANVAS AREA ─── */}
      <div className="flex-1 relative flex flex-col overflow-hidden">
        
        {/* Gallery Strip */}
        {history.length > 0 && (
          <div className="absolute top-0 left-0 right-0 h-24 bg-gradient-to-b from-black/80 to-transparent z-10 p-4 flex gap-3 overflow-x-auto custom-scrollbar items-start">
             {history.map((url, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentJob({ id: `hist-${i}`, status: 'completed', image: url })}
                  className="flex-shrink-0 w-16 h-16 rounded-xl border border-white/10 overflow-hidden hover:border-emerald-400/50 hover:shadow-[0_0_15px_rgba(16,185,129,0.2)] transition-all transform hover:scale-105"
                >
                  <img src={url} className="w-full h-full object-cover" alt={`History ${i}`} />
                </button>
              ))}
          </div>
        )}

        <div className="flex-1 relative flex items-center justify-center p-12">
          {/* Background grid accent */}
          <div className="absolute inset-0 bg-[url('/noise.svg')] opacity-[0.02] mix-blend-overlay pointer-events-none" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,#000_20%,transparent_100%)] pointer-events-none" />

          {currentJob?.image ? (
            <div className="relative group max-h-full max-w-full inline-flex rounded-2xl overflow-hidden shadow-[0_0_80px_rgba(0,0,0,0.8)] border border-white/5 ring-1 ring-white/10 animate-in fade-in zoom-in-95 duration-700 ease-out">
              <img 
                src={currentJob.image} 
                alt="Generated Output" 
                className="max-w-full max-h-[85vh] object-contain"
                style={{ aspectRatio: `${width}/${height}` }}
              />
              
              {/* Image Toolbar overlays on hover */}
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 p-2 bg-black/60 backdrop-blur-xl rounded-2xl border border-white/10 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-4 group-hover:translate-y-0">
                <button className="p-3 text-slate-300 hover:text-white hover:bg-white/10 rounded-xl transition-colors">
                  <Download className="w-5 h-5" />
                </button>
                <div className="w-px h-6 bg-white/10 mx-1" />
                <button className="p-3 text-slate-300 hover:text-white hover:bg-white/10 rounded-xl transition-colors">
                  <Maximize2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-center animate-pulse">
              <div className="relative w-32 h-32 mb-8">
                <div className="absolute inset-0 bg-emerald-500/10 rounded-3xl blur-2xl" />
                <div className="relative w-full h-full rounded-3xl border border-emerald-500/20 bg-emerald-500/5 flex items-center justify-center backdrop-blur-sm">
                  {isGenerating ? (
                    <Loader2 className="w-10 h-10 animate-spin text-emerald-400" />
                  ) : (
                    <ImageIcon className="w-10 h-10 text-emerald-400/50" />
                  )}
                </div>
              </div>
              <h3 className="text-xl font-bold bg-gradient-to-r from-white to-white/40 bg-clip-text text-transparent">
                {isGenerating ? 'Synthesizing Z-Matrix' : 'Studio Canvas Ready'}
              </h3>
              <p className="text-sm text-slate-500 mt-2 font-mono tracking-widest max-w-[280px]">
                {isGenerating ? 'PROCESSING NODES...' : 'CONFIGURE PARAMS & INITIALIZE'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
