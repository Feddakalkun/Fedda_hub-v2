import { TerminalSquare } from 'lucide-react';
import { CatalogShell, CatalogCard } from '../components/layout/CatalogShell';

export const ConsoleLogsPage = () => {
    return (
        <CatalogShell
            title="Console Logs"
            subtitle="Runtime status and diagnostics in-app"
            icon={TerminalSquare}
            maxWidthClassName="max-w-6xl"
        >
            <CatalogCard className="p-6 h-[calc(100vh-260px)] overflow-auto font-mono text-xs">
                <div className="text-slate-500 space-y-2">
                    <p>[INFO] ComfyFront initialized</p>
                    <p>[INFO] Connecting to ComfyUI backend...</p>
                    <p className="text-emerald-400">[SUCCESS] Connected to ComfyUI</p>
                    <p>[INFO] UI layout system: unified</p>
                    <p>[INFO] Use page-level toasts and inline alerts for detailed errors</p>
                </div>
            </CatalogCard>
        </CatalogShell>
    );
};
