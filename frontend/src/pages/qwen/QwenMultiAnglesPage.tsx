import { useMemo, useState } from 'react';
import { Camera, Loader2, RefreshCw, Upload } from 'lucide-react';
import { BACKEND_API } from '../../config/api';
import { useToast } from '../../components/ui/Toast';

type AnglePreset = {
  id: string;
  label: string;
  horizontal: number;
  vertical: number;
  zoom: number;
  description: string;
};

const ANGLE_PRESETS: AnglePreset[] = [
  { id: 'front', label: 'Front', horizontal: 0, vertical: 0, zoom: 5, description: 'Neutral front view' },
  { id: 'left', label: 'Left 3/4', horizontal: -45, vertical: 0, zoom: 5, description: 'Three-quarter left' },
  { id: 'right', label: 'Right 3/4', horizontal: 45, vertical: 0, zoom: 5, description: 'Three-quarter right' },
  { id: 'profile-left', label: 'Left Profile', horizontal: -90, vertical: 0, zoom: 5, description: 'Strong side profile' },
  { id: 'profile-right', label: 'Right Profile', horizontal: 90, vertical: 0, zoom: 5, description: 'Strong side profile' },
  { id: 'high', label: 'High Angle', horizontal: 0, vertical: 30, zoom: 5, description: 'Camera from above' },
  { id: 'low', label: 'Low Angle', horizontal: 0, vertical: -30, zoom: 5, description: 'Camera from below' },
];

