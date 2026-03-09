import type { ElementType, ReactNode } from 'react';

interface CatalogShellProps {
    title: string;
    subtitle?: ReactNode;
    icon?: ElementType;
    actions?: ReactNode;
    children: ReactNode;
    maxWidthClassName?: string;
}

interface CatalogCardProps {
    children: ReactNode;
    className?: string;
}

export const CatalogShell = ({
    title,
    subtitle,
    icon: Icon,
    actions,
    children,
    maxWidthClassName = 'max-w-[1920px]',
}: CatalogShellProps) => {
    return (
        <div className={`p-8 mx-auto space-y-6 ${maxWidthClassName}`}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-3">
                    {Icon && <Icon className="w-8 h-8 text-white" />}
                    <div>
                        <h1 className="text-3xl font-bold text-white">{title}</h1>
                        {subtitle ? <p className="text-slate-400">{subtitle}</p> : null}
                    </div>
                </div>

                {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
            </div>

            {children}
        </div>
    );
};

export const CatalogCard = ({ children, className = 'p-6' }: CatalogCardProps) => {
    return (
        <div className={`bg-[#121218] border border-white/5 rounded-2xl ${className}`}>
            {children}
        </div>
    );
};
