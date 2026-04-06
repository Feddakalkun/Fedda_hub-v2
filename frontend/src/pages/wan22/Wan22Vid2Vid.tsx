import { useState, useEffect, useRef } from 'react';
import { Video, Upload, Hash, RefreshCw, Settings2, ChevronLeft, ChevronRight, Film, Loader2 } from 'lucide-react';
import { useToast } from '../../components/ui/Toast';
import { BACKEND_API, COMFY_API } from '../../config/api';
import { useComfyExecution } from '../../contexts/ComfyExecutionContext';
import { usePersistentState } from '../../hooks/usePersistentState';
import { comfyService } from '../../services/comfyService';

export const Wan22Vid2Vid = () => {
  const [prompt1, setPrompt1] = usePersistentState('wan22v2v_prompt1', '');
  const [prompt2, setPrompt2] = usePersistentState('wan22v2v_prompt2', '');
  const [prompt3, setPrompt3] = usePersistentState('wan22v2v_prompt3', '');
  const [skipFrames, setSkipFrames] = usePersistentState('wan22v2v_skip', 0);
  const [clipLength, setClipLength] = usePersistentState('wan22v2v_clip', 77);
  const [seed, setSeed] = usePersistentState('wan22v2v_seed', -1);

  const [uploadedVideo, setUploadedVideo] = useState<string | null>(null);
  const [uploadedVideoName, setUploadedVideoName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingPromptId, setPendingPromptId] = useState<string | null>(null);
  const [history, setHistory] = useState<{ url: string; filename: string }[]>([]);
  const [galleryOpen, setGalleryOpen] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { state: execState, lastOutputVideos, lastCompletedPromptId } = useComfyExecution();

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
    toast('Video ready — check the gallery', 'success');
  }, [lastOutputVideos, lastCompletedPromptId, pendingPromptId, toast]);

  useEffect(() => {
    if (execState === 'error') { setIsGenerating(false); setPendingPromptId(null); }
  }, [execState]);

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
    if (file && file.type.startsWith('video/')) handleUpload(file);
  };

  const handleGenerate = async () => {
    if (!uploadedVideoName || !prompt1.trim() || isGenerating) return;
    setIsGenerating(true);
    try {
      const res = await fetch(`${BACKEND_API.BASE_URL}${BACKEND_API.ENDPOINTS.GENERATE}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_id: 'wan22-vid2vid',
          params: {
            video: uploadedVideoName,
            skip_first_frames: skipFrames,
            frame_load_cap: clipLength,
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

          {/* Video Upload */}
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Input Video</label>
            <div
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="relative cursor-pointer rounded-2xl border-2 border-dashed border-white/10 hover:border-violet-500/30 bg-white/[0.02] hover:bg-white/[0.04] transition-all overflow-hidden"
            >
              {uploadedVideo ? (
                <div className="relative">
                  <video src={uploadedVideo} className="w-full max-h-48 object-cover rounded-2xl" muted />
                  <div className="absolute bottom-2 left-2 bg-black/70 backdrop-blur-sm rounded-lg px-2 py-1">
                    <span className="text-[9px] font-mono text-white/60 truncate max-w-[200px] block">{uploadedVideoName}</span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 gap-3">
                  {uploading
                    ? <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
                    : <Upload className="w-8 h-8 text-white/20" />}
                  <span className="text-xs text-white/20 font-medium">
                    {uploading ? 'Uploading...' : 'Drop video or click to upload'}
                  </span>
                </div>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="video/*" className="hidden"
              onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])} />
          </div>

          {/* Start frame + Clip length */}
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-3">
              <div className="flex justify-between text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">
                <span>Start Frame</span>
                <span className="text-violet-400 font-mono">{skipFrames}</span>
              </div>
              <input type="range" min="0" max="300" step="1" value={skipFrames}
                onChange={e => setSkipFrames(Number(e.target.value))}
                className="w-full h-1 bg-white/5 rounded-full appearance-none outline-none accent-violet-500 cursor-pointer" />
            </div>
            <div className="space-y-3">
              <div className="flex justify-between text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">
                <span>Clip Length</span>
                <span className="text-violet-400 font-mono">{clipLength}f</span>
              </div>
              <input type="range" min="10" max="200" step="1" value={clipLength}
                onChange={e => setClipLength(Number(e.target.value))}
                className="w-full h-1 bg-white/5 rounded-full appearance-none outline-none accent-violet-500 cursor-pointer" />
            </div>
          </div>

          <div className="h-px bg-white/5" />

          {/* Prompts */}
          {[
            { label: 'Scene 1', value: prompt1, set: setPrompt1, key: 'p1' },
            { label: 'Scene 2', value: prompt2, set: setPrompt2, key: 'p2' },
            { label: 'Scene 3', value: prompt3, set: setPrompt3, key: 'p3' },
          ].map(({ label, value, set, key }) => (
            <div key={key} className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center justify-between">
                <span>{label}</span>
                <span className="text-white/10 font-mono">{value.length}</span>
              </label>
              <textarea
                value={value}
                onChange={e => set(e.target.value)}
                placeholder={`Describe ${label.toLowerCase()}...`}
                className="w-full bg-white/[0.02] border border-white/5 rounded-xl p-4 text-sm text-white/90 placeholder-white/10 resize-none min-h-[80px] focus:outline-none focus:bg-white/[0.04] focus:border-violet-500/20 transition-all"
              />
            </div>
          ))}

          <div className="h-px bg-white/5" />

          {/* Seed */}
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

          {/* Run */}
          <div className="pb-8 max-w-sm">
            <button
              disabled={!uploadedVideoName || !prompt1.trim() || isGenerating}
              onClick={handleGenerate}
              className={`w-full py-6 rounded-[2rem] font-black text-xs uppercase tracking-[0.4em] transition-all duration-500 flex items-center justify-center gap-4 ${
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

      {/* ── COLLAPSIBLE GALLERY ── */}
      <div className={`flex shrink-0 border-l border-white/5 bg-[#060606] transition-all duration-300 overflow-hidden ${galleryOpen ? 'w-[220px]' : 'w-10'}`}>
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

        {galleryOpen && (
          <div className="flex-1 overflow-y-auto custom-scrollbar py-4 px-2 space-y-2">
            {history.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2 opacity-30">
                <Film className="w-5 h-5 text-white/20" />
                <span className="text-[8px] text-white/20 font-black uppercase tracking-widest">Empty</span>
              </div>
            ) : (
              history.map((item, i) => (
                <div key={item.url}
                  className="w-full rounded-xl overflow-hidden border border-white/5 hover:border-violet-500/30 transition-all bg-black/40 group"
                >
                  <video src={item.url} className="w-full aspect-video object-cover" muted />
                  <div className="px-2 py-1.5 flex items-center justify-between">
                    <span className="text-[8px] font-mono text-white/30 truncate">#{i + 1}</span>
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
