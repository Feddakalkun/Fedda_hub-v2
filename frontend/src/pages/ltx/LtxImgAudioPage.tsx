import { useState, useRef, useEffect } from 'react';
import {
  Mic, RefreshCw, Loader2, Play,
  Music, Image as ImageIcon,
} from 'lucide-react';
import { LoraSelector } from '../../components/ui/LoraSelector';
import { useToast } from '../../components/ui/Toast';
import { BACKEND_API } from '../../config/api';
import { useComfyExecution } from '../../contexts/ComfyExecutionContext';
import { usePersistentState } from '../../hooks/usePersistentState';
import { comfyService } from '../../services/comfyService';
import { PromptAssistant } from '../../components/ui/PromptAssistant';

// ── Upload slot ───────────────────────────────────────────────────────────────
function UploadSlot({ label, icon: Icon, accept, preview, filename, uploading, onFile }: {
  label: string; icon: typeof ImageIcon; accept: string;
  preview?: string | null; filename: string | null; uploading: boolean; onFile: (f: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const isImage = accept.includes('image');
  return (
    <div
      onClick={() => ref.current?.click()}
      onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      onDragOver={e => e.preventDefault()}
      className={`relative flex-1 rounded-xl border border-dashed cursor-pointer transition-all overflow-hidden group ${
        filename ? 'border-violet-500/30 bg-black/40' : 'border-white/[0.08] hover:border-violet-500/25 bg-white/[0.02]'
      }`}
      style={{ height: 120 }}
    >
      {isImage && preview ? (
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
            : filename
              ? <Icon className="w-5 h-5 text-violet-400/50" />
              : <Icon className="w-5 h-5 text-white/10" />
          }
          {filename ? (
            <p className="text-[8px] font-mono text-white/25 truncate max-w-[110px] px-2">{filename}</p>
          ) : (
            <span className="text-[8px] font-black uppercase tracking-widest text-white/15">
              {uploading ? 'Uploading…' : label}
            </span>
          )}
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 px-2 py-1">
        <span className="text-[7px] font-black uppercase tracking-widest text-white/25">{label}</span>
      </div>
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export const LtxImgAudioPage = () => {
  const [prompt,        setPrompt]        = usePersistentState('ltx_ia_prompt', 'person speaking naturally, realistic facial movement, lip sync');
  const [audioStart,    setAudioStart]    = usePersistentState('ltx_ia_start', 0);
  const [audioDuration, setAudioDuration] = usePersistentState('ltx_ia_dur', 5);
  const [width,         setWidth]         = usePersistentState('ltx_ia_width', 720);
  const [seed,          setSeed]          = usePersistentState('ltx_ia_seed', -1);
  const [loraName, setLoraName] = usePersistentState('ltx_ia_lora_name', '');
  const [loraStrength, setLoraStrength] = usePersistentState('ltx_ia_lora_strength', 1.0);

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
  void currentVideo;
  void history;
  const [availableLoras, setAvailableLoras] = useState<string[]>([]);

  const sessionRef   = useRef<string[]>([]);
  const prevCountRef = useRef(0);

  const { toast } = useToast();
  const { state: execState, lastOutputVideos, outputReadyCount, registerNodeMap } = useComfyExecution();

  useEffect(() => {
    comfyService.getLoras().then((loras) => {
      const filtered = loras.filter((l) => {
        const n = l.replace(/\\/g, '/').toLowerCase();
        return n.startsWith('ltx/') || n.includes('ltx');
      });
      setAvailableLoras(filtered);
    }).catch(() => {});
  }, []);

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

  const toggleAudio = () => {
    if (!audioRef.current) return;
    if (audioPlaying) { audioRef.current.pause(); setAudioPlaying(false); }
    else              { audioRef.current.play();  setAudioPlaying(true);  }
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
        toast('Lipsync video ready', 'success');
      })
      .catch(() => toast('Lipsync video ready', 'success'));
  }, [execState, pendingPromptId, toast, setHistory]);

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
            image: imageFilename, audio: audioFilename,
            audio_start: audioStart, audio_duration: audioDuration,
            prompt: prompt.trim(), width,
            seed: seed === -1 ? Math.floor(Math.random() * 10_000_000_000) : seed,
            ...(loraName ? { lora_name: loraName, lora_strength: loraStrength } : {}),
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

  const canGenerate = !!imageFilename && !!audioFilename && !isGenerating;

  return (
    <div className="flex h-full bg-[#080808] overflow-hidden">

      {/* ══ LEFT PANEL ══════════════════════════════════════════════════════ */}
      <div className="flex-1 min-w-0 flex flex-col border-r border-white/[0.04] overflow-y-auto custom-scrollbar">
        <div className="px-5 py-5 space-y-5">

          {/* Inputs */}
          <div className="space-y-2">
            <p className="text-[9px] font-black uppercase tracking-[0.22em] text-white/20">Inputs</p>
            <div className="flex gap-2">
              <UploadSlot label="Image" icon={ImageIcon} accept="image/*"
                preview={imagePreview} filename={imageFilename} uploading={imageUploading}
                onFile={f => uploadFile(f, setImageFilename, setImageUploading, setImagePreview)} />
              <UploadSlot label="Audio" icon={Music} accept="audio/*"
                filename={audioFilename} uploading={audioUploading}
                onFile={f => {
                  uploadFile(f, setAudioFilename, setAudioUploading);
                  if (audioRef.current) audioRef.current.src = URL.createObjectURL(f);
                }} />
            </div>

            {/* Audio mini-player */}
            {audioFilename && (
              <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-black/30 border border-white/[0.05]">
                <button onClick={toggleAudio}
                  className="w-6 h-6 rounded-full bg-violet-500/20 border border-violet-500/25 flex items-center justify-center text-violet-400 hover:bg-violet-500/30 transition-all flex-shrink-0">
                  {audioPlaying
                    ? <span className="flex gap-0.5 w-2.5 h-2.5"><span className="flex-1 bg-violet-400 rounded-sm"/><span className="flex-1 bg-violet-400 rounded-sm"/></span>
                    : <Play className="w-2.5 h-2.5 ml-0.5" />
                  }
                </button>
                <p className="text-[8px] font-mono text-white/25 truncate flex-1">{audioFilename}</p>
                <audio ref={audioRef} onEnded={() => setAudioPlaying(false)} className="hidden" />
              </div>
            )}
          </div>

          {/* Motion Prompt */}
          <PromptAssistant
            context="ltx-lipsync"
            value={prompt}
            onChange={setPrompt}
            placeholder="Describe the speaking style and facial animation…"
            minRows={3}
            accent="violet"
            label="Motion Prompt"
            enableCaption={false}
          />

          {/* Audio Timing */}
          <div className="space-y-3">
            <p className="text-[9px] font-black uppercase tracking-[0.22em] text-white/20">Audio Timing</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <p className="text-[8px] font-black uppercase tracking-widest text-white/15">Start</p>
                  <span className="text-[8px] font-mono text-violet-400/50">{audioStart}s</span>
                </div>
                <input type="range" min={0} max={60} step={0.5} value={audioStart}
                  onChange={e => setAudioStart(Number(e.target.value))}
                  className="w-full accent-violet-500" />
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <p className="text-[8px] font-black uppercase tracking-widest text-white/15">Duration</p>
                  <span className="text-[8px] font-mono text-violet-400/50">{audioDuration}s</span>
                </div>
                <input type="range" min={1} max={30} step={0.5} value={audioDuration}
                  onChange={e => setAudioDuration(Number(e.target.value))}
                  className="w-full accent-violet-500" />
              </div>
            </div>
          </div>

          {/* Video Width */}
          <div className="space-y-2">
            <div className="flex justify-between">
              <p className="text-[9px] font-black uppercase tracking-[0.22em] text-white/20">Video Width</p>
              <span className="text-[9px] font-mono text-violet-400/40">{width}px</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {[512, 720, 1024, 1280].map(w => (
                <button key={w} onClick={() => setWidth(w)}
                  className={`px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-wider transition-all ${
                    width === w
                      ? 'bg-violet-500/20 border border-violet-500/35 text-violet-300'
                      : 'bg-white/[0.03] border border-white/[0.06] text-white/25 hover:text-white/50'
                  }`}>{w}
                </button>
              ))}
            </div>
          </div>

          {/* Seed */}
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

          <LoraSelector
            label="LoRA"
            value={loraName}
            onChange={setLoraName}
            strength={loraStrength}
            onStrengthChange={setLoraStrength}
            options={availableLoras}
            accent="violet"
          />

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
                : <><Mic className="w-4 h-4" /><span>Generate Lipsync</span></>
              }
            </button>
            {(!imageFilename || !audioFilename) && (
              <p className="text-center text-[8px] text-white/10 mt-2 uppercase tracking-widest">
                Upload image + audio to start
              </p>
            )}
          </div>

        </div>
      </div>

    </div>
  );
};

