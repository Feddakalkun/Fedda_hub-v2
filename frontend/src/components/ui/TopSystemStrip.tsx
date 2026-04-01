import { useEffect, useMemo, useState } from 'react';
import { Activity, BrainCircuit, Loader2, Trash2, Zap } from 'lucide-react';
import { comfyService } from '../../services/comfyService';
import { useComfyStatus } from '../../hooks/useComfyStatus';
import { useOllamaStatus } from '../../hooks/useOllamaStatus';
import { IS_RUNPOD } from '../../config/api';

export const TopSystemStrip = () => {
    const comfy = useComfyStatus(3000);
    const ollama = useOllamaStatus();
    const [stats, setStats] = useState<any>(null);
    const [gpuStats, setGpuStats] = useState<any>(null);
    const [purging, setPurging] = useState(false);

    useEffect(() => {
        let mounted = true;
        const update = async () => {
            try {
                const hwData = await comfyService.getHardwareStats();
                if (!mounted) return;
                if (hwData) setGpuStats(hwData);

                // Only query Comfy system stats when Comfy is reported online.
                if (comfy.isConnected) {
                    const sysData = await comfyService.getSystemStats();
                    if (!mounted) return;
                    if (sysData) setStats(sysData);
                } else {
                    setStats(null);
                }
            } catch {
                // Keep UI quiet during startup/offline
            }
        };

        update();
        const interval = setInterval(update, 3000);
        return () => {
            mounted = false;
            clearInterval(interval);
        };
    }, [comfy.isConnected]);

    const gpu = useMemo(() => {
        if (!stats?.devices?.length) return null;
        const device = stats.devices[0];
        const total = Number(device.vram_total || 0);
        const free = Number(device.vram_free || 0);
        const used = Math.max(0, total - free);
        const percent = total > 0 ? Math.round((used / total) * 100) : 0;
        return {
            name: String(device.name || '').replace('NVIDIA GeForce ', ''),
            usedGiB: (used / (1024 ** 3)).toFixed(1),
            totalGiB: (total / (1024 ** 3)).toFixed(1),
            percent,
            temp: gpuStats?.gpu?.temperature ?? null,
            load: gpuStats?.gpu?.utilization ?? percent,
        };
    }, [stats, gpuStats]);

    const handlePurge = async () => {
        if (purging) return;
        const ok = confirm('Purge VRAM now? This stops active generation and unloads models from GPU.');
        if (!ok) return;
        setPurging(true);
        try {
            await comfyService.freeMemory();
        } finally {
            setPurging(false);
        }
    };

    const comfyOnline = comfy.isConnected;
    const ollamaOnline = IS_RUNPOD ? true : ollama.isConnected;

    return (
        <div className="hidden xl:flex items-center gap-2">
            <div className="h-9 px-3 rounded-lg border border-white/10 bg-white/5 flex items-center gap-2 text-xs">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                {gpu ? (
                    <>
                        <span className="text-slate-200 font-medium">{gpu.name}</span>
                        {gpu.temp !== null && <span className="text-amber-400 font-semibold">{gpu.temp}°C</span>}
                        <span className="text-slate-400">{gpu.usedGiB}/{gpu.totalGiB} GB</span>
                        <span className="text-slate-500">{gpu.load}%</span>
                    </>
                ) : (
                    <span className="text-slate-400">GPU stats loading...</span>
                )}
            </div>

            <button
                onClick={handlePurge}
                disabled={purging}
                className="h-9 px-3 rounded-lg border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-300 text-xs font-semibold transition-all disabled:opacity-60 flex items-center gap-1.5"
                title="Purge VRAM"
            >
                {purging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                {purging ? 'Purging' : 'Purge VRAM'}
            </button>

            <div className={`h-9 px-3 rounded-lg border text-xs font-medium flex items-center gap-1.5 ${
                comfyOnline ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-white/5 text-slate-400'
            }`}>
                <Activity className="w-3.5 h-3.5" />
                {comfyOnline ? 'ComfyUI Online' : 'ComfyUI Starting'}
            </div>

            <div className={`h-9 px-3 rounded-lg border text-xs font-medium flex items-center gap-1.5 ${
                ollamaOnline ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-white/5 text-slate-400'
            }`}>
                {ollama.isLoading && !IS_RUNPOD ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                    <BrainCircuit className="w-3.5 h-3.5" />
                )}
                {IS_RUNPOD ? 'IF_AI_tools' : ollamaOnline ? 'Ollama Online' : 'Ollama Starting'}
            </div>
        </div>
    );
};
