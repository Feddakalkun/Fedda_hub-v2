import { useState, useEffect, useRef } from 'react';
import {
  Video, Upload, RefreshCw, Film, Loader2,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Check,
} from 'lucide-react';
import { useToast } from '../../components/ui/Toast';
import { BACKEND_API } from '../../config/api';
import { useComfyExecution } from '../../contexts/ComfyExecutionContext';
import { usePersistentState } from '../../hooks/usePersistentState';
import { comfyService } from '../../services/comfyService';
import { PromptAssistant } from '../../components/ui/PromptAssistant';

const SCENE_COUNT = 3;

// ── Scene slot ────────────────────────────────────────────────────────────────
function SceneSlot({ index, url, isActive, isPending }: {
  index: number; url?: string; isActive: boolean; isPending: boolean;
}) {
  return (
    <div className={`rounded-xl overflow-hidden border transition-all duration-500 ${
      url ? 'border-violet-500/30 bg-black/60' :
      isActive ? 'border-violet-500/20 bg-white/[0.03]' : 'border-white/5 bg-white/[0.02]'
    }`}>
      {url ? (
        <video src={url} className="w-full aspect-video object-cover" autoPlay loop muted playsInline />
      ) : (
        <div className="w-full aspect-video flex items-center justify-center">
          {isPending ? <Loader2 className="w-5 h-5 text-violet-400/60 animate-spin" /> : <Film className="w-5 h-5 text-white/10" />}
        </div>
      )}
      <div className="px-3 py-1.5 flex items-center justify-between">
        <span className="text-[8px] font-black uppercase tracking-widest text-white/30">Scene {index + 1}</span>
        {url && (
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-violet-400/60 animate-pulse" />
            <span className="text-[7px] font-mono text-violet-400/40">live</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export const Wan22Img2Vid = () => {
  const [prompt1, setPrompt1] = usePersistentState('wan22i2v_p1', '');
  const [prompt2, setPrompt2] = usePersistentState('wan22i2v_p2', '');
  const [prompt3, setPrompt3] = usePersistentState('wan22i2v_p3', '');
  const [frameCount, setFrameCount] = usePersistentState('wan22i2v_frames', 81);
  const [seed, setSeed]             = usePersistentState('wan22i2v_seed', -1);

  const [expanded, setExpanded] = useState<boolean[]>([true, true, true]);
  const toggleExpand = (i: number) => setExpanded(prev => prev.map((v, idx) => idx === i ? !v : v));

  const [uploadedImage,     setUploadedImage]     = useState<string | null>(null);
  const [uploadedImageName, setUploadedImageName] = useState<string | null>(null);
  const [uploading,         setUploading]         = useState(false);

  const [isGenerating,    setIsGenerating]    = useState(false);
  const [pendingPromptId, setPendingPromptId] = useState<string | null>(null);
  const [sessionVideos,   setSessionVideos]   = useState<string[]>([]);
  const [history, setHistory] = usePersistentState<string[]>('wan22i2v_history', []);
  const [galleryOpen, setGalleryOpen] = useState(true);

  const fileInputRef  = useRef<HTMLInputElement>(null);
  const sessionRef    = useRef<string[]>([]);
  const prevCountRef  = useRef(0);

  const { toast } = useToast();
  const { state: execState, lastOutputVideos, outputReadyCount, registerNodeMap } = useComfyExecution();

  // ── Upload ────────────────────────────────────────────────────────────────
  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res  = await fetch(`${BACKEND_API.BASE_URL}/api/upload`, { method: 'POST', body: form });
      const data = await res.json();
      if (!data.success) throw new Error(data.detail || 'Upload failed');
      setUploadedImageName(data.filename);
      setUploadedImage(URL.createObjectURL(file));
    } catch (err: any) { toast(err.message || 'Upload failed', 'error'); }
    finally { setUploading(false); }
  };

  // ── Stream videos ─────────────────────────────────────────────────────────
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
    setSessionVideos([...sessionRef.current]);
    setHistory(prev => [...urls, ...prev.filter(u => !urls.includes(u))].slice(0, 40));
  }, [outputReadyCount, lastOutputVideos, isGenerating, pendingPromptId, setHistory]);

  // ── Completion ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pendingPromptId) return;
    if (execState === 'done') {
      setIsGenerating(false);
      setPendingPromptId(null);
      toast(`Done — ${sessionRef.current.length} video${sessionRef.current.length !== 1 ? 's' : ''} generated`, 'success');
    }
    if (execState === 'error') { setIsGenerating(false); setPendingPromptId(null); }
  }, [execState, pendingPromptId, toast]);

  // ── Generate ──────────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!uploadedImageName || !prompt1.trim() || isGenerating) return;
    sessionRef.current   = [];
    prevCountRef.current = lastOutputVideos?.length ?? 0;
    setSessionVideos([]);
    setIsGenerating(true);

    fetch(`${BACKEND_API.BASE_URL}/api/workflow/node-map/wan22-img2vid`)
      .then(r => r.json()).then(d => { if (d.success) registerNodeMap(d.node_map); }).catch(() => {});

    try {
      const res = await fetch(`${BACKEND_API.BASE_URL}${BACKEND_API.ENDPOINTS.GENERATE}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_id: 'wan22-img2vid',
          params: {
            image:       uploadedImageName,
            frame_count: frameCount,
            prompt1:     prompt1.trim(),
            prompt2:     prompt2.trim() || prompt1.trim(),
            prompt3:     prompt3.trim() || prompt1.trim(),
            seed:        seed === -1 ? Math.floor(Math.random() * 10_000_000_000) : seed,
            client_id:   (comfyService as any).clientId,
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

  const prompts = [
    { label: 'Scene 1', value: prompt1, set: setPrompt1 },
    { label: 'Scene 2', value: prompt2, set: setPrompt2 },
    { label: 'Scene 3', value: prompt3, set: setPrompt3 },
  ];

  return (
    <div className="flex h-full bg-[#080808] overflow-hidden">

      {/* ══ LEFT PANEL ══════════════════════════════════════════════════════ */}
      <div className="w-[440px] shrink-0 flex flex-col border-r border-white/5 overflow-y-auto custom-scrollbar">
        <div className="px-7 py-7 space-y-7">

          {/* Header */}
          <div className="flex items-center gap-2">
            <Video className="w-4 h-4 text-violet-400" />
            <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40">WAN 2.2 — Img2Vid</h2>
          </div>

          {/* ── IMAGE UPLOAD ── */}
          {!uploadedImage ? (
            <div
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) handleUpload(f); }}
              onDragOver={e => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="cursor-pointer rounded-2xl border-2 border-dashed border-white/10 hover:border-violet-500/40 bg-white/[0.02] hover:bg-white/[0.04] transition-all"
            >
              <div className="flex flex-col items-center py-14 gap-3">
                {uploading ? <Loader2 className="w-9 h-9 text-violet-400 animate-spin" /> : <Upload className="w-9 h-9 text-white/15" />}
                <div className="text-center">
                  <p className="text-sm font-bold text-white/25">{uploading ? 'Uploading...' : 'Drop image here'}</p>
                  <p className="text-xs text-white/15 mt-0.5">or click to browse</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="relative rounded-2xl overflow-hidden border border-white/5 group cursor-pointer"
              onClick={() => fileInputRef.current?.click()}>
              <img src={uploadedImage} alt="Input" className="w-full max-h-[260px] object-contain" />
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center gap-2">
                <span className="text-[9px] font-black uppercase tracking-widest text-white/70">Replace</span>
              </div>
              <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                <span className="text-[8px] font-mono bg-black/60 backdrop-blur-sm rounded px-1.5 py-0.5 text-white/40">{uploadedImageName}</span>
              </div>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
            onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])} />

          {/* ── FRAME COUNT ── */}
          <div className="bg-black/30 rounded-xl border border-white/5 p-3 space-y-2">
            <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-widest text-slate-600">
              <span>Frame Count</span>
              <span className="font-mono text-violet-400/60">{frameCount}f · {(frameCount / 24).toFixed(1)}s</span>
            </div>
            <input type="range" min={17} max={161} step={8} value={frameCount}
              onChange={e => setFrameCount(Number(e.target.value))}
              className="w-full accent-violet-500" />
            <div className="flex justify-between text-[8px] font-mono text-slate-600">
              <span>17f · 0.7s</span>
              <span className="text-white/15">81f · 3.4s</span>
              <span>161f · 6.7s</span>
            </div>
          </div>

          <div className="h-px bg-white/5" />

          {/* ── 3 SCENE PROMPTS ── */}
          <div className="space-y-2">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Scene Expansions</p>
            {prompts.map(({ label, value, set }, i) => (
              <div key={i} className={`rounded-xl border transition-all ${value.trim() ? 'border-violet-500/20 bg-violet-500/5' : 'border-white/5 bg-white/[0.02]'}`}>
                <button onClick={() => toggleExpand(i)}
                  className="w-full flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${value.trim() ? 'bg-violet-400' : 'bg-white/10'}`} />
                    <span className="text-[10px] font-black uppercase tracking-widest text-white/50">{label}</span>
                    {i > 0 && !value.trim() && <span className="text-[8px] text-white/20 font-mono">→ uses Scene 1</span>}
                    {value.trim() && <span className="text-[8px] text-violet-400/50 truncate max-w-[140px]">{value.slice(0, 30)}{value.length > 30 ? '…' : ''}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {value.trim() && <Check className="w-3 h-3 text-violet-400" />}
                    {expanded[i] ? <ChevronUp className="w-3 h-3 text-white/20" /> : <ChevronDown className="w-3 h-3 text-white/20" />}
                  </div>
                </button>
                {expanded[i] && (
                  <div className="px-4 pb-3">
                    <PromptAssistant
                      context="wan-scene"
                      accent="violet"
                      compact
                      value={value}
                      onChange={set}
                      placeholder={i === 0 ? 'Describe the motion / action...' : 'Leave empty to reuse Scene 1'}
                      minRows={3}
                      enableCaption={false}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="h-px bg-white/5" />

          {/* ── SEED ── */}
          <div className="flex gap-1.5">
            <input type="number" value={seed} onChange={e => setSeed(parseInt(e.target.value))}
              className="flex-1 bg-white/[0.02] border border-white/5 rounded-xl py-3 px-3 text-xs font-mono focus:border-violet-500/20 outline-none text-white/40" />
            <button onClick={() => setSeed(-1)}
              className={`p-3 rounded-xl border transition-all ${seed === -1 ? 'bg-violet-500/10 border-violet-500/30 text-violet-400' : 'bg-white/[0.02] border-white/5 text-slate-500'}`}>
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* ── GENERATE ── */}
          <div className="pb-6">
            <button disabled={!uploadedImageName || !prompt1.trim() || isGenerating}
              onClick={handleGenerate}
              className={`w-full py-5 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] transition-all duration-500 flex items-center justify-center gap-3 ${
                !uploadedImageName || !prompt1.trim() || isGenerating
                  ? 'bg-white/5 text-white/10 cursor-not-allowed'
                  : 'bg-violet-600 text-white hover:bg-violet-500 hover:shadow-[0_0_50px_rgba(139,92,246,0.4)]'
              }`}>
              {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />}
              <span>{isGenerating ? 'Generating...' : 'Generate'}</span>
            </button>
          </div>

        </div>
      </div>

      {/* ══ SCENE OUTPUT ════════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#050505]">
        <div className="h-12 shrink-0 flex items-center justify-between px-6 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Film className="w-3.5 h-3.5 text-violet-400/60" />
            <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white/30">Scene Output</span>
          </div>
          {isGenerating && (
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
              <span className="text-[9px] font-mono text-violet-400/60">{sessionVideos.length}/{SCENE_COUNT} scenes</span>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-5">
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: SCENE_COUNT }).map((_, i) => (
              <SceneSlot key={i} index={i} url={sessionVideos[i]}
                isActive={isGenerating} isPending={isGenerating && !sessionVideos[i]} />
            ))}
          </div>

          {!isGenerating && sessionVideos.length === 0 && (
            <div className="flex flex-col items-center justify-center h-48 gap-3 opacity-30">
              <Video className="w-8 h-8 text-white/20" />
              <p className="text-xs font-black uppercase tracking-widest text-white/20">Upload an image and generate</p>
            </div>
          )}
        </div>
      </div>

      {/* ══ COLLAPSIBLE GALLERY ═════════════════════════════════════════════ */}
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
                <Film className="w-5 h-5 text-white/20" />
                <span className="text-[8px] text-white/20 font-black uppercase tracking-widest">Empty</span>
              </div>
            ) : (
              history.map((url, i) => (
                <div key={url + i} className="w-full aspect-video rounded-xl overflow-hidden border border-white/5 hover:border-white/20 transition-all bg-black/40">
                  <video src={url} className="w-full h-full object-cover" muted playsInline />
                </div>
              ))
            )}
          </div>
        )}
      </div>

    </div>
  );
};
