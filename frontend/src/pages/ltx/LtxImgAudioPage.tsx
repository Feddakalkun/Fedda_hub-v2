import { useState, useRef, useEffect } from 'react';
import {
  Mic, RefreshCw, Loader2, Play,
  ChevronLeft, ChevronRight, Film, Music, Image as ImageIcon,
} from 'lucide-react';
import { useToast } from '../../components/ui/Toast';
import { BACKEND_API } from '../../config/api';
import { useComfyExecution } from '../../contexts/ComfyExecutionContext';
import { usePersistentState } from '../../hooks/usePersistentState';
import { comfyService } from '../../services/comfyService';

// ── Upload slot (image or audio) ──────────────────────────────────────────────
function UploadSlot({ label, icon: Icon, accept, preview, filename, uploading, onFile }: {
  label: string;
  icon: typeof ImageIcon;
  accept: string;
  preview?: string | null;
  filename: string | null;
  uploading: boolean;
  onFile: (f: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const isImage = accept.includes('image');
  return (
    <div
      onClick={() => ref.current?.click()}
      onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      onDragOver={e => e.preventDefault()}
      className={`relative flex-1 rounded-2xl border-2 border-dashed cursor-pointer transition-all overflow-hidden group ${
        filename ? 'border-violet-500/30 bg-violet-500/5' : 'border-white/8 hover:border-violet-500/30 bg-white/[0.02]'
      }`}
      style={{ minHeight: 140 }}
    >
      {isImage && preview ? (
        <>
          <img src={preview} alt={label} className="w-full h-full object-cover absolute inset-0" />
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center">
            <span className="text-[9px] font-black uppercase tracking-widest text-white/70">Replace</span>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-full py-10 gap-3">
          {uploading
            ? <Loader2 className="w-7 h-7 text-violet-400 animate-spin" />
            : filename
              ? <Icon className="w-7 h-7 text-violet-400/70" />
              : <Icon className="w-7 h-7 text-white/15" />
          }
          {filename ? (
            <div className="text-center px-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-violet-400/60">{label}</p>
              <p className="text-[8px] font-mono text-white/30 truncate max-w-[140px] mt-1">{filename}</p>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-[9px] font-black uppercase tracking-widest text-white/20">
                {uploading ? 'Uploading…' : label}
              </p>
              <p className="text-[8px] text-white/10 mt-0.5">drop or click</p>
            </div>
          )}
        </div>
      )}
      <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-sm">
        <span className="text-[8px] font-black uppercase tracking-widest text-white/40">{label}</span>
      </div>
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export const LtxImgAudioPage = () => {
  const [prompt,        setPrompt]        = usePersistentState('ltx_ia_prompt', 'person speaking naturally, realistic facial movement, lip sync');
  const [audioStart,    setAudioStart]    = usePersistentState('ltx_ia_start', 0);
  const [audioDuration, setAudioDuration] = usePersistentState('ltx_ia_dur', 5);
  const [width,         setWidth]         = usePersistentState('ltx_ia_width', 720);
  const [seed,          setSeed]          = usePersistentState('ltx_ia_seed', -1);
  const [galleryOpen,   setGalleryOpen]   = useState(true);

  const [imageFilename,  setImageFilename]  = useState<string | null>(null);
  const [imagePreview,   setImagePreview]   = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);

  const [audioFilename,  setAudioFilename]  = useState<string | null>(null);
  const [audioUploading, setAudioUploading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);

  const [isGenerating,    setIsGenerating]    = useState(false);
  const [pendingPromptId, setPendingPromptId] = useState<string | null>(null);
  const [currentVideo,    setCurrentVideo]    = useState<string | null>(null);
  const [history, setHistory] = usePersistentState<string[]>('ltx_ia_history', []);

  const sessionRef   = useRef<string[]>([]);
  const prevCountRef = useRef(0);

  const { toast } = useToast();
  const { state: execState, lastOutputVideos, outputReadyCount, registerNodeMap } = useComfyExecution();

  // ── Upload helper ─────────────────────────────────────────────────────────
  const uploadFile = async (
    file: File,
    setFilename: (s: string) => void,
    setUploading: (b: boolean) => void,
    onPreview?: (url: string) => void,
  ) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res  = await fetch(`${BACKEND_API.BASE_URL}/api/upload`, { method: 'POST', body: form });
      const data = await res.json();
      if (!data.success) throw new Error(data.detail || 'Upload failed');
      setFilename(data.filename);
      onPreview?.(URL.createObjectURL(file));
    } catch (err: any) { toast(err.message || 'Upload failed', 'error'); }
    finally { setUploading(false); }
  };

  // Audio preview player
  const toggleAudioPlay = () => {
    if (!audioRef.current) return;
    if (audioPlaying) { audioRef.current.pause(); setAudioPlaying(false); }
    else              { audioRef.current.play();  setAudioPlaying(true);  }
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
    setCurrentVideo(urls[0]);
    setHistory(prev => [...urls, ...prev.filter(u => !urls.includes(u))].slice(0, 40));
  }, [outputReadyCount, lastOutputVideos, isGenerating, pendingPromptId, setHistory]);

  // ── Completion + fallback ─────────────────────────────────────────────────
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
        toast('Lipsync video ready', 'success');
      })
      .catch(() => toast('Lipsync video ready', 'success'));
  }, [execState, pendingPromptId, toast, setHistory]);

  // ── Generate ──────────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!imageFilename || !audioFilename || isGenerating) return;
    sessionRef.current   = [];
    prevCountRef.current = lastOutputVideos?.length ?? 0;
    setCurrentVideo(null);
    setIsGenerating(true);

    fetch(`${BACKEND_API.BASE_URL}/api/workflow/node-map/ltx-img-audio`)
      .then(r => r.json()).then(d => { if (d.success) registerNodeMap(d.node_map); }).catch(() => {});

    try {
      const res = await fetch(`${BACKEND_API.BASE_URL}${BACKEND_API.ENDPOINTS.GENERATE}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_id: 'ltx-img-audio',
          params: {
            image:          imageFilename,
            audio:          audioFilename,
            audio_start:    audioStart,
            audio_duration: audioDuration,
            prompt:         prompt.trim(),
            width:          width,
            seed:           seed === -1 ? Math.floor(Math.random() * 10_000_000_000) : seed,
            client_id:      (comfyService as any).clientId,
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

  const canGenerate = !!imageFilename && !!audioFilename && !isGenerating;

  return (
    <div className="flex h-full bg-[#080808] overflow-hidden">

      {/* ══ LEFT PANEL ══════════════════════════════════════════════════════ */}
      <div className="w-[440px] shrink-0 flex flex-col border-r border-white/5 overflow-y-auto custom-scrollbar">
        <div className="px-7 py-7 space-y-7">

          {/* Header */}
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4 text-violet-400" />
            <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40">LTX 2.3 — Img + Audio Lipsync</h2>
          </div>

          {/* ── INPUTS ── */}
          <div className="space-y-2">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Inputs</p>
            <div className="flex gap-3" style={{ minHeight: 160 }}>
              <UploadSlot label="Reference Image" icon={ImageIcon} accept="image/*"
                preview={imagePreview} filename={imageFilename} uploading={imageUploading}
                onFile={f => uploadFile(f, setImageFilename, setImageUploading, setImagePreview)} />
              <UploadSlot label="Audio File" icon={Music} accept="audio/*"
                filename={audioFilename} uploading={audioUploading}
                onFile={f => {
                  uploadFile(f, setAudioFilename, setAudioUploading);
                  if (audioRef.current) audioRef.current.src = URL.createObjectURL(f);
                }} />
            </div>

            {/* Audio mini-player */}
            {audioFilename && (
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-black/30 border border-white/5">
                <button onClick={toggleAudioPlay}
                  className="w-7 h-7 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center text-violet-400 hover:bg-violet-500/30 transition-all flex-shrink-0">
                  {audioPlaying
                    ? <span className="w-2.5 h-2.5 flex gap-0.5"><span className="flex-1 bg-violet-400 rounded-sm"/><span className="flex-1 bg-violet-400 rounded-sm"/></span>
                    : <Play className="w-3 h-3 ml-0.5" />
                  }
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-[8px] font-mono text-white/30 truncate">{audioFilename}</p>
                  <div className="h-1 bg-white/5 rounded-full mt-1">
                    <div className="h-full bg-violet-500/40 rounded-full" style={{ width: '60%' }} />
                  </div>
                </div>
                <audio ref={audioRef} onEnded={() => setAudioPlaying(false)} className="hidden" />
              </div>
            )}
          </div>

          <div className="h-px bg-white/5" />

          {/* ── PROMPT ── */}
          <div className="space-y-2">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Motion Prompt</p>
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
              placeholder="Describe the facial motion and speaking style…"
              rows={3}
              className="w-full bg-black/30 border border-white/5 rounded-2xl p-4 text-sm text-white/90 placeholder-white/15 resize-none focus:outline-none focus:border-violet-500/20 transition-all" />
          </div>

          <div className="h-px bg-white/5" />

          {/* ── AUDIO TIMING ── */}
          <div className="space-y-3">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Audio Timing</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-600">
                  Start — <span className="text-violet-400/60 font-mono">{audioStart}s</span>
                </p>
                <input type="range" min={0} max={60} step={0.5} value={audioStart}
                  onChange={e => setAudioStart(Number(e.target.value))}
                  className="w-full accent-violet-500" />
              </div>
              <div className="space-y-1.5">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-600">
                  Duration — <span className="text-violet-400/60 font-mono">{audioDuration}s</span>
                </p>
                <input type="range" min={1} max={30} step={0.5} value={audioDuration}
                  onChange={e => setAudioDuration(Number(e.target.value))}
                  className="w-full accent-violet-500" />
              </div>
            </div>
          </div>

          <div className="h-px bg-white/5" />

          {/* ── VIDEO WIDTH ── */}
          <div className="space-y-2">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">
              Video Width — <span className="text-violet-400/60 font-mono">{width}px</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {[512, 720, 1024, 1280].map(w => (
                <button key={w} onClick={() => setWidth(w)}
                  className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all ${
                    width === w
                      ? 'bg-violet-500/20 border border-violet-500/40 text-violet-300'
                      : 'bg-white/[0.03] border border-white/5 text-white/30 hover:text-white/50 hover:bg-white/[0.06]'
                  }`}>{w}px</button>
              ))}
            </div>
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
            <button disabled={!canGenerate} onClick={handleGenerate}
              className={`w-full py-5 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] transition-all duration-500 flex items-center justify-center gap-3 ${
                canGenerate
                  ? 'bg-violet-600 text-white hover:bg-violet-500 hover:shadow-[0_0_50px_rgba(139,92,246,0.4)]'
                  : 'bg-white/5 text-white/10 cursor-not-allowed'
              }`}>
              {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
              <span>{isGenerating ? 'Generating…' : 'Generate Lipsync'}</span>
            </button>
            {!imageFilename && <p className="text-center text-[8px] text-white/15 mt-2 uppercase tracking-widest">Upload image + audio to start</p>}
          </div>

        </div>
      </div>

      {/* ══ OUTPUT ══════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#050505]">
        <div className="h-12 shrink-0 flex items-center justify-between px-6 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Play className="w-3.5 h-3.5 text-violet-400/60" />
            <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white/30">Output</span>
          </div>
          {isGenerating && (
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
              <span className="text-[9px] font-mono text-violet-400/60">Generating lipsync…</span>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
          {currentVideo ? (
            <div className="rounded-2xl overflow-hidden border border-violet-500/20 bg-black/60">
              <video key={currentVideo} src={currentVideo} className="w-full" autoPlay loop playsInline controls />
            </div>
          ) : isGenerating ? (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
              <div className="relative">
                <div className="w-16 h-16 rounded-full border border-violet-500/20 flex items-center justify-center">
                  <Mic className="w-7 h-7 text-violet-400/60 animate-pulse" />
                </div>
                <div className="absolute inset-0 rounded-full border border-violet-500/10 animate-ping" />
              </div>
              <p className="text-[10px] font-black uppercase tracking-widest text-white/20">Syncing lips to audio…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 gap-3 opacity-30">
              <Mic className="w-10 h-10 text-white/10" />
              <p className="text-[10px] font-black uppercase tracking-widest text-white/20">Upload image + audio and generate</p>
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
                <button key={url + i} onClick={() => setCurrentVideo(url)}
                  className={`w-full aspect-video rounded-xl overflow-hidden border-2 transition-all hover:opacity-90 ${
                    currentVideo === url ? 'border-violet-500/70 shadow-[0_0_16px_rgba(139,92,246,0.25)]' : 'border-white/5 hover:border-white/20'
                  }`}>
                  <video src={url} className="w-full h-full object-cover" muted playsInline />
                </button>
              ))
            )}
          </div>
        )}
      </div>

    </div>
  );
};
