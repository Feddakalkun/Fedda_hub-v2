import { useCallback, useEffect, useState } from 'react';
import { Loader2, Music4, Wand2, AlertCircle, Sparkles } from 'lucide-react';
import { useComfyExecution } from '../contexts/ComfyExecutionContext';
import { comfyService } from '../services/comfyService';
import { ollamaService } from '../services/ollamaService';
import { assistantService, type AceStepBlueprint } from '../services/assistantService';
import { useToast } from '../components/ui/Toast';
import { ModelDownloader } from '../components/ModelDownloader';
import { WorkbenchShell } from '../components/layout/WorkbenchShell';
import { BACKEND_API } from '../config/api';
import { usePersistentState } from '../hooks/usePersistentState';
import { directDownload } from '../utils/directDownload';

interface OutputFileRef {
    filename: string;
    subfolder: string;
    type: string;
}

interface AudioReferenceInfo {
    title: string;
    uploader: string;
    duration_seconds: number;
    description: string;
    tags: string[];
    categories: string[];
    webpage_url: string;
}

interface ReferenceSuggestions {
    bpm: number;
    seconds: number;
    tags: string;
    arrangementHint: string;
}

type GenerationSourceMode = 'preset' | 'reference' | 'manual';

type AcePreset = {
    id: string;
    label: string;
    artistHint: string;
    tags: string;
    lyrics: string;
    seconds: number;
    bpm: number;
    steps: number;
    cfg: number;
    cfgScale: number;
};

const AUDIO_FILE_REGEX = /\.(flac|wav|mp3|ogg|m4a|aac)$/i;
const REFERENCE_CUES_MARKER = '[Reference cues]';

const BPM_HINTS: Array<{ pattern: RegExp; bpm: number }> = [
    { pattern: /\b(drum\s*and\s*bass|dnb)\b/i, bpm: 174 },
    { pattern: /\b(hardstyle)\b/i, bpm: 150 },
    { pattern: /\b(phonk)\b/i, bpm: 160 },
    { pattern: /\b(techno)\b/i, bpm: 130 },
    { pattern: /\b(house|deep house|tech house)\b/i, bpm: 124 },
    { pattern: /\b(trance)\b/i, bpm: 138 },
    { pattern: /\b(trap)\b/i, bpm: 145 },
    { pattern: /\b(hip hop|hip-hop|rap)\b/i, bpm: 95 },
    { pattern: /\b(reggaeton)\b/i, bpm: 96 },
    { pattern: /\b(pop)\b/i, bpm: 120 },
    { pattern: /\b(rnb|r&b|soul)\b/i, bpm: 100 },
    { pattern: /\b(rock|metal)\b/i, bpm: 128 },
    { pattern: /\b(ambient|cinematic)\b/i, bpm: 90 },
];

const dedupeTokens = (tokens: string[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    tokens.forEach((token) => {
        const cleaned = token
            .replace(/[|]/g, ',')
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!cleaned) return;

        const key = cleaned.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        out.push(cleaned);
    });
    return out;
};

const inferReferenceBpm = (info: AudioReferenceInfo): number => {
    const pool = [info.title, info.description, ...(info.tags || []), ...(info.categories || [])]
        .filter(Boolean)
        .join(' ');

    const explicit = pool.match(/(?:^|\b)([6-9]\d|1\d\d|2\d\d)\s?bpm\b/i);
    if (explicit) {
        const parsed = parseInt(explicit[1], 10);
        if (!Number.isNaN(parsed)) return parsed;
    }

    const hinted = BPM_HINTS.find((entry) => entry.pattern.test(pool));
    return hinted?.bpm || 120;
};

const buildArrangementHint = (durationSeconds: number): string => {
    if (durationSeconds <= 45) {
        return 'short-form hook first: intro (2 bars), verse (4 bars), chorus (8 bars), fast turnaround outro';
    }
    if (durationSeconds <= 120) {
        return 'compact song form: intro, verse, pre-chorus, chorus, verse 2, chorus, bridge, final chorus';
    }
    return 'full song arc: intro, verse, pre, chorus, verse 2, pre, chorus, bridge breakdown, final chorus, outro';
};

const buildReferenceSuggestions = (
    info: AudioReferenceInfo,
    favoriteArtist: string,
    currentSeconds: number
): ReferenceSuggestions => {
    const bpm = Math.max(70, Math.min(220, inferReferenceBpm(info)));
    const sourceDuration = Number(info.duration_seconds) || currentSeconds || 120;
    const seconds = Math.max(20, Math.min(240, Math.round(sourceDuration / 10) * 10));

    const candidateTags = dedupeTokens([
        favoriteArtist ? `${favoriteArtist} inspired` : '',
        ...(info.categories || []).slice(0, 3),
        ...(info.tags || []).slice(0, 6),
        `${bpm} BPM`,
    ]);
    const tags = candidateTags.join(', ');

    return {
        bpm,
        seconds,
        tags,
        arrangementHint: buildArrangementHint(seconds),
    };
};
const HISTORY_ITEM_KEYS = ['status', 'outputs', 'prompt'];

const ACE_DEFAULT_MODELS = {
    unet: 'acestep_v1.5_turbo.safetensors',
    clip1: 'qwen_0.6b_ace15.safetensors',
    clip2: 'qwen_0.6b_ace15.safetensors',
    vae: 'ace_1.5_vae.safetensors',
};

const ACE_REQUIRED_NODE_TYPES: Record<string, string> = {
    '72': 'VAEDecodeAudio',
    '73': 'KSampler',
    '74': 'ConditioningZeroOut',
    '75': 'EmptyAceStep1.5LatentAudio',
    '76': 'UNETLoader',
    '77': 'DualCLIPLoader',
    '78': 'TextEncodeAceStepAudio1.5',
    '79': 'SaveAudio',
    '80': 'ModelSamplingAuraFlow',
    '81': 'VAELoader',
};

