import { useState, useEffect } from 'react';
import { Sparkles, Maximize2, Loader2, Hash, RefreshCw, Settings2, Image as ImageIcon, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useToast } from '../../components/ui/Toast';
import { BACKEND_API } from '../../config/api';
import { useComfyExecution } from '../../contexts/ComfyExecutionContext';
import { usePersistentState } from '../../hooks/usePersistentState';
import { comfyService } from '../../services/comfyService';

/** "zimage_turbo\Alex_Kingston_PMv1a_ZImage.safetensors" → "Alex Kingston" */
function loraLabel(path: string): string {
  const stem = path.replace(/\\/g, '/').split('/').pop()?.replace(/\.safetensors$/i, '') ?? path;
  return stem.replace(/_PMv\d+[ab]_ZImage$/i, '').replace(/_/g, ' ');
}

export const ZImageTxt2Img = () => {
  const [prompt, setPrompt]               = usePersistentState('zimage_prompt', '');
  const [negativePrompt, setNegativePrompt] = usePersistentState('zimage_negative', 'blurry, ugly, bad proportions, low quality, artifacts');
  const [width, setWidth]                 = usePersistentState('zimage_width', 1024);
  const [height, setHeight]               = usePersistentState('zimage_height', 1024);
  const [steps, setSteps]                 = usePersistentState('zimage_steps', 8);
  const [cfg]                             = usePersistentState('zimage_cfg', 1.5);
  const [seed, setSeed]                   = usePersistentState('zimage_seed', -1);
  const [loraName, setLoraName]           = usePersistentState('zimage_lora_name', '');
  const [loraStrength, setLoraStrength]   = usePersistentState('zimage_lora_strength', 1.0);

  const [isGenerating, setIsGenerating]   = useState(false);
  const [pendingPromptId, setPendingPromptId] = useState<string | null>(null);
  const [currentImage, setCurrentImage]   = useState<string | null>(null);
  const [history, setHistory]             = useState<string[]>([]);
  const [availableLoras, setAvailableLoras] = useState<string[]>([]);
  const [loraSearch, setLoraSearch]       = useState('');
  const [showLoraList, setShowLoraList]   = useState(false);
  const [galleryOpen, setGalleryOpen]     = useState(true);

  const { toast } = useToast();
  const { state: execState, clearOutputs } = useComfyExecution();

  useEffect(() => {
    comfyService.getLoras('zimage_turbo').then(setAvailableLoras).catch(() => {});
  }, []);

  // Completion: fires when execState transitions to 'done'
  useEffect(() => {
    if (execState !== 'done' || !pendingPromptId) return;

    const pid = pendingPromptId;

    const fetchAndShow = async () => {
      try {
        const res = await fetch(`${BACKEND_API.BASE_URL}/api/generate/status/${pid}`);
        const data = await res.json();
        const imgs: Array<{ filename: string; subfolder: string; type: string }> =
          data.images ?? [];
        if (imgs.length > 0) {
          const img = imgs[imgs.length - 1];
          const url = `/comfy/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`;
          setCurrentImage(url);
          setHistory(prev => (prev.includes(url) ? prev : [url, ...prev.slice(0, 29)]));
          setGalleryOpen(true);
          toast('Complete', 'success');
        }
      } catch {
        // silent — image may still appear via WS
      } finally {
        setIsGenerating(false);
        setPendingPromptId(null);
        clearOutputs();
      }
    };

    fetchAndShow();
  }, [execState, pendingPromptId, toast, clearOutputs]);

  useEffect(() => {
    if (execState === 'error') { setIsGenerating(false); setPendingPromptId(null); }
  }, [execState]);

  const handleGenerate = async () => {
    if (!prompt.trim() || isGenerating) return;
    setIsGenerating(true);
    clearOutputs();
    try {
      const params: Record<string, unknown> = {
        prompt,
        negative: negativePrompt,
        width,
        height,
        seed: seed === -1 ? Math.floor(Math.random() * 10_000_000_000) : seed,
        steps,
        cfg,
        client_id: (comfyService as any).clientId,
      };
      // Only inject LoRA fields if a LoRA is selected — node 185 stays in workflow regardless
      if (loraName) {
        params.lora_name = loraName;
        params.lora_strength = loraStrength;
      }
      const res = await fetch(`${BACKEND_API.BASE_URL}${BACKEND_API.ENDPOINTS.GENERATE}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow_id: 'z-image', params }),
      });
      const data = await res.json();
      if (data.success) { setPendingPromptId(data.prompt_id); }
      else { throw new Error(data.detail || 'Failed'); }
    } catch (err: any) {
      toast(err.message || 'Failed', 'error');
      setIsGenerating(false);
    }
  };

  const filteredLoras = availableLoras.filter(l =>
    loraLabel(l).toLowerCase().includes(loraSearch.toLowerCase())
  );

  return (
    <div className="flex h-full bg-[#080808] overflow-hidden">

      {/* ── PARAMS ── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="px-8 py-8 space-y-8">

          {/* Header */}
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-500" />
            <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-white/50">Z-Image</h2>
          </div>

          {/* Prompt */}
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center justify-between">
              <span>Prompt</span>
              <span className="text-white/10 font-mono">{prompt.length}</span>
            </label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Description..."
              className="w-full bg-white/[0.02] border border-white/5 rounded-2xl p-4 text-sm tracking-wide text-white/90 placeholder-white/10 resize-none min-h-[130px] focus:outline-none focus:bg-white/[0.04] focus:border-emerald-500/20 transition-all font-medium"
            />
          </div>

          {/* ── LoRA ── */}
          <div className="space-y-4 pt-4 border-t border-white/5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">LoRA</label>
              {loraName && (
                <button onClick={() => { setLoraName(''); setLoraSearch(''); }}
                  className="flex items-center gap-1 text-[9px] font-bold text-white/20 hover:text-red-400 transition-colors uppercase tracking-widest">
                  <X className="w-3 h-3" /> Clear
                </button>
              )}
            </div>

            {/* Selected LoRA badge */}
            {loraName ? (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 flex items-center justify-between">
                <span className="text-sm font-bold text-emerald-300">{loraLabel(loraName)}</span>
                <span className="text-[10px] font-mono text-emerald-500/60">×{loraStrength.toFixed(1)}</span>
              </div>
            ) : (
              <div className="text-[11px] text-white/15 font-medium">No LoRA — using workflow default</div>
            )}

            {/* Search + dropdown */}
            <div className="relative max-w-sm">
              <input
                type="text"
                value={loraSearch}
                onChange={e => { setLoraSearch(e.target.value); setShowLoraList(true); }}
                onFocus={() => setShowLoraList(true)}
                onBlur={() => setTimeout(() => setShowLoraList(false), 150)}
                placeholder={availableLoras.length ? `Search ${availableLoras.length} LoRAs…` : 'Loading…'}
                className="w-full bg-white/[0.02] border border-white/5 rounded-xl px-4 py-2.5 text-xs text-white/80 placeholder-white/20 focus:outline-none focus:border-emerald-500/20 transition-all"
              />
              {showLoraList && filteredLoras.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-[#121218] border border-white/10 rounded-2xl shadow-2xl max-h-56 overflow-y-auto custom-scrollbar">
                  {filteredLoras.map((l, i) => (
                    <button key={i}
                      onMouseDown={() => { setLoraName(l); setLoraSearch(''); setShowLoraList(false); }}
                      className="w-full text-left px-4 py-2.5 text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors border-b border-white/[0.03] last:border-0">
                      {loraLabel(l)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Strength — only when a LoRA is selected */}
            {loraName && (
              <div className="space-y-2 max-w-sm">
                <div className="flex justify-between text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">
                  <span>Strength</span>
                  <span className="text-emerald-500 font-mono">{loraStrength.toFixed(2)}</span>
                </div>
                <input type="range" min="0" max="2" step="0.05" value={loraStrength}
                  onChange={e => setLoraStrength(parseFloat(e.target.value))}
                  className="w-full h-1 bg-white/5 rounded-full appearance-none outline-none accent-emerald-500 cursor-pointer" />
              </div>
            )}
          </div>

          <div className="h-px bg-white/5" />

          {/* Dimensions */}
          <div className="space-y-4">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
              <Maximize2 className="w-3 h-3" /> Dimensions
            </label>
            <div className="grid grid-cols-4 gap-2 max-w-sm">
              {[
                { label: 'Square',    w: 1024, h: 1024 },
                { label: 'Portrait',  w: 1024, h: 1536 },
                { label: 'Landscape', w: 1536, h: 1024 },
                { label: 'Vertical',  w: 896,  h: 1152 },
              ].map(r => (
                <button key={r.label}
                  onClick={() => { setWidth(r.w); setHeight(r.h); }}
                  className={`py-2.5 rounded-xl border text-[8px] font-black uppercase tracking-widest transition-all ${
                    width === r.w && height === r.h
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-white/[0.02] border-white/5 text-slate-500 hover:border-white/10 hover:text-white/40'
                  }`}>{r.label}</button>
              ))}
            </div>
            <div className="flex gap-3 max-w-sm">
              <div className="flex-1 space-y-1.5">
                <span className="text-[9px] font-bold text-slate-600 uppercase">Width</span>
                <input type="number" value={width} onChange={e => setWidth(Number(e.target.value))}
                  className="w-full bg-white/[0.02] border border-white/5 rounded-xl px-3 py-2 text-xs font-mono text-white/60 focus:border-emerald-500/20 outline-none" />
              </div>
              <div className="flex-1 space-y-1.5">
                <span className="text-[9px] font-bold text-slate-600 uppercase">Height</span>
                <input type="number" value={height} onChange={e => setHeight(Number(e.target.value))}
                  className="w-full bg-white/[0.02] border border-white/5 rounded-xl px-3 py-2 text-xs font-mono text-white/60 focus:border-emerald-500/20 outline-none" />
              </div>
            </div>
          </div>

          {/* Steps */}
          <div className="space-y-3 max-w-sm">
            <div className="flex justify-between items-center text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">
              <span className="flex items-center gap-2"><Hash className="w-3 h-3" /> Steps</span>
              <span className="text-emerald-500 font-mono">{steps}</span>
            </div>
            <input type="range" min="1" max="25" step="1" value={steps} onChange={e => setSteps(Number(e.target.value))}
              className="w-full h-1 bg-white/5 rounded-full appearance-none outline-none accent-emerald-500 cursor-pointer" />
          </div>

          {/* Seed */}
          <div className="space-y-3 max-w-sm">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
              <Settings2 className="w-3 h-3" /> Seed
            </label>
            <div className="flex gap-2">
              <input type="number" value={seed} onChange={e => setSeed(parseInt(e.target.value))}
                className="flex-1 bg-white/[0.02] border border-white/5 rounded-xl py-3 px-4 text-xs font-mono focus:border-emerald-500/20 outline-none text-white/50" />
              <button onClick={() => setSeed(-1)}
                className={`p-3 rounded-xl border transition-all ${seed === -1 ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-white/[0.02] border-white/5 text-slate-500 hover:text-white/40'}`}>
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Negative */}
          <div className="space-y-2 max-w-sm">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Negative</label>
            <textarea value={negativePrompt} onChange={e => setNegativePrompt(e.target.value)}
              className="w-full bg-black/40 border border-white/5 rounded-xl p-3 text-xs text-white/40 focus:outline-none focus:border-white/10 transition-all resize-none min-h-[60px] font-mono" />
          </div>

          {/* Run */}
          <div className="pb-8 max-w-sm">
            <button disabled={!prompt.trim() || isGenerating} onClick={handleGenerate}
              className={`w-full py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] transition-all duration-500 flex items-center justify-center gap-4 ${
                !prompt.trim() || isGenerating
                  ? 'bg-white/5 text-white/10 cursor-not-allowed'
                  : 'bg-white text-black hover:bg-emerald-400 hover:shadow-[0_0_60px_rgba(16,185,129,0.3)]'
              }`}>
              {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
              <span>{isGenerating ? 'Running' : 'Run'}</span>
            </button>
          </div>

        </div>
      </div>

      {/* ── COLLAPSIBLE GALLERY ── */}
      <div className={`flex shrink-0 border-l border-white/5 bg-[#060606] transition-all duration-300 overflow-hidden ${galleryOpen ? 'w-[220px]' : 'w-10'}`}>
        <div className="w-10 shrink-0 flex flex-col items-center pt-5 gap-3 border-r border-white/5">
          <button onClick={() => setGalleryOpen(!galleryOpen)}
            className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-white/30 hover:text-white transition-all">
            {galleryOpen ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
          </button>
          {!galleryOpen && history.length > 0 && (
            <span className="text-[9px] font-black text-white/20 tracking-widest"
              style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
              {history.length}
            </span>
          )}
        </div>
        {galleryOpen && (
          <div className="flex-1 overflow-y-auto custom-scrollbar py-4 px-2 space-y-2">
            {history.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2 opacity-30">
                <ImageIcon className="w-5 h-5 text-white/20" />
                <span className="text-[8px] text-white/20 font-black uppercase tracking-widest">Empty</span>
              </div>
            ) : (
              history.map((url, i) => (
                <button key={url} onClick={() => setCurrentImage(url)}
                  className={`w-full aspect-square rounded-xl overflow-hidden border-2 transition-all hover:opacity-90 ${
                    currentImage === url
                      ? 'border-emerald-500/70 shadow-[0_0_16px_rgba(16,185,129,0.25)]'
                      : 'border-white/5 hover:border-white/20'
                  }`}>
                  <img src={url} alt={`Gen ${i + 1}`} className="w-full h-full object-cover" />
                </button>
              ))
            )}
          </div>
        )}
      </div>

    </div>
  );
};
