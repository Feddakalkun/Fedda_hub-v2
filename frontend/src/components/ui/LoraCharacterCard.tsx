import { useMemo, useState } from 'react';
import { ChevronDown, Search, Trash2, UserRound, X } from 'lucide-react';

interface LoraCharacterCardProps {
  index: number;
  value: string;
  strength: number;
  options: string[];
  previewUrl?: string | null;
  accent?: 'violet' | 'emerald';
  onChange: (value: string) => void;
  onStrengthChange: (value: number) => void;
  onRemove?: () => void;
}

const ACCENT = {
  violet: {
    ring: 'focus:border-violet-500/40',
    active: 'border-violet-500/35 bg-violet-500/10 text-violet-300',
    badge: 'text-violet-400/80',
    slider: 'accent-violet-500',
    border: 'border-violet-500/25',
  },
  emerald: {
    ring: 'focus:border-emerald-500/40',
    active: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300',
    badge: 'text-emerald-400/80',
    slider: 'accent-emerald-500',
    border: 'border-emerald-500/25',
  },
};

function toLabel(path: string) {
  const stem = path.replace(/\\/g, '/').split('/').pop()?.replace(/\.safetensors$/i, '') ?? path;
  return stem.replace(/_PMv\d+[ab]_ZImage$/i, '').replace(/_/g, ' ');
}

export const LoraCharacterCard = ({
  index,
  value,
  strength,
  options,
  previewUrl,
  accent = 'emerald',
  onChange,
  onStrengthChange,
  onRemove,
}: LoraCharacterCardProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const token = ACCENT[accent];

  const filtered = useMemo(
    () => options.filter((o) => toLabel(o).toLowerCase().includes(query.toLowerCase())),
    [options, query],
  );

  const title = value ? toLabel(value) : 'Select character LoRA';

  return (
    <div className={`rounded-2xl border bg-white/[0.02] p-2.5 space-y-2.5 ${value ? token.border : 'border-white/[0.08]'}`}>
      <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-white/[0.08] bg-black/30">
        {previewUrl ? (
          <img src={previewUrl} alt={title} className="h-full w-full object-cover object-center" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-white/[0.08] to-black/30 flex items-center justify-center">
            <UserRound className="h-5 w-5 text-white/25" />
          </div>
        )}
        <div className="absolute left-1.5 top-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-white/70">
          LoRA {index + 1}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className={`flex-1 rounded-xl border px-2.5 py-2 text-left text-[11px] font-semibold transition-all ${
            value ? token.active : 'border-white/[0.08] bg-white/[0.02] text-white/45 hover:text-white/75'
          }`}
        >
          <span className="flex items-center justify-between gap-2">
            <span className="truncate">{title}</span>
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
          </span>
        </button>
        {onRemove && (
          <button
            onClick={onRemove}
            className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-2 text-white/30 transition-colors hover:border-red-500/30 hover:text-red-400"
            title="Remove LoRA"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="rounded-xl border border-white/[0.08] bg-[#0d0d12] p-2 space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-white/20" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${options.length} LoRAs...`}
              className={`w-full rounded-lg border border-white/[0.08] bg-black/30 py-2 pl-8 pr-3 text-[11px] text-white/70 placeholder-white/20 outline-none ${token.ring}`}
            />
          </div>
          <div className="max-h-40 overflow-y-auto custom-scrollbar space-y-1">
            <button
              onClick={() => { onChange(''); setOpen(false); }}
              className="w-full rounded-lg px-2.5 py-2 text-left text-[11px] text-white/40 transition-colors hover:bg-white/[0.05] hover:text-white/80"
            >
              None (use workflow default)
            </button>
            {filtered.map((item) => (
              <button
                key={item}
                onClick={() => { onChange(item); setOpen(false); }}
                className={`w-full rounded-lg px-2.5 py-2 text-left text-[11px] transition-colors ${
                  value === item ? 'bg-white/[0.08] text-white' : 'text-white/50 hover:bg-white/[0.05] hover:text-white/85'
                }`}
              >
                {toLabel(item)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-wider text-white/20">
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
          className={`w-full h-1 appearance-none rounded-full outline-none cursor-pointer ${token.slider}`}
        />
      </div>

      {value && (
        <button
          onClick={() => onChange('')}
          className="inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-widest text-white/20 transition-colors hover:text-red-400"
        >
          <X className="h-2.5 w-2.5" /> Clear
        </button>
      )}
    </div>
  );
};
