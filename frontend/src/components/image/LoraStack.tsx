import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/Button';

export interface SelectedLora {
    name: string;
    strength: number;
}

interface LoraStackProps {
    selectedLoras: SelectedLora[];
    setSelectedLoras: (loras: SelectedLora[]) => void;
    availableLoras: string[];
}

/** Convert a lora path like "zimage_turbo\Alex_Kingston_PMv1a_ZImage.safetensors" to "Alex Kingston" */
function loraDisplayName(path: string): string {
    // Handle both Windows (\) and Unix (/) path separators
    const stem = path.replace(/\\/g, '/').split('/').pop()?.replace(/\.safetensors$/i, '') ?? path;
    return stem.replace(/_PMv\d+[ab]_ZImage$/i, '').replace(/_/g, ' ');
}

export const LoraStack = ({ selectedLoras, setSelectedLoras, availableLoras }: LoraStackProps) => {
    const [searchText, setSearchText] = useState('');
    const [currentLora, setCurrentLora] = useState('');
    const [currentLoraStrength, setCurrentLoraStrength] = useState(1.0);
    const [showLoraList, setShowLoraList] = useState(false);

    const filteredLoras = availableLoras.filter(l =>
        loraDisplayName(l).toLowerCase().includes(searchText.toLowerCase()) ||
        l.toLowerCase().includes(searchText.toLowerCase())
    );

    const addLora = () => {
        if (!currentLora) return;
        if (selectedLoras.some(l => l.name === currentLora)) return;
        setSelectedLoras([...selectedLoras, { name: currentLora, strength: currentLoraStrength }]);
        setCurrentLora('');
        setSearchText('');
        setCurrentLoraStrength(1.0);
        setShowLoraList(false);
    };

    const removeLora = (index: number) => {
        setSelectedLoras(selectedLoras.filter((_, i) => i !== index));
    };

    return (
        <div className="space-y-4 pt-4 border-t border-white/5">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] block mb-2">LoRA Stack</label>
            <div className="space-y-3 bg-white/[0.02] p-4 rounded-2xl border border-white/5">
                <div className="relative">
                    <input
                        type="text"
                        value={currentLora ? loraDisplayName(currentLora) : searchText}
                        onChange={(e) => { setSearchText(e.target.value); setCurrentLora(''); setShowLoraList(true); }}
                        onFocus={() => setShowLoraList(true)}
                        onBlur={() => setTimeout(() => setShowLoraList(false), 200)}
                        placeholder="Search LoRAs..."
                        className="w-full bg-[#0a0a0f] border border-white/10 rounded-xl pl-4 pr-10 py-3 text-xs text-white/90 focus:outline-none focus:border-emerald-500/20 transition-all"
                    />
                    {showLoraList && filteredLoras.length > 0 && (
                        <div className="absolute z-50 w-full mt-2 bg-[#121218] border border-white/10 rounded-2xl shadow-2xl max-h-60 overflow-y-auto custom-scrollbar">
                            {filteredLoras.map((l, idx) => (
                                <button key={idx} onClick={() => { setCurrentLora(l); setSearchText(''); setShowLoraList(false); }}
                                    className="w-full text-left px-5 py-3 text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors border-b border-white/[0.02] last:border-0">{loraDisplayName(l)}</button>
                            ))}
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex-1 space-y-2">
                        <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                            <span>Strength</span>
                            <span className="text-emerald-500 font-mono">{currentLoraStrength.toFixed(1)}</span>
                        </div>
                        <input type="range" min="-2" max="2" step="0.1" value={currentLoraStrength}
                            onChange={(e) => setCurrentLoraStrength(parseFloat(e.target.value))}
                            className="w-full h-1 bg-white/5 rounded-full appearance-none outline-none accent-white cursor-pointer" />
                    </div>
                    <Button variant="secondary" size="sm" onClick={addLora} disabled={!currentLora} className="h-10 px-6 rounded-xl text-[10px] font-black uppercase tracking-widest border-white/10 bg-white/5 hover:bg-white/10">Add</Button>
                </div>
            </div>

            {selectedLoras.length > 0 && (
                <div className="grid gap-2">
                    {selectedLoras.map((l, idx) => (
                        <div key={idx} className="flex items-center justify-between bg-white/[0.03] px-4 py-3 rounded-xl text-xs border border-white/5 group hover:border-white/10 transition-all">
                            <div className="flex flex-col gap-0.5">
                                <span className="text-white/80 font-bold truncate max-w-[180px]" title={l.name}>{loraDisplayName(l.name)}</span>
                                <span className="text-[10px] text-emerald-500/60 font-mono">Weight: {l.strength}</span>
                            </div>
                            <button onClick={() => removeLora(idx)} className="p-2 text-slate-500 hover:text-red-400 transition-colors bg-white/5 rounded-lg opacity-0 group-hover:opacity-100">
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
