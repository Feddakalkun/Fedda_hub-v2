import type { ReactNode } from 'react';

interface PlaceholderPageProps {
  icon?: ReactNode;
  label: string;
  description?: string;
}

export const PlaceholderPage = ({ icon, label, description }: PlaceholderPageProps) => {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-6 select-none">
      {/* Soft glow orb behind icon */}
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-white/5 blur-2xl scale-[2]" />
        <div className="relative w-20 h-20 rounded-2xl bg-white/5 border border-white/8 flex items-center justify-center text-slate-400">
          {icon ?? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-8 h-8"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          )}
        </div>
      </div>

      <div className="text-center space-y-2 max-w-sm">
        <h2 className="text-2xl font-bold text-white tracking-tight">{label}</h2>
        <p className="text-sm text-slate-500 leading-relaxed">
          {description ?? 'This section is ready to be built. Add your components here.'}
        </p>
      </div>

      <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/4 border border-white/8 text-[11px] text-slate-500 font-medium tracking-wide">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-600 animate-pulse" />
        Coming Soon
      </div>
    </div>
  );
};
