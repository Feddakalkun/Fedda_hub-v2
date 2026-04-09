import { useMemo, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

interface LoraSelectorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  strength: number;
  onStrengthChange: (value: number) => void;
  options: string[];
  accent?: 'violet' | 'emerald';
}

const ACCENT = {
  violet: {
    ring: 'focus:border-violet-500/40',
    active: 'border-violet-500/35 bg-violet-500/10 text-violet-300',
    badge: 'text-violet-400/70',
    slider: 'accent-violet-500',
  },
  emerald: {
    ring: 'focus:border-emerald-500/40',
    active: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300',
    badge: 'text-emerald-400/70',
    slider: 'accent-emerald-500',
  },
};

function toLabel(path: string) {
  const stem = path.replace(/\\/g, '/').split('/').pop()?.replace(/\.safetensors$/i, '') ?? path;
  return stem.replace(/_PMv\d+[ab]_ZImage$/i, '').replace(/_/g, ' ');
}

export const LoraSelector = ({
  label,
  value,
  onChange,
  strength,
  onStrengthChange,
  options,
  accent = 'violet',
}: LoraSelectorProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const token = ACCENT[accent];

  const filtered = useMemo(
    () => options.filter((o) => toLabel(o).toLowerCase().includes(query.toLowerCase())),
    [options, query],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/25">{label}</span>
        {value && (
          <button
            onClick={() => onChange('')}
            className="flex items-center gap-1 text-[8px] font-bold text-white/15 hover:text-red-400 transition-colors uppercase tracking-widest"
          >
            <X className="w-2.5 h-2.5" /> Clear
          </button>
        )}
      </div>

      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all text-left ${
          value ? token.active : 'bg-white/[0.02] border-white/[0.06] text-white/45 hover:text-white/70'
        }`}
      >
        <span className="truncate text-[11px] font-semibold">{value ? toLabel(value) : 'No LoRA selected'}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="rounded-xl border border-white/[0.08] bg-[#0d0d12] p-2.5 space-y-2">
          <div className="relative">
            <Search className="w-3 h-3 text-white/20 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${options.length} LoRAs...`}
              className={`w-full bg-black/30 border border-white/[0.08] rounded-lg pl-8 pr-3 py-2 text-[11px] text-white/70 placeholder-white/20 outline-none ${token.ring}`}
            />
          </div>
          <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-1">
            <button
              onClick={() => { onChange(''); setOpen(false); }}
              className="w-full text-left px-2.5 py-2 rounded-lg text-[11px] text-white/40 hover:bg-white/[0.05] hover:text-white/80 transition-colors"
            >
              None (use workflow default)
            </button>
            {filtered.map((item) => (
              <button
                key={item}
                onClick={() => { onChange(item); setOpen(false); }}
                className={`w-full text-left px-2.5 py-2 rounded-lg text-[11px] transition-colors ${
                  value === item
                    ? 'bg-white/[0.08] text-white'
                    : 'text-white/50 hover:bg-white/[0.05] hover:text-white/85'
                }`}
              >
                {toLabel(item)}
              </button>
            ))}
          </div>
        </div>
      )}

      {value && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-white/20">
            <span>Strength</span>
            <span className={`font-mono ${token.badge}`}>{strength.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={strength}
            onChange={(e) => onStrengthChange(Number(e.target.value))}
            className={`w-full h-1 rounded-full appearance-none outline-none cursor-pointer ${token.slider}`}
          />
        </div>
      )}
    </div>
  );
};