const ACE_PRESETS: AcePreset[] = [
    {
        id: 'mj-groove-pop',
        label: 'MJ Groove Pop',
        artistHint: 'Michael Jackson-inspired',
        tags: 'groove pop, funk bass, tight live drums, punchy brass stabs, soulful male vocal, dancefloor hook, retro modern polish, 118 BPM',
        lyrics: '[verse]\nCity lights burn like fire tonight\nFeet on the edge and the rhythm is right\n\n[pre-chorus]\nHeartbeat racing under neon skies\n\n[chorus]\nWe move like thunder, no looking back\nHands to the ceiling, we light the track',
        seconds: 120,
        bpm: 118,
        steps: 12,
        cfg: 1,
        cfgScale: 1.2,
    },
    {
        id: 'metallica-heavy',
        label: 'Metallica Heavy',
        artistHint: 'Metallica-inspired',
        tags: 'heavy metal, palm-muted guitar riffs, aggressive drums, distorted bass, dramatic build, stadium chorus, dark energy, 132 BPM',
        lyrics: '[verse]\nSteel in my lungs and thunder in my veins\nMarch through the smoke in a storm of chains\n\n[chorus]\nRaise the fire, break the night\nWe are the pressure, we are the fight',
        seconds: 130,
        bpm: 132,
        steps: 12,
        cfg: 1,
        cfgScale: 1.3,
    },
    {
        id: 'sundfor-nordic-cinema',
        label: 'Sundfor Nordic',
        artistHint: 'Susanne Sundfor-inspired',
        tags: 'nordic art pop, cinematic synth layers, intimate female vocal, melancholic lift, atmospheric textures, emotional crescendo, 104 BPM',
        lyrics: '[verse]\nSnow on the wires, a silver glow\nI hear your name in the undertow\n\n[chorus]\nCarry me over the northern line\nCold as a star, but the pulse is mine',
        seconds: 140,
        bpm: 104,
        steps: 12,
        cfg: 1,
        cfgScale: 1.1,
    },
    {
        id: 'infected-psytrance',
        label: 'Infected Psy',
        artistHint: 'Infected Mushroom-inspired',
        tags: 'psytrance, goa leads, rolling bassline, tribal percussion, psychedelic FX, vocal chops, high energy drop, 145 BPM',
        lyrics: '[intro]\n(instrumental mantra texture)\n\n[verse]\nSpiral in the night where the colors collide\n\n[chorus]\nTake me higher, fractal fire\nRide the signal, never tire',
        seconds: 120,
        bpm: 145,
        steps: 12,
        cfg: 1,
        cfgScale: 1.4,
    },
    {
        id: 'billie-dark-pop',
        label: 'Dark Whisper Pop',
        artistHint: 'Billie Eilish-inspired',
        tags: 'dark pop, minimalist beat, intimate whispered female vocal, sub bass, moody textures, cinematic tension, 96 BPM',
        lyrics: '[verse]\nMidnight glass and a silver haze\nI hear your pulse in electric waves\n\n[chorus]\nHold me close in the low blue light\nWe disappear in the static night',
        seconds: 110,
        bpm: 96,
        steps: 12,
        cfg: 1,
        cfgScale: 1.2,
    },
    {
        id: 'weeknd-neon-rnb',
        label: 'Neon RnB Drive',
        artistHint: 'The Weeknd-inspired',
        tags: 'synthwave rnb, neon pads, pulsing bass, smooth male vocal, glossy 80s drums, late-night vibe, 108 BPM',
        lyrics: '[verse]\nRed lights bleeding on the boulevard\nEvery promise hits me like a spark\n\n[chorus]\nStay for the night, dont fade away\nNeon hearts in a purple haze',
        seconds: 120,
        bpm: 108,
        steps: 12,
        cfg: 1,
        cfgScale: 1.2,
    },
    {
        id: 'zimmer-trailer',
        label: 'Trailer Impact',
        artistHint: 'Hans Zimmer-inspired',
        tags: 'cinematic trailer, braam hits, epic strings, hybrid percussion, rising tension, wide choir, dramatic climax, 96 BPM',
        lyrics: '[intro]\n(instrumental)\n\n[bridge]\nShadows awaken, the sky turns gold\n\n[outro]\n(instrumental impact ending)',
        seconds: 120,
        bpm: 96,
        steps: 12,
        cfg: 1,
        cfgScale: 1.1,
    },
    {
        id: 'adele-soul-ballad',
        label: 'Soul Ballad Lift',
        artistHint: 'Adele-inspired',
        tags: 'soul pop ballad, piano lead, emotional female vocal, warm strings, intimate to powerful dynamic arc, 84 BPM',
        lyrics: '[verse]\nI kept your letters in a quiet drawer\nEvery word still knocks against the door\n\n[chorus]\nIf love was fire, I still feel the flame\nCall my name through the rain',
        seconds: 140,
        bpm: 84,
        steps: 12,
        cfg: 1,
        cfgScale: 1.1,
    },
    {
        id: 'drake-melodic-trap',
        label: 'Melodic Trap Mood',
        artistHint: 'Drake-inspired',
        tags: 'melodic trap, airy keys, deep 808, sparse hats, introspective male vocal, modern urban vibe, 140 BPM',
        lyrics: '[verse]\nLate calls, same walls, city never sleeps\nGold lights on my face while the silence speaks\n\n[chorus]\nI keep moving through the echo and the rain\nEvery win feels different, every loss the same',
        seconds: 120,
        bpm: 140,
        steps: 12,
        cfg: 1,
        cfgScale: 1.3,
    },
    {
        id: 'avicii-festival',
        label: 'Festival Uplift',
        artistHint: 'Avicii-inspired',
        tags: 'uplifting edm pop, acoustic guitar plucks, bright synth lead, festival drop, euphoric chorus, 128 BPM',
        lyrics: '[verse]\nDust on my shoes and sun in my eyes\nChasing tomorrow across open skies\n\n[chorus]\nWe are the sparks in the midnight crowd\nSing it louder, sing it loud',
        seconds: 120,
        bpm: 128,
        steps: 12,
        cfg: 1,
        cfgScale: 1.3,
    },
    {
        id: 'ambient-focus',
        label: 'Ambient Focus',
        artistHint: 'Instrumental ambient-inspired',
        tags: 'ambient electronic, soft evolving pads, no vocals, subtle pulses, lo-fi texture, deep focus background, 78 BPM',
        lyrics: '[intro]\n(instrumental)\n\n[verse]\n(instrumental)\n\n[outro]\n(instrumental fade)',
        seconds: 180,
        bpm: 78,
        steps: 12,
        cfg: 1,
        cfgScale: 1.0,
    },
    {
        id: 'tiktok-hook-30',
        label: 'TikTok Hook 30s',
        artistHint: 'Viral short-form pop-inspired',
        tags: 'viral pop hook, upfront vocal, clean punchy drums, glossy synths, immediate chorus, loop-friendly, 124 BPM',
        lyrics: '[intro]\nOne line setup\n\n[chorus]\nThis is the moment, dont let it go\nSay my name and steal the show',
        seconds: 30,
        bpm: 124,
        steps: 10,
        cfg: 1,
        cfgScale: 1.2,
    },
];

const ACE_FEATURED_PRESET_IDS = [
    'mj-groove-pop',
    'metallica-heavy',
    'sundfor-nordic-cinema',
    'infected-psytrance',
];
const chooseModel = (models: string[], preferred: string, fuzzy?: string): string => {
    if (models.includes(preferred)) return preferred;
    if (fuzzy) {
        const found = models.find((name) => name.toLowerCase().includes(fuzzy.toLowerCase()));
        if (found) return found;
    }
    return models[0] || preferred;
};

const chooseClip2Model = (models: string[], previous: string): string => {
    if (models.includes(previous) && previous !== 'qwen_3_4b.safetensors' && previous !== 'qwen_4b_ace15.safetensors') return previous;
    if (models.includes('qwen_0.6b_ace15.safetensors')) return 'qwen_0.6b_ace15.safetensors';
    if (models.includes(previous)) return previous;
    return models[0] || ACE_DEFAULT_MODELS.clip2;
};
const chooseAceSafeClip = (models: string[], previous: string): string => {
    if (models.includes('qwen_0.6b_ace15.safetensors')) return 'qwen_0.6b_ace15.safetensors';
    if (models.includes(previous) && previous !== 'qwen_3_4b.safetensors') return previous;
    if (models.includes('qwen_4b_ace15.safetensors')) return 'qwen_4b_ace15.safetensors';
    return models[0] || ACE_DEFAULT_MODELS.clip1;
};
const isAceUnetName = (name: string): boolean => {
    const n = name.toLowerCase();
    return n.includes('acestep') || n.includes('ace-step') || n.includes('ace_step');
};
const chooseAceUnetModel = (models: string[], previous: string): string => {
    const aceModels = models.filter(isAceUnetName);
    const pool = aceModels.length > 0 ? aceModels : models;
    return chooseModel(pool, previous, 'acestep');
};

