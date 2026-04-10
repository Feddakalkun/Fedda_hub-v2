import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import { Camera, Loader2, RefreshCw, Upload } from 'lucide-react';
import { BACKEND_API } from '../../config/api';
import { useToast } from '../../components/ui/Toast';

const WHEEL_SIZE = 260;
const WHEEL_RADIUS_X = 92;
const WHEEL_RADIUS_Y = 34;
const VERTICAL_RANGE = 60;
const ORBIT_ROTATION_DEG = -90;

type Preset = {
  id: string;
  label: string;
  value: number;
};

const H_PRESETS: Preset[] = [
  { id: 'front', label: 'front view', value: 0 },
  { id: 'left-30', label: 'left 30 deg', value: -30 },
  { id: 'right-30', label: 'right 30 deg', value: 30 },
  { id: 'left-profile', label: 'left profile', value: -90 },
  { id: 'right-profile', label: 'right profile', value: 90 },
  { id: 'back', label: 'back view', value: 180 },
];

const V_PRESETS: Preset[] = [
  { id: 'eye', label: 'eye-level shot', value: 0 },
  { id: 'high', label: 'high-angle shot', value: 30 },
  { id: 'low', label: 'low-angle shot', value: -30 },
  { id: 'top', label: 'top-down shot', value: 55 },
  { id: 'worm', label: 'worm-eye shot', value: -55 },
];

