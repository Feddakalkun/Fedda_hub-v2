import { useState, useEffect } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { comfyService } from '../../services/comfyService';
import { useComfyExecution } from '../../contexts/ComfyExecutionContext';
import { useToast } from '../ui/Toast';
import { PromptInput } from './PromptInput';
import { DimensionSelector } from './DimensionSelector';
import { BACKEND_API } from '../../config/api';
import { usePersistentState } from '../../hooks/usePersistentState';

interface PersonConfig {
    lora: string;
    strength: number;
    description: string;
    label: string;
}

interface HQPortraitTabProps {
    isGenerating: boolean;
    setIsGenerating: (v: boolean) => void;
}

export const HQPortraitTab = ({ isGenerating, setIsGenerating }: HQPortraitTabProps) => {
    const { queueWorkflow } = useComfyExecution();
    const { toast } = useToast();

    const [prompt, setPrompt] = usePersistentState('image_hq_prompt', '');
    const [negativePrompt, setNegativePrompt] = usePersistentState('image_hq_negative', 'cartoon, anime, 3d render, bad anatomy, blurry, watermark, face hidden, flat lighting');
    const [showAdvanced, setShowAdvanced] = usePersistentState('image_hq_show_advanced', false);
    const [steps, setSteps] = usePersistentState('image_hq_steps', 20);
    const [cfg, setCfg] = usePersistentState('image_hq_cfg', 1.1);
    const [dimensions, setDimensions] = usePersistentState('image_hq_dimensions', '768x1152');
    const [dualPersonMode, setDualPersonMode] = usePersistentState('image_hq_dual_person_mode', false);

    const [personA, setPersonA] = usePersistentState<PersonConfig>('image_hq_person_a', { lora: '', strength: 0.95, description: '', label: 'man' });
    const [personB, setPersonB] = usePersistentState<PersonConfig>('image_hq_person_b', { lora: '', strength: 0.95, description: '', label: 'woman' });
    const [showPersonALoraList, setShowPersonALoraList] = useState(false);
    const [showPersonBLoraList, setShowPersonBLoraList] = useState(false);
    const [personALoraSearch, setPersonALoraSearch] = useState('');
    const [personBLoraSearch, setPersonBLoraSearch] = useState('');

    const [availableLoras, setAvailableLoras] = useState<string[]>([]);
    const [loraDescriptions, setLoraDescriptions] = useState<Record<string, string>>({});

    useEffect(() => {
        const load = async () => {
            try {
                const loras = await comfyService.getLoras();
                setAvailableLoras(loras);
                try {
                    const descResp = await fetch('/api/lora/descriptions');
                    if (descResp.ok) {
                        const descData = await descResp.json();
                        if (descData.descriptions) setLoraDescriptions(descData.descriptions);
                    }
                } catch { /* optional */ }
            } catch (err) { console.error("Failed to load data", err); }
        };
        load();
    }, []);

    const selectPersonLora = (person: 'A' | 'B', lora: string) => {
        const desc = loraDescriptions[lora] || '';
        if (person === 'A') {
            setPersonA(prev => ({ ...prev, lora, description: prev.description || desc }));
            setPersonALoraSearch(''); setShowPersonALoraList(false);
        } else {
            setPersonB(prev => ({ ...prev, lora, description: prev.description || desc }));
            setPersonBLoraSearch(''); setShowPersonBLoraList(false);
        }
    };

    const handleGenerate = async () => {
        if (!prompt.trim()) return;
        if (!personA.lora) {
            toast('Select a LoRA for Person A first', 'error');
            return;
        }
        setIsGenerating(true);
        try {
            const response = await fetch('/workflows/zimage-HQ.json');
            if (!response.ok) throw new Error('Failed to load workflow');
            const workflow = await response.json();

            const activeSeed = Math.floor(Math.random() * 1000000000000000);

            // Expand wildcards
            let finalPrompt = prompt;
            if (prompt.includes('__')) {
                try {
                    const expandResp = await fetch(`${BACKEND_API.BASE_URL}/api/wildcards/expand?text=${encodeURIComponent(prompt)}`);
                    const expandData = await expandResp.json();
                    if (expandData.success) finalPrompt = expandData.expanded;
                } catch { /* use raw */ }
            }

            // Node 46: KSampler
            workflow["46"].inputs.seed = activeSeed;
            workflow["46"].inputs.steps = steps;
            workflow["46"].inputs.cfg = cfg;

            // Node 5: Positive Prompt (CLIPTextEncode)
            let fullPrompt = finalPrompt;
            if (dualPersonMode && personB.description) {
                fullPrompt = `${finalPrompt}, ${personB.description}`;
            }
            workflow["5"].inputs.text = fullPrompt;

            // Node 6: Negative prompt
            workflow["6"].inputs.text = negativePrompt;

            // Node 19: Dimensions
            const [w, h] = dimensions.split('x').map(Number);
            workflow["19"].inputs.width = w;
            workflow["19"].inputs.height = h;

            // Detailer guide size matches largest dimension
            const maxDim = Math.max(w, h);
            workflow["102"].inputs.guide_size = maxDim;
            workflow["102"].inputs.max_size = maxDim;

            // Detailer seed
            workflow["102"].inputs.seed = Math.floor(Math.random() * 1000000000000000);

            if (dualPersonMode) {
                // Dual person mode
                const loraA = personA.lora;
                const strA = personA.strength;
                const loraB = personB.lora || personA.lora; // fallback to A if B not set
                const strB = personB.lora ? personB.strength : 0;

                // Node 125: Person A LoRA (Main)
                workflow["125"].inputs.lora_name = loraA;
                workflow["125"].inputs.strength_model = strA;
                workflow["125"].inputs.strength_clip = strA;

                // Node 124: Person B LoRA (Detailer)
                workflow["124"].inputs.lora_name = loraB;
                workflow["124"].inputs.strength_model = strB;
                workflow["124"].inputs.strength_clip = strB;

                // Person labels for Florence2
                workflow["53"].inputs.text_input = personA.label || "person";
                // Person index hardcoded in workflow

                // Detailer face descriptions
                if (personA.description) workflow["65"].inputs.text = personA.description;

                // Save to dual person path
                workflow["145"].inputs.filename_prefix = "FEDDA/Image/z-image-2person";
            } else {
                // Single person mode
                const loraA = personA.lora;
                const strA = personA.strength;

                workflow["125"].inputs.lora_name = loraA;
                workflow["125"].inputs.strength_model = strA;
                workflow["125"].inputs.strength_clip = strA;
                
                // Same LoRA for detailer
                workflow["124"].inputs.lora_name = loraA;
                workflow["124"].inputs.strength_model = strA;
                workflow["124"].inputs.strength_clip = strA;

                if (personA.description) {
                    workflow["65"].inputs.text = personA.description;
                }

                workflow["53"].inputs.text_input = personA.label || "person";
                // Person index hardcoded in workflow
            }

            await queueWorkflow(workflow);
        } catch (error: any) {
            console.error('Generation failed:', error);
            toast(error?.message || 'Generation failed!', 'error');
            setIsGenerating(false);
        }
    };

    const renderPersonCard = (person: 'A' | 'B') => {
        const config = person === 'A' ? personA : personB;
        const setConfig = person === 'A' ? setPersonA : setPersonB;
        const showList = person === 'A' ? showPersonALoraList : showPersonBLoraList;
        const setShowList = person === 'A' ? setShowPersonALoraList : setShowPersonBLoraList;
        const search = person === 'A' ? personALoraSearch : personBLoraSearch;
        const setSearch = person === 'A' ? setPersonALoraSearch : setPersonBLoraSearch;
        const color = person === 'A' ? 'purple' : 'blue';

        return (
            <div className={`bg-${color}-500/5 border border-${color}-500/20 rounded-xl p-4 space-y-3`}>
                <label className={`block text-xs font-bold text-${color}-300 uppercase tracking-wider`}>Person {person}</label>
                <div className="relative">
                    <input type="text"
                        value={config.lora ? config.lora : search}
                        onChange={(e) => { setSearch(e.target.value); setConfig({ ...config, lora: '' }); setShowList(true); }}
                        onFocus={() => setShowList(true)}
                        onBlur={() => setTimeout(() => setShowList(false), 200)}
                        placeholder="Select LoRA..."
                        className={`w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-${color}-500/30`}
                    />
                    {config.lora && (
                        <button onClick={() => setConfig({ ...config, lora: '' })} className="absolute right-2 top-2 text-slate-500 hover:text-red-400">
                            <X className="w-4 h-4" />
                        </button>
                    )}
                    {showList && (
                        <div className="absolute z-50 w-full mt-1 bg-[#1a1a24] border border-white/10 rounded-xl shadow-2xl max-h-40 overflow-y-auto custom-scrollbar">
                            {availableLoras.filter(l => l.toLowerCase().includes(search.toLowerCase())).map((l, idx) => (
                                <button key={idx} onClick={() => selectPersonLora(person, l)}
                                    className="w-full text-left px-4 py-2 text-sm text-slate-300 hover:bg-white/10 hover:text-white transition-colors">{l}</button>
                            ))}
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500 w-8">Str</span>
                    <input type="range" min="0" max="2" step="0.05" value={config.strength}
                        onChange={(e) => setConfig({ ...config, strength: parseFloat(e.target.value) })}
                        className={`flex-1 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-${color}-400`} />
                    <span className="text-xs text-slate-400 w-8 text-right">{config.strength}</span>
                </div>
                <input type="text" value={config.label} onChange={(e) => setConfig({ ...config, label: e.target.value })}
                    placeholder="Florence2 label (e.g. man)"
                    className={`w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-${color}-500/30`} />
                <textarea value={config.description} onChange={(e) => setConfig({ ...config, description: e.target.value })}
                    placeholder={`Person ${person} face description for detailer...`}
                    className={`w-full h-16 bg-[#0a0a0f] border border-white/10 rounded-lg p-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-${color}-500/30 resize-none`} />
            </div>
        );
    };

    return (
        <div className="space-y-6">
            <PromptInput
                prompt={prompt} setPrompt={setPrompt}
                negativePrompt={negativePrompt} setNegativePrompt={setNegativePrompt}
                isGenerating={isGenerating} onGenerate={handleGenerate}
                showNegative={false}
            />

            {/* Person Config */}
            <div className="bg-[#121218] border border-white/5 rounded-2xl p-6 shadow-xl space-y-4">
                <div className="flex items-center justify-between border-b border-white/5 pb-4">
                    <label className="text-xs text-slate-400 uppercase tracking-wider">Dual Person Mode</label>
                    <button onClick={() => setDualPersonMode(!dualPersonMode)}
                        className={`w-12 h-6 rounded-full transition-colors duration-200 flex items-center px-1 ${dualPersonMode ? 'bg-purple-600' : 'bg-slate-700'}`}>
                        <div className={`w-4 h-4 bg-white rounded-full transition-transform duration-200 ${dualPersonMode ? 'translate-x-6' : 'translate-x-0'}`} />
                    </button>
                </div>

                {renderPersonCard('A')}
                {dualPersonMode && renderPersonCard('B')}
            </div>

            {/* Advanced Settings */}
            <div className="bg-[#121218] border border-white/5 rounded-2xl p-6 shadow-xl">
                <button onClick={() => setShowAdvanced(!showAdvanced)} className="w-full flex items-center justify-between text-sm font-medium text-slate-300 hover:text-white transition-colors">
                    <span>Advanced Settings</span>
                    <ChevronRight className={`w-4 h-4 transition-transform duration-200 ${showAdvanced ? 'rotate-90' : ''}`} />
                </button>

                {showAdvanced && (
                    <div className="mt-4 space-y-4 animate-in slide-in-from-top-2 fade-in duration-200">
                        <div>
                            <label className="block text-xs text-slate-400 mb-2 uppercase tracking-wider">Negative Prompt</label>
                            <textarea value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)}
                                className="w-full h-24 bg-[#0a0a0f] border border-white/10 rounded-xl p-3 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-white/20 resize-none transition-all"
                                placeholder="Things to avoid..." />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-400 mb-2">Steps: {steps}</label>
                            <input type="range" min="1" max="50" value={steps} onChange={(e) => setSteps(parseInt(e.target.value))} className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-white" />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-400 mb-2">CFG Scale: {cfg}</label>
                            <input type="range" min="1" max="4" step="0.1" value={cfg} onChange={(e) => setCfg(parseFloat(e.target.value))} className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-white" />
                            <p className="text-[10px] text-slate-600 mt-1">FLUX models work best at 1.0–2.0</p>
                        </div>

                        {/* Dimensions */}
                        <DimensionSelector dimensions={dimensions} setDimensions={setDimensions} />
                    </div>
                )}
            </div>
        </div>
    );
};

