import { useState, useRef, useEffect } from 'react';
import {
  Clapperboard, Upload, RefreshCw, Loader2, Play,
  ChevronDown, ChevronUp, Zap,
} from 'lucide-react';
import { useToast } from '../../components/ui/Toast';
import { BACKEND_API } from '../../config/api';
import { useComfyExecution } from '../../contexts/ComfyExecutionContext';
import { usePersistentState } from '../../hooks/usePersistentState';
import { comfyService } from '../../services/comfyService';

// ── Tiny frame-upload slot ────────────────────────────────────────────────────
function FrameSlot({
  label, preview, uploading, onFile,
}: {
  label: string;
  filename?: string | null;
  preview: string | null;
  uploading: boolean;
  onFile: (f: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div
      onClick={() => ref.current?.click()}
      onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) onFile(f); }}
      onDragOver={e => e.preventDefault()}
      className={`relative flex-1 rounded-2xl border-2 border-dashed cursor-pointer transition-all overflow-hidden group ${
        preview ? 'border-violet-500/30' : 'border-white/8 hover:border-violet-500/30'
      }`}
      style={{ minHeight: 140 }}
    >
      {preview ? (
        <>
          <img src={preview} alt={label} className="w-full h-full object-cover absolute inset-0" />
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center">
            <span className="text-[9px] font-black uppercase tracking-widest text-white/70">Replace</span>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-full py-10 gap-2">
          {uploading
            ? <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
            : <Upload className="w-6 h-6 text-white/15" />
          }
          <span className="text-[9px] font-black uppercase tracking-widest text-white/20">
            {uploading ? 'Uploading…' : label}
          </span>
        </div>
      )}
      {/* corner badge */}
      <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-sm">
        <span className="text-[8px] font-black uppercase tracking-widest text-white/40">{label}</span>
      </div>
      <input ref={ref} type="file" accept="image/*" className="hidden"
        onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export const LtxFlfPage = () => {
  const [prompt,    setPrompt]    = usePersistentState('ltx_flf_prompt', '');
  const [aspectRatio, setAspectRatio] = usePersistentState('ltx_flf_ar', '16:9');
  const [direction, setDirection] = usePersistentState('ltx_flf_dir', 'Horizontal');
  const [lengthSec, setLengthSec] = usePersistentState('ltx_flf_len', 5);
  const [seed,      setSeed]      = usePersistentState('ltx_flf_seed', -1);
  const [guideFirst, setGuideFirst] = usePersistentState('ltx_flf_gf', 0.7);
  const [guideLast,  setGuideLast]  = usePersistentState('ltx_flf_gl', 0.7);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // First frame
  const [firstFilename, setFirstFilename] = useState<string | null>(null);
  const [firstPreview,  setFirstPreview]  = useState<string | null>(null);
  const [firstUploading, setFirstUploading] = useState(false);

  // Last frame
  const [lastFilename, setLastFilename] = useState<string | null>(null);
  const [lastPreview,  setLastPreview]  = useState<string | null>(null);
  const [lastUploading, setLastUploading] = useState(false);

  // Generation
  const [isGenerating, setIsGenerating]       = useState(false);
  const [pendingPromptId, setPendingPromptId] = useState<string | null>(null);
  const [currentVideo,    setCurrentVideo]    = useState<string | null>(null);
  const [history,         setHistory]         = useState<string[]>([]);

  const sessionRef   = useRef<string[]>([]);
  const prevCountRef = useRef(0);

  const { toast } = useToast();
  const {
    state: execState,
    lastOutputVideos,
    lastCompletedPromptId,
    outputReadyCount,
    registerNodeMap,
  } = useComfyExecution();

  // ── Upload helper ───────────────────────────────────────────────────────────
  const uploadFrame = async (
    file: File,
    setFilename: (s: string) => void,
    setPreview: (s: string) => void,
    setUploading: (b: boolean) => void,
  ) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res  = await fetch(`${BACKEND_API.BASE_URL}/api/upload`, { method: 'POST', body: form });
      const data = await res.json();
      if (!data.success) throw new Error(data.detail || 'Upload failed');
      setFilename(data.filename);
      setPreview(URL.createObjectURL(file));
    } catch (err: any) {
      toast(err.message || 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  // ── Stream new videos ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!isGenerating && !pendingPromptId) return;
    if (!lastOutputVideos?.length) return;
    const newVids = lastOutputVideos.slice(prevCountRef.current);
    if (!newVids.length) return;
    prevCountRef.current = lastOutputVideos.length;
    const urls = newVids.map(v =>
      `/comfy/view?filename=${encodeURIComponent(v.filename)}&subfolder=${encodeURIComponent(v.subfolder)}&type=${v.type}`
    );
    sessionRef.current = [...sessionRef.current, ...urls];
    setCurrentVideo(urls[0]);
    setHistory(prev => [...urls, ...prev].slice(0, 40));
  }, [outputReadyCount, lastOutputVideos, isGenerating, pendingPromptId]);

  // ── Completion ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pendingPromptId) return;
    if (lastCompletedPromptId !== pendingPromptId) return;
    setIsGenerating(false);
    setPendingPromptId(null);
    toast('Video ready', 'success');
  }, [lastCompletedPromptId, pendingPromptId, toast]);

  useEffect(() => {
    if (execState === 'error') { setIsGenerating(false); setPendingPromptId(null); }
  }, [execState]);

  // ── Generate ────────────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!firstFilename || !lastFilename || !prompt.trim() || isGenerating) return;

    sessionRef.current  = [];
    prevCountRef.current = lastOutputVideos?.length ?? 0;
    setCurrentVideo(null);
    setIsGenerating(true);

    fetch(`${BACKEND_API.BASE_URL}/api/workflow/node-map/ltx-flf`)
      .then(r => r.json()).then(d => { if (d.success) registerNodeMap(d.node_map); }).catch(() => {});

    try {
      const res = await fetch(`${BACKEND_API.BASE_URL}${BACKEND_API.ENDPOINTS.GENERATE}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_id: 'ltx-flf',
          params: {
            image_first:          firstFilename,
            image_last:           lastFilename,
            prompt:               prompt.trim(),
            aspect_ratio:         aspectRatio,
            direction:            direction,
            length_seconds:       lengthSec,
            seed:                 seed === -1 ? Math.floor(Math.random() * 10_000_000_000) : seed,
            guide_strength_first: guideFirst,
            guide_strength_last:  guideLast,
            client_id:            (comfyService as any).clientId,
          },
        }),
      });
      const data = await res.json();
      if (data.success) setPendingPromptId(data.prompt_id);
      else throw new Error(data.detail || 'Failed');
    } catch (err: any) {
      toast(err.message || 'Failed', 'error');
      setIsGenerating(false);
    }
  };

  const canGenerate = !!firstFilename && !!lastFilename && !!prompt.trim() && !isGenerating;

  return (
    <div className="flex h-full bg-[#080808] overflow-hidden">

      {/* ══ LEFT PANEL ══════════════════════════════════════════════════════ */}
      <div className="w-[440px] shrink-0 flex flex-col border-r border-white/5 overflow-y-auto custom-scrollbar">
        <div className="px-7 py-7 space-y-7">

          {/* Header */}
          <div className="flex items-center gap-2">
            <Clapperboard className="w-4 h-4 text-violet-400" />
            <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40">LTX 2.3 — First / Last Frame</h2>
          </div>

          {/* ── FRAME UPLOADS ── */}
          <div className="space-y-2">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Keyframes</p>
            <div className="flex gap-3" style={{ height: 160 }}>
              <FrameSlot
                label="First Frame"
                filename={firstFilename}
                preview={firstPreview}
                uploading={firstUploading}
                onFile={f => uploadFrame(f, setFirstFilename, setFirstPreview, setFirstUploading)}
              />
              <FrameSlot
                label="Last Frame"
                filename={lastFilename}
                preview={lastPreview}
                uploading={lastUploading}
                onFile={f => uploadFrame(f, setLastFilename, setLastPreview, setLastUploading)}
              />
            </div>
            {firstFilename && lastFilename && (
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-violet-400/60" />
                <span className="text-[8px] font-mono text-white/20">Both frames ready</span>
              </div>
            )}
          </div>

          <div className="h-px bg-white/5" />

          {/* ── PROMPT ── */}
          <div className="space-y-2">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Motion Prompt</p>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Describe the motion and action between the two frames…"
              rows={4}
              className="w-full bg-black/30 border border-white/5 rounded-2xl p-4 text-sm text-white/90 placeholder-white/15 resize-none focus:outline-none focus:border-violet-500/20 transition-all"
            />
          </div>

          <div className="h-px bg-white/5" />

          {/* ── ASPECT RATIO ── */}
          <div className="space-y-3">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Output Format</p>
            <div className="flex flex-wrap gap-1.5">
              {['1:1','4:3','3:4','16:9','9:16','21:9','3:2','2:3'].map(ar => (
                <button key={ar} onClick={() => setAspectRatio(ar)}
                  className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all ${
                    aspectRatio === ar
                      ? 'bg-violet-500/20 border border-violet-500/40 text-violet-300'
                      : 'bg-white/[0.03] border border-white/5 text-white/30 hover:text-white/50 hover:bg-white/[0.06]'
                  }`}>{ar}</button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Direction */}
              <div className="space-y-1.5">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-600">Direction</p>
                <div className="flex gap-1.5">
                  {['Horizontal','Vertical'].map(d => (
                    <button key={d} onClick={() => setDirection(d)}
                      className={`flex-1 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all ${
                        direction === d
                          ? 'bg-violet-500/20 border border-violet-500/40 text-violet-300'
                          : 'bg-white/[0.03] border border-white/5 text-white/30 hover:text-white/50'
                      }`}>{d === 'Horizontal' ? 'H' : 'V'}</button>
                  ))}
                </div>
              </div>

              {/* Length */}
              <div className="space-y-1.5">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-600">
                  Length — <span className="text-violet-400/60 font-mono">{lengthSec}s</span>
                </p>
                <input type="range" min={2} max={15} step={1} value={lengthSec}
                  onChange={e => setLengthSec(Number(e.target.value))}
                  className="w-full accent-violet-500" />
              </div>
            </div>
          </div>

          <div className="h-px bg-white/5" />

          {/* ── SEED + ADVANCED ── */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5 flex-1">
                <input type="number" value={seed} onChange={e => setSeed(parseInt(e.target.value))}
                  className="flex-1 bg-white/[0.02] border border-white/5 rounded-xl py-3 px-3 text-xs font-mono focus:border-violet-500/20 outline-none text-white/40" />
                <button onClick={() => setSeed(-1)}
                  className={`p-3 rounded-xl border transition-all ${seed === -1 ? 'bg-violet-500/10 border-violet-500/30 text-violet-400' : 'bg-white/[0.02] border-white/5 text-slate-500'}`}>
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Advanced toggle */}
            <button onClick={() => setShowAdvanced(v => !v)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-white/[0.02] border border-white/5 text-slate-500 hover:text-slate-300 transition-colors">
              <span className="text-[9px] font-black uppercase tracking-widest">Guide Strengths</span>
              {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>

            {showAdvanced && (
              <div className="grid grid-cols-2 gap-3 px-1">
                {[
                  { label: 'First Frame', value: guideFirst, set: setGuideFirst },
                  { label: 'Last Frame',  value: guideLast,  set: setGuideLast  },
                ].map(({ label, value, set }) => (
                  <div key={label} className="space-y-1.5">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-600">
                      {label} — <span className="text-violet-400/60 font-mono">{value.toFixed(2)}</span>
                    </p>
                    <input type="range" min={0} max={1} step={0.05} value={value}
                      onChange={e => set(Number(e.target.value))}
                      className="w-full accent-violet-500" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── GENERATE ── */}
          <div className="pb-6">
            <button
              disabled={!canGenerate}
              onClick={handleGenerate}
              className={`w-full py-5 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] transition-all duration-500 flex items-center justify-center gap-3 ${
                canGenerate
                  ? 'bg-violet-600 text-white hover:bg-violet-500 hover:shadow-[0_0_50px_rgba(139,92,246,0.4)]'
                  : 'bg-white/5 text-white/10 cursor-not-allowed'
              }`}
            >
              {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              <span>{isGenerating ? 'Generating…' : 'Generate'}</span>
            </button>
          </div>

        </div>
      </div>

      {/* ══ RIGHT PANEL — OUTPUT ════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#050505]">

        {/* Header */}
        <div className="h-12 shrink-0 flex items-center justify-between px-6 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Play className="w-3.5 h-3.5 text-violet-400/60" />
            <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white/30">Output</span>
          </div>
          {isGenerating && (
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
              <span className="text-[9px] font-mono text-violet-400/60">Generating…</span>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">

          {/* Current output */}
          {currentVideo ? (
            <div className="rounded-2xl overflow-hidden border border-violet-500/20 bg-black/60 shadow-2xl">
              <video
                key={currentVideo}
                src={currentVideo}
                className="w-full"
                autoPlay
                loop
                muted
                playsInline
                controls
              />
            </div>
          ) : isGenerating ? (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
              <div className="relative">
                <div className="w-16 h-16 rounded-full border border-violet-500/20 flex items-center justify-center">
                  <Loader2 className="w-7 h-7 text-violet-400/60 animate-spin" />
                </div>
                <div className="absolute inset-0 rounded-full border border-violet-500/10 animate-ping" />
              </div>
              <p className="text-[10px] font-black uppercase tracking-widest text-white/20">LTX is working…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 gap-3 opacity-30">
              <Clapperboard className="w-10 h-10 text-white/10" />
              <p className="text-[10px] font-black uppercase tracking-widest text-white/20">Upload frames and generate</p>
            </div>
          )}

          {/* History */}
          {history.length > 0 && (
            <>
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-white/5" />
                <span className="text-[8px] font-black uppercase tracking-widest text-white/15">Previous Runs</span>
                <div className="h-px flex-1 bg-white/5" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {history.map((url, i) => (
                  <div
                    key={url + i}
                    onClick={() => setCurrentVideo(url)}
                    className={`rounded-xl overflow-hidden border cursor-pointer transition-all hover:scale-[1.01] ${
                      currentVideo === url ? 'border-violet-500/40' : 'border-white/5 hover:border-white/15'
                    } bg-black/40`}
                  >
                    <video src={url} className="w-full aspect-video object-cover" muted playsInline />
                  </div>
                ))}
              </div>
            </>
          )}

        </div>
      </div>

    </div>
  );
};
