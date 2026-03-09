import type { ReactNode } from 'react';

interface WorkbenchShellProps {
    topBar?: ReactNode;
    leftPane: ReactNode;
    rightPane: ReactNode;
    leftWidthClassName?: string;
    leftPaneClassName?: string;
    rightPaneClassName?: string;
}

export const WorkbenchShell = ({
    topBar,
    leftPane,
    rightPane,
    leftWidthClassName = 'w-[420px]',
    leftPaneClassName = 'p-5',
    rightPaneClassName = '',
}: WorkbenchShellProps) => {
    return (
        <div className="flex flex-col h-full overflow-hidden">
            {topBar}

            <div className="flex flex-1 overflow-hidden">
                <aside className={`${leftWidthClassName} flex flex-col border-r border-white/5 bg-[#0d0d14]`}>
                    <div className={`flex-1 overflow-y-auto custom-scrollbar ${leftPaneClassName}`}>
                        {leftPane}
                    </div>
                </aside>

                <section className={`flex-1 flex flex-col bg-black relative ${rightPaneClassName}`}>
                    {rightPane}
                </section>
            </div>
        </div>
    );
};
