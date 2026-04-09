import { useState } from 'react';
import { LoRADownloader } from '../components/LoRADownloader';

type Family = 'z-image' | 'flux2klein' | 'sd15' | 'sdxl' | 'wan';

const FAMILIES: { key: Family; label: string; desc: string }[] = [
  { key: 'z-image',   label: 'Z-Image',     desc: 'Turbo celeb & character LoRAs' },
  { key: 'flux2klein',label: 'FLUX2KLEIN',   desc: 'FLUX.2-klein & FLUX.1-dev packs' },
  { key: 'sd15',      label: 'SD 1.5',       desc: 'Classic portrait & style LoRAs' },
  { key: 'sdxl',      label: 'SDXL',         desc: 'High-res XL character models' },
  { key: 'wan',       label: 'WAN 2.2',      desc: 'WAN 2.2 LoRA packs' },
];

export const LibraryPage = () => {
  const [activeFamily, setActiveFamily] = useState<Family>('z-image');

  return (
    <div className="flex flex-col h-full bg-[#050505] overflow-hidden">

      {/* ─── Family tabs ─── */}
      <div className="shrink-0 flex items-center gap-1 px-8 pt-8 pb-0">
        {FAMILIES.map(f => (
          <button
            key={f.key}
            onClick={() => setActiveFamily(f.key)}
            className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${
              activeFamily === f.key
                ? 'bg-white text-black shadow-lg'
                : 'bg-white/[0.03] border border-white/5 text-white/30 hover:text-white/60 hover:bg-white/[0.06]'
            }`}
          >
            {f.label}
          </button>
        ))}
        <div className="ml-3 text-[10px] text-white/20 font-bold uppercase tracking-widest hidden sm:block">
          {FAMILIES.find(f => f.key === activeFamily)?.desc}
        </div>
      </div>

      {/* ─── Content ─── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <LoRADownloader family={activeFamily} />
      </div>

    </div>
  );
};
