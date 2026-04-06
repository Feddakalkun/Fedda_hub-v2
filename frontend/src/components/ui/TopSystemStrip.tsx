import { useEffect, useMemo, useState } from 'react';
import { Activity, BrainCircuit, Loader2, Trash2, Zap } from 'lucide-react';
import { useComfyStatus } from '../../hooks/useComfyStatus';
import { useOllamaStatus } from '../../hooks/useOllamaStatus';
import { COMFY_API } from '../../config/api';

export const TopSystemStrip = () => {
  const comfy = useComfyStatus(3000);
  const ollama = useOllamaStatus();
  const [comfyStats, setComfyStats] = useState<any>(null);
  const [gpuStats, setGpuStats] = useState<any>(null);
  const [purging, setPurging] = useState(false);

  // Poll hardware + comfy system stats
  useEffect(() => {
    let mounted = true;

    const update = async () => {
      // GPU stats from our backend
      try {
        const r = await fetch('/api/hardware/stats', { cache: 'no-store' });
        if (r.ok && mounted) setGpuStats(await r.json());
      } catch {}

      // ComfyUI VRAM stats — only when online
      if (comfy.isConnected) {
        try {
          const r = await fetch(`${COMFY_API.BASE_URL}/system_stats`, { cache: 'no-store' });
          if (r.ok && mounted) setComfyStats(await r.json());
        } catch {}
      } else {
        if (mounted) setComfyStats(null);
      }
    };

    update();
    const id = setInterval(update, 3000);
    return () => { mounted = false; clearInterval(id); };
  }, [comfy.isConnected]);

  const gpu = useMemo(() => {
    if (!comfyStats?.devices?.length) return null;
    const d = comfyStats.devices[0];
    const total = Number(d.vram_total || 0);
    const free = Number(d.vram_free || 0);
    const used = Math.max(0, total - free);
    const pct = total > 0 ? Math.round((used / total) * 100) : 0;
    return {
      name: String(d.name || '').replace('NVIDIA GeForce ', ''),
      usedGiB: (used / 1024 ** 3).toFixed(1),
      totalGiB: (total / 1024 ** 3).toFixed(1),
      pct,
      temp: gpuStats?.gpu?.temperature ?? null,
    };
  }, [comfyStats, gpuStats]);

  const handlePurge = async () => {
    if (purging) return;
    if (!confirm('Purge VRAM? This stops active generation and unloads all models.')) return;
    setPurging(true);
    try {
      await fetch(`${COMFY_API.BASE_URL}/free`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unload_models: true, free_memory: true }),
      });
    } finally {
      setPurging(false);
    }
  };

  const comfyLabel = comfy.isLoading
    ? 'Checking...'
    : comfy.isConnected ? 'ComfyUI Online' : 'ComfyUI Offline';

  const ollamaLabel = ollama.isLoading
    ? 'Checking...'
    : ollama.isConnected ? 'Ollama Online' : 'Ollama Offline';

  return (
    <div className="hidden xl:flex items-center gap-2">

      {/* GPU VRAM pill */}
      <div className="h-8 px-3 rounded-lg border border-white/10 bg-white/5 flex items-center gap-2 text-xs">
        <Zap className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
        {gpu ? (
          <>
            <span className="text-slate-200 font-medium">{gpu.name}</span>
            {gpu.temp !== null && (
              <span className={`font-semibold ${gpu.temp > 80 ? 'text-red-400' : gpu.temp > 70 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {gpu.temp}°C
              </span>
            )}
            <div className="flex items-center gap-1.5">
              <div className="w-14 h-1.5 bg-white/8 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${gpu.pct}%`,
                    background: gpu.pct > 90
                      ? 'linear-gradient(90deg,#ef4444,#dc2626)'
                      : gpu.pct > 75
                        ? 'linear-gradient(90deg,#f59e0b,#d97706)'
                        : 'linear-gradient(90deg,#34d399,#10b981)',
                  }}
                />
              </div>
              <span className="text-slate-400 font-mono text-[11px]">{gpu.usedGiB}/{gpu.totalGiB}GB</span>
            </div>
          </>
        ) : (
          <span className="text-slate-500 text-[11px]">GPU loading…</span>
        )}
      </div>

      {/* Purge VRAM button */}
      <button
        id="purge-vram-btn"
        onClick={handlePurge}
        disabled={purging || !comfy.isConnected}
        title="Purge VRAM — unload all models"
        className="h-8 px-3 rounded-lg border border-red-500/25 bg-red-500/8 hover:bg-red-500/18 text-red-300 text-xs font-semibold transition-all disabled:opacity-40 flex items-center gap-1.5"
      >
        {purging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        {purging ? 'Purging' : 'Purge VRAM'}
      </button>

      {/* ComfyUI status */}
      <div className={`h-8 px-3 rounded-lg border text-xs font-medium flex items-center gap-1.5 ${
        comfy.isConnected
          ? 'border-emerald-500/30 bg-emerald-500/8 text-emerald-300'
          : 'border-white/10 bg-white/5 text-slate-500'
      }`}>
        {comfy.isLoading
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <Activity className="w-3.5 h-3.5" />
        }
        {comfyLabel}
      </div>

      {/* Ollama status */}
      <div className={`h-8 px-3 rounded-lg border text-xs font-medium flex items-center gap-1.5 ${
        ollama.isConnected
          ? 'border-emerald-500/30 bg-emerald-500/8 text-emerald-300'
          : 'border-white/10 bg-white/5 text-slate-500'
      }`}>
        {ollama.isLoading
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <BrainCircuit className="w-3.5 h-3.5" />
        }
        {ollamaLabel}
      </div>
    </div>
  );
};
