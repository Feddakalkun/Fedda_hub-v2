import { useEffect, useMemo, useState } from 'react';
import { Lock, RefreshCw, Sun } from 'lucide-react';
import { comfyService } from '../../services/comfyService';
import { useComfyExecution } from '../../contexts/ComfyExecutionContext';
import { useToast } from '../ui/Toast';
import { ImageUpload } from './ImageUpload';
import { usePersistentState } from '../../hooks/usePersistentState';
import {
    HARD_LOCK_DEFAULTS,
    HARD_LOCK_NEGATIVE_PROMPT,
    HARD_LOCK_PRESERVE_PROMPT,
    MOOD_PRESETS,
    type MoodPresetKey,
    strengthToDenoise,
} from '../../config/moodPresets';

interface MoodEditTabProps {
    isGenerating: boolean;
    setIsGenerating: (v: boolean) => void;
    initialImageUrl?: string | null;
    onConsumeImage?: () => void;
}

export const MoodEditTab = ({ isGenerating, setIsGenerating, initialImageUrl, onConsumeImage }: MoodEditTabProps) => {
    const { queueWorkflow } = useComfyExecution();
    const { toast } = useToast();

    const [inputImage, setInputImage] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [selectedMood, setSelectedMood] = usePersistentState<MoodPresetKey>('image_mood_edit_preset', 'Sunset');
    const [strength, setStrength] = usePersistentState<number>('image_mood_edit_strength', HARD_LOCK_DEFAULTS.defaultStrength);
    const [customLightingNote, setCustomLightingNote] = usePersistentState('image_mood_edit_custom_note', '');
    const [lockSeed, setLockSeed] = usePersistentState('image_mood_edit_lock_seed', true);
    const [seed, setSeed] = usePersistentState('image_mood_edit_seed', Math.floor(Math.random() * 1000000000000000));

    useEffect(() => {
        if (initialImageUrl) onConsumeImage?.();
    }, [initialImageUrl, onConsumeImage]);

    const denoise = useMemo(() => strengthToDenoise(strength), [strength]);
    const warningActive = denoise > HARD_LOCK_DEFAULTS.warningDenoise;

    const handleImageSelected = (file: File) => {
        setInputImage(file);
        setPreviewUrl(URL.createObjectURL(file));
    };

    const handleClearImage = () => {
        setInputImage(null);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
    };

    const buildPositivePrompt = () => {
        const base = HARD_LOCK_PRESERVE_PROMPT;
        const mood = MOOD_PRESETS[selectedMood].lightingPrompt;
        const custom = customLightingNote.trim();
        return custom ? `${base}; ${mood}; ${custom}` : `${base}; ${mood}`;
    };

    const handleGenerate = async () => {
        if (!inputImage) {
            toast('Upload a reference image first', 'error');
            return;
        }

        setIsGenerating(true);
        try {
            const uploaded = await comfyService.uploadImage(inputImage);
            const response = await fetch('/workflows/zimage-mood-edit.json');
            if (!response.ok) throw new Error('Failed to load mood edit workflow');
            const workflow = await response.json();

            const activeSeed = lockSeed ? seed : Math.floor(Math.random() * 1000000000000000);

            workflow['52'].inputs.image = uploaded.name;
            workflow['49'].inputs.seed = activeSeed;
            workflow['49'].inputs.steps = HARD_LOCK_DEFAULTS.steps;
            workflow['49'].inputs.cfg = HARD_LOCK_DEFAULTS.cfg;
            workflow['49'].inputs.denoise = denoise;
            workflow['42'].inputs.text = buildPositivePrompt();
            workflow['36'].inputs.text = HARD_LOCK_NEGATIVE_PROMPT;

            await queueWorkflow(workflow);
            toast('Mood edit queued: preserve geometry, change mood only', 'success');
        } catch (error: any) {
            console.error('Mood edit failed:', error);
            toast(error?.message || 'Mood edit failed', 'error');
            setIsGenerating(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="bg-[#121218] border border-white/5 rounded-2xl p-6 shadow-xl">
                <ImageUpload
                    onImageSelected={handleImageSelected}
                    previewUrl={previewUrl}
                    onClear={handleClearImage}
                    label="Reference Image"
                    initialUrl={initialImageUrl}
                />
            </div>

            <div className="bg-[#121218] border border-white/5 rounded-2xl p-6 shadow-xl space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-xs text-slate-400 uppercase tracking-wider">Mood Preset</div>
                        <div className="text-[11px] text-slate-600">Hard lock scene, adjust lighting mood only</div>
                    </div>
                    <span className="px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-fuchsia-500/20 border border-fuchsia-400/40 text-fuchsia-200">
                        Preserve Scene: Hard Lock
                    </span>
                </div>

                <div className="grid grid-cols-5 gap-2">
                    {(Object.keys(MOOD_PRESETS) as MoodPresetKey[]).map((mood) => (
                        <button
                            key={mood}
                            onClick={() => setSelectedMood(mood)}
                            className={`py-2 px-2 text-[10px] font-bold uppercase tracking-wider rounded-lg border transition-all ${selectedMood === mood
                                ? 'bg-white text-black border-white'
                                : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:text-white'
                                }`}
                        >
                            {mood}
                        </button>
                    ))}
                </div>
            </div>

            <div className="bg-[#121218] border border-white/5 rounded-2xl p-6 shadow-xl space-y-4">
                <div>
                    <label className="flex items-center justify-between text-xs text-slate-400 uppercase tracking-wider mb-2">
                        <span>Strength</span>
                        <span>{strength}% (denoise {denoise.toFixed(3)})</span>
                    </label>
                    <input
                        type="range"
                        min="0"
                        max="100"
                        value={strength}
                        onChange={(e) => setStrength(parseInt(e.target.value, 10))}
                        className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-white"
                    />
                    <p className="text-xs text-slate-600 mt-2">
                        Lower strength keeps the original image tighter. Default is tuned for stable mood-only edits.
                    </p>
                    {warningActive && (
                        <p className="mt-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-400/30 rounded-lg px-3 py-2">
                            Warning: high strength can introduce unwanted new details.
                        </p>
                    )}
                </div>

                <div>
                    <label className="block text-xs text-slate-400 mb-2 uppercase tracking-wider">Lighting Notes (optional)</label>
                    <textarea
                        value={customLightingNote}
                        onChange={(e) => setCustomLightingNote(e.target.value)}
                        className="w-full h-20 bg-[#0a0a0f] border border-white/10 rounded-xl p-3 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-white/20 resize-none transition-all"
                        placeholder="Example: keep clouds soft and add warmer highlights on the ground"
                    />
                </div>
            </div>

            <div className="bg-[#121218] border border-white/5 rounded-2xl p-6 shadow-xl space-y-3">
                <div className="flex items-center justify-between">
                    <div className="text-xs text-slate-400 uppercase tracking-wider">Seed Control</div>
                    <button
                        onClick={() => setLockSeed((prev) => !prev)}
                        className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg border transition-all ${lockSeed
                            ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200'
                            : 'bg-white/5 border-white/10 text-slate-400'
                            }`}
                    >
                        {lockSeed ? 'Lock Seed ON' : 'Lock Seed OFF'}
                    </button>
                </div>
                <div className="grid grid-cols-4 gap-2">
                    <input
                        type="number"
                        value={seed}
                        onChange={(e) => setSeed(parseInt(e.target.value || '0', 10))}
                        className="col-span-3 w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                    />
                    <button
                        onClick={() => setSeed(Math.floor(Math.random() * 1000000000000000))}
                        className="w-full rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold text-white transition-all flex items-center justify-center"
                        title="Randomize seed"
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            <div className="bg-[#121218] border border-white/5 rounded-2xl p-5 shadow-xl space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Render Intent</div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-slate-200">
                        <div className="text-[10px] text-slate-500 uppercase">Layout</div>
                        <div className="font-semibold">Locked</div>
                    </div>
                    <div className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-slate-200">
                        <div className="text-[10px] text-slate-500 uppercase">Objects</div>
                        <div className="font-semibold">Locked</div>
                    </div>
                    <div className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-slate-200">
                        <div className="text-[10px] text-slate-500 uppercase">Lighting</div>
                        <div className="font-semibold">{selectedMood}</div>
                    </div>
                </div>
                <p className="text-[11px] text-slate-600">
                    Output uses the input image geometry/aspect by default through latent encode from source.
                </p>
            </div>

            <button
                onClick={handleGenerate}
                disabled={isGenerating || !inputImage}
                className="w-full py-3.5 bg-white text-black font-bold text-sm rounded-xl hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
                <Lock className="w-4 h-4" />
                <Sun className="w-4 h-4" />
                {isGenerating ? 'Generating mood edit...' : 'Preserve geometry, change mood only'}
            </button>
        </div>
    );
};
