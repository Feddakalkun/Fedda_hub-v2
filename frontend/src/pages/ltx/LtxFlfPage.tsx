import { useState, useRef, useEffect } from 'react';
import {
  Upload, RefreshCw, Loader2, Play,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import { PromptAssistant } from '../../components/ui/PromptAssistant';
import { useToast } from '../../components/ui/Toast';
import { BACKEND_API } from '../../config/api';
import { useComfyExecution } from '../../contexts/ComfyExecutionContext';
import { usePersistentState } from '../../hooks/usePersistentState';
import { comfyService } from '../../services/comfyService';

// ── Frame upload slot ─────────────────────────────────────────────────────────
function FrameSlot({ label, preview, uploading, onFile }: {
  label: string; preview: string | null; uploading: boolean; onFile: (f: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div
      onClick={() => ref.current?.click()}
      onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) onFile(f); }}
      onDragOver={e => e.preventDefault()}
      className={`relative flex-1 rounded-xl border border-dashed cursor-pointer transition-all overflow-hidden group ${
        preview ? 'border-violet-500/30 bg-black/40' : 'border-white/[0.08] hover:border-violet-500/25 bg-white/[0.02]'
      }`}
      style={{ height: 120 }}
    >
      {preview ? (
        <>
          <img src={preview} alt={label} className="w-full h-full object-cover absolute inset-0" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center">
            <span className="text-[8px] font-black uppercase tracking-widest text-white/70">Replace</span>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-full gap-2">
          {uploading
            ? <Loader2 className="w-5 h-5 text-violet-400/60 animate-spin" />
            : <Upload className="w-5 h-5 text-white/10" />
          }
          <span className="text-[8px] font-black uppercase tracking-widest text-white/15">
            {uploading ? 'Uploading…' : label}
          </span>
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 px-2 py-1">
        <span className="text-[7px] font-black uppercase tracking-widest text-white/30">{label}</span>
      </div>
      <input ref={ref} type="file" accept="image/*" className="hidden"
        onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export const LtxFlfPage = () => {
  const [prompt,      setPrompt]      = usePersistentState('ltx_flf_prompt', '');
  const [aspectRatio, setAspectRatio] = usePersistentState('ltx_flf_ar', '16:9');
  const [direction,   setDirection]   = usePersistentState('ltx_flf_dir', 'Horizontal');
  const [lengthSec,   setLengthSec]   = usePersistentState('ltx_flf_len', 5);
  const [seed,        setSeed]        = usePersistentState('ltx_flf_seed', -1);
  const [guideFirst,  setGuideFirst]  = usePersistentState('ltx_flf_gf', 0.7);
  const [guideLast,   setGuideLast]   = usePersistentState('ltx_flf_gl', 0.7);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [firstPreview,  setFirstPreview]  = useState<string | null>(null);
  const [firstFilename, setFirstFilename] = useState<string | null>(null);
  const [firstUploading, setFirstUploading] = useState(false);
  const [lastPreview,   setLastPreview]   = useState<string | null>(null);
  const [lastFilename,  setLastFilename]  = useState<string | null>(null);
  const [lastUploading, setLastUploading] = useState(false);

  const [isGenerating,    setIsGenerating]    = useState(false);
  const [pendingPromptId, setPendingPromptId] = useState<string | null>(null);
  const [currentVideo,    setCurrentVideo]    = useState<string | null>(null);
  const [history, setHistory] = usePersistentState<string[]>('ltx_flf_history', []);
  void currentVideo;
  void history;

  const sessionRef   = useRef<string[]>([]);
  const prevCountRef = useRef(0);

  const { toast } = useToast();
  const { state: execState, lastOutputVideos, outputReadyCount, registerNodeMap } = useComfyExecution();

  const uploadFrame = async (
    file: File,
    setFn: (s: string) => void,
    setPrev: (s: string) => void,
    setUpl: (b: boolean) => void,
  ) => {
    setUpl(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res  = await fetch(`${BACKEND_API.BASE_URL}/api/upload`, { method: 'POST', body: form });
      const data = await res.json();
      if (!data.success) throw new Error(data.detail || 'Upload failed');
      setFn(data.filename);
      setPrev(URL.createObjectURL(file));
    } catch (err: any) { toast(err.message || 'Upload failed', 'error'); }
    finally { setUpl(false); }
  };

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
    setHistory(prev => [...urls, ...prev.filter(u => !urls.includes(u))].slice(0, 40));
  }, [outputReadyCount, lastOutputVideos, isGenerating, pendingPromptId, setHistory]);

  useEffect(() => {
    if (!pendingPromptId) return;
    if (execState === 'error') { setIsGenerating(false); setPendingPromptId(null); return; }
    if (execState !== 'done') return;
    const pid = pendingPromptId;
    setIsGenerating(false);
    setPendingPromptId(null);
    fetch(`${BACKEND_API.BASE_URL}/api/generate/status/${pid}`)
      .then(r => r.json())
      .then(d => {
        if (d.status === 'completed' && d.videos?.length) {
          const urls = d.videos.map((v: any) =>
            `/comfy/view?filename=${encodeURIComponent(v.filename)}&subfolder=${encodeURIComponent(v.subfolder)}&type=${v.type}`
          );
          setCurrentVideo(urls[0]);
          setHistory(prev => [...urls, ...prev.filter(u => !urls.includes(u))].slice(0, 40));
        }
        toast('Video ready', 'success');
      })
      .catch(() => toast('Video ready', 'success'));
  }, [execState, pendingPromptId, toast, setHistory]);

  const handleGenerate = async () => {
    if (!firstFilename || !lastFilename || !prompt.trim() || isGenerating) return;
    sessionRef.current   = [];
    prevCountRef.current = lastOutputVideos?.length ?? 0;
    setCurrentVideo(null);
    setIsGenerating(true);

    fetch(`${BACKEND_API.BASE_URL}/api/workflow/node-map/ltx-flf`)
      .then(r => r.json()).then(d => { if (d.success) registerNodeMap(d.node_map); }).catch(() => {});

    try {
      const res = await fetch(`${BACKEND_API.BASE_URL}${BACKEND_API.ENDPOINTS.GENERATE}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_id: 'ltx-flf',
          params: {
            image_first: firstFilename, image_last: lastFilename,
            prompt: prompt.trim(), aspect_ratio: aspectRatio, direction,
            length_seconds: lengthSec,
            seed: seed === -1 ? Math.floor(Math.random() * 10_000_000_000) : seed,
            guide_strength_first: guideFirst, guide_strength_last: guideLast,
            client_id: (comfyService as any).clientId,
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

  const RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', '3:2', '2:3'];

  return (
    <div className="flex h-full bg-[#080808] overflow-hidden">

      {/* ══ LEFT PANEL ══════════════════════════════════════════════════════ */}
      <div className="flex-1 min-w-0 flex flex-col border-r border-white/[0.04] overflow-y-auto custom-scrollbar">
        <div className="px-5 py-5 space-y-5">

          {/* Keyframes */}
          <div className="space-y-2">
            <p className="text-[9px] font-black uppercase tracking-[0.22em] text-white/20">Keyframes</p>
            <div className="flex gap-2">
              <FrameSlot label="First" preview={firstPreview} uploading={firstUploading}
                onFile={f => uploadFrame(f, setFirstFilename, setFirstPreview, setFirstUploading)} />
              <FrameSlot label="Last" preview={lastPreview} uploading={lastUploading}
                onFile={f => uploadFrame(f, setLastFilename, setLastPreview, setLastUploading)} />
            </div>
            {firstFilename && lastFilename && (
              <p className="text-[8px] text-violet-400/40 font-mono">Both frames ready</p>
            )}
          </div>

          {/* Motion Prompt */}
          <PromptAssistant
            context="ltx-flf"
            value={prompt}
            onChange={setPrompt}
            placeholder="Describe the motion between the two frames…"
            minRows={4}
            accent="violet"
            label="Motion Prompt"
            enableCaption={false}
          />

          {/* Format */}
          <div className="space-y-3">
            <p className="text-[9px] font-black uppercase tracking-[0.22em] text-white/20">Format</p>

            {/* Aspect ratio */}
            <div className="flex flex-wrap gap-1">
              {RATIOS.map(ar => (
                <button key={ar} onClick={() => setAspectRatio(ar)}
                  className={`px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-wider transition-all ${
                    aspectRatio === ar
                      ? 'bg-violet-500/20 border border-violet-500/35 text-violet-300'
                      : 'bg-white/[0.03] border border-white/[0.06] text-white/25 hover:text-white/50'
                  }`}>{ar}
                </button>
              ))}
            </div>

            {/* Direction + Length */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <p className="text-[8px] font-black uppercase tracking-widest text-white/15">Direction</p>
                <div className="flex gap-1">
                  {['Horizontal', 'Vertical'].map(d => (
                    <button key={d} onClick={() => setDirection(d)}
                      className={`flex-1 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-wider transition-all ${
                        direction === d
                          ? 'bg-violet-500/20 border border-violet-500/35 text-violet-300'
                          : 'bg-white/[0.03] border border-white/[0.06] text-white/25 hover:text-white/50'
                      }`}>{d === 'Horizontal' ? 'H' : 'V'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <p className="text-[8px] font-black uppercase tracking-widest text-white/15">Length</p>
                  <span className="text-[8px] font-mono text-violet-400/50">{lengthSec}s</span>
                </div>
                <input type="range" min={2} max={15} step={1} value={lengthSec}
                  onChange={e => setLengthSec(Number(e.target.value))}
                  className="w-full accent-violet-500" />
              </div>
            </div>
          </div>

          {/* Seed + Advanced */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <input type="number" value={seed} onChange={e => setSeed(parseInt(e.target.value))}
                className="flex-1 bg-white/[0.02] border border-white/[0.06] rounded-xl py-2.5 px-3 text-[11px] font-mono text-white/35 focus:border-violet-500/20 outline-none" />
              <button onClick={() => setSeed(-1)}
                className={`p-2.5 rounded-xl border transition-all ${
                  seed === -1
                    ? 'bg-violet-500/10 border-violet-500/30 text-violet-400'
                    : 'bg-white/[0.02] border-white/[0.06] text-white/20 hover:text-white/50'
                }`}>
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            <button onClick={() => setShowAdvanced(v => !v)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-white/[0.02] border border-white/[0.04] text-white/20 hover:text-white/40 transition-colors">
              <span className="text-[8px] font-black uppercase tracking-widest">Guide Strengths</span>
              {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>

            {showAdvanced && (
              <div className="grid grid-cols-2 gap-3 px-1">
                {[
                  { label: 'First Frame', value: guideFirst, set: setGuideFirst },
                  { label: 'Last Frame',  value: guideLast,  set: setGuideLast  },
                ].map(({ label, value, set }) => (
                  <div key={label} className="space-y-1">
                    <div className="flex justify-between">
                      <p className="text-[8px] font-black uppercase tracking-widest text-white/15">{label}</p>
                      <span className="text-[8px] font-mono text-violet-400/50">{value.toFixed(2)}</span>
                    </div>
                    <input type="range" min={0} max={1} step={0.05} value={value}
                      onChange={e => set(Number(e.target.value))} className="w-full accent-violet-500" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Generate */}
          <div className="pb-4">
            <button disabled={!canGenerate} onClick={handleGenerate}
              className={`w-full py-4 rounded-2xl font-black text-[11px] uppercase tracking-[0.35em] transition-all duration-300 flex items-center justify-center gap-3 ${
                canGenerate
                  ? 'bg-violet-500 text-white hover:bg-violet-400 hover:shadow-[0_0_40px_rgba(139,92,246,0.35)] active:scale-[0.98]'
                  : 'bg-white/[0.03] text-white/10 cursor-not-allowed border border-white/[0.04]'
              }`}>
              {isGenerating
                ? <><Loader2 className="w-4 h-4 animate-spin" /><span>Generating…</span></>
                : <><Play className="w-4 h-4" /><span>Generate</span></>
              }
            </button>
            {(!firstFilename || !lastFilename) && (
              <p className="text-center text-[8px] text-white/10 mt-2 uppercase tracking-widest">
                Upload both frames to start
              </p>
            )}
          </div>

        </div>
      </div>

    </div>
  );
};

