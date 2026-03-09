import type { ElementType } from 'react';

interface PageTabItem<T extends string> {
    id: T;
    label: string;
    icon: ElementType;
}

interface PageTabsProps<T extends string> {
    tabs: PageTabItem<T>[];
    activeTab: T;
    onChange: (tab: T) => void;
}

export const PageTabs = <T extends string>({ tabs, activeTab, onChange }: PageTabsProps<T>) => {
    return (
        <div className="px-8 pt-4 pb-0 flex gap-2">
            {tabs.map(({ id, label, icon: Icon }) => (
                <button
                    key={id}
                    onClick={() => onChange(id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-t-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 border border-b-0 ${
                        activeTab === id
                            ? 'bg-[#121218] text-white border-white/10'
                            : 'bg-transparent text-slate-500 border-transparent hover:text-slate-300 hover:bg-white/5'
                    }`}
                >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                </button>
            ))}
        </div>
    );
};
