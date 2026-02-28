// Live ComfyUI Execution Status Bar
// Shows under the header during workflow execution
import { useComfyExecution } from '../contexts/ComfyExecutionContext';
import { Loader2, Download, CheckCircle2, AlertTriangle } from 'lucide-react';

export const ExecutionStatusBar = () => {
    const {
        state,
        currentNodeName,
        progress,
        isDownloaderNode,
        error,
        totalNodes,
        completedNodes,
    } = useComfyExecution();

    // Don't render when idle
    if (state === 'idle') return null;

    // Error state
    if (state === 'error' && error) {
        // Suppress "Value not in list" errors (model selection errors)
        // since we handle these with our own Model Downloader UI
        if (error.message.includes('Value not in list')) return null;

        return (
            <div className="h-10 bg-red-500/10 border-b border-red-500/20 flex items-center px-6 gap-3 animate-in slide-in-from-top-2 duration-300">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <span className="text-sm font-medium text-red-300 truncate">
                    {error.message}
                </span>
                {error.nodeType && (
                    <span className="text-xs text-red-400/60 bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/10 shrink-0">
                        Install via ComfyUI Manager
                    </span>
                )}
            </div>
        );
    }

    // Done state (green, fades after 5s via context)
    if (state === 'done') {
        return (
            <div className="h-10 bg-emerald-500/10 border-b border-emerald-500/20 flex items-center px-6 gap-3 animate-in slide-in-from-top-2 duration-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-medium text-emerald-300">
                    Generation Complete
                </span>
                {/* Full green bar */}
                <div className="flex-1 h-1 bg-emerald-500/10 rounded-full overflow-hidden ml-4">
                    <div className="h-full w-full bg-emerald-400 rounded-full" />
                </div>
            </div>
        );
    }

    // Executing state
    const nodeCounter = totalNodes > 0
        ? `${completedNodes}/${totalNodes}`
        : '';

    return (
        <div className="h-10 bg-[#0d0d14] border-b border-white/5 flex items-center px-6 gap-3 animate-in slide-in-from-top-2 duration-300">
            {/* Icon: spinner, download, or cpu */}
            {isDownloaderNode ? (
                <Download className="w-4 h-4 text-blue-400 animate-bounce shrink-0" />
            ) : (
                <Loader2 className="w-4 h-4 text-white/60 animate-spin shrink-0" />
            )}

            {/* Node name */}
            <span className={`text-sm font-medium truncate ${isDownloaderNode ? 'text-blue-300' : 'text-slate-300'}`}>
                {currentNodeName}
            </span>

            {/* Node counter badge */}
            {nodeCounter && (
                <span className="text-[10px] text-slate-500 bg-white/5 px-1.5 py-0.5 rounded font-mono shrink-0">
                    {nodeCounter}
                </span>
            )}

            {/* Progress bar */}
            <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden ml-2">
                <div
                    className={`h-full rounded-full transition-all duration-300 ease-out ${isDownloaderNode
                        ? 'bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.4)]'
                        : 'bg-white/70 shadow-[0_0_8px_rgba(255,255,255,0.2)]'
                        }`}
                    style={{ width: `${progress}%` }}
                />
            </div>

            {/* Percentage */}
            {progress > 0 && (
                <span className="text-xs text-slate-400 font-mono w-8 text-right shrink-0">
                    {progress}%
                </span>
            )}
        </div>
    );
};
