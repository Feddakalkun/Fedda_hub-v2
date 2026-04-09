import { useState, useEffect } from 'react';
import {
  Sparkles, Maximize2, Loader2, RefreshCw, Plus, Trash2,
  ChevronLeft, Expand, ChevronDown, ChevronUp,
} from 'lucide-react';
import { PromptAssistant } from '../../components/ui/PromptAssistant';
import { LoraSelector } from '../../components/ui/LoraSelector';
import { Lightbox } from '../../components/ui/Lightbox';
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

type ZImageLoraEntry = {
  name: string;
  strength: number;
};

const normLora = (v: string) => v.replace(/\\/g, '/').toLowerCase().trim();

const resolveInstalledLoraName = (name: string, available: string[]) => {
  if (!name) return '';
  const direct = available.find((a) => normLora(a) === normLora(name));
  if (direct) return direct;

  const candidate = name
    .replace(/zimage_turbo/gi, 'zimage-turbo')
    .replace(/zimage\/turbo/gi, 'zimage-turbo');
  const fixed = available.find((a) => normLora(a) === normLora(candidate));
  return fixed ?? name;
};

export const ZImageTxt2Img = () => {
  const [prompt, setPrompt]                   = usePersistentState('zimage_prompt', '');
  const [negativePrompt, setNegativePrompt]   = usePersistentState('zimage_negative', 'blurry, ugly, bad proportions, low quality, artifacts');
  const [width, setWidth]                     = usePersistentState('zimage_width', 1024);
  const [height, setHeight]                   = usePersistentState('zimage_height', 1024);
  const [steps, setSteps]                     = usePersistentState('zimage_steps', 11);
  const cfg                                   = 1.0;
  const [seed, setSeed]                       = usePersistentState('zimage_seed', -1);
  const [loraEntries, setLoraEntries]         = usePersistentState<ZImageLoraEntry[]>('zimage_loras', []);

  const [isGenerating, setIsGenerating]       = useState(false);
  const [pendingPromptId, setPendingPromptId] = useState<string | null>(null);
  const [currentImage, setCurrentImage]       = usePersistentState<string | null>('zimage_current_image', null);
  const [history, setHistory]                 = usePersistentState<string[]>('zimage_history', []);
  const [availableLoras, setAvailableLoras]   = useState<string[]>([]);
  const [negExpanded, setNegExpanded]         = useState(false);
  const [lightboxImage, setLightboxImage]     = useState<string | null>(null);
  const [previewCollapsed, setPreviewCollapsed] = usePersistentState('zimage_preview_collapsed', false);

  const { toast } = useToast();
  const {
    state: execState,
    clearOutputs,
    previewUrl,
    outputReadyCount,
    lastOutputImages,
  } = useComfyExecution();

  useEffect(() => {
    comfyService.getLoras().then((loras) => {
      const filtered = loras.filter((l) => {
        const normalized = l.replace(/\\/g, '/').toLowerCase();
        return normalized.startsWith('zimage_turbo/') || normalized.startsWith('zimage-turbo/');
      });
      setAvailableLoras(filtered);
    }).catch(() => {});
  }, []);

  // Normalize persisted LoRA paths to currently installed names.
  useEffect(() => {
    if (availableLoras.length === 0 || loraEntries.length === 0) return;
    const normalized = loraEntries.map((entry) => ({
      ...entry,
      name: resolveInstalledLoraName(entry.name, availableLoras),
    }));
    const changed = normalized.some((entry, i) => entry.name !== loraEntries[i]?.name);
    if (changed) setLoraEntries(normalized);
  }, [availableLoras, loraEntries, setLoraEntries]);

  // One-time defaults migration for existing browsers:
  // force Z-Image defaults to 11 steps / CFG 1.0.
  useEffect(() => {
    try {
      const marker = 'zimage_defaults_migrated_v2';
      if (window.localStorage.getItem(marker)) return;
      setSteps(11);
      window.localStorage.setItem('zimage_cfg', JSON.stringify(1.0));
      window.localStorage.setItem(marker, '1');
    } catch {
      // ignore storage access errors
    }
  }, [setSteps]);

  // One-time migration from legacy single-LoRA keys.
  useEffect(() => {
    if (loraEntries.length > 0) return;
    try {
      const legacyNameRaw = window.localStorage.getItem('zimage_lora_name');
      const legacyStrengthRaw = window.localStorage.getItem('zimage_lora_strength');
      if (!legacyNameRaw) return;
      const legacyName = JSON.parse(legacyNameRaw) as string;
      const legacyStrength = legacyStrengthRaw ? Number(JSON.parse(legacyStrengthRaw)) : 1.0;
      if (legacyName && legacyName.trim()) {
        setLoraEntries([{ name: legacyName, strength: Number.isFinite(legacyStrength) ? legacyStrength : 1.0 }]);
      }
    } catch {
      // ignore legacy parsing errors
    }
  }, [loraEntries.length, setLoraEntries]);

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

  // Also consume real-time executed output events so the strip updates immediately.
  useEffect(() => {
    if (!isGenerating || outputReadyCount <= 0 || lastOutputImages.length === 0) return;
    const urls = lastOutputImages.map((img) => comfyService.getImageUrl(img));
    setHistory((prev) => {
      const merged = [...urls, ...prev.filter((u) => !urls.includes(u))];
      return merged.slice(0, 40);
    });
    if (urls[0]) setCurrentImage(urls[0]);
  }, [isGenerating, outputReadyCount, lastOutputImages, setHistory, setCurrentImage]);

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
      const activeLoras = loraEntries
        .filter((l) => l.name && l.name.trim())
        .map((l) => ({
          name: resolveInstalledLoraName(l.name, availableLoras),
          strength: l.strength,
        }))
        .filter((l) => availableLoras.some((a) => normLora(a) === normLora(l.name)));
      if (activeLoras.length > 0) params.loras = activeLoras;
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

  const stripImages = [
    ...(previewUrl ? [previewUrl] : []),
    ...history.filter((h) => h !== previewUrl),
  ];

  const openImage = (url: string) => {
    setCurrentImage(url);
    setLightboxImage(url);
  };

  return (
    <>
    <div className="flex h-full bg-[#080808] overflow-hidden">

      {/* ══════════════ LEFT PANEL ══════════════ */}
      <div className="flex-1 min-w-0 flex flex-col border-r border-white/[0.04] overflow-y-auto custom-scrollbar">
        <div className="px-6 py-6 space-y-6">

          {/* Header */}
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30">Z-Image</span>
          </div>

          {/* Top preview strip */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setPreviewCollapsed((v) => !v)}
                className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-[0.2em] text-white/30 hover:text-white/65 transition-colors"
              >
                {previewCollapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
                Preview
              </button>
              <span className="text-[8px] font-mono text-white/20">{previewUrl ? 'Live' : 'Recent'} · {history.length}</span>
            </div>
            {!previewCollapsed && (
              <>
                {stripImages.length === 0 ? (
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[10px] text-white/30">
                    No previews yet. Generate an image to fill this bar.
                  </div>
                ) : (
                  <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
                    {stripImages.map((url, idx) => {
                      const isLive = !!previewUrl && idx === 0;
                      return (
                        <button
                          key={`z-preview-${idx}`}
                          onClick={() => openImage(url)}
                          className={`group relative h-24 w-24 shrink-0 rounded-xl border overflow-hidden transition-all ${
                            currentImage === url
                              ? 'ring-1 ring-emerald-400/50 border-emerald-400/40'
                              : 'border-white/15 bg-black/40 hover:border-emerald-400/50'
                          }`}
                        >
                          <img src={url} alt={`Preview ${idx + 1}`} className="h-full w-full object-cover" />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors" />
                          <div className="absolute bottom-1 right-1 rounded bg-black/60 px-1 py-0.5 text-[8px] font-bold text-white/80 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Expand className="h-2.5 w-2.5" />
                          </div>
                          {isLive && (
                            <div className="absolute left-1 top-1 inline-flex items-center gap-1 rounded bg-emerald-500/80 px-1 py-0.5 text-[7px] font-black uppercase tracking-wider text-black">
                              <Loader2 className="h-2 w-2 animate-spin" /> Live
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
                {isGenerating && !previewUrl && (
                  <div className="text-[9px] text-white/30">
                    Live preview is off in ComfyUI. Enable it in ComfyUI Settings if you want step-by-step preview.
                  </div>
                )}
              </>
            )}
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
            label="LoRA 1"
            value={loraEntries[0]?.name ?? ''}
            onChange={(name) => {
              setLoraEntries((prev) => {
                const next = [...prev];
                if (!next[0]) next[0] = { name: '', strength: 1.0 };
                next[0] = { ...next[0], name };
                return next;
              });
            }}
            strength={loraEntries[0]?.strength ?? 1.0}
            onStrengthChange={(strength) => {
              setLoraEntries((prev) => {
                const next = [...prev];
                if (!next[0]) next[0] = { name: '', strength: 1.0 };
                next[0] = { ...next[0], strength };
                return next;
              });
            }}
            options={availableLoras}
            accent="emerald"
          />

          {loraEntries.slice(1).map((entry, idx) => (
            <div key={`zimage-lora-${idx + 1}`} className="space-y-2 rounded-xl border border-white/[0.06] bg-white/[0.01] p-2.5">
              <div className="flex justify-end">
                <button
                  onClick={() => setLoraEntries((prev) => prev.filter((_, i) => i !== idx + 1))}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.02] px-2 py-1 text-[9px] font-black uppercase tracking-wider text-white/40 transition-colors hover:border-red-500/30 hover:text-red-400"
                >
                  <Trash2 className="h-3 w-3" /> Remove
                </button>
              </div>
              <LoraSelector
                label={`LoRA ${idx + 2}`}
                value={entry.name}
                onChange={(name) => {
                  setLoraEntries((prev) => {
                    const next = [...prev];
                    next[idx + 1] = { ...next[idx + 1], name };
                    return next;
                  });
                }}
                strength={entry.strength}
                onStrengthChange={(strength) => {
                  setLoraEntries((prev) => {
                    const next = [...prev];
                    next[idx + 1] = { ...next[idx + 1], strength };
                    return next;
                  });
                }}
                options={availableLoras}
                accent="emerald"
              />
            </div>
          ))}

          <button
            onClick={() => setLoraEntries((prev) => (prev.length >= 5 ? prev : [...prev, { name: '', strength: 1.0 }]))}
            disabled={loraEntries.length >= 5}
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wider transition-all ${
              loraEntries.length >= 5
                ? 'cursor-not-allowed border-white/[0.05] bg-white/[0.02] text-white/20'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15'
            }`}
          >
            <Plus className="h-3 w-3" /> Add LoRA
          </button>

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
    {lightboxImage && (
      <Lightbox imageUrl={lightboxImage} onClose={() => setLightboxImage(null)} />
    )}
    </>
  );
};