const Z_PRESETS: Preset[] = [
  { id: 'close', label: 'close-up', value: 2 },
  { id: 'medium', label: 'medium shot', value: 5 },
  { id: 'full', label: 'full body', value: 8 },
  { id: 'wide', label: 'wide shot', value: 10 },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeDegrees(value: number): number {
  let out = value;
  while (out > 180) out -= 360;
  while (out < -180) out += 360;
  return out;
}

function nearestPresetId(value: number, presets: Preset[], tolerance: number): string {
  let best = presets[0];
  let bestDiff = Math.abs(value - best.value);
  for (const preset of presets) {
    const diff = Math.abs(value - preset.value);
    if (diff < bestDiff) {
      best = preset;
      bestDiff = diff;
    }
  }
  return bestDiff <= tolerance ? best.id : 'custom';
}

function labelFromPresetId(id: string, presets: Preset[], fallback: string): string {
  const found = presets.find((p) => p.id === id);
  return found ? found.label : fallback;
}

export const QwenMultiAnglesPage = () => {
  const { toast } = useToast();
  const wheelRef = useRef<HTMLDivElement | null>(null);
  const [dragTarget, setDragTarget] = useState<'h' | 'v' | 'z' | null>(null);
  const [horizontalAngle, setHorizontalAngle] = useState(0);
  const [verticalAngle, setVerticalAngle] = useState(0);
  const [zoom, setZoom] = useState(5);
  const [hPresetId, setHPresetId] = useState('front');
  const [vPresetId, setVPresetId] = useState('eye');
  const [zPresetId, setZPresetId] = useState('medium');
  const [defaultPrompts, setDefaultPrompts] = useState(false);
  const [cameraView, setCameraView] = useState(false);
  const [seed, setSeed] = useState(-1);
  const [outputCount, setOutputCount] = useState(4);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [uploadedImageName, setUploadedImageName] = useState('');
  const [uploadedPreview, setUploadedPreview] = useState('');
  const [results, setResults] = useState<string[]>([]);

  useEffect(() => {
    setHPresetId(nearestPresetId(horizontalAngle, H_PRESETS, 5));
    setVPresetId(nearestPresetId(verticalAngle, V_PRESETS, 4));
  }, [horizontalAngle, verticalAngle]);

  useEffect(() => {
    setZPresetId(nearestPresetId(zoom, Z_PRESETS, 1));
  }, [zoom]);

  const promptText = useMemo(() => {
    const hLabel = labelFromPresetId(hPresetId, H_PRESETS, `h-${horizontalAngle}`);
    const vLabel = labelFromPresetId(vPresetId, V_PRESETS, `v-${verticalAngle}`);
    const zLabel = labelFromPresetId(zPresetId, Z_PRESETS, `z-${zoom.toFixed(1)}`);
    return `<sks> ${hLabel} ${vLabel} ${zLabel}`;
  }, [hPresetId, vPresetId, zPresetId, horizontalAngle, verticalAngle, zoom]);

  const updateHorizontalFromPointer = (clientX: number, clientY: number) => {
    const el = wheelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2 + 8;
    const dx = (clientX - cx) / Math.max(1, WHEEL_RADIUS_X);
    const dy = (clientY - cy) / Math.max(1, WHEEL_RADIUS_Y);
    const thetaDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const h = normalizeDegrees(thetaDeg - ORBIT_ROTATION_DEG);
    setHorizontalAngle(Math.round(h));
  };

  const updateVerticalFromPointer = (clientY: number) => {
    const el = wheelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cy = rect.top + rect.height / 2 + 8;
    const arcTop = cy - 110;
    const arcBottom = cy;
    const t = clamp((clientY - arcTop) / Math.max(1, arcBottom - arcTop), 0, 1);
    const value = VERTICAL_RANGE - t * (VERTICAL_RANGE * 2);
    setVerticalAngle(Math.round(clamp(value, -VERTICAL_RANGE, VERTICAL_RANGE)));
  };

  const updateZoomFromPointer = (clientX: number) => {
    const el = wheelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = rect.left + 36;
    const right = rect.left + 224;
    const t = clamp((clientX - left) / Math.max(1, right - left), 0, 1);
    setZoom(Number((1 + t * 11).toFixed(1)));
  };

  useEffect(() => {
    if (!dragTarget) return;
    const onMove = (ev: PointerEvent) => {
      if (dragTarget === 'h') updateHorizontalFromPointer(ev.clientX, ev.clientY);
      if (dragTarget === 'v') updateVerticalFromPointer(ev.clientY);
      if (dragTarget === 'z') updateZoomFromPointer(ev.clientX);
    };
    const onUp = () => setDragTarget(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragTarget]);

  const onHorizontalDown = (ev: ReactPointerEvent<HTMLDivElement>) => {
    ev.preventDefault();
    ev.stopPropagation();
    setDragTarget('h');
    updateHorizontalFromPointer(ev.clientX, ev.clientY);
  };

  const onHorizontalDownSvg = (ev: ReactPointerEvent<SVGEllipseElement>) => {
    ev.preventDefault();
    ev.stopPropagation();
    setDragTarget('h');
    updateHorizontalFromPointer(ev.clientX, ev.clientY);
  };

  const onVerticalDown = (ev: ReactPointerEvent<HTMLDivElement>) => {
    ev.preventDefault();
    ev.stopPropagation();
    setDragTarget('v');
    updateVerticalFromPointer(ev.clientY);
  };

  const onZoomDown = (ev: ReactPointerEvent<HTMLDivElement>) => {
    ev.preventDefault();
    ev.stopPropagation();
    setDragTarget('z');
    updateZoomFromPointer(ev.clientX);
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

  const handleFileDrop = async (ev: ReactDragEvent<HTMLDivElement>) => {
    ev.preventDefault();
    ev.stopPropagation();
    setIsDragOver(false);
    const file = ev.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      toast('Drop an image file', 'error');
      return;
    }
    await uploadReference(file);
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
          default_prompts: defaultPrompts,
          camera_view: cameraView,
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

  const cx = WHEEL_SIZE / 2;
  const cy = WHEEL_SIZE / 2 + 8;
  const orbitTheta = ((horizontalAngle + ORBIT_ROTATION_DEG) * Math.PI) / 180;
  const knobX = cx + Math.cos(orbitTheta) * WHEEL_RADIUS_X;
  const ringKnobY = cy + Math.sin(orbitTheta) * WHEEL_RADIUS_Y;
  const zoomKnobX = 36 + ((zoom - 1) / 11) * 188;

  return (
    <div className="h-full overflow-y-auto custom-scrollbar px-6 py-5">
      <div className="max-w-7xl mx-auto grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-5">
        <section className="rounded-2xl border border-amber-300/35 bg-[#141018] p-4 space-y-4 shadow-[0_0_0_1px_rgba(245,158,11,0.08)]">
          <div>
            <h3 className="text-sm font-semibold tracking-wide text-amber-100">Qwen Multiangle Camera</h3>
            <p className="text-xs text-slate-400 mt-1">Original-style camera control with X, Y and Zoom.</p>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/40 p-3">
            <label className="text-[11px] uppercase tracking-[0.12em] text-slate-400 block mb-2">Image</label>
            <div
              onDragOver={(ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                setIsDragOver(true);
              }}
              onDragLeave={(ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                setIsDragOver(false);
              }}
              onDrop={(ev) => void handleFileDrop(ev)}
              className={`w-full rounded-lg border border-dashed p-3 transition-colors ${
                isDragOver
                  ? 'border-cyan-300 bg-cyan-500/15'
                  : 'border-cyan-400/35 bg-cyan-500/5'
              }`}
            >
              <label className="w-full cursor-pointer flex items-center justify-center gap-2 text-sm text-cyan-200 hover:text-cyan-100">
                {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {isUploading ? 'Uploading...' : 'Drop Image Here or Click Upload'}
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
            </div>
            {uploadedImageName && <p className="mt-2 text-[11px] text-emerald-300">Loaded: {uploadedImageName}</p>}
          </div>

          <div className="rounded-xl border border-fuchsia-500/35 bg-[#0d0b12] p-3">
            <div className="text-[11px] text-fuchsia-300 mb-2 font-mono">{promptText}</div>

            <div className="grid grid-cols-2 gap-2 mb-2">
              <label className="text-[11px] flex items-center justify-between rounded border border-white/10 px-2 py-1 text-slate-300">
                <span>default_prompts</span>
                <input type="checkbox" checked={defaultPrompts} onChange={(e) => setDefaultPrompts(e.target.checked)} />
              </label>
              <label className="text-[11px] flex items-center justify-between rounded border border-white/10 px-2 py-1 text-slate-300">
                <span>camera_view</span>
                <input type="checkbox" checked={cameraView} onChange={(e) => setCameraView(e.target.checked)} />
              </label>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-3">
              <label className="text-[11px] text-slate-400">
                H
                <select
                  value={hPresetId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setHPresetId(id);
                    const match = H_PRESETS.find((p) => p.id === id);
                    if (match) setHorizontalAngle(match.value);
                  }}
                  className="mt-1 w-full rounded border border-white/10 bg-black/50 px-2 py-1 text-slate-100"
                >
                  {H_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  <option value="custom">custom</option>
                </select>
              </label>
              <label className="text-[11px] text-slate-400">
                V
                <select
                  value={vPresetId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setVPresetId(id);
                    const match = V_PRESETS.find((p) => p.id === id);
                    if (match) setVerticalAngle(match.value);
                  }}
                  className="mt-1 w-full rounded border border-white/10 bg-black/50 px-2 py-1 text-slate-100"
                >
                  {V_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  <option value="custom">custom</option>
                </select>
              </label>
              <label className="text-[11px] text-slate-400">
                Z
                <select
                  value={zPresetId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setZPresetId(id);
                    const match = Z_PRESETS.find((p) => p.id === id);
                    if (match) setZoom(match.value);
                  }}
                  className="mt-1 w-full rounded border border-white/10 bg-black/50 px-2 py-1 text-slate-100"
                >
                  {Z_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  <option value="custom">custom</option>
                </select>
              </label>
            </div>

            <div
              ref={wheelRef}
              className="relative mx-auto touch-none rounded-lg border border-white/10 bg-[radial-gradient(circle_at_center,rgba(17,24,39,0.65),rgba(2,6,23,0.95))]"
              style={{ width: WHEEL_SIZE, height: WHEEL_SIZE }}
            >
              <svg width={WHEEL_SIZE} height={WHEEL_SIZE} className="absolute inset-0">
                <defs>
                  <linearGradient id="ringPink" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#ff2f92" />
                    <stop offset="100%" stopColor="#ff66bd" />
                  </linearGradient>
                  <linearGradient id="arcCyan" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#22d3ee" />
                    <stop offset="100%" stopColor="#34d399" />
                  </linearGradient>
                </defs>
                <ellipse
                  cx={cx}
                  cy={cy}
                  rx={WHEEL_RADIUS_X}
                  ry={WHEEL_RADIUS_Y}
                  fill="none"
                  stroke="transparent"
                  strokeWidth="24"
                  style={{ pointerEvents: 'stroke' }}
                  onPointerDown={onHorizontalDownSvg}
                />
                <ellipse cx={cx} cy={cy} rx={WHEEL_RADIUS_X} ry={WHEEL_RADIUS_Y} fill="none" stroke="url(#ringPink)" strokeWidth="7" />
                <path d={`M ${cx - 92} ${cy} Q ${cx - 116} ${cy - 58} ${cx - 96} ${cy - 110}`} fill="none" stroke="url(#arcCyan)" strokeWidth="5" />
                <rect x={cx - 16} y={cy - 58} width="32" height="72" fill="rgba(148,163,184,0.2)" stroke="#f472b6" strokeWidth="1.5" />
                <line x1={cx} y1={cy - 18} x2={cx + 30} y2={cy - 28} stroke="#fbbf24" strokeWidth="3" />
              </svg>

              <div
                className="absolute w-4 h-4 rounded-full border border-fuchsia-100 bg-fuchsia-500 shadow-[0_0_16px_rgba(236,72,153,0.55)] -translate-x-1/2 -translate-y-1/2"
                style={{ left: knobX, top: ringKnobY }}
                onPointerDown={onHorizontalDown}
              />
              <div
                className="absolute w-4 h-4 rounded-full border border-cyan-100 bg-cyan-400 shadow-[0_0_16px_rgba(34,211,238,0.55)] -translate-x-1/2 -translate-y-1/2"
                style={{ left: cx - 98, top: cy - 110 + ((VERTICAL_RANGE - verticalAngle) / (VERTICAL_RANGE * 2)) * 110 }}
                onPointerDown={onVerticalDown}
              />

              <div className="absolute left-5 right-5 bottom-5" onPointerDown={onZoomDown}>
                <div className="h-2 rounded-full bg-white/10 relative">
                  <div className="absolute top-0 left-0 h-full rounded-full bg-amber-300/70" style={{ width: `${((zoom - 1) / 11) * 100}%` }} />
                  <div
                    className="absolute top-1/2 w-3 h-3 rounded-full bg-amber-300 border border-amber-100 -translate-x-1/2 -translate-y-1/2"
                    style={{ left: zoomKnobX }}
                  />
                </div>
              </div>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
              <div className="rounded border border-white/10 bg-black/40 px-2 py-1 text-center text-slate-300">H {horizontalAngle}deg</div>
              <div className="rounded border border-white/10 bg-black/40 px-2 py-1 text-center text-slate-300">V {verticalAngle}deg</div>
              <div className="rounded border border-white/10 bg-black/40 px-2 py-1 text-center text-amber-200">Z {zoom.toFixed(1)}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-slate-400">
              Seed
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value))}
                className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1 text-slate-100"
              />
            </label>
            <label className="text-[11px] text-slate-400">
              Output Count
              <select
                value={outputCount}
                onChange={(e) => setOutputCount(Math.max(1, Math.min(6, Number(e.target.value) || 1)))}
                className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1 text-slate-100"
              >
                {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
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
