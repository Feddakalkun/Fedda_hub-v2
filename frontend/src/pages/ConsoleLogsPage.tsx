import { useEffect, useMemo, useState } from 'react';
import { TerminalSquare, Trash2, RefreshCw } from 'lucide-react';
import { CatalogShell, CatalogCard } from '../components/layout/CatalogShell';
import { UI_LOG_EVENT, clearUiLogs, getUiLogs } from '../services/uiLogger';

const levelColor: Record<string, string> = {
    info: 'text-slate-300',
    warn: 'text-amber-300',
    error: 'text-red-300',
    success: 'text-emerald-300',
};

export const ConsoleLogsPage = () => {
    const [logs, setLogs] = useState(() => getUiLogs());

    useEffect(() => {
        const refresh = () => setLogs(getUiLogs());
        window.addEventListener(UI_LOG_EVENT, refresh as EventListener);
        return () => window.removeEventListener(UI_LOG_EVENT, refresh as EventListener);
    }, []);

    const ordered = useMemo(() => [...logs].reverse(), [logs]);

    return (
        <CatalogShell
            title="Console Logs"
            subtitle="Runtime status and diagnostics in-app"
            icon={TerminalSquare}
            maxWidthClassName="max-w-6xl"
            actions={
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setLogs(getUiLogs())}
                        className="px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300"
                    >
                        <span className="inline-flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" />Refresh</span>
                    </button>
                    <button
                        onClick={() => {
                            clearUiLogs();
                            setLogs([]);
                        }}
                        className="px-3 py-1.5 text-xs rounded-lg border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-200"
                    >
                        <span className="inline-flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5" />Clear</span>
                    </button>
                </div>
            }
        >
            <CatalogCard className="p-4 h-[calc(100vh-260px)] overflow-auto font-mono text-xs space-y-2">
                {ordered.length === 0 ? (
                    <div className="text-slate-500">No logs yet.</div>
                ) : (
                    ordered.map((entry) => (
                        <div key={entry.id} className="border border-white/5 rounded-lg p-2 bg-black/20">
                            <div className="flex items-center gap-2 text-[11px]">
                                <span className="text-slate-500">[{new Date(entry.ts).toLocaleTimeString()}]</span>
                                <span className={levelColor[entry.level] || 'text-slate-300'}>[{entry.level.toUpperCase()}]</span>
                                <span className="text-cyan-300">[{entry.source}]</span>
                                <span className="text-slate-200">{entry.message}</span>
                            </div>
                            {entry.details && (
                                <pre className="mt-2 text-[11px] text-slate-400 whitespace-pre-wrap break-words">{entry.details}</pre>
                            )}
                        </div>
                    ))
                )}
            </CatalogCard>
        </CatalogShell>
    );
};