export const AudioPage = () => {
    const { queueWorkflow } = useComfyExecution();
    const { toast } = useToast();

    const [tags, setTags] = usePersistentState('audio_ace_tags', 'cinematic pop, emotional, female vocal, modern synths, 120 BPM');
    const [lyrics, setLyrics] = usePersistentState('audio_ace_lyrics', '[verse]\nWe rise again through the fire\n\n[chorus]\nWe are unbreakable tonight');
    const [seconds, setSeconds] = usePersistentState('audio_ace_seconds', 120);
    const [steps, setSteps] = usePersistentState('audio_ace_steps', 50);
    const [cfg, setCfg] = usePersistentState('audio_ace_cfg', 4);
    const [seed, setSeed] = usePersistentState('audio_ace_seed', -1);

    const [bpm, setBpm] = usePersistentState('audio_ace_bpm', 120);
    const [cfgScale, setCfgScale] = usePersistentState('audio_ace_cfg_scale', 2);
    const [useAudioCodes, setUseAudioCodes] = usePersistentState('audio_ace_use_audio_codes', false);
    const [selectedPresetId, setSelectedPresetId] = usePersistentState('audio_ace_selected_preset', ACE_PRESETS[0].id);
    const [generationSourceMode, setGenerationSourceMode] = usePersistentState<GenerationSourceMode>('audio_ace_source_mode', 'preset');
    const [activeReferenceSummary, setActiveReferenceSummary] = usePersistentState('audio_ace_active_reference', '');

    const [unetModels, setUnetModels] = useState<string[]>([]);
    const [textEncoderModels, setTextEncoderModels] = useState<string[]>([]);
    const [vaeModels, setVaeModels] = useState<string[]>([]);

    const [unetModel, setUnetModel] = usePersistentState('audio_ace_unet_model', ACE_DEFAULT_MODELS.unet);
    const [clipModel1, setClipModel1] = usePersistentState('audio_ace_clip_model_1', ACE_DEFAULT_MODELS.clip1);
    const [clipModel2, setClipModel2] = usePersistentState('audio_ace_clip_model_2', ACE_DEFAULT_MODELS.clip2);
    const [vaeModel, setVaeModel] = usePersistentState('audio_ace_vae_model', ACE_DEFAULT_MODELS.vae);

    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [plannerModel, setPlannerModel] = usePersistentState('audio_ace_planner_model', '');
    const [ideaBrief, setIdeaBrief] = usePersistentState('audio_ace_idea_brief', '');
    const [favoriteArtist, setFavoriteArtist] = usePersistentState('audio_ace_favorite_artist', '');
    const [referenceUrl, setReferenceUrl] = usePersistentState('audio_ace_reference_url', '');
    const [referenceInfo, setReferenceInfo] = useState<AudioReferenceInfo | null>(null);
    const [isAnalyzingReference, setIsAnalyzingReference] = useState(false);
    const [isPlanning, setIsPlanning] = useState(false);
    const [plannerError, setPlannerError] = useState<string | null>(null);
    const [blueprint, setBlueprint] = useState<AceStepBlueprint | null>(null);

    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);

    const [lastPromptId, setLastPromptId] = useState<string | null>(null);
    const [historyStatus, setHistoryStatus] = useState('');
    const [detectedOutputs, setDetectedOutputs] = useState<string[]>([]);
    const [generationLogs, setGenerationLogs] = useState<string[]>([]);

    const pushLog = (message: string) => {
        const stamp = new Date().toLocaleTimeString();
        setGenerationLogs((prev) => [`${stamp} ${message}`, ...prev].slice(0, 60));
    };

    const collectOutputFiles = (historyItem: any): OutputFileRef[] => {
        if (!historyItem?.outputs) return [];

        const files: OutputFileRef[] = [];
        const seen = new Set<string>();

        const walk = (value: any) => {
            if (Array.isArray(value)) {
                value.forEach((entry) => walk(entry));
                return;
            }
            if (!value || typeof value !== 'object') return;

            if (typeof value.filename === 'string') {
                const subfolder = typeof value.subfolder === 'string' ? value.subfolder : '';
                const type = typeof value.type === 'string' ? value.type : 'output';
                const key = `${value.filename}|${subfolder}|${type}`;

                if (!seen.has(key)) {
                    seen.add(key);
                    files.push({ filename: value.filename, subfolder, type });
                }
            }

            Object.values(value).forEach((child) => walk(child));
        };

        Object.values(historyItem.outputs).forEach((nodeOutput) => walk(nodeOutput));
        return files;
    };

    const resolveHistoryItem = (historyPayload: any, promptId: string): any | null => {
        if (!historyPayload || typeof historyPayload !== 'object') return null;
        if (historyPayload[promptId]) return historyPayload[promptId];

        const isDirectItem = HISTORY_ITEM_KEYS.some((key) => key in historyPayload);
        if (isDirectItem) return historyPayload;

        for (const value of Object.values(historyPayload)) {
            if (value && typeof value === 'object') {
                const isEntry = HISTORY_ITEM_KEYS.some((key) => key in (value as Record<string, unknown>));
                if (isEntry) return value;
            }
        }

        return null;
    };

    const findAudioOutput = (historyItem: any): OutputFileRef | null => {
        const files = collectOutputFiles(historyItem);
        const audioFiles = files.filter((file) => AUDIO_FILE_REGEX.test(file.filename));
        return audioFiles.length > 0 ? audioFiles[audioFiles.length - 1] : null;
    };

    const attachLatestAudioFallback = async (startedAtMs: number): Promise<boolean> => {
        try {
            const response = await fetch(`${BACKEND_API.BASE_URL}${BACKEND_API.ENDPOINTS.FILES_LIST}`);
            if (!response.ok) return false;
            const data = await response.json();
            const files = Array.isArray(data?.files) ? data.files : [];
            const audioFiles = files.filter((file: any) => typeof file?.filename === 'string' && AUDIO_FILE_REGEX.test(file.filename));
            if (audioFiles.length === 0) return false;
            const recent = audioFiles.find((file: any) => {
                const modifiedMs = Number(file?.modified || 0) * 1000;
                return Number.isFinite(modifiedMs) && modifiedMs >= startedAtMs - 120000;
            });
            const selected = recent || audioFiles[0];
            const subfolder = typeof selected?.subfolder === 'string' ? selected.subfolder : '';
            const type = typeof selected?.type === 'string' ? selected.type : 'output';
            const resolvedUrl = typeof selected?.url === 'string' && selected.url
                ? selected.url
                : comfyService.getImageUrl(selected.filename, subfolder, type);
            setAudioUrl(resolvedUrl);
            setHistoryStatus('completed_with_audio_fallback');
            setDetectedOutputs((prev) => (prev.includes(selected.filename) ? prev : [selected.filename, ...prev].slice(0, 20)));
            pushLog(`Fallback output scan attached audio: ${selected.filename}`);
            toast('Track generated (recovered from output folder).', 'success');
            return true;
        } catch (err) {
            pushLog(`Fallback output scan failed: ${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
    };

    const extractHistoryError = (historyItem: any): string => {
        const messages = historyItem?.status?.messages;
        if (Array.isArray(messages)) {
            for (const entry of messages) {
                if (Array.isArray(entry) && entry[0] === 'execution_error') {
                    const payload = entry[1] || {};
                    const nodeMeta = payload.node_type
                        ? ` (node ${payload.node_type}${payload.node_id ? `#${payload.node_id}` : ''})`
                        : '';
                    const base = payload.exception_message || payload.error || 'Execution error';
                    return `${base}${nodeMeta}`;
                }
            }
        }

        if (typeof historyItem?.status?.error === 'string' && historyItem.status.error.trim()) {
            return historyItem.status.error;
        }

        return 'ComfyUI reported an error during execution.';
    };

    const refreshAceModels = useCallback(async (silent: boolean = false) => {
        try {
            await fetch(`${BACKEND_API.BASE_URL}${BACKEND_API.ENDPOINTS.COMFY_REFRESH_MODELS}`).catch(() => null);

            const [unets, clipsA, clipsB, vaes] = await Promise.all([
                comfyService.getUNetModels(),
                comfyService.getDualClipModels('clip_name1'),
                comfyService.getDualClipModels('clip_name2'),
                comfyService.getVaeModels(),
            ]);

            const aceUnets = unets.filter(isAceUnetName);
            const unetPool = aceUnets.length > 0 ? aceUnets : unets;

            setUnetModels(unetPool);
            const mergedClip = Array.from(new Set([...clipsA, ...clipsB]));
            setTextEncoderModels(mergedClip);
            setVaeModels(vaes);

            setUnetModel((prev) => chooseAceUnetModel(unets, prev));
            setClipModel1((prev) => chooseAceSafeClip(clipsA.length > 0 ? clipsA : mergedClip, prev));
            setClipModel2((prev) => chooseClip2Model(clipsB.length > 0 ? clipsB : mergedClip, prev));
            setVaeModel((prev) => chooseModel(vaes, prev, 'ace_1.5_vae'));

            const missing: string[] = [];
            if (!unetPool.includes(ACE_DEFAULT_MODELS.unet)) missing.push(ACE_DEFAULT_MODELS.unet);
            if (!mergedClip.includes(ACE_DEFAULT_MODELS.clip1)) missing.push(ACE_DEFAULT_MODELS.clip1);
            if (!mergedClip.includes(ACE_DEFAULT_MODELS.clip2)) missing.push(ACE_DEFAULT_MODELS.clip2);
            if (!vaes.includes(ACE_DEFAULT_MODELS.vae)) missing.push(ACE_DEFAULT_MODELS.vae);

            if (missing.length > 0) {
                const message = `Missing ACE models in ComfyUI: ${missing.join(', ')}`;
                setError(message);
                if (!silent) toast(message, 'error');
            } else {
                setError(null);
                if (!silent) toast('ACE-Step model set is ready.', 'success');
            }
        } catch (err) {
            const message = `Could not load ACE model lists: ${err instanceof Error ? err.message : String(err)}`;
            setError(message);
            if (!silent) toast(message, 'error');
        }
    }, [setClipModel1, setClipModel2, setUnetModel, setVaeModel, toast]);

    useEffect(() => {
        const loadPlannerModels = async () => {
            try {
                const models = await ollamaService.getModels();
                const names = models.map((m) => m.name);
                setAvailableModels(names);

                if (names.length > 0) {
                    const preferred = names.find((name) => {
                        const n = name.toLowerCase();
                        return n.includes('qwen') || n.includes('dolphin') || n.includes('llama') || n.includes('mistral');
                    });
                    setPlannerModel((prev) => (names.includes(prev) ? prev : (preferred || names[0])));
                }
            } catch {
                setAvailableModels([]);
            }
        };

        refreshAceModels(true);
        loadPlannerModels();
    }, [refreshAceModels, setPlannerModel]);

    const applyPresetById = (presetId: string) => {
        const preset = ACE_PRESETS.find((item) => item.id === presetId);
        if (!preset) return;
        setSelectedPresetId(preset.id);
        setTags(preset.tags);
        setLyrics(preset.lyrics);
        setSeconds(preset.seconds);
        setBpm(preset.bpm);
        setSteps(preset.steps);
        setCfg(preset.cfg);
        setCfgScale(preset.cfgScale);
        setUseAudioCodes(false);
        setFavoriteArtist(preset.artistHint);
        toast(`Preset applied: ${preset.label}`, 'success');
    };

    const applyBlueprint = (result: AceStepBlueprint) => {
        const ui = result.ui_suggestions;

        if (ui.tags?.trim()) setTags(ui.tags.trim());
        if (ui.lyrics?.trim()) setLyrics(ui.lyrics);

        setSeconds(Math.max(20, Math.min(240, Math.round(ui.seconds || 120))));
        setSteps(Math.max(20, Math.min(80, Math.round(ui.steps || 50))));
        setCfg(Math.max(2, Math.min(7, Number(ui.cfg || 4))));
    };

    const fetchReferenceInfo = async (url: string): Promise<AudioReferenceInfo> => {
        const response = await fetch(`${BACKEND_API.BASE_URL}${BACKEND_API.ENDPOINTS.AUDIO_REFERENCE_INFO}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.success) {
            throw new Error(data?.detail || data?.error || 'Failed to analyze YouTube reference');
        }

        return data as AudioReferenceInfo;
    };

    const applyReferenceSuggestionsToFields = (info: AudioReferenceInfo): ReferenceSuggestions => {
        const suggestions = buildReferenceSuggestions(info, favoriteArtist, seconds);

        setBpm(suggestions.bpm);
        setSeconds(suggestions.seconds);
        if (suggestions.tags.trim()) {
            setTags(suggestions.tags);
        }
        setGenerationSourceMode('reference');
        setActiveReferenceSummary(`${info.title || 'Reference'} (${suggestions.bpm} BPM, ${suggestions.seconds}s)`);

        const cueLines = [
            REFERENCE_CUES_MARKER,
            `Track: ${info.title || '-'} by ${info.uploader || '-'}`,
            `URL: ${info.webpage_url || referenceUrl.trim()}`,
            `Suggested BPM: ${suggestions.bpm}`,
            `Suggested Duration: ${suggestions.seconds}s`,
            `Arrangement Hint: ${suggestions.arrangementHint}`,
            favoriteArtist.trim() ? `Artist style cue: ${favoriteArtist.trim()} (inspired, not copied)` : '',
        ].filter(Boolean);
        const cueBlock = cueLines.join('\n');

        setIdeaBrief((prev) => {
            const markerIndex = prev.indexOf(REFERENCE_CUES_MARKER);
            const base = markerIndex >= 0 ? prev.slice(0, markerIndex).trim() : prev.trim();
            return [base, cueBlock].filter(Boolean).join('\n\n').trim();
        });

        return suggestions;
    };

    const handleAnalyzeReference = async () => {
        const url = referenceUrl.trim();
        if (!url) {
            setPlannerError('Paste a YouTube link before analyzing reference.');
            return;
        }

        setIsAnalyzingReference(true);
        setPlannerError(null);

        try {
            const info = await fetchReferenceInfo(url);
            setReferenceInfo(info);
            toast('Reference analyzed.', 'success');
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setPlannerError(msg);
            toast(`Reference analyze failed: ${msg}`, 'error');
        } finally {
            setIsAnalyzingReference(false);
        }
    };

    const handleAnalyzeAndApplyReference = async () => {
        const url = referenceUrl.trim();
        if (!url) {
            setPlannerError('Paste a YouTube link before analyze + apply.');
            return;
        }

        setIsAnalyzingReference(true);
        setPlannerError(null);

        try {
            const info = await fetchReferenceInfo(url);
            setReferenceInfo(info);
            const suggestions = applyReferenceSuggestionsToFields(info);
            toast(`Reference applied: ${suggestions.bpm} BPM, ${suggestions.seconds}s target.`, 'success');
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setPlannerError(msg);
            toast(`Analyze + apply failed: ${msg}`, 'error');
        } finally {
            setIsAnalyzingReference(false);
        }
    };

    const handleDraftBlueprint = async () => {
        const brief = ideaBrief.trim();
        if (!brief) {
            setPlannerError('Write a short song brief first.');
            return;
        }
        if (!plannerModel) {
            setPlannerError('No Ollama text model selected. Install one in Settings first.');
            return;
        }

        const contextParts = [brief];
        if (favoriteArtist.trim()) {
            contextParts.push(`Favorite artist reference: ${favoriteArtist.trim()} (use high-level style cues only, no direct cloning).`);
        }
        if (referenceInfo) {
            const suggestions = buildReferenceSuggestions(referenceInfo, favoriteArtist, seconds);
            contextParts.push(`YouTube reference metadata: title=${referenceInfo.title}; uploader=${referenceInfo.uploader}; duration_seconds=${referenceInfo.duration_seconds}; tags=${referenceInfo.tags.join(', ')}; categories=${referenceInfo.categories.join(', ')}; description=${referenceInfo.description}`);
            contextParts.push(`Reference-derived settings: bpm=${suggestions.bpm}; duration_seconds=${suggestions.seconds}; tags=${suggestions.tags}; arrangement_hint=${suggestions.arrangementHint}`);
        } else if (referenceUrl.trim()) {
            contextParts.push(`YouTube reference URL provided by user: ${referenceUrl.trim()} (treat as style inspiration only).`);
        }

        setIsPlanning(true);
        setPlannerError(null);

        try {
            const result = await assistantService.generateAceStepBlueprint(plannerModel, contextParts.join('\n\n'));
            setBlueprint(result);
            applyBlueprint(result);
            toast('ACE blueprint generated and applied to fields.', 'success');
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setPlannerError(msg);
            toast(`Blueprint generation failed: ${msg}`, 'error');
        } finally {
            setIsPlanning(false);
        }
    };

    const handleGenerate = async () => {
        setIsGenerating(true);
        setError(null);
        setAudioUrl(null);
        setLastPromptId(null);
        setHistoryStatus('Queuing');
        setDetectedOutputs([]);
        setGenerationLogs([]);
        const generationStartedAt = Date.now();

        try {
            if (!unetModel || !clipModel1 || !clipModel2 || !vaeModel) {
                throw new Error('ACE model selection is incomplete. Refresh the model lists.');
            }

            const res = await fetch(`/workflows/ace-step.json?v=${Date.now()}`);
            if (!res.ok) throw new Error('Could not load ace-step.json');

            const contentType = res.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
                const body = await res.text();
                if (body.toLowerCase().includes('<!doctype')) {
                    throw new Error('Workflow path returned HTML instead of JSON. Check frontend/public/workflows/ace-step.json');
                }
                throw new Error('Workflow file is not valid JSON');
            }

            const workflow = await res.json();

            const missingNodes = Object.keys(ACE_REQUIRED_NODE_TYPES).filter((id) => !workflow[id]);
            if (missingNodes.length > 0) {
                throw new Error(`ACE workflow is missing required nodes: ${missingNodes.join(', ')}`);
            }

            const invalidNode = Object.entries(ACE_REQUIRED_NODE_TYPES).find(([id, classType]) => workflow[id]?.class_type !== classType);
            if (invalidNode) {
                throw new Error(`ACE workflow node ${invalidNode[0]} must be ${invalidNode[1]}, got ${workflow[invalidNode[0]]?.class_type || 'missing'}`);
            }

            const activeSeed = seed === -1 ? Math.floor(Math.random() * 1000000000000000) : seed;
            const safeSeconds = Number.isFinite(Number(seconds)) ? Math.max(20, Math.min(240, Math.round(Number(seconds)))) : 120;
            const safeSteps = Number.isFinite(Number(steps)) ? Math.max(4, Math.min(80, Math.round(Number(steps)))) : 12;
            const safeCfg = Number.isFinite(Number(cfg)) ? Math.max(1, Math.min(7, Number(cfg))) : 1;
            const safeBpm = Number.isFinite(Number(bpm)) ? Math.max(10, Math.min(300, Math.round(Number(bpm)))) : 120;
            const safeCfgScale = Number.isFinite(Number(cfgScale)) ? Math.max(0.25, Math.min(6, Number(cfgScale))) : 2;

            let effectiveUseAudioCodes = false;
            if (useAudioCodes) {
                setUseAudioCodes(false);
                pushLog('Disabled audio-code generation for stability (ACE decode-safe mode).');
            }

            workflow['73'].inputs.steps = safeSteps;
            workflow['73'].inputs.cfg = safeCfg;
            workflow['73'].inputs.seed = activeSeed;

            workflow['75'].inputs.seconds = safeSeconds;

            const effectiveUnet = chooseAceUnetModel(unetModels, unetModel);
            if (!isAceUnetName(effectiveUnet)) {
                throw new Error('No ACE-Step UNET detected. Download acestep_v1.5_turbo.safetensors in Model Downloader.');
            }
            if (effectiveUnet !== unetModel) {
                setUnetModel(effectiveUnet);
                pushLog('Auto-switched UNET to ' + effectiveUnet + ' for ACE compatibility.');
            }
            workflow['76'].inputs.unet_name = effectiveUnet;
            workflow['76'].inputs.weight_dtype = workflow['76'].inputs.weight_dtype || 'default';

            let effectiveClip1 = clipModel1;
            if (effectiveClip1 === 'qwen_3_4b.safetensors' && textEncoderModels.includes('qwen_0.6b_ace15.safetensors')) {
                effectiveClip1 = 'qwen_0.6b_ace15.safetensors';
            }

            let effectiveClip2 = clipModel2;
            if (textEncoderModels.includes('qwen_0.6b_ace15.safetensors')) {
                effectiveClip2 = 'qwen_0.6b_ace15.safetensors';
            } else if (effectiveClip2 === 'qwen_3_4b.safetensors' || effectiveClip2 === 'qwen_4b_ace15.safetensors') {
                effectiveClip2 = clipModel1;
            }
            if (effectiveClip2 !== clipModel2) {
                setClipModel2(effectiveClip2);
                pushLog(`Auto-switched text encoder 2 to ${effectiveClip2} for compatibility.`);
            }

            workflow['77'].inputs.clip_name1 = effectiveClip1;
            workflow['77'].inputs.clip_name2 = effectiveClip2;
            workflow['77'].inputs.type = 'ace';
            workflow['77'].inputs.device = workflow['77'].inputs.device || 'default';

            workflow['78'].inputs.tags = tags;
            workflow['78'].inputs.lyrics = lyrics;
            workflow['78'].inputs.seed = activeSeed;
            workflow['78'].inputs.bpm = safeBpm;
            workflow['78'].inputs.duration = safeSeconds;
            workflow['78'].inputs.timesignature = workflow['78'].inputs.timesignature || '4';
            workflow['78'].inputs.language = workflow['78'].inputs.language || 'en';
            workflow['78'].inputs.keyscale = workflow['78'].inputs.keyscale || 'E minor';
            workflow['78'].inputs.generate_audio_codes = effectiveUseAudioCodes;
            workflow['78'].inputs.cfg_scale = safeCfgScale;
            workflow['78'].inputs.temperature = workflow['78'].inputs.temperature ?? 0.85;
            workflow['78'].inputs.top_p = workflow['78'].inputs.top_p ?? 0.9;
            workflow['78'].inputs.top_k = workflow['78'].inputs.top_k ?? 0;
            workflow['78'].inputs.min_p = workflow['78'].inputs.min_p ?? 0;

            workflow['81'].inputs.vae_name = vaeModel;

            pushLog(`Queueing ACE workflow (seconds=${seconds}, steps=${steps}, cfg=${cfg}, bpm=${bpm}).`);
            const promptId = await queueWorkflow(workflow);
            setLastPromptId(promptId);
            setHistoryStatus('Queued');
            pushLog(`Prompt queued: ${promptId}`);
            toast('ACE-Step queued. Rendering audio...', 'info');

            const timeoutAt = Date.now() + 12 * 60 * 1000;
            let attempts = 0;

            while (Date.now() < timeoutAt) {
                attempts += 1;
                const history = await Promise.race([
                    comfyService.getHistory(promptId),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('History poll timeout')), 8000)),
                ]) as any;
                const item = resolveHistoryItem(history, promptId);

                if (item) {
                    const statusStr = item?.status?.status_str || (item?.status?.completed ? 'completed' : 'running');
                    setHistoryStatus(statusStr);

                    const allFiles = collectOutputFiles(item);
                    const outputPreview = allFiles.map((file) => file.filename);
                    setDetectedOutputs(outputPreview);

                    if (attempts === 1 || attempts % 3 === 0) {
                        pushLog(`History status: ${statusStr}. Files detected: ${outputPreview.length}.`);
                    }

                    const audio = findAudioOutput(item);
                    if (audio) {
                        const url = comfyService.getImageUrl(audio.filename, audio.subfolder, audio.type);
                        setAudioUrl(url);
                        setHistoryStatus('completed_with_audio');
                        pushLog(`Audio output found: ${audio.filename}`);
                        toast('Track generated!', 'success');
                        return;
                    }

                    if (statusStr === 'error') {
                        const details = extractHistoryError(item);
                        throw new Error(details);
                    }

                    if (item?.status?.completed === true || statusStr === 'success') {
                        const recovered = await attachLatestAudioFallback(generationStartedAt);
                        if (recovered) return;
                        const outputsText = outputPreview.length > 0 ? outputPreview.join(', ') : 'none';
                        throw new Error(`Generation completed but no audio output was found. Detected outputs: ${outputsText}`);
                    }
                } else if (attempts === 1 || attempts % 4 === 0) {
                    pushLog('Waiting for history to appear...');
                }

                await new Promise((resolve) => setTimeout(resolve, 1800));
            }

            const recovered = await attachLatestAudioFallback(generationStartedAt);
            if (recovered) return;
            throw new Error('Timed out waiting for audio output. Check diagnostics below for prompt ID and detected outputs.');
        } catch (err) {
            const rawMsg = err instanceof Error ? err.message : String(err);

            const isClipMismatch =
                rawMsg.includes('Qwen3_4B_ACE15_lm') &&
                rawMsg.includes('size mismatch') &&
                rawMsg.includes('DualCLIPLoader');
            const isVaeDecodeTupleError =
                rawMsg.includes('tuple index out of range') &&
                rawMsg.includes('VAEDecodeAudio');
            if (isClipMismatch) {
                const fallbackClip2 = textEncoderModels.includes('qwen_0.6b_ace15.safetensors')
                    ? 'qwen_0.6b_ace15.safetensors'
                    : clipModel1;
                const fallbackClip1 = textEncoderModels.includes('qwen_0.6b_ace15.safetensors')
                    ? 'qwen_0.6b_ace15.safetensors'
                    : clipModel1;
                setClipModel1(fallbackClip1);
                setClipModel2(fallbackClip2);
                setUseAudioCodes(false);
            }
            if (isVaeDecodeTupleError) {
                setUseAudioCodes(false);
                if (textEncoderModels.includes('qwen_0.6b_ace15.safetensors')) setClipModel2('qwen_0.6b_ace15.safetensors');
                if (steps > 12) setSteps(12);
                if (cfg > 2) setCfg(2);
                if (seconds > 120) setSeconds(120);
            }

            let msg = rawMsg;
            if (isClipMismatch) {
                msg += ' Switched encoder 2 to qwen_0.6b_ace15.safetensors and disabled audio-code generation. Try again.';
            }
            if (isVaeDecodeTupleError) {
                msg += ' Applied decode-safe preset (audio codes OFF, encoder 2 set to qwen_0.6b_ace15 when available, steps<=12, cfg<=2, duration<=120). Click Generate again.';
            }
            if (rawMsg.includes('device-side assert triggered')) {
                if (textEncoderModels.includes('qwen_0.6b_ace15.safetensors')) {
                    setClipModel1('qwen_0.6b_ace15.safetensors');
                    setClipModel2('qwen_0.6b_ace15.safetensors');
                }
                setUseAudioCodes(false);
                msg += ' Restart ComfyUI and try again. ACE was reset to stable mode (audio codes OFF, qwen_0.6b on both encoders).';
            }

            setError(msg);
            setHistoryStatus('error');
            pushLog(`Error: ${msg}`);
            toast(`Audio generation failed: ${msg}`, 'error');
        } finally {
            setIsGenerating(false);
        }
    };

    const aceReady = unetModels.length > 0 && textEncoderModels.length > 0 && vaeModels.length > 0;
    const referenceSuggestions = referenceInfo ? buildReferenceSuggestions(referenceInfo, favoriteArtist, seconds) : null;
    const sourceModeLabel = generationSourceMode === 'reference' ? 'Reference mode' : generationSourceMode === 'preset' ? 'Preset mode' : 'Manual mode';
    const handleDownloadAudio = async () => {
        if (!audioUrl) return;
        const filename = detectedOutputs[detectedOutputs.length - 1] || `ace-step-${Date.now()}.flac`;
        const savedAs = await directDownload(audioUrl, filename);
        toast(`Downloaded ${savedAs}`, 'success');
    };

    return (
        <WorkbenchShell
            leftPane={
                <>
                    <ModelDownloader modelGroup="ace-step" onModelsReady={() => refreshAceModels(true)} />

                    <div className="bg-[#121218] border border-white/5 rounded-2xl p-4 space-y-3 mt-4">
                        <div className="text-xs font-bold uppercase tracking-widest text-slate-500">ACE Prompt Architect</div>

                        <select
                            value={plannerModel}
                            onChange={(e) => setPlannerModel(e.target.value)}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                            disabled={availableModels.length === 0}
                        >
                            {availableModels.length > 0 ? (
                                availableModels.map((model) => (
                                    <option key={model} value={model}>{model}</option>
                                ))
                            ) : (
                                <option value="">No Ollama models found</option>
                            )}
                        </select>

                        <textarea
                            value={ideaBrief}
                            onChange={(e) => setIdeaBrief(e.target.value)}
                            rows={4}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                            placeholder="Describe the song idea, style, mood, language, and target length..."
                        />

                        <input
                            value={favoriteArtist}
                            onChange={(e) => setFavoriteArtist(e.target.value)}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                            placeholder="Favorite artist (style inspiration only)"
                        />

                        <div className="flex gap-2">
                            <input
                                value={referenceUrl}
                                onChange={(e) => setReferenceUrl(e.target.value)}
                                className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                                placeholder="YouTube reference link"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={handleAnalyzeAndApplyReference}
                                disabled={isAnalyzingReference || !referenceUrl.trim()}
                                className="py-2 rounded-xl font-bold text-xs uppercase bg-white text-black hover:bg-slate-200 disabled:opacity-40"
                            >
                                {isAnalyzingReference ? <Loader2 className="w-4 h-4 inline animate-spin mr-2" /> : null}
                                Analyze + Use In ACE
                            </button>
                            <button
                                onClick={handleAnalyzeReference}
                                disabled={isAnalyzingReference || !referenceUrl.trim()}
                                className="py-2 rounded-xl font-bold text-xs uppercase bg-white/10 text-white hover:bg-white/20 disabled:opacity-40"
                            >
                                Analyze Only
                            </button>
                        </div>

                        {referenceInfo && (
                            <div className="bg-black/30 border border-white/10 rounded-xl p-3 text-[11px] text-slate-400 space-y-1">
                                <div className="text-slate-300 font-semibold">Reference: {referenceInfo.title}</div>
                                <div>Channel: {referenceInfo.uploader || '-'}</div>
                                <div>Duration: {referenceInfo.duration_seconds ? `${referenceInfo.duration_seconds}s` : '-'}</div>
                                {referenceSuggestions && (
                                    <>
                                        <div>Suggested BPM: {referenceSuggestions.bpm}</div>
                                        <div>Suggested Duration: {referenceSuggestions.seconds}s</div>
                                        <div className="line-clamp-2">Arrangement: {referenceSuggestions.arrangementHint}</div>
                                    </>
                                )}
                                <div className="line-clamp-3">{referenceInfo.description || 'No description available.'}</div>

                                <button
                                    onClick={() => {
                                        const suggestions = applyReferenceSuggestionsToFields(referenceInfo);
                                        toast(`Reference active: ${suggestions.bpm} BPM, ${suggestions.seconds}s.`, 'success');
                                    }}
                                    className="mt-2 w-full py-2 rounded-xl font-bold text-[11px] uppercase bg-white/10 text-white hover:bg-white/20"
                                >
                                    Use This Reference In ACE
                                </button>
                            </div>
                        )}

                        <div className="flex gap-2">
                            <button
                                onClick={handleDraftBlueprint}
                                disabled={isPlanning || !plannerModel}
                                className="flex-1 py-2 rounded-xl font-bold text-xs uppercase bg-white/10 text-white hover:bg-white/20 disabled:opacity-40"
                            >
                                {isPlanning ? <Loader2 className="w-4 h-4 inline animate-spin mr-2" /> : <Sparkles className="w-4 h-4 inline mr-2" />}Draft Blueprint
                            </button>
                            {blueprint && (
                                <button
                                    onClick={() => applyBlueprint(blueprint)}
                                    className="px-3 py-2 rounded-xl font-bold text-xs uppercase bg-black/40 border border-white/10 text-white hover:bg-black/60"
                                >
                                    Apply
                                </button>
                            )}
                        </div>

                        {plannerError && (
                            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 flex items-start gap-2">
                                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                                <div className="text-xs text-red-300">{plannerError}</div>
                            </div>
                        )}
                    </div>

                    <div className="bg-[#121218] border border-white/5 rounded-2xl p-4 space-y-3 mt-4">
                        <div className="text-xs font-bold uppercase tracking-widest text-slate-500">ACE-Step 1.5</div>
                        <div className="bg-black/30 border border-white/10 rounded-xl p-3 text-[11px] text-slate-400 space-y-1">
                            <div className="flex items-center justify-between">
                                <span className="uppercase tracking-widest text-slate-500">Current Source</span>
                                <span className="font-semibold text-slate-200">{sourceModeLabel}</span>
                            </div>
                            <div>
                                {generationSourceMode === 'reference'
                                    ? (activeReferenceSummary || 'Reference applied from link metadata')
                                    : generationSourceMode === 'preset'
                                        ? `Preset: ${ACE_PRESETS.find((item) => item.id === selectedPresetId)?.label || selectedPresetId}`
                                        : 'Manual field values'}
                            </div>
                            <div className="text-slate-500">Generate uses the ACE fields below. Preset/Reference updates those fields.</div>
                        </div>
                        <div className="bg-black/30 border border-white/10 rounded-xl p-3 space-y-3">
                            <div>
                                <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Ready To Launch Presets</div>
                                <div className="text-[11px] text-slate-500 mt-1">Pick a starter sound, then tweak tags/lyrics below.</div>
                            </div>

                            <div className="flex gap-2">
                                <select
                                    value={selectedPresetId}
                                    onChange={(e) => setSelectedPresetId(e.target.value)}
                                    className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                                >
                                    {ACE_PRESETS.map((preset) => (
                                        <option key={preset.id} value={preset.id}>
                                            {preset.label} ({preset.artistHint})
                                        </option>
                                    ))}
                                </select>
                                <button
                                    onClick={() => applyPresetById(selectedPresetId)}
                                    className="px-3 py-2 rounded-xl font-bold text-xs uppercase bg-white/10 text-white hover:bg-white/20"
                                >
                                    Apply
                                </button>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                {ACE_FEATURED_PRESET_IDS.map((presetId) => {
                                    const preset = ACE_PRESETS.find((item) => item.id === presetId);
                                    if (!preset) return null;
                                    const active = selectedPresetId === preset.id;
                                    return (
                                        <button
                                            key={`featured_${preset.id}`}
                                            onClick={() => applyPresetById(preset.id)}
                                            className={`px-2.5 py-1.5 rounded-lg text-[11px] border transition-colors ${active ? 'bg-white text-black border-white' : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'}`}
                                        >
                                            {preset.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3">
                            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Model Routing</div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                    <div className="text-[11px] text-slate-500">UNET</div>
                                    <select value={unetModel} onChange={(e) => setUnetModel(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white">
                                        {unetModels.length > 0 ? unetModels.map((name) => <option key={name} value={name}>{name}</option>) : <option value="">No UNET models</option>}
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <div className="text-[11px] text-slate-500">VAE</div>
                                    <select value={vaeModel} onChange={(e) => setVaeModel(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white">
                                        {vaeModels.length > 0 ? vaeModels.map((name) => <option key={name} value={name}>{name}</option>) : <option value="">No VAE models</option>}
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <div className="text-[11px] text-slate-500">Text Encoder 1</div>
                                    <select value={clipModel1} onChange={(e) => setClipModel1(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white">
                                        {textEncoderModels.length > 0 ? textEncoderModels.map((name) => <option key={`a_${name}`} value={name}>{name}</option>) : <option value="">No text encoders</option>}
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <div className="text-[11px] text-slate-500">Text Encoder 2</div>
                                    <select value={clipModel2} onChange={(e) => setClipModel2(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white">
                                        {textEncoderModels.length > 0 ? textEncoderModels.map((name) => <option key={`b_${name}`} value={name}>{name}</option>) : <option value="">No text encoders</option>}
                                    </select>
                                </div>
                            </div>
                        </div>

                        {!aceReady && (
                            <button
                                onClick={() => refreshAceModels()}
                                className="w-full py-2 rounded-xl font-bold text-xs uppercase bg-white/10 text-white hover:bg-white/20"
                            >
                                Refresh ACE Models
                            </button>
                        )}

                        <div className="space-y-1">
                            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Tags</div>
                            <input
                                value={tags}
                                onChange={(e) => { setTags(e.target.value); setGenerationSourceMode('manual'); setActiveReferenceSummary(''); }}
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
                                placeholder="genre, mood, instruments, vocal style"
                            />
                        </div>

                        <div className="space-y-1">
                            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Lyrics & Structure</div>
                            <textarea
                                value={lyrics}
                                onChange={(e) => { setLyrics(e.target.value); setGenerationSourceMode('manual'); setActiveReferenceSummary(''); }}
                                rows={8}
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono"
                            />
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                            <div className="space-y-1">
                                <div className="text-[11px] text-slate-500">Seconds</div>
                                <input type="number" value={seconds} onChange={(e) => { setSeconds(parseInt(e.target.value || '120')); setGenerationSourceMode('manual'); setActiveReferenceSummary(''); }} className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
                            </div>
                            <div className="space-y-1">
                                <div className="text-[11px] text-slate-500">BPM</div>
                                <input type="number" value={bpm} onChange={(e) => { setBpm(parseInt(e.target.value || '120')); setGenerationSourceMode('manual'); setActiveReferenceSummary(''); }} className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
                            </div>
                            <div className="space-y-1">
                                <div className="text-[11px] text-slate-500">Steps</div>
                                <input type="number" value={steps} onChange={(e) => { setSteps(parseInt(e.target.value || '50')); setGenerationSourceMode('manual'); setActiveReferenceSummary(''); }} className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
                            </div>
                            <div className="space-y-1">
                                <div className="text-[11px] text-slate-500">CFG</div>
                                <input type="number" step={0.1} value={cfg} onChange={(e) => { setCfg(parseFloat(e.target.value || '4')); setGenerationSourceMode('manual'); setActiveReferenceSummary(''); }} className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
                            </div>
                            <div className="space-y-1">
                                <div className="text-[11px] text-slate-500">CFG Scale</div>
                                <input type="number" step={0.1} value={cfgScale} onChange={(e) => { setCfgScale(parseFloat(e.target.value || '2')); setGenerationSourceMode('manual'); setActiveReferenceSummary(''); }} className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
                            </div>
                            <div className="space-y-1">
                                <div className="text-[11px] text-slate-500">Seed</div>
                                <input type="number" value={seed} onChange={(e) => { setSeed(parseInt(e.target.value || '-1')); setGenerationSourceMode('manual'); setActiveReferenceSummary(''); }} className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
                            </div>
                        </div>

                        <label className="flex items-center gap-2 text-xs text-slate-400">
                            <input
                                type="checkbox"
                                checked={useAudioCodes}
                                onChange={(e) => { setUseAudioCodes(e.target.checked); setGenerationSourceMode('manual'); setActiveReferenceSummary(''); }}
                                className="rounded border-white/20 bg-black/40"
                            />
                            Enable audio code generation (higher quality, can be unstable on some setups)
                        </label>

                        <button onClick={handleGenerate} disabled={isGenerating || !aceReady} className="w-full py-3 rounded-xl font-bold text-sm uppercase bg-white text-black hover:bg-slate-200 disabled:opacity-30">
                            {isGenerating ? <Loader2 className="w-4 h-4 inline animate-spin mr-2" /> : <Wand2 className="w-4 h-4 inline mr-2" />}Generate Track
                        </button>

                        {(lastPromptId || historyStatus || detectedOutputs.length > 0 || generationLogs.length > 0) && (
                            <div className="bg-black/30 border border-white/10 rounded-xl p-3 space-y-2 text-[11px]">
                                <div className="flex items-center justify-between">
                                    <span className="text-slate-400">Status</span>
                                    <span className="text-slate-200 font-semibold">{isGenerating ? 'running' : historyStatus || 'idle'}</span>
                                </div>
                                {lastPromptId && (
                                    <div className="text-slate-400">
                                        Prompt ID: <span className="font-mono text-slate-300">{lastPromptId}</span>
                                    </div>
                                )}
                                <div className="text-slate-400">
                                    Detected outputs: <span className="text-slate-300">{detectedOutputs.length > 0 ? detectedOutputs.join(', ') : 'none yet'}</span>
                                </div>
                                <details>
                                    <summary className="cursor-pointer text-slate-300">Generation log</summary>
                                    <div className="mt-2 max-h-28 overflow-y-auto custom-scrollbar space-y-1">
                                        {generationLogs.length > 0 ? generationLogs.map((line, idx) => (
                                            <div key={`${line}_${idx}`} className="text-slate-500 font-mono">{line}</div>
                                        )) : <div className="text-slate-600">No log entries yet.</div>}
                                    </div>
                                </details>
                            </div>
                        )}

                        {error && (
                            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 flex items-start gap-2">
                                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                                <div className="text-xs text-red-300">{error}</div>
                            </div>
                        )}
                    </div>
                </>
            }
            rightPane={
                <div className="flex-1 p-8 flex items-center justify-center">
                    {audioUrl ? (
                        <div className="w-full max-w-2xl bg-[#121218] border border-white/5 rounded-2xl p-4 space-y-3">
                            <audio controls className="w-full">
                                <source src={audioUrl} />
                            </audio>
                            <button onClick={handleDownloadAudio} className="text-xs text-slate-400 hover:text-white text-left">Download</button>
                        </div>
                    ) : blueprint ? (
                        <div className="w-full max-w-3xl bg-[#121218] border border-white/5 rounded-2xl p-5 space-y-4">
                            <div>
                                <h3 className="text-lg font-bold text-white">{blueprint.title}</h3>
                                <p className="text-xs text-slate-400 mt-1">{blueprint.overview.mood_imagery}</p>
                            </div>

                            <div className="bg-black/30 border border-white/10 rounded-xl p-3">
                                <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">ACE-Step Prompt</div>
                                <p className="text-sm text-slate-200 leading-relaxed">{blueprint.ace_step_prompt}</p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                                <div className="bg-black/30 border border-white/10 rounded-xl p-3">
                                    <div className="text-slate-500 mb-1">Genre</div>
                                    <div className="text-slate-200">{blueprint.music_metadata.genre || '-'}</div>
                                </div>
                                <div className="bg-black/30 border border-white/10 rounded-xl p-3">
                                    <div className="text-slate-500 mb-1">Tempo</div>
                                    <div className="text-slate-200">{blueprint.music_metadata.tempo_bpm || '-'}</div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center text-slate-500">
                            <Music4 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                            <p>ACE-Step output will appear here</p>
                        </div>
                    )}
                </div>
            }
        />
    );
};
















































