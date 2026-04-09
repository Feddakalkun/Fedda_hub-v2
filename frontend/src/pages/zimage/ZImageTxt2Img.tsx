import { useState, useEffect } from 'react';
import {
  Sparkles, Maximize2, Loader2, RefreshCw,
  ChevronLeft,
} from 'lucide-react';
import { PromptAssistant } from '../../components/ui/PromptAssistant';
import { LoraSelector } from '../../components/ui/LoraSelector';
import { useToast } from '../../components/ui/Toast';
import { BACKEND_API } from '../../config/api';
import { useComfyExecution } from '../../contexts/ComfyExecutionContext';
import { usePersistentState } from '../../hooks/usePersistentState';
import { comfyService } from '../../services/comfyService';

const PRESETS = [
  { label: '1:1',  w: 1024, h: 1024 },
  { label: '2:3',  w: 1024, h: 1536 },
  { label: '3:2',  w: 1536, h: 1024 },
  { label: '9:16', w: 896,  h: 1152 },
];

export const ZImageTxt2Img = () => {
  const [prompt, setPrompt]                   = usePersistentState('zimage_prompt', '');
  const [negativePrompt, setNegativePrompt]   = usePersistentState('zimage_negative', 'blurry, ugly, bad proportions, low quality, artifacts');
  const [width, setWidth]                     = usePersistentState('zimage_width', 1024);
  const [height, setHeight]                   = usePersistentState('zimage_height', 1024);
  const [steps, setSteps]                     = usePersistentState('zimage_steps', 8);
  const [cfg]                                 = usePersistentState('zimage_cfg', 1.5);
  const [seed, setSeed]                       = usePersistentState('zimage_seed', -1);
  const [loraName, setLoraName]               = usePersistentState('zimage_lora_name', '');
  const [loraStrength, setLoraStrength]       = usePersistentState('zimage_lora_strength', 1.0);

  const [isGenerating, setIsGenerating]       = useState(false);
  const [pendingPromptId, setPendingPromptId] = useState<string | null>(null);
  const [currentImage, setCurrentImage]       = useState<string | null>(null);
  const [history, setHistory]                 = useState<string[]>([]);
  void currentImage;
  void history;
  const [availableLoras, setAvailableLoras]   = useState<string[]>([]);
  const [negExpanded, setNegExpanded]         = useState(false);

  const { toast } = useToast();
  const { state: execState, clearOutputs } = useComfyExecution();

  useEffect(() => {
    comfyService.getLoras().then((loras) => {
      const filtered = loras.filter((l) => {
        const normalized = l.replace(/\\/g, '/').toLowerCase();
        return normalized.startsWith('zimage_turbo/') || normalized.startsWith('zimage-turbo/');
      });
      setAvailableLoras(filtered);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (execState !== 'done' || !pendingPromptId) return;
    const pid = pendingPromptId;
    const fetchAndShow = async () => {
      try {
        const res = await fetch(`${BACKEND_API.BASE_URL}/api/generate/status/${pid}`);
        const data = await res.json();
        const imgs: Array<{ filename: string; subfolder: string; type: string }> = data.images ?? [];
        if (imgs.length > 0) {
          const img = imgs[imgs.length - 1];
          const url = `/comfy/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`;
          setCurrentImage(url);
          setHistory(prev => (prev.includes(url) ? prev : [url, ...prev.slice(0, 29)]));
          toast('Complete', 'success');
        }
      } catch { /* silent */ }
      finally {
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
        prompt, negative: negativePrompt, width, height,
        seed: seed === -1 ? Math.floor(Math.random() * 10_000_000_000) : seed,
        steps, cfg, client_id: (comfyService as any).clientId,
      };
      if (loraName) { params.lora_name = loraName; params.lora_strength = loraStrength; }
      const res = await fetch(`${BACKEND_API.BASE_URL}${BACKEND_API.ENDPOINTS.GENERATE}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow_id: 'z-image', params }),
      });
      const data = await res.json();
      if (data.success) setPendingPromptId(data.prompt_id);
      else throw new Error(data.detail || 'Failed');
    } catch (err: any) {
      toast(err.message || 'Failed', 'error');
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex h-full bg-[#080808] overflow-hidden">

      {/* ══════════════ LEFT PANEL ══════════════ */}
      <div className="flex-1 min-w-0 flex flex-col border-r border-white/[0.04] overflow-y-auto custom-scrollbar">
        <div className="px-6 py-6 space-y-6">

          {/* Header */}
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30">Z-Image</span>
          </div>

          {/* Prompt */}
          <PromptAssistant
            context="zimage"
            value={prompt}
            onChange={setPrompt}
            placeholder="Describe the subject, mood, lighting…"
            minRows={5}
            accent="emerald"
            label="Prompt"
          />

          <LoraSelector
            label="LoRA"
            value={loraName}
            onChange={setLoraName}
            strength={loraStrength}
            onStrengthChange={setLoraStrength}
            options={availableLoras}
            accent="emerald"
          />

          <div className="h-px bg-white/[0.04]" />

          {/* Dimensions */}
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <Maximize2 className="w-3 h-3 text-white/15" />
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/25">Dimensions</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {PRESETS.map(r => (
                <button key={r.label}
                  onClick={() => { setWidth(r.w); setHeight(r.h); }}
                  className={`py-2 rounded-lg border text-[8px] font-black uppercase tracking-wider transition-all ${
                    width === r.w && height === r.h
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-white/[0.02] border-white/[0.06] text-white/20 hover:text-white/50 hover:border-white/15'
                  }`}>{r.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[['W', width, setWidth], ['H', height, setHeight]].map(([label, val, fn]) => (
                <div key={label as string} className="space-y-1">
                  <span className="text-[8px] font-black uppercase tracking-widest text-white/15">{label as string}</span>
                  <input type="number" value={val as number} onChange={e => (fn as (v: number) => void)(Number(e.target.value))}
                    className="w-full bg-white/[0.02] border border-white/[0.06] rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-white/50 focus:border-emerald-500/20 outline-none" />
                </div>
              ))}
            </div>
          </div>

          {/* Steps */}
          <div className="space-y-2">
            <div className="flex justify-between text-[9px] font-black uppercase tracking-[0.2em] text-white/25">
              <span>Steps</span>
              <span className="text-emerald-400/70 font-mono">{steps}</span>
            </div>
            <input type="range" min="1" max="25" step="1" value={steps}
              onChange={e => setSteps(Number(e.target.value))}
              className="w-full h-1 rounded-full appearance-none outline-none accent-emerald-500 cursor-pointer" />
            <div className="flex justify-between text-[8px] font-mono text-white/10">
              <span>1</span><span>25</span>
            </div>
          </div>

          {/* Seed */}
          <div className="flex gap-2">
            <input type="number" value={seed} onChange={e => setSeed(parseInt(e.target.value))}
              className="flex-1 bg-white/[0.02] border border-white/[0.06] rounded-xl py-2.5 px-3 text-[11px] font-mono text-white/40 focus:border-emerald-500/20 outline-none" />
            <button onClick={() => setSeed(-1)}
              className={`p-2.5 rounded-xl border transition-all ${
                seed === -1
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-white/[0.02] border-white/[0.06] text-white/20 hover:text-white/50'
              }`}>
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Negative — collapsible */}
          <div className="space-y-2">
            <button
              onClick={() => setNegExpanded(v => !v)}
              className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.2em] text-white/15 hover:text-white/35 transition-colors">
              {negExpanded ? <ChevronLeft className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3 -rotate-90" />}
              Negative prompt
            </button>
            {negExpanded && (
              <textarea value={negativePrompt} onChange={e => setNegativePrompt(e.target.value)}
                className="w-full bg-black/30 border border-white/[0.05] rounded-xl p-3 text-[11px] font-mono text-white/30 focus:outline-none focus:border-white/10 transition-all resize-none min-h-[60px]"
                placeholder="What to avoid…" />
            )}
          </div>

          {/* Generate */}
          <div className="pb-6">
            <button disabled={!prompt.trim() || isGenerating} onClick={handleGenerate}
              className={`w-full py-5 rounded-2xl font-black text-[11px] uppercase tracking-[0.35em] transition-all duration-300 flex items-center justify-center gap-3 ${
                !prompt.trim() || isGenerating
                  ? 'bg-white/[0.03] text-white/10 cursor-not-allowed border border-white/[0.04]'
                  : 'bg-emerald-500 text-black hover:bg-emerald-400 hover:shadow-[0_0_40px_rgba(16,185,129,0.3)] active:scale-[0.98]'
              }`}>
              {isGenerating
                ? <><Loader2 className="w-4 h-4 animate-spin" /><span>Generating…</span></>
                : <><Sparkles className="w-4 h-4" /><span>Generate</span></>
              }
            </button>
          </div>

        </div>
      </div>

    </div>
  );
};

