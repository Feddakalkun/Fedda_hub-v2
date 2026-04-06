import { useState, useEffect } from 'react';
import {
  Sparkles, Download, Maximize2, Loader2, Image as ImageIcon,
  Settings2, Hash, RefreshCw, X, DownloadCloud, ChevronRight, ChevronLeft,
} from 'lucide-react';
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
  const [currentImage, setCurrentImage]   = useState<string | null>(null);
  const [history, setHistory]             = useState<string[]>([]);
  const [availableLoras, setAvailableLoras] = useState<string[]>([]);

  // Layout
  const [panelWidth, setPanelWidth]       = useState(400);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [isResizing, setIsResizing]       = useState(false);
  const [galleryOpen, setGalleryOpen]     = useState(true);

  const { toast } = useToast();
  const {
    state: execState,
    isDownloaderNode,
    progress: execProgress,
    lastOutputImages,
    lastCompletedPromptId,
    previewUrl,
  } = useComfyExecution();

  // Load available LoRAs once
  useEffect(() => {
    comfyService.getLoras().then(setAvailableLoras).catch(() => {});
  }, []);

  // Resize drag
  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: MouseEvent) => setPanelWidth(Math.max(300, Math.min(800, e.clientX)));
    const onUp   = () => setIsResizing(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [isResizing]);

  // ── Image completion ──────────────────────────────────────────────────────
  // Only accept output when OUR prompt completes — fixes the "second run" bug.
  useEffect(() => {
    if (!pendingPromptId || !lastOutputImages?.length) return;
    if (lastCompletedPromptId !== pendingPromptId) return;

    const img = lastOutputImages[lastOutputImages.length - 1];
    const url = `/comfy/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`;

    setCurrentImage(url);
    setHistory(prev => (prev.includes(url) ? prev : [url, ...prev.slice(0, 29)]));
    setIsGenerating(false);
    setPendingPromptId(null);
    toast('Complete', 'success');
  }, [lastOutputImages, lastCompletedPromptId, pendingPromptId, toast]);

  // Safety net: clear spinner on execution error
  useEffect(() => {
    if (execState === 'error') {
      setIsGenerating(false);
      setPendingPromptId(null);
    }
  }, [execState]);

  // ── Generate ─────────────────────────────────────────────────────────────
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

  const displayImage = (isGenerating && previewUrl) ? previewUrl : currentImage;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full bg-[#050505] overflow-hidden">

      {/* ── LEFT PARAMS PANEL ── */}
      <div
        className="flex flex-col border-r border-white/5 bg-[#080808] shrink-0 overflow-hidden transition-all duration-400"
        style={{ width: leftCollapsed ? 0 : panelWidth }}
      >
        <div className="h-14 flex items-center justify-between px-6 border-b border-white/5 shrink-0">
          <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-white/50 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-500" /> Z-Image
          </h2>
          <button onClick={() => setLeftCollapsed(true)} className="p-1.5 hover:bg-white/5 rounded-lg text-slate-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-8">

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

      {/* Resize handle */}
      {!leftCollapsed && (
        <div
          onMouseDown={() => setIsResizing(true)}
          className="w-1 shrink-0 cursor-col-resize hover:bg-emerald-500/50 transition-colors z-30"
        />
      )}

      {/* ── CANVAS ── */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden bg-[#030303]">

        {/* Left panel restore */}
        {leftCollapsed && (
          <button
            onClick={() => setLeftCollapsed(false)}
            className="absolute top-5 left-5 z-20 w-9 h-9 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl flex items-center justify-center text-white/30 hover:text-white transition-all"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}

        {displayImage ? (
          <div className="flex flex-col items-center max-h-full max-w-full p-8">
            <div className="relative rounded-[2rem] overflow-hidden shadow-[0_0_100px_rgba(0,0,0,0.9)] border border-white/5 bg-black">
              <img
                src={displayImage}
                alt="Generated"
                className={`max-w-full max-h-[80vh] object-contain transition-all duration-500 ${
                  isGenerating && previewUrl && !currentImage ? 'opacity-40 blur-sm' : 'opacity-100 blur-0'
                }`}
              />
              {isGenerating && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="p-4 bg-black/60 backdrop-blur-2xl rounded-full border border-white/10">
                    <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
                  </div>
                </div>
              )}
            </div>

            {!isGenerating && currentImage && (
              <div className="mt-5 flex items-center gap-1 p-1 bg-white/5 backdrop-blur-2xl rounded-2xl border border-white/5">
                <a href={currentImage} target="_blank" rel="noreferrer"
                  className="p-2.5 text-white/40 hover:text-white transition-all rounded-xl hover:bg-white/5">
                  <Download className="w-4 h-4" />
                </a>
                <button
                  onClick={() => window.open(currentImage, '_blank')}
                  className="p-2.5 text-white/40 hover:text-white transition-all rounded-xl hover:bg-white/5">
                  <Maximize2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center text-center select-none">
            <div className="relative w-36 h-36 mb-8">
              <div className={`absolute inset-0 rounded-[3rem] blur-[60px] transition-all duration-1000 ${isGenerating ? 'bg-emerald-500/10 scale-150' : 'bg-white/5'}`} />
              <div className={`relative w-full h-full rounded-[2.5rem] border flex items-center justify-center transition-all duration-700 ${
                isGenerating ? 'border-emerald-500/30 bg-white/5' : 'border-white/5 bg-white/[0.02]'
              }`}>
                {isGenerating
                  ? isDownloaderNode
                    ? <DownloadCloud className="w-10 h-10 animate-bounce text-emerald-400" />
                    : <Loader2 className="w-10 h-10 animate-spin text-emerald-400/40" />
                  : <ImageIcon className="w-10 h-10 text-white/5" />}
              </div>
              {isGenerating && execProgress > 0 && (
                <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-white text-black text-[9px] font-black px-3 py-1 rounded-full font-mono whitespace-nowrap">
                  {execProgress}%
                </div>
              )}
            </div>
            <p className={`text-sm font-black uppercase tracking-[0.5em] transition-all duration-700 ${isGenerating ? 'text-white' : 'text-white/10'}`}>
              {isGenerating ? 'Generating' : 'Ready'}
            </p>
          </div>
        )}
      </div>

      {/* ── RIGHT GALLERY PANEL ── */}
      <div className={`flex shrink-0 border-l border-white/5 bg-[#080808] transition-all duration-300 overflow-hidden ${galleryOpen ? 'w-[200px]' : 'w-10'}`}>

        {/* Thin toggle strip */}
        <div className="w-10 shrink-0 flex flex-col items-center pt-5 gap-3 border-r border-white/5">
          <button
            onClick={() => setGalleryOpen(!galleryOpen)}
            className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-white/30 hover:text-white transition-all"
          >
            {galleryOpen ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
          </button>
          {!galleryOpen && history.length > 0 && (
            <span className="text-[9px] font-black text-white/20 tracking-widest"
              style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
              {history.length}
            </span>
          )}
        </div>

        {/* Image list */}
        {galleryOpen && (
          <div className="flex-1 overflow-y-auto custom-scrollbar py-4 px-2 space-y-2">
            {history.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2 opacity-30">
                <ImageIcon className="w-5 h-5 text-white/20" />
                <span className="text-[8px] text-white/20 font-black uppercase tracking-widest">Empty</span>
              </div>
            ) : (
              history.map((url, i) => (
                <button
                  key={url}
                  onClick={() => setCurrentImage(url)}
                  className={`w-full aspect-square rounded-xl overflow-hidden border-2 transition-all hover:opacity-90 ${
                    currentImage === url
                      ? 'border-emerald-500/70 shadow-[0_0_16px_rgba(16,185,129,0.25)]'
                      : 'border-white/5 hover:border-white/20'
                  }`}
                >
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
