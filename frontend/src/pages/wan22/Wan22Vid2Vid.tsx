import { useState, useEffect, useRef, useCallback } from 'react';
import { Video, Upload, RefreshCw, Settings2, ChevronLeft, ChevronRight, Film, Loader2, Play, Pause } from 'lucide-react';
import { useToast } from '../../components/ui/Toast';
import { BACKEND_API } from '../../config/api';
import { useComfyExecution } from '../../contexts/ComfyExecutionContext';
import { usePersistentState } from '../../hooks/usePersistentState';
import { comfyService } from '../../services/comfyService';

const FPS = 24;

export const Wan22Vid2Vid = () => {
  const [prompt1, setPrompt1] = usePersistentState('wan22v2v_prompt1', '');
  const [prompt2, setPrompt2] = usePersistentState('wan22v2v_prompt2', '');
  const [prompt3, setPrompt3] = usePersistentState('wan22v2v_prompt3', '');
  const [seed, setSeed]       = usePersistentState('wan22v2v_seed', -1);

  const [uploadedVideo, setUploadedVideo]       = useState<string | null>(null);
  const [uploadedVideoName, setUploadedVideoName] = useState<string | null>(null);
  const [uploading, setUploading]               = useState(false);
  const [isPlaying, setIsPlaying]               = useState(false);
  const [videoDuration, setVideoDuration]       = useState(0); // seconds
  const [currentTime, setCurrentTime]           = useState(0); // seconds

  // IN/OUT handles in seconds
  const [inPoint, setInPoint]   = useState(0);
  const [outPoint, setOutPoint] = useState(0);

  const [isGenerating, setIsGenerating]     = useState(false);
  const [pendingPromptId, setPendingPromptId] = useState<string | null>(null);
  const [history, setHistory]               = useState<{ url: string; filename: string }[]>([]);
  const [galleryOpen, setGalleryOpen]       = useState(true);

  const fileInputRef  = useRef<HTMLInputElement>(null);
  const videoRef      = useRef<HTMLVideoElement>(null);
  const trackRef      = useRef<HTMLDivElement>(null);
  const dragging      = useRef<'in' | 'out' | null>(null);

  const { toast } = useToast();
  const { state: execState, lastOutputVideos, lastCompletedPromptId, registerNodeMap } = useComfyExecution();

  // Derived frame values
  const totalFrames    = Math.max(1, Math.floor(videoDuration * FPS));
  const inFrame        = Math.round(inPoint * FPS);
  const outFrame       = Math.round(outPoint * FPS);
  const clipFrames     = Math.max(1, outFrame - inFrame);

  // Video complete
  useEffect(() => {
    if (!pendingPromptId || !lastOutputVideos?.length) return;
    if (lastCompletedPromptId !== pendingPromptId) return;
    const vid = lastOutputVideos[lastOutputVideos.length - 1];
    const url = `/comfy/view?filename=${encodeURIComponent(vid.filename)}&subfolder=${encodeURIComponent(vid.subfolder)}&type=${vid.type}`;
    setHistory(prev => [{ url, filename: vid.filename }, ...prev.slice(0, 19)]);
    setIsGenerating(false);
    setPendingPromptId(null);
    setGalleryOpen(true);
    toast('Video ready', 'success');
  }, [lastOutputVideos, lastCompletedPromptId, pendingPromptId, toast]);

  useEffect(() => {
    if (execState === 'error') { setIsGenerating(false); setPendingPromptId(null); }
  }, [execState]);

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
      toast(`Uploaded: ${data.filename}`, 'success');
    } catch (err: any) {
      toast(err.message || 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('video/')) handleUpload(file);
  };

  // ── Video events ─────────────────────────────────────────────────────────
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

  const onTimeUpdate = () => {
    setCurrentTime(videoRef.current?.currentTime || 0);
  };

  // ── Clip range drag ───────────────────────────────────────────────────────
  const getSecondsFromEvent = useCallback((e: MouseEvent | React.MouseEvent) => {
    const track = trackRef.current;
    if (!track || videoDuration === 0) return 0;
    const rect = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return pct * videoDuration;
  }, [videoDuration]);

  const onHandleMouseDown = (handle: 'in' | 'out') => (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = handle;
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const secs = getSecondsFromEvent(e);
      if (dragging.current === 'in') {
        setInPoint(Math.min(secs, outPoint - 1 / FPS));
        if (videoRef.current) videoRef.current.currentTime = secs;
      } else {
        setOutPoint(Math.max(secs, inPoint + 1 / FPS));
        if (videoRef.current) videoRef.current.currentTime = secs;
      }
    };
    const onUp = () => { dragging.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [inPoint, outPoint, getSecondsFromEvent]);

  const onTrackClick = (e: React.MouseEvent) => {
    if (dragging.current) return;
    const secs = getSecondsFromEvent(e);
    if (videoRef.current) videoRef.current.currentTime = secs;
  };

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // ── Generate ──────────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!uploadedVideoName || !prompt1.trim() || isGenerating) return;
    setIsGenerating(true);
    try {
      // Pre-fetch node map so the top bar shows human-readable names
      fetch(`${BACKEND_API.BASE_URL}/api/workflow/node-map/wan22-vid2vid`)
        .then(r => r.json())
        .then(d => { if (d.success) registerNodeMap(d.node_map); })
        .catch(() => {});

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
            seed: seed === -1 ? Math.floor(Math.random() * 10_000_000_000) : seed,
            client_id: (comfyService as any).clientId,
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

  // ── Percentages for range overlay ─────────────────────────────────────────
  const inPct  = videoDuration > 0 ? (inPoint  / videoDuration) * 100 : 0;
  const outPct = videoDuration > 0 ? (outPoint / videoDuration) * 100 : 100;
  const playPct = videoDuration > 0 ? (currentTime / videoDuration) * 100 : 0;

  return (
    <div className="flex h-full bg-[#080808] overflow-hidden">

      {/* ── PARAMS ── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="px-8 py-8 space-y-8">

          {/* Header */}
          <div className="flex items-center gap-2">
            <Video className="w-4 h-4 text-violet-400" />
            <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-white/50">WAN 2.2 — Vid2Vid</h2>
          </div>

          {/* ── VIDEO SECTION ─────────────────────────────────── */}
          {!uploadedVideo ? (
            /* Upload zone */
            <div
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="relative cursor-pointer rounded-2xl border-2 border-dashed border-white/10 hover:border-violet-500/40 bg-white/[0.02] hover:bg-white/[0.04] transition-all"
            >
              <div className="flex flex-col items-center justify-center py-16 gap-4">
                {uploading
                  ? <Loader2 className="w-10 h-10 text-violet-400 animate-spin" />
                  : <Upload className="w-10 h-10 text-white/15" />}
                <div className="text-center">
                  <p className="text-sm font-bold text-white/30">{uploading ? 'Uploading...' : 'Drop video here'}</p>
                  <p className="text-xs text-white/15 mt-1">or click to browse</p>
                </div>
              </div>
            </div>
          ) : (
            /* Video player + clip range selector */
            <div className="space-y-3">

              {/* Player */}
              <div className="relative rounded-2xl overflow-hidden bg-black border border-white/5 group">
                <video
                  ref={videoRef}
                  src={uploadedVideo}
                  className="w-full max-h-[320px] object-contain"
                  onLoadedMetadata={onVideoLoaded}
                  onTimeUpdate={onTimeUpdate}
                  onEnded={() => setIsPlaying(false)}
                  onClick={togglePlay}
                />
                {/* Play/pause overlay */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <button
                    onClick={togglePlay}
                    className="pointer-events-auto w-14 h-14 rounded-full bg-black/50 backdrop-blur-sm border border-white/20 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-all hover:bg-black/70 hover:scale-105"
                  >
                    {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
                  </button>
                </div>
                {/* Filename badge */}
                <div className="absolute bottom-2 left-2 bg-black/60 backdrop-blur-sm rounded-lg px-2 py-0.5">
                  <span className="text-[9px] font-mono text-white/40 truncate max-w-[200px] block">{uploadedVideoName}</span>
                </div>
                {/* Replace button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute top-2 right-2 px-2 py-1 bg-black/60 backdrop-blur-sm rounded-lg text-[9px] font-black uppercase tracking-widest text-white/30 hover:text-white/70 transition-colors opacity-0 group-hover:opacity-100"
                >
                  Replace
                </button>
              </div>

              {/* ── CLIP RANGE SELECTOR ── */}
              <div className="space-y-2 bg-white/[0.02] rounded-2xl border border-white/5 p-4">
                {/* Header row */}
                <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-widest text-slate-600">
                  <span>Clip Selection</span>
                  <span className="font-mono text-violet-400/60">{clipFrames}f · {(clipFrames / FPS).toFixed(1)}s</span>
                </div>

                {/* Timeline track */}
                <div
                  ref={trackRef}
                  className="relative h-7 cursor-crosshair select-none"
                  onClick={onTrackClick}
                >
                  {/* Full track background */}
                  <div className="absolute inset-y-0 left-0 right-0 my-auto h-1.5 bg-white/5 rounded-full" />

                  {/* Selected range */}
                  <div
                    className="absolute inset-y-0 my-auto h-1.5 bg-violet-500/40 rounded-full pointer-events-none"
                    style={{ left: `${inPct}%`, width: `${outPct - inPct}%` }}
                  />

                  {/* Playhead */}
                  <div
                    className="absolute inset-y-0 my-auto w-0.5 bg-white/30 rounded-full pointer-events-none"
                    style={{ left: `${playPct}%` }}
                  />

                  {/* IN handle */}
                  <div
                    onMouseDown={onHandleMouseDown('in')}
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-violet-400 border-2 border-black/60 shadow-lg cursor-ew-resize hover:scale-125 transition-transform z-10"
                    style={{ left: `${inPct}%` }}
                  />

                  {/* OUT handle */}
                  <div
                    onMouseDown={onHandleMouseDown('out')}
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-violet-300 border-2 border-black/60 shadow-lg cursor-ew-resize hover:scale-125 transition-transform z-10"
                    style={{ left: `${outPct}%` }}
                  />
                </div>

                {/* Time labels */}
                <div className="flex items-center justify-between text-[9px] font-mono text-slate-600">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-violet-400" />
                    <span>IN {fmtTime(inPoint)} · f{inFrame}</span>
                  </div>
                  <span className="text-white/20">{fmtTime(videoDuration)}</span>
                  <div className="flex items-center gap-1.5">
                    <span>OUT {fmtTime(outPoint)} · f{outFrame}</span>
                    <div className="w-2 h-2 rounded-full bg-violet-300" />
                  </div>
                </div>

                {/* Fine-tune numeric inputs */}
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="space-y-1">
                    <label className="text-[8px] font-black uppercase tracking-widest text-slate-600">Skip (start frame)</label>
                    <input
                      type="number" min="0" max={totalFrames - 1} value={inFrame}
                      onChange={e => setInPoint(Number(e.target.value) / FPS)}
                      className="w-full bg-black/40 border border-white/5 rounded-xl px-3 py-2 text-xs font-mono text-violet-300 focus:border-violet-500/30 outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[8px] font-black uppercase tracking-widest text-slate-600">Clip length (frames)</label>
                    <input
                      type="number" min="1" max={totalFrames} value={clipFrames}
                      onChange={e => setOutPoint(inPoint + Number(e.target.value) / FPS)}
                      className="w-full bg-black/40 border border-white/5 rounded-xl px-3 py-2 text-xs font-mono text-violet-300 focus:border-violet-500/30 outline-none"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="video/*" className="hidden"
            onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])} />

          <div className="h-px bg-white/5" />

          {/* ── PROMPTS ─────────────────────────────────────────── */}
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] block mb-4">Scene Expansions</label>
            {[
              { label: 'Scene 1', value: prompt1, set: setPrompt1, key: 'p1' },
              { label: 'Scene 2', value: prompt2, set: setPrompt2, key: 'p2' },
              { label: 'Scene 3', value: prompt3, set: setPrompt3, key: 'p3' },
            ].map(({ label, value, set, key }, i) => (
              <div key={key} className="space-y-1.5 mb-4">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">{label}</span>
                  <span className="text-[9px] font-mono text-white/10">{value.length}</span>
                </div>
                <textarea
                  value={value}
                  onChange={e => set(e.target.value)}
                  placeholder={i === 0 ? 'Required — describe the motion / action...' : `Optional — falls back to Scene 1`}
                  rows={3}
                  className="w-full bg-white/[0.02] border border-white/5 rounded-xl p-3 text-sm text-white/90 placeholder-white/10 resize-none focus:outline-none focus:bg-white/[0.04] focus:border-violet-500/20 transition-all"
                />
              </div>
            ))}
          </div>

          <div className="h-px bg-white/5" />

          {/* ── SEED ─────────────────────────────────────────────── */}
          <div className="space-y-3 max-w-sm">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
              <Settings2 className="w-3 h-3" /> Seed
            </label>
            <div className="flex gap-2">
              <input type="number" value={seed} onChange={e => setSeed(parseInt(e.target.value))}
                className="flex-1 bg-white/[0.02] border border-white/5 rounded-xl py-3 px-4 text-xs font-mono focus:border-violet-500/20 outline-none text-white/50" />
              <button onClick={() => setSeed(-1)}
                className={`p-3 rounded-xl border transition-all ${seed === -1 ? 'bg-violet-500/10 border-violet-500/30 text-violet-400' : 'bg-white/[0.02] border-white/5 text-slate-500 hover:text-white/40'}`}>
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* ── RUN ──────────────────────────────────────────────── */}
          <div className="pb-8">
            <button
              disabled={!uploadedVideoName || !prompt1.trim() || isGenerating}
              onClick={handleGenerate}
              className={`w-full py-5 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] transition-all duration-500 flex items-center justify-center gap-4 ${
                !uploadedVideoName || !prompt1.trim() || isGenerating
                  ? 'bg-white/5 text-white/10 cursor-not-allowed'
                  : 'bg-violet-600 text-white hover:bg-violet-500 hover:shadow-[0_0_60px_rgba(139,92,246,0.3)]'
              }`}
            >
              {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Video className="w-5 h-5" />}
              <span>{isGenerating ? 'Generating...' : 'Generate'}</span>
            </button>
          </div>

        </div>
      </div>

      {/* ── GALLERY ── */}
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
              history.map((item, i) => (
                <div key={item.url} className="w-full rounded-xl overflow-hidden border border-white/5 hover:border-violet-500/30 transition-all bg-black/40 group">
                  <video src={item.url} className="w-full aspect-video object-cover" muted />
                  <div className="px-2 py-1.5 flex items-center justify-between">
                    <span className="text-[8px] font-mono text-white/30">#{i + 1}</span>
                    <a href={item.url} download={item.filename}
                      className="text-[8px] text-violet-400/50 hover:text-violet-400 transition-colors font-black uppercase tracking-widest opacity-0 group-hover:opacity-100">
                      Save
                    </a>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

    </div>
  );
};
