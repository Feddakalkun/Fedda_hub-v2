import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Camera, Loader2, RefreshCw, Upload } from 'lucide-react';
import { BACKEND_API } from '../../config/api';
import { useToast } from '../../components/ui/Toast';

const WHEEL_SIZE = 220;
const WHEEL_RADIUS = 90;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export const QwenMultiAnglesPage = () => {
  const { toast } = useToast();
  const wheelRef = useRef<HTMLDivElement | null>(null);
  const [isDraggingWheel, setIsDraggingWheel] = useState(false);
  const [horizontalAngle, setHorizontalAngle] = useState<number>(0);
  const [verticalAngle, setVerticalAngle] = useState<number>(0);
  const [zoom, setZoom] = useState<number>(5);
  const [seed, setSeed] = useState<number>(-1);
  const [outputCount, setOutputCount] = useState<number>(4);
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [uploadedImageName, setUploadedImageName] = useState<string>('');
  const [uploadedPreview, setUploadedPreview] = useState<string>('');
  const [results, setResults] = useState<string[]>([]);

  const updateWheelFromPointer = (clientX: number, clientY: number) => {
    const el = wheelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > WHEEL_RADIUS) {
      const scale = WHEEL_RADIUS / len;
      dx *= scale;
      dy *= scale;
    }
    const nx = clamp(dx / WHEEL_RADIUS, -1, 1);
    const ny = clamp(dy / WHEEL_RADIUS, -1, 1);
    setHorizontalAngle(Math.round(nx * 180));
    setVerticalAngle(Math.round(-ny * 60));
  };

  useEffect(() => {
    if (!isDraggingWheel) return;
    const onMove = (ev: PointerEvent) => updateWheelFromPointer(ev.clientX, ev.clientY);
    const onUp = () => setIsDraggingWheel(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [isDraggingWheel]);

  const handleWheelPointerDown = (ev: ReactPointerEvent<HTMLDivElement>) => {
    ev.preventDefault();
    setIsDraggingWheel(true);
    updateWheelFromPointer(ev.clientX, ev.clientY);
  };

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
        setResults(urls.slice(0, Math.max(1, Math.min(6, outputCount))));
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
          horizontal_angle: horizontalAngle,
          vertical_angle: verticalAngle,
          zoom,
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

  const knobLeft = WHEEL_SIZE / 2 + (horizontalAngle / 180) * WHEEL_RADIUS;
  const knobTop = WHEEL_SIZE / 2 - (verticalAngle / 60) * WHEEL_RADIUS;

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
            <label className="text-[11px] uppercase tracking-[0.12em] text-slate-400 block mb-2">Camera Wheel</label>
            <div className="flex justify-center mb-3">
              <div
                ref={wheelRef}
                onPointerDown={handleWheelPointerDown}
                className="relative rounded-full border border-cyan-400/45 bg-cyan-500/5 touch-none cursor-grab active:cursor-grabbing"
                style={{ width: WHEEL_SIZE, height: WHEEL_SIZE }}
              >
                <div className="absolute left-1/2 top-0 h-full w-px bg-white/10 -translate-x-1/2" />
                <div className="absolute top-1/2 left-0 w-full h-px bg-white/10 -translate-y-1/2" />
                <div
                  className="absolute w-4 h-4 rounded-full border border-cyan-200 bg-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.45)] -translate-x-1/2 -translate-y-1/2"
                  style={{ left: knobLeft, top: knobTop }}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <label className="text-slate-400">
                X
                <input
                  type="number"
                  value={horizontalAngle}
                  min={-180}
                  max={180}
                  onChange={(e) => setHorizontalAngle(clamp(Number(e.target.value) || 0, -180, 180))}
                  className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1 text-slate-100"
                />
              </label>
              <label className="text-slate-400">
                Y
                <input
                  type="number"
                  value={verticalAngle}
                  min={-60}
                  max={60}
                  onChange={(e) => setVerticalAngle(clamp(Number(e.target.value) || 0, -60, 60))}
                  className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1 text-slate-100"
                />
              </label>
              <label className="text-slate-400">
                Zoom
                <input
                  type="number"
                  value={zoom}
                  min={1}
                  max={12}
                  onChange={(e) => setZoom(clamp(Number(e.target.value) || 1, 1, 12))}
                  className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1 text-slate-100"
                />
              </label>
            </div>
            <input
              type="range"
              min={1}
              max={12}
              step={1}
              value={zoom}
              onChange={(e) => setZoom(clamp(Number(e.target.value) || 1, 1, 12))}
              className="w-full mt-3"
            />
            <button
              onClick={() => {
                setHorizontalAngle(0);
                setVerticalAngle(0);
                setZoom(5);
              }}
              className="mt-2 text-[11px] px-2 py-1 rounded border border-white/10 text-slate-300"
            >
              Reset Camera
            </button>
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

          <div className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-2">
            <label className="text-[11px] uppercase tracking-[0.12em] text-slate-400 block">Output Count</label>
            <select
              value={outputCount}
              onChange={(e) => setOutputCount(Math.max(1, Math.min(6, Number(e.target.value) || 1)))}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            >
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500">How many images to return from this run.</p>
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
