import { useState, useEffect } from 'react';
import { Sparkles, Maximize2, Loader2, Hash, RefreshCw, Settings2 } from 'lucide-react';
import { useToast } from '../../components/ui/Toast';
import { BACKEND_API } from '../../config/api';
import { useComfyExecution } from '../../contexts/ComfyExecutionContext';
import { usePersistentState } from '../../hooks/usePersistentState';
import { comfyService } from '../../services/comfyService';
import { LoraStack } from '../../components/image/LoraStack';
import type { SelectedLora } from '../../components/image/LoraStack';

export const ZImageTxt2Img = () => {
  const [prompt, setPrompt]               = usePersistentState('zimage_prompt', '');
  const [negativePrompt, setNegativePrompt] = usePersistentState('zimage_negative', 'blurry, ugly, bad proportions, low quality, artifacts');
  const [width, setWidth]                 = usePersistentState('zimage_width', 1024);
  const [height, setHeight]               = usePersistentState('zimage_height', 1024);
  const [steps, setSteps]                 = usePersistentState('zimage_steps', 8);
  const [cfg]                             = usePersistentState('zimage_cfg', 1.5);
  const [seed, setSeed]                   = usePersistentState('zimage_seed', -1);
  const [loras, setLoras]                 = usePersistentState<SelectedLora[]>('zimage_loras', []);

  const [isGenerating, setIsGenerating]   = useState(false);
  const [pendingPromptId, setPendingPromptId] = useState<string | null>(null);
  const [availableLoras, setAvailableLoras] = useState<string[]>([]);

  const { toast } = useToast();
  const {
    state: execState,
    lastOutputImages,
    lastCompletedPromptId,
  } = useComfyExecution();

  // Load available LoRAs once
  useEffect(() => {
    comfyService.getLoras().then(setAvailableLoras).catch(() => {});
  }, []);

  // Image completion — show toast when our prompt finishes
  useEffect(() => {
    if (!pendingPromptId || !lastOutputImages?.length) return;
    if (lastCompletedPromptId !== pendingPromptId) return;

    setIsGenerating(false);
    setPendingPromptId(null);
    toast('Image complete — check the gallery', 'success');
  }, [lastOutputImages, lastCompletedPromptId, pendingPromptId, toast]);

  // Safety net: clear spinner on error
  useEffect(() => {
    if (execState === 'error') {
      setIsGenerating(false);
      setPendingPromptId(null);
    }
  }, [execState]);

  // ── Generate ──────────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!prompt.trim() || isGenerating) return;
    setIsGenerating(true);

    try {
      const res = await fetch(`${BACKEND_API.BASE_URL}${BACKEND_API.ENDPOINTS.GENERATE}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_id: 'z-image',
          params: {
            prompt,
            negative: negativePrompt,
            width,
            height,
            seed: seed === -1 ? Math.floor(Math.random() * 10_000_000_000) : seed,
            steps,
            cfg,
            client_id: (comfyService as any).clientId,
            loras: loras.map(l => ({ name: l.name, strength: l.strength })),
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        setPendingPromptId(data.prompt_id);
      } else {
        throw new Error(data.detail || 'Failed');
      }
    } catch (err: any) {
      toast(err.message || 'Failed', 'error');
      setIsGenerating(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="h-full overflow-y-auto custom-scrollbar bg-[#080808]">
      <div className="max-w-xl mx-auto px-6 py-8 space-y-8">

        {/* Header */}
        <div className="flex items-center gap-2 pb-2">
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

        {/* LoRA */}
        <LoraStack selectedLoras={loras} setSelectedLoras={setLoras} availableLoras={availableLoras} />

        <div className="h-px bg-white/5" />

        {/* Dimensions */}
        <div className="space-y-4">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
            <Maximize2 className="w-3 h-3" /> Dimensions
          </label>
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Square',    w: 1024, h: 1024 },
              { label: 'Portrait',  w: 1024, h: 1536 },
              { label: 'Landscape', w: 1536, h: 1024 },
              { label: 'Vertical',  w: 896,  h: 1152 },
            ].map(r => (
              <button
                key={r.label}
                onClick={() => { setWidth(r.w); setHeight(r.h); }}
                className={`py-2.5 rounded-xl border text-[8px] font-black uppercase tracking-widest transition-all ${
                  width === r.w && height === r.h
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : 'bg-white/[0.02] border-white/5 text-slate-500 hover:border-white/10 hover:text-white/40'
                }`}
              >{r.label}</button>
            ))}
          </div>
          <div className="flex gap-3">
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
        <div className="space-y-3">
          <div className="flex justify-between items-center text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">
            <span className="flex items-center gap-2"><Hash className="w-3 h-3" /> Steps</span>
            <span className="text-emerald-500 font-mono">{steps}</span>
          </div>
          <input type="range" min="1" max="25" step="1" value={steps} onChange={e => setSteps(Number(e.target.value))}
            className="w-full h-1 bg-white/5 rounded-full appearance-none outline-none accent-emerald-500 cursor-pointer" />
        </div>

        {/* Seed */}
        <div className="space-y-3">
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
        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Negative</label>
          <textarea value={negativePrompt} onChange={e => setNegativePrompt(e.target.value)}
            className="w-full bg-black/40 border border-white/5 rounded-xl p-3 text-xs text-white/40 focus:outline-none focus:border-white/10 transition-all resize-none min-h-[60px] font-mono" />
        </div>

        {/* Run */}
        <div className="pb-8">
          <button
            disabled={!prompt.trim() || isGenerating}
            onClick={handleGenerate}
            className={`w-full py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] transition-all duration-500 flex items-center justify-center gap-4 ${
              !prompt.trim() || isGenerating
                ? 'bg-white/5 text-white/10 cursor-not-allowed'
                : 'bg-white text-black hover:bg-emerald-400 hover:shadow-[0_0_60px_rgba(16,185,129,0.3)]'
            }`}
          >
            {isGenerating
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : <Sparkles className="w-5 h-5" />}
            <span>{isGenerating ? 'Running' : 'Run'}</span>
          </button>
        </div>

      </div>
    </div>
  );
};
