import { type ReactNode, useState, useEffect } from 'react';
import { PanelRightOpen, PanelRightClose } from 'lucide-react';

interface WorkbenchShellProps {
    topBar?: ReactNode;
    leftPane: ReactNode;
    rightPane: ReactNode;
    leftWidthClassName?: string;
    leftPaneClassName?: string;
    rightPaneClassName?: string;
    collapsible?: boolean;
    collapseKey?: string;
    forceExpand?: boolean;
}

export const WorkbenchShell = ({
    topBar,
    leftPane,
    rightPane,
    leftWidthClassName = 'w-[480px]',
    leftPaneClassName = 'p-5',
    rightPaneClassName = '',
    collapsible = false,
    collapseKey = 'workbench_preview_collapsed',
    forceExpand = false,
}: WorkbenchShellProps) => {
    const [collapsed, setCollapsed] = useState(() => {
        if (!collapsible) return false;
        try { return localStorage.getItem(collapseKey) === '1'; } catch { return false; }
    });

    useEffect(() => {
        if (!collapsible) return;
        try { localStorage.setItem(collapseKey, collapsed ? '1' : '0'); } catch {}
    }, [collapsed, collapsible, collapseKey]);

    useEffect(() => {
        if (forceExpand && collapsed) setCollapsed(false);
    }, [forceExpand, collapsed]);

    const isCollapsed = collapsible && collapsed;

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {topBar}

            <div className="flex flex-1 overflow-hidden">
                <aside className={`${isCollapsed ? 'flex-1' : leftWidthClassName} flex flex-col border-r border-white/5 bg-[#0d0d14] transition-all duration-200`}>
                    {collapsible && (
                        <div className="flex items-center justify-end px-3 py-1.5 border-b border-white/5">
                            <button
                                onClick={() => setCollapsed(!collapsed)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium text-slate-300 bg-white/5 hover:text-white hover:bg-white/10 transition-colors border border-white/10"
                            >
                                {isCollapsed ? (
                                    <><PanelRightOpen className="w-3.5 h-3.5" /> Show Preview</>
                                ) : (
                                    <><PanelRightClose className="w-3.5 h-3.5" /> Hide Preview</>
                                )}
                            </button>
                        </div>
                    )}
                    <div className={`flex-1 overflow-y-auto custom-scrollbar ${leftPaneClassName} ${isCollapsed ? 'max-w-3xl mx-auto w-full' : ''}`}>
                        {leftPane}
                    </div>
                </aside>

                {!isCollapsed && (
                    <section className={`flex-1 flex flex-col bg-black relative ${rightPaneClassName}`}>
                        {rightPane}
                    </section>
                )}
            </div>
        </div>
    );
};