export const QwenMultiAnglesPage = () => {
  const { toast } = useToast();
  const [selectedAngleId, setSelectedAngleId] = useState<string>(ANGLE_PRESETS[0].id);
  const [seed, setSeed] = useState<number>(-1);
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [uploadedImageName, setUploadedImageName] = useState<string>('');
  const [uploadedPreview, setUploadedPreview] = useState<string>('');
  const [results, setResults] = useState<string[]>([]);

  const selectedAngle = useMemo(
    () => ANGLE_PRESETS.find((p) => p.id === selectedAngleId) ?? ANGLE_PRESETS[0],
    [selectedAngleId],
  );

  const uploadReference = async (file: File) => {
    setIsUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(`${BACKEND_API.BASE_URL}/api/upload`, { method: 'POST', body });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.detail || data?.error || 'Upload failed');
      }
      setUploadedImageName(String(data.filename ?? ''));
      if (uploadedPreview.startsWith('blob:')) URL.revokeObjectURL(uploadedPreview);
      setUploadedPreview(URL.createObjectURL(file));
      toast('Reference image uploaded', 'success');
    } catch (err: any) {
      toast(err?.message || 'Upload failed', 'error');
    } finally {
      setIsUploading(false);
    }
  };

  const pollResults = async (promptId: string) => {
    const started = Date.now();
    while (Date.now() - started < 240_000) {
      const res = await fetch(`${BACKEND_API.BASE_URL}/api/generate/status/${encodeURIComponent(promptId)}`);
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.detail || data?.error || 'Status check failed');
      }
      const state = String(data.status ?? '');
      if (state === 'completed') {
        const imgs = Array.isArray(data.images) ? data.images : [];
        const urls = imgs.map(
          (img: any) =>
            `/comfy/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder ?? '')}&type=${encodeURIComponent(img.type ?? 'output')}`,
        );
        setResults(urls);
        return;
      }
      if (state === 'not_found' || state === 'pending' || state === 'running') {
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      throw new Error(`Unexpected status: ${state}`);
    }
    throw new Error('Generation timed out');
  };

  const generate = async () => {
    if (!uploadedImageName) {
      toast('Upload one image first', 'error');
      return;
    }
    setIsGenerating(true);
    setResults([]);
    try {
      const chosenSeed = seed < 0 ? Math.floor(Math.random() * 2_147_483_000) : seed;
      const payload = {
        workflow_id: 'qwen-multi-angles',
        params: {
          image: uploadedImageName,
          horizontal_angle: selectedAngle.horizontal,
          vertical_angle: selectedAngle.vertical,
          zoom: selectedAngle.zoom,
          seed: chosenSeed,
        },
      };
      const res = await fetch(`${BACKEND_API.BASE_URL}${BACKEND_API.ENDPOINTS.GENERATE}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data?.success || !data?.prompt_id) {
        throw new Error(data?.detail || data?.error || 'Failed to start generation');
      }
      await pollResults(String(data.prompt_id));
      toast('Multi-angle generation complete', 'success');
    } catch (err: any) {
      toast(err?.message || 'Generation failed', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto custom-scrollbar px-6 py-5">
      <div className="max-w-7xl mx-auto grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-5">
        <section className="rounded-2xl border border-white/10 bg-black/30 p-4 space-y-4">
          <div>
            <h3 className="text-sm font-semibold tracking-wide text-white">Qwen Multi Angles</h3>
            <p className="text-xs text-slate-400 mt-1">Upload 1 image, choose a camera angle, generate variations.</p>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/30 p-3">
            <label className="text-[11px] uppercase tracking-[0.12em] text-slate-400 block mb-2">Reference Image</label>
            <label className="w-full cursor-pointer rounded-lg border border-dashed border-cyan-400/35 bg-cyan-500/5 p-3 flex items-center justify-center gap-2 text-sm text-cyan-200 hover:bg-cyan-500/10">
              {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {isUploading ? 'Uploading...' : 'Upload Image'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadReference(file);
                }}
              />
            </label>
            {uploadedImageName && <p className="mt-2 text-[11px] text-emerald-300">Loaded: {uploadedImageName}</p>}
          </div>

          <div className="rounded-xl border border-white/10 bg-black/30 p-3">
            <label className="text-[11px] uppercase tracking-[0.12em] text-slate-400 block mb-2">Camera Angle</label>
            <div className="grid grid-cols-1 gap-2">
              {ANGLE_PRESETS.map((preset) => {
                const active = selectedAngleId === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => setSelectedAngleId(preset.id)}
                    className={`text-left rounded-lg border px-3 py-2 transition ${
                      active ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-100' : 'border-white/10 bg-white/[0.02] text-slate-200 hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="text-sm font-medium">{preset.label}</div>
                    <div className="text-[11px] text-slate-400">{preset.description}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-2">
            <label className="text-[11px] uppercase tracking-[0.12em] text-slate-400 block">Seed</label>
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value))}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            />
            <p className="text-[11px] text-slate-500">Use `-1` for random seed each run.</p>
          </div>

          <button
            onClick={() => void generate()}
            disabled={isGenerating || !uploadedImageName}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 border border-emerald-400/40 bg-emerald-500/15 text-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
            {isGenerating ? 'Generating...' : 'Generate Angle'}
          </button>
        </section>

        <section className="rounded-2xl border border-white/10 bg-black/30 p-4 min-h-[520px]">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-white">Output</h4>
            <button
              onClick={() => setResults([])}
              className="inline-flex items-center gap-1 text-[11px] text-slate-300 border border-white/10 rounded px-2 py-1"
            >
              <RefreshCw className="w-3 h-3" />
              Clear
            </button>
          </div>

          {uploadedPreview && (
            <div className="mb-4">
              <p className="text-[11px] text-slate-400 mb-2">Reference</p>
              <img src={uploadedPreview} alt="Reference" className="w-44 h-44 object-cover rounded-lg border border-white/10" />
            </div>
          )}

          {results.length === 0 ? (
            <div className="h-[360px] rounded-xl border border-dashed border-white/10 flex items-center justify-center text-slate-500 text-sm">
              {isGenerating ? 'Running workflow...' : 'No outputs yet'}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {results.map((url, idx) => (
                <a key={`${url}-${idx}`} href={url} target="_blank" rel="noreferrer" className="block group">
                  <img
                    src={url}
                    alt={`Result ${idx + 1}`}
                    className="w-full aspect-square object-cover rounded-lg border border-white/10 group-hover:border-cyan-400/40"
                  />
                </a>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
