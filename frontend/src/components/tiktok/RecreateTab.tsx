import { useState, useEffect } from 'react';
import { Loader2, Wand2, Image } from 'lucide-react';
import { LoraStack } from '../image/LoraStack';
import type { SelectedLora } from '../image/LoraStack';
import { comfyService } from '../../services/comfyService';
import { useComfyExecution } from '../../contexts/ComfyExecutionContext';
import { useToast } from '../ui/Toast';
import { usePersistentState } from '../../hooks/usePersistentState';

interface FrameData {
    path: string;
    url: string;
    caption: string;
}

interface RecreateTabProps {
    frames: FrameData[];
}

export const RecreateTab = ({ frames }: RecreateTabProps) => {
    const { toast } = useToast();
    const { queueWorkflow, lastCompletedPromptId, lastOutputImages, outputReadyCount } = useComfyExecution();

    const [selectedLoras, setSelectedLoras] = usePersistentState<SelectedLora[]>('tiktok_recreate_selected_loras', []);
    const [availableLoras, setAvailableLoras] = useState<string[]>([]);
    const [denoise, setDenoise] = usePersistentState('tiktok_recreate_denoise', 0.55);
    const [generating, setGenerating] = useState(false);
    const [results, setResults] = useState<Record<number, string>>({});

    useEffect(() => {
        const load = async () => {
            try {
                const loras = await comfyService.getLoras();
                setAvailableLoras(loras);
            } catch (err) {
                toast(`Failed to load LoRAs: ${err instanceof Error ? err.message : String(err)}`, 'error');
            }
        };
        load();
    }, []);

    // Capture completed images
    useEffect(() => {
        if (!lastCompletedPromptId || lastOutputImages.length === 0) return;
        const url = comfyService.getImageUrl(
            lastOutputImages[0].filename,
            lastOutputImages[0].subfolder,
            lastOutputImages[0].type
        );
        // Find which frame index this result belongs to (stored in generating state)
        setResults(prev => {
            const nextIdx = Object.keys(prev).length;
            return { ...prev, [nextIdx]: url };
        });
    }, [lastCompletedPromptId, outputReadyCount]);

    const handleGenerateAll = async () => {
        if (frames.length === 0) return;
        setGenerating(true);
        setResults({});

        try {
            const workflowRes = await fetch('/workflows/zimageimg2img.json');
            if (!workflowRes.ok) throw new Error('Failed to load img2img workflow');
            const baseWorkflow = await workflowRes.json();

            for (let i = 0; i < frames.length; i++) {
                const frame = frames[i];
                if (!frame.caption) continue;

                // Upload the frame to ComfyUI
                const imgRes = await fetch(frame.url);
                const blob = await imgRes.blob();
                const file = new File([blob], `tiktok_frame_${i}.png`, { type: 'image/png' });
                const uploaded = await comfyService.uploadImage(file);

                const workflow = JSON.parse(JSON.stringify(baseWorkflow));

                const prompt = frame.caption;

                // Set input image (look for LoadImage node)
                for (const nodeId of Object.keys(workflow)) {
                    const node = workflow[nodeId];
                    if (node.class_type === 'LoadImage') {
                        node.inputs.image = uploaded.name;
                    }
                    if (node.class_type === 'KSampler') {
                        node.inputs.denoise = denoise;
                        node.inputs.seed = Math.floor(Math.random() * 1000000000000000);
                    }
                    if (node.class_type === 'CLIPTextEncode' && node.inputs?.text !== undefined) {
                        // Assume first CLIP text encode is positive prompt
                        if (!node._tagged) {
                            node.inputs.text = prompt;
                            node._tagged = true;
                        }
                    }
                }

                // Apply LoRAs
                if (selectedLoras.length > 0) {
                    for (const nodeId of Object.keys(workflow)) {
                        const node = workflow[nodeId];
                        if (node.class_type === 'Power Lora Loader (rgthree)') {
                            selectedLoras.forEach((lora, loraIdx) => {
                                const key = `lora_${loraIdx + 1}`;
                                node.inputs[key] = {
                                    on: true,
                                    lora: lora.name,
                                    strength: lora.strength,
                                };
                            });
                        }
                    }
                }

                // Clean up temp tags
                for (const nodeId of Object.keys(workflow)) {
                    delete workflow[nodeId]._tagged;
                }

                await queueWorkflow(workflow);
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            toast(`Recreation failed: ${msg}`, 'error');
        } finally {
            setGenerating(false);
        }
    };

    if (frames.length === 0) {
        return (
            <div className="text-center py-12 text-slate-500">
                <Wand2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No frames to recreate</p>
                <p className="text-xs mt-1">Extract and caption frames first, then send them here</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* LoRA Selection */}
            <div className="bg-[#121218] border border-white/5 rounded-2xl p-4 space-y-3">
                <div className="text-xs font-bold uppercase tracking-widest text-slate-500">LoRA Selection</div>
                <LoraStack
                    selectedLoras={selectedLoras}
                    setSelectedLoras={setSelectedLoras}
                    availableLoras={availableLoras}
                />
            </div>

            {/* Denoise Strength */}
            <div className="bg-[#121218] border border-white/5 rounded-2xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                    <label className="text-xs text-slate-400">Denoise Strength</label>
                    <span className="text-xs font-mono text-white">{denoise.toFixed(2)}</span>
                </div>
                <input
                    type="range"
                    min={0.1}
                    max={1.0}
                    step={0.05}
                    value={denoise}
                    onChange={e => setDenoise(parseFloat(e.target.value))}
                    className="w-full accent-white"
                />
                <div className="flex justify-between text-[9px] text-slate-600">
                    <span>Keep composition</span>
                    <span>Full creative freedom</span>
                </div>
            </div>

            {/* Generate Button */}
            <button
                onClick={handleGenerateAll}
                disabled={generating || frames.every(f => !f.caption)}
                className="w-full py-3 rounded-xl font-bold text-sm tracking-wider uppercase transition-all bg-white text-black hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
            >
                {generating ? <Loader2 className="w-4 h-4 inline animate-spin mr-2" /> : <Wand2 className="w-4 h-4 inline mr-2" />}
                {generating ? 'Generating...' : `Recreate ${frames.filter(f => f.caption).length} Frames`}
            </button>

            {/* Results Comparison */}
            <div className="grid grid-cols-2 gap-3">
                {frames.map((frame, idx) => (
                    <div key={idx} className="space-y-1">
                        <div className="text-[9px] text-slate-600 uppercase tracking-wider">Frame {idx + 1}</div>
                        <div className="grid grid-cols-2 gap-1">
                            {/* Original */}
                            <div className="relative">
                                <img src={frame.url} className="w-full aspect-video object-cover rounded-lg" alt="" />
                                <span className="absolute bottom-1 left-1 text-[8px] bg-black/70 text-slate-300 px-1.5 py-0.5 rounded">Original</span>
                            </div>
                            {/* Recreated */}
                            <div className="relative">
                                {results[idx] ? (
                                    <img src={results[idx]} className="w-full aspect-video object-cover rounded-lg" alt="" />
                                ) : (
                                    <div className="w-full aspect-video bg-white/5 rounded-lg flex items-center justify-center">
                                        {generating ? (
                                            <Loader2 className="w-4 h-4 text-slate-600 animate-spin" />
                                        ) : (
                                            <Image className="w-4 h-4 text-slate-700" />
                                        )}
                                    </div>
                                )}
                                <span className="absolute bottom-1 left-1 text-[8px] bg-black/70 text-slate-300 px-1.5 py-0.5 rounded">Recreated</span>
                            </div>
                        </div>
                        {frame.caption && (
                            <div className="text-[9px] text-slate-600 truncate">{frame.caption}</div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

