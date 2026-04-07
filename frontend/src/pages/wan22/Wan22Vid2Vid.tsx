import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Video, Upload, RefreshCw, Film, Loader2,
  Play, Pause, Zap, ZapOff, ChevronDown, ChevronUp, Check, ChevronLeft, ChevronRight, FlameKindling,
} from 'lucide-react';
import { useToast } from '../../components/ui/Toast';
import { BACKEND_API } from '../../config/api';
import { useComfyExecution } from '../../contexts/ComfyExecutionContext';
import { usePersistentState } from '../../hooks/usePersistentState';
import { comfyService } from '../../services/comfyService';
import { PromptAssistant } from '../../components/ui/PromptAssistant';

const FPS = 24;
const SCENE_COUNT = 4;

// ── Scene slot component ──────────────────────────────────────────────────────
function SceneSlot({
  index, url, isActive, isPending,
}: { index: number; url?: string; isActive: boolean; isPending: boolean }) {
  const label = `Scene ${index + 1}`;
  return (
    <div className={`rounded-xl overflow-hidden border transition-all duration-500 ${
      url ? 'border-violet-500/30 bg-black/60' :
      isActive ? 'border-violet-500/20 bg-white/[0.03]' :
      'border-white/5 bg-white/[0.02]'
    }`}>
      {url ? (
        <video
          src={url}
          className="w-full aspect-video object-cover"
          autoPlay
          loop
          muted
          playsInline
        />
      ) : (
        <div className="w-full aspect-video flex flex-col items-center justify-center gap-2">
          {isPending ? (
            <Loader2 className="w-5 h-5 text-violet-400/60 animate-spin" />
          ) : (
            <Film className="w-5 h-5 text-white/10" />
          )}
        </div>
      )}
      <div className="px-3 py-1.5 flex items-center justify-between">
        <span className="text-[8px] font-black uppercase tracking-widest text-white/30">{label}</span>
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

export const Wan22Vid2Vid = () => {
  const [prompt1, setPrompt1] = usePersistentState('wan22v2v_p1', '');
  const [prompt2, setPrompt2] = usePersistentState('wan22v2v_p2', '');
  const [prompt3, setPrompt3] = usePersistentState('wan22v2v_p3', '');
  const [prompt4, setPrompt4] = usePersistentState('wan22v2v_p4', '');
  const [seed, setSeed]       = usePersistentState('wan22v2v_seed', -1);
  const [slowMotion, setSlowMotion] = usePersistentState('wan22v2v_slowmo', true);
  const [nsfw, setNsfw]             = usePersistentState('wan22v2v_nsfw', true);
  const [aspectRatio, setAspectRatio] = usePersistentState('wan22v2v_ar', '16:9');
  const [direction, setDirection]     = usePersistentState('wan22v2v_dir', 'Vertical');
  const [cropMethod, setCropMethod]   = usePersistentState('wan22v2v_crop', 'Stretch');

  // Which scene prompt panels are expanded
  const [expanded, setExpanded] = useState<boolean[]>([true, true, true, true]);
  const toggleExpand = (i: number) =>
    setExpanded(prev => prev.map((v, idx) => idx === i ? !v : v));

  // Video upload + clip state
  const [uploadedVideo, setUploadedVideo]         = useState<string | null>(null);
  const [uploadedVideoName, setUploadedVideoName] = useState<string | null>(null);
  const [uploading, setUploading]                 = useState(false);
  const [isPlaying, setIsPlaying]                 = useState(false);
  const [videoDuration, setVideoDuration]         = useState(0);
  const [currentTime, setCurrentTime]             = useState(0);
  const [inPoint, setInPoint]                     = useState(0);
  const [outPoint, setOutPoint]                   = useState(0);

  // Generation state
  const [isGenerating, setIsGenerating]       = useState(false);
  const [pendingPromptId, setPendingPromptId] = useState<string | null>(null);
  const [sessionVideos, setSessionVideos]     = useState<string[]>([]);
  const [history, setHistory]                 = usePersistentState<string[]>('wan22v2v_history', []);
  const [galleryOpen, setGalleryOpen]         = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef     = useRef<HTMLVideoElement>(null);
  const trackRef     = useRef<HTMLDivElement>(null);
  const dragging     = useRef<'in' | 'out' | null>(null);
  const sessionRef   = useRef<string[]>([]);

  const { toast } = useToast();
  const {
    state: execState,
    lastOutputVideos,
    outputReadyCount,
    registerNodeMap,
  } = useComfyExecution();

  const totalFrames = Math.max(1, Math.floor(videoDuration * FPS));
  const inFrame     = Math.round(inPoint * FPS);
  const outFrame    = Math.round(outPoint * FPS);
  const clipFrames  = Math.max(1, outFrame - inFrame);

  // ── Track new videos arriving during current session ─────────────────────
  const prevCountRef = useRef(0);
  useEffect(() => {
    if (!isGenerating && !pendingPromptId) return;
    if (!lastOutputVideos?.length) return;
    const newVids = lastOutputVideos.slice(prevCountRef.current);
    if (newVids.length === 0) return;
    prevCountRef.current = lastOutputVideos.length;
    const urls = newVids.map(v =>
      `/comfy/view?filename=${encodeURIComponent(v.filename)}&subfolder=${encodeURIComponent(v.subfolder)}&type=${v.type}`
    );
    sessionRef.current = [...sessionRef.current, ...urls];
    setSessionVideos([...sessionRef.current]);
    setHistory(prev => [...urls, ...prev].slice(0, 40));
  }, [outputReadyCount, lastOutputVideos, isGenerating, pendingPromptId]);

  // ── Detect completion via execState 'done' (full workflow finished) ─────────
  useEffect(() => {
    if (!pendingPromptId) return;
    if (execState === 'done') {
      setIsGenerating(false);
      setPendingPromptId(null);
      toast(`Done — ${sessionRef.current.length} video${sessionRef.current.length !== 1 ? 's' : ''} generated`, 'success');
    }
    if (execState === 'error') {
      setIsGenerating(false);
      setPendingPromptId(null);
    }
  }, [execState, pendingPromptId, toast]);

  // ── Upload ────────────────────────────────────────────────────────────────
  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${BACKEND_API.BASE_URL}/api/upload`, { method: 'POST', body: form });
      const data = await res.json();
      if (!data.success) throw new Error(data.detail || 'Upload failed');
      setUploadedVideoName(data.filename);
      setUploadedVideo(URL.createObjectURL(file));
    } catch (err: any) {
      toast(err.message || 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  // ── Video player ──────────────────────────────────────────────────────────
  const onVideoLoaded = () => {
    const dur = videoRef.current?.duration || 0;
    setVideoDuration(dur);
    setInPoint(0);
    setOutPoint(Math.min(dur, 77 / FPS));
  };
  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setIsPlaying(true); }
    else          { v.pause(); setIsPlaying(false); }
  };

  // ── Clip drag ─────────────────────────────────────────────────────────────
  const getSeconds = useCallback((e: MouseEvent | React.MouseEvent) => {
    const t = trackRef.current;
    if (!t || videoDuration === 0) return 0;
    const r = t.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * videoDuration;
  }, [videoDuration]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const s = getSeconds(e);
      if (dragging.current === 'in')  setInPoint(Math.min(s, outPoint - 1 / FPS));
      else                             setOutPoint(Math.max(s, inPoint  + 1 / FPS));
      if (videoRef.current) videoRef.current.currentTime = s;
    };
    const onUp = () => { dragging.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [inPoint, outPoint, getSeconds]);

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const inPct   = videoDuration > 0 ? (inPoint    / videoDuration) * 100 : 0;
  const outPct  = videoDuration > 0 ? (outPoint   / videoDuration) * 100 : 100;
  const playPct = videoDuration > 0 ? (currentTime / videoDuration) * 100 : 0;

  // ── Generate ──────────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!uploadedVideoName || !prompt1.trim() || isGenerating) return;

    // Reset session
    sessionRef.current = [];
    prevCountRef.current = lastOutputVideos?.length ?? 0;
    setSessionVideos([]);
    setIsGenerating(true);

    // Pre-fetch node map
    fetch(`${BACKEND_API.BASE_URL}/api/workflow/node-map/wan22-vid2vid`)
      .then(r => r.json()).then(d => { if (d.success) registerNodeMap(d.node_map); }).catch(() => {});

    try {
      const res = await fetch(`${BACKEND_API.BASE_URL}${BACKEND_API.ENDPOINTS.GENERATE}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_id: 'wan22-vid2vid',
          params: {
            video: uploadedVideoName,
            skip_first_frames: inFrame,
            frame_load_cap: clipFrames,
            prompt1: prompt1.trim(),
            prompt2: prompt2.trim() || prompt1.trim(),
            prompt3: prompt3.trim() || prompt1.trim(),
            prompt4: prompt4.trim() || prompt1.trim(),
            seed: seed === -1 ? Math.floor(Math.random() * 10_000_000_000) : seed,
            client_id: (comfyService as any).clientId,
            // Slow motion toggle: set save_output on all 5 slow-motion VHS nodes
            slow_motion_1: slowMotion,
            slow_motion_2: slowMotion,
            slow_motion_3: slowMotion,
            slow_motion_4: slowMotion,
            slow_motion_5: slowMotion,
            nsfw,
            aspect_ratio: aspectRatio,
            direction: direction,
            crop_method: cropMethod,
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
    { label: 'Scene 4', value: prompt4, set: setPrompt4 },
  ];

  return (
    <div className="flex h-full bg-[#080808] overflow-hidden">

      {/* ══════════ LEFT: PARAMS ══════════ */}
      <div className="w-[380px] shrink-0 flex flex-col border-r border-white/5 overflow-y-auto custom-scrollbar">
        <div className="px-5 py-5 space-y-5">

          {/* Header */}
          <div className="flex items-center gap-2">
            <Video className="w-4 h-4 text-violet-400" />
            <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40">WAN 2.2 — Vid2Vid</h2>
          </div>

          {/* ── VIDEO UPLOAD / PLAYER ── */}
          {!uploadedVideo ? (
            <div
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('video/')) handleUpload(f); }}
              onDragOver={e => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="cursor-pointer rounded-2xl border-2 border-dashed border-white/10 hover:border-violet-500/40 bg-white/[0.02] hover:bg-white/[0.04] transition-all"
            >
              <div className="flex flex-col items-center py-14 gap-3">
                {uploading ? <Loader2 className="w-9 h-9 text-violet-400 animate-spin" /> : <Upload className="w-9 h-9 text-white/15" />}
                <div className="text-center">
                  <p className="text-sm font-bold text-white/25">{uploading ? 'Uploading...' : 'Drop video here'}</p>
                  <p className="text-xs text-white/15 mt-0.5">or click to browse</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Player */}
              <div className="relative rounded-2xl overflow-hidden bg-black border border-white/5 group cursor-pointer" onClick={togglePlay}>
                <video ref={videoRef} src={uploadedVideo} className="w-full max-h-[260px] object-contain"
                  onLoadedMetadata={onVideoLoaded}
                  onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
                  onEnded={() => setIsPlaying(false)} />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className={`w-12 h-12 rounded-full bg-black/60 backdrop-blur-sm border border-white/20 flex items-center justify-center text-white transition-all ${isPlaying ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}>
                    {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                  </div>
                </div>
                <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                  <span className="text-[8px] font-mono bg-black/60 backdrop-blur-sm rounded px-1.5 py-0.5 text-white/40">{uploadedVideoName}</span>
                  <button onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
                    className="text-[8px] font-black uppercase tracking-widest bg-black/60 backdrop-blur-sm rounded px-1.5 py-0.5 text-white/30 hover:text-white/70 transition-colors opacity-0 group-hover:opacity-100">
                    Replace
                  </button>
                </div>
              </div>

              {/* Clip selector */}
              <div className="bg-black/30 rounded-xl border border-white/5 p-3 space-y-2">
                <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-widest text-slate-600">
                  <span>Clip Selection</span>
                  <span className="font-mono text-violet-400/60">{clipFrames}f · {(clipFrames / FPS).toFixed(1)}s</span>
                </div>

                {/* Timeline */}
                <div ref={trackRef} className="relative h-6 cursor-crosshair select-none"
                  onClick={e => { if (!dragging.current && videoRef.current) videoRef.current.currentTime = getSeconds(e); }}>
                  <div className="absolute inset-y-0 left-0 right-0 my-auto h-1 bg-white/5 rounded-full" />
                  <div className="absolute inset-y-0 my-auto h-1 bg-violet-500/40 rounded-full pointer-events-none"
                    style={{ left: `${inPct}%`, width: `${outPct - inPct}%` }} />
                  <div className="absolute inset-y-0 my-auto w-px bg-white/20 pointer-events-none" style={{ left: `${playPct}%` }} />
                  {/* IN handle */}
                  <div onMouseDown={e => { e.preventDefault(); dragging.current = 'in'; }}
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-violet-400 border-2 border-[#080808] shadow-lg cursor-ew-resize hover:scale-125 transition-transform z-10"
                    style={{ left: `${inPct}%` }} />
                  {/* OUT handle */}
                  <div onMouseDown={e => { e.preventDefault(); dragging.current = 'out'; }}
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-violet-200 border-2 border-[#080808] shadow-lg cursor-ew-resize hover:scale-125 transition-transform z-10"
                    style={{ left: `${outPct}%` }} />
                </div>

                <div className="flex justify-between text-[8px] font-mono text-slate-600">
                  <span>IN {fmtTime(inPoint)} f{inFrame}</span>
                  <span className="text-white/15">{fmtTime(videoDuration)}</span>
                  <span>OUT {fmtTime(outPoint)} f{outFrame}</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-[8px] uppercase tracking-widest text-slate-700 mb-1">Skip frames</p>
                    <input type="number" min="0" max={totalFrames - 1} value={inFrame}
                      onChange={e => setInPoint(Number(e.target.value) / FPS)}
                      className="w-full bg-black/40 border border-white/5 rounded-lg px-2 py-1.5 text-xs font-mono text-violet-300 focus:border-violet-500/30 outline-none" />
                  </div>
                  <div>
                    <p className="text-[8px] uppercase tracking-widest text-slate-700 mb-1">Clip length (frames)</p>
                    <input type="number" min="1" max={totalFrames} value={clipFrames}
                      onChange={e => setOutPoint(inPoint + Number(e.target.value) / FPS)}
                      className="w-full bg-black/40 border border-white/5 rounded-lg px-2 py-1.5 text-xs font-mono text-violet-300 focus:border-violet-500/30 outline-none" />
                  </div>
                </div>
              </div>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="video/*" className="hidden"
            onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])} />

          <div className="h-px bg-white/5" />

          {/* ── RESIZE OPTIONS ── */}
          <div className="space-y-3">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Output Resize</p>

            {/* Aspect Ratio */}
            <div className="space-y-1.5">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-600">Aspect Ratio</p>
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
            </div>

            {/* Direction + Crop Method side by side */}
            <div className="grid grid-cols-2 gap-3">
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
              <div className="space-y-1.5">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-600">Crop Method</p>
                <div className="flex gap-1.5">
                  {['Stretch','Crop','Pad'].map(c => (
                    <button key={c} onClick={() => setCropMethod(c)}
                      className={`flex-1 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all ${
                        cropMethod === c
                          ? 'bg-violet-500/20 border border-violet-500/40 text-violet-300'
                          : 'bg-white/[0.03] border border-white/5 text-white/30 hover:text-white/50'
                      }`}>{c}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="h-px bg-white/5" />

          {/* ── 4 SCENE PROMPTS ── */}
          <div className="space-y-2">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Scene Expansions</p>
            {prompts.map(({ label, value, set }, i) => (
              <div key={i} className={`rounded-xl border transition-all ${value.trim() ? 'border-violet-500/20 bg-violet-500/5' : 'border-white/5 bg-white/[0.02]'}`}>
                <button
                  onClick={() => toggleExpand(i)}
                  className="w-full flex items-center justify-between px-4 py-3"
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${value.trim() ? 'bg-violet-400' : 'bg-white/10'}`} />
                    <span className="text-[10px] font-black uppercase tracking-widest text-white/50">{label}</span>
                    {i > 0 && !value.trim() && (
                      <span className="text-[8px] text-white/20 font-mono">→ uses Scene 1</span>
                    )}
                    {value.trim() && (
                      <span className="text-[8px] text-violet-400/50 truncate max-w-[140px]">{value.slice(0, 30)}{value.length > 30 ? '…' : ''}</span>
                    )}
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
                      compact={i > 0}
                      value={value}
                      onChange={set}
                      placeholder={i === 0 ? 'Describe the motion / action...' : 'Leave empty to reuse Scene 1'}
                      minRows={i === 0 ? 4 : 3}
                      enableCaption={false}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="h-px bg-white/5" />

          {/* ── SLOW MOTION + NSFW + SEED ── */}
          <div className="space-y-2">
            <div className="flex gap-2">
              {/* Slow motion toggle */}
              <button
                onClick={() => setSlowMotion(!slowMotion)}
                className={`flex-1 flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all ${
                  slowMotion
                    ? 'bg-violet-500/10 border-violet-500/30 text-violet-300'
                    : 'bg-white/[0.02] border-white/5 text-slate-500'
                }`}
              >
                <div className="flex items-center gap-2">
                  {slowMotion ? <Zap className="w-3 h-3" /> : <ZapOff className="w-3 h-3" />}
                  <span className="text-[9px] font-black uppercase tracking-widest">Slo-Mo</span>
                </div>
                <div className={`w-7 h-3.5 rounded-full transition-all relative ${slowMotion ? 'bg-violet-500' : 'bg-white/10'}`}>
                  <div className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-all ${slowMotion ? 'left-3.5' : 'left-0.5'}`} />
                </div>
              </button>

              {/* NSFW toggle */}
              <button
                onClick={() => setNsfw(!nsfw)}
                className={`flex-1 flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all ${
                  nsfw
                    ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                    : 'bg-white/[0.02] border-white/5 text-slate-500'
                }`}
              >
                <div className="flex items-center gap-2">
                  <FlameKindling className="w-3 h-3" />
                  <span className="text-[9px] font-black uppercase tracking-widest">NSFW</span>
                </div>
                <div className={`w-7 h-3.5 rounded-full transition-all relative ${nsfw ? 'bg-rose-500' : 'bg-white/10'}`}>
                  <div className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-all ${nsfw ? 'left-3.5' : 'left-0.5'}`} />
                </div>
              </button>
            </div>

            {/* Seed */}
            <div className="flex gap-1.5">
              <input type="number" value={seed} onChange={e => setSeed(parseInt(e.target.value))}
                className="w-28 bg-white/[0.02] border border-white/5 rounded-xl py-3 px-3 text-xs font-mono focus:border-violet-500/20 outline-none text-white/40" />
              <button onClick={() => setSeed(-1)}
                className={`p-3 rounded-xl border transition-all ${seed === -1 ? 'bg-violet-500/10 border-violet-500/30 text-violet-400' : 'bg-white/[0.02] border-white/5 text-slate-500'}`}>
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* ── RUN ── */}
          <div className="pb-6">
            <button
              disabled={!uploadedVideoName || !prompt1.trim() || isGenerating}
              onClick={handleGenerate}
              className={`w-full py-5 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] transition-all duration-500 flex items-center justify-center gap-3 ${
                !uploadedVideoName || !prompt1.trim() || isGenerating
                  ? 'bg-white/5 text-white/10 cursor-not-allowed'
                  : 'bg-violet-600 text-white hover:bg-violet-500 hover:shadow-[0_0_50px_rgba(139,92,246,0.4)]'
              }`}
            >
              {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />}
              <span>{isGenerating ? 'Generating...' : 'Generate'}</span>
            </button>
          </div>

        </div>
      </div>

      {/* ══════════ RIGHT: SCENE PREVIEW ══════════ */}
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

        <div className="flex-1 flex items-center justify-center overflow-y-auto custom-scrollbar p-5">
          {(isGenerating || sessionVideos.length > 0) ? (
            <div className="w-full self-start space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: SCENE_COUNT }).map((_, i) => (
                  <SceneSlot key={i} index={i} url={sessionVideos[i]}
                    isActive={isGenerating} isPending={isGenerating && !sessionVideos[i]} />
                ))}
              </div>

              {slowMotion && sessionVideos.length > SCENE_COUNT && (
                <>
                  <div className="flex items-center gap-3">
                    <div className="h-px flex-1 bg-white/5" />
                    <span className="text-[8px] font-black uppercase tracking-widest text-white/20 flex items-center gap-1">
                      <Zap className="w-2.5 h-2.5 text-violet-400/40" /> Slow Motion
                    </span>
                    <div className="h-px flex-1 bg-white/5" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {sessionVideos.slice(SCENE_COUNT).map((url, i) => (
                      <div key={url} className="rounded-xl overflow-hidden border border-violet-500/20 bg-black/40">
                        <video src={url} className="w-full aspect-video object-cover" autoPlay loop muted playsInline />
                        <div className="px-3 py-1.5">
                          <span className="text-[8px] font-black uppercase tracking-widest text-violet-400/40">Slow Motion {i + 1}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 opacity-20">
              <Film className="w-10 h-10 text-white/20" />
              <p className="text-[9px] font-black uppercase tracking-[0.25em] text-white/25">Upload a video and generate</p>
            </div>
          )}
        </div>
      </div>

      {/* ══════════ COLLAPSIBLE GALLERY ══════════ */}
      <div className={`flex shrink-0 border-l border-white/5 bg-[#060606] transition-all duration-300 overflow-hidden ${galleryOpen ? 'w-[180px]' : 'w-9'}`}>
        <div className="w-9 shrink-0 flex flex-col items-center pt-5 gap-3 border-r border-white/5">
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
