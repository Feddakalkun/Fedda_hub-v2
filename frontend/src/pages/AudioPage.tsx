import { useCallback, useEffect, useState } from 'react';
import { Loader2, Music4, Wand2, AlertCircle, Sparkles, ChevronDown } from 'lucide-react';
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
import {
    ACE_PRESETS,
    ACE_FEATURED_PRESET_IDS,
    ACE_DEFAULT_MODELS,
    ACE_REQUIRED_NODE_TYPES,
    type AcePreset,
} from '../config/audioPresets';
import {
    buildReferenceSuggestions,
    type AudioReferenceInfo,
    type ReferenceSuggestions
} from '../utils/audioPatterns';

interface OutputFileRef {
    filename: string;
    subfolder: string;
    type: string;
}

type GenerationSourceMode = 'preset' | 'reference' | 'manual';

const AUDIO_FILE_REGEX = /\.(flac|wav|mp3|ogg|m4a|aac)$/i;
const REFERENCE_CUES_MARKER = '[Reference cues]';


const HISTORY_ITEM_KEYS = ['status', 'outputs', 'prompt'];


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

    const [tags, setTags] = usePersistentState('audio_ace_tags', 'groove pop, funk bass, tight live drums, punchy brass stabs, soulful male vocal, dancefloor hook, retro modern polish, 118 BPM');
    const [lyrics, setLyrics] = usePersistentState('audio_ace_lyrics', '[verse]\nCity lights burn like fire tonight\nFeet on the edge and the rhythm is right\n\n[pre-chorus]\nHeartbeat racing under neon skies\n\n[chorus]\nWe move like thunder, no looking back\nHands to the ceiling, we light the track');
    const [seconds, setSeconds] = usePersistentState('audio_ace_seconds', 120);
    const [steps, setSteps] = usePersistentState('audio_ace_steps', 12);
    const [cfg, setCfg] = usePersistentState('audio_ace_cfg', 1);
    const [seed, setSeed] = usePersistentState('audio_ace_seed', -1);

    const [bpm, setBpm] = usePersistentState('audio_ace_bpm', 118);
    const [cfgScale, setCfgScale] = usePersistentState('audio_ace_cfg_scale', 1.2);
    const [useAudioCodes, setUseAudioCodes] = usePersistentState('audio_ace_use_audio_codes', false);
    const [selectedPresetId, setSelectedPresetId] = usePersistentState('audio_ace_selected_preset', ACE_PRESETS[0].id);
    const [, setGenerationSourceMode] = usePersistentState<GenerationSourceMode>('audio_ace_source_mode', 'preset');
    const [, setActiveReferenceSummary] = usePersistentState('audio_ace_active_reference', '');

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

    const [showAdvanced, setShowAdvanced] = useState(false);
    const [showArchitect, setShowArchitect] = useState(false);
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

    // --- One-Shot Quick Create ---
    const [quickBrief, setQuickBrief] = usePersistentState('audio_ace_quick_brief', '');
    const [isQuickGenerating, setIsQuickGenerating] = useState(false);

    const findClosestPreset = (input: string): AcePreset => {
        const lower = input.toLowerCase();
        const keywords: Record<string, string[]> = {
            'mj-groove-pop': ['pop', 'funk', 'disco', 'dance', 'groove', 'michael', 'jackson', 'motown', 'soul'],
            'metallica-heavy': ['metal', 'heavy', 'rock', 'thrash', 'metallica', 'hard', 'guitar', 'riff', 'headbang'],
            'sundfor-nordic-cinema': ['nordic', 'cinematic', 'ethereal', 'atmospheric', 'aurora', 'sundfor', 'art pop', 'scandinavian'],
            'infected-psytrance': ['psy', 'trance', 'psychedelic', 'goa', 'rave', 'festival', 'infected', 'techno', 'electronic'],
            'dark-whisper-pop': ['billie', 'whisper', 'dark pop', 'minimalist', 'eerie', 'asmr'],
            'neon-rnb-drive': ['rnb', 'r&b', 'synthwave', '80s', 'retro', 'weeknd', 'neon', 'synth'],
            'trailer-impact': ['trailer', 'epic', 'cinematic', 'orchestra', 'hans', 'zimmer', 'film', 'dramatic', 'soundtrack'],
            'soul-ballad-lift': ['ballad', 'soul', 'adele', 'emotional', 'piano', 'vocal', 'sad', 'heartbreak'],
            'melodic-trap-mood': ['trap', 'rap', 'hip hop', 'hiphop', 'drake', 'eminem', '808', 'beat', 'bars', 'flow', 'rapper'],
            'festival-uplift': ['edm', 'avicii', 'festival', 'uplift', 'house', 'progressive', 'anthem', 'drop'],
            'ambient-focus': ['ambient', 'lo-fi', 'lofi', 'chill', 'focus', 'study', 'relax', 'meditation', 'calm', 'jazz'],
            'tiktok-hook-30': ['tiktok', 'viral', 'hook', 'short', 'catchy', 'trending'],
        };

        let bestId = 'mj-groove-pop';
        let bestScore = 0;
        for (const [presetId, words] of Object.entries(keywords)) {
            const score = words.filter(w => lower.includes(w)).length;
            if (score > bestScore) {
                bestScore = score;
                bestId = presetId;
            }
        }
        return ACE_PRESETS.find(p => p.id === bestId) || ACE_PRESETS[0];
    };

    const handleOneShotGenerate = async () => {
        const brief = quickBrief.trim();
        if (!brief) return;

        setIsQuickGenerating(true);
        setError(null);

        try {
            // Try AI blueprint first
            const model = plannerModel || availableModels[0];
            if (model) {
                toast('Creating your song...', 'success');
                const result = await assistantService.generateAceStepBlueprint(model, brief);
                setBlueprint(result);
                applyBlueprint(result);
                toast(`Blueprint: "${result.title}" — generating audio...`, 'success');
            } else {
                // Fallback: match to closest preset
                const preset = findClosestPreset(brief);
                applyPresetById(preset.id);
                toast(`No AI model available — using "${preset.label}" preset`, 'info');
            }
        } catch (err) {
            // On AI failure, fall back to preset matching
            const preset = findClosestPreset(brief);
            applyPresetById(preset.id);
            toast(`AI unavailable — using "${preset.label}" preset`, 'info');
        }

        setIsQuickGenerating(false);

        // Auto-trigger generation (small delay to let state settle)
        setTimeout(() => {
            handleGenerate();
        }, 100);
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
                    {/* Quick Create — one-shot song generation */}
                    <div className="bg-gradient-to-br from-white/[0.03] to-white/[0.01] border border-white/10 rounded-2xl p-4 space-y-3">
                        <div className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                            <Music4 className="w-3.5 h-3.5" /> Quick Create
                        </div>
                        <input
                            value={quickBrief}
                            onChange={(e) => setQuickBrief(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && quickBrief.trim()) { e.preventDefault(); handleOneShotGenerate(); } }}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:ring-1 focus:ring-white/20 focus:outline-none"
                            placeholder="Describe your song... e.g. 'eminem rap god battle rap' or 'sad piano ballad'"
                            disabled={isQuickGenerating || isGenerating}
                        />
                        <button
                            onClick={handleOneShotGenerate}
                            disabled={isQuickGenerating || isGenerating || !quickBrief.trim() || !aceReady}
                            className="w-full py-3 rounded-xl font-bold text-sm uppercase tracking-wider bg-white text-black hover:bg-slate-200 disabled:opacity-30 transition-all flex items-center justify-center gap-2"
                        >
                            {isQuickGenerating ? (
                                <><Loader2 className="w-4 h-4 animate-spin" /> Creating Song...</>
                            ) : (
                                <><Wand2 className="w-4 h-4" /> Create Song</>
                            )}
                        </button>
                    </div>

                    <ModelDownloader modelGroup="ace-step" onModelsReady={() => refreshAceModels(true)} />

                    <div className="bg-[#121218] border border-white/5 rounded-2xl p-4 space-y-3 mt-4">
                        <div className="text-xs font-bold uppercase tracking-widest text-slate-500">ACE-Step 1.5</div>

                        {/* Preset quick-pick */}
                        <div className="flex gap-2">
                            <select
                                value={selectedPresetId}
                                onChange={(e) => { setSelectedPresetId(e.target.value); applyPresetById(e.target.value); }}
                                className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                            >
                                {ACE_PRESETS.map((preset) => (
                                    <option key={preset.id} value={preset.id}>
                                        {preset.label} ({preset.artistHint})
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="flex flex-wrap gap-1.5">
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

                        {/* Tags */}
                        <div className="space-y-1">
                            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Tags</div>
                            <input
                                value={tags}
                                onChange={(e) => { setTags(e.target.value); setGenerationSourceMode('manual'); setActiveReferenceSummary(''); }}
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
                                placeholder="genre, mood, instruments, vocal style"
                            />
                        </div>

                        {/* Lyrics */}
                        <div className="space-y-1">
                            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Lyrics</div>
                            <textarea
                                value={lyrics}
                                onChange={(e) => { setLyrics(e.target.value); setGenerationSourceMode('manual'); setActiveReferenceSummary(''); }}
                                rows={6}
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono"
                            />
                        </div>

                        {/* Core params: Duration + BPM */}
                        <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                                <div className="text-[11px] text-slate-500">Duration (seconds)</div>
                                <input type="number" value={seconds} onChange={(e) => { setSeconds(parseInt(e.target.value || '120')); setGenerationSourceMode('manual'); setActiveReferenceSummary(''); }} className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
                            </div>
                            <div className="space-y-1">
                                <div className="text-[11px] text-slate-500">BPM</div>
                                <input type="number" value={bpm} onChange={(e) => { setBpm(parseInt(e.target.value || '120')); setGenerationSourceMode('manual'); setActiveReferenceSummary(''); }} className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
                            </div>
                        </div>

                        {/* Generate button */}
                        <button onClick={handleGenerate} disabled={isGenerating || !aceReady} className="w-full py-3 rounded-xl font-bold text-sm uppercase bg-white text-black hover:bg-slate-200 disabled:opacity-30">
                            {isGenerating ? <Loader2 className="w-4 h-4 inline animate-spin mr-2" /> : <Wand2 className="w-4 h-4 inline mr-2" />}Generate Track
                        </button>

                        {/* Status (only during/after generation) */}
                        {(lastPromptId || historyStatus || detectedOutputs.length > 0) && (
                            <div className="bg-black/30 border border-white/10 rounded-xl p-3 space-y-2 text-[11px]">
                                <div className="flex items-center justify-between">
                                    <span className="text-slate-400">Status</span>
                                    <span className="text-slate-200 font-semibold">{isGenerating ? 'running' : historyStatus || 'idle'}</span>
                                </div>
                                <details>
                                    <summary className="cursor-pointer text-slate-500">Details</summary>
                                    <div className="mt-2 space-y-1">
                                        {lastPromptId && <div className="text-slate-500">ID: <span className="font-mono text-slate-400">{lastPromptId}</span></div>}
                                        <div className="text-slate-500">Outputs: <span className="text-slate-400">{detectedOutputs.length > 0 ? detectedOutputs.join(', ') : 'none'}</span></div>
                                        {generationLogs.length > 0 && (
                                            <div className="max-h-20 overflow-y-auto custom-scrollbar space-y-0.5 mt-1">
                                                {generationLogs.map((line, idx) => (
                                                    <div key={`${line}_${idx}`} className="text-slate-600 font-mono text-[10px]">{line}</div>
                                                ))}
                                            </div>
                                        )}
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

                        {/* Advanced Settings (collapsed) */}
                        <button
                            onClick={() => setShowAdvanced(!showAdvanced)}
                            className="w-full flex items-center justify-between py-2 text-[11px] text-slate-500 hover:text-slate-300 uppercase tracking-widest"
                        >
                            Advanced Settings
                            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                        </button>

                        {showAdvanced && (
                            <div className="space-y-3 border-t border-white/5 pt-3">
                                <div className="grid grid-cols-4 gap-2">
                                    <div className="space-y-1">
                                        <div className="text-[10px] text-slate-500">Steps</div>
                                        <input type="number" value={steps} onChange={(e) => { setSteps(parseInt(e.target.value || '12')); setGenerationSourceMode('manual'); }} className="w-full bg-black/40 border border-white/10 rounded-xl px-2 py-1.5 text-xs text-white" />
                                    </div>
                                    <div className="space-y-1">
                                        <div className="text-[10px] text-slate-500">CFG</div>
                                        <input type="number" step={0.1} value={cfg} onChange={(e) => { setCfg(parseFloat(e.target.value || '1')); setGenerationSourceMode('manual'); }} className="w-full bg-black/40 border border-white/10 rounded-xl px-2 py-1.5 text-xs text-white" />
                                    </div>
                                    <div className="space-y-1">
                                        <div className="text-[10px] text-slate-500">CFG Scale</div>
                                        <input type="number" step={0.1} value={cfgScale} onChange={(e) => { setCfgScale(parseFloat(e.target.value || '1.2')); setGenerationSourceMode('manual'); }} className="w-full bg-black/40 border border-white/10 rounded-xl px-2 py-1.5 text-xs text-white" />
                                    </div>
                                    <div className="space-y-1">
                                        <div className="text-[10px] text-slate-500">Seed</div>
                                        <input type="number" value={seed} onChange={(e) => { setSeed(parseInt(e.target.value || '-1')); setGenerationSourceMode('manual'); }} className="w-full bg-black/40 border border-white/10 rounded-xl px-2 py-1.5 text-xs text-white" />
                                    </div>
                                </div>

                                {/* Model Routing */}
                                <div className="space-y-2">
                                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Model Routing</div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="space-y-1">
                                            <div className="text-[10px] text-slate-600">UNET</div>
                                            <select value={unetModel} onChange={(e) => setUnetModel(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl px-2 py-1.5 text-[11px] text-white">
                                                {unetModels.length > 0 ? unetModels.map((name) => <option key={name} value={name}>{name}</option>) : <option value="">No UNET</option>}
                                            </select>
                                        </div>
                                        <div className="space-y-1">
                                            <div className="text-[10px] text-slate-600">VAE</div>
                                            <select value={vaeModel} onChange={(e) => setVaeModel(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl px-2 py-1.5 text-[11px] text-white">
                                                {vaeModels.length > 0 ? vaeModels.map((name) => <option key={name} value={name}>{name}</option>) : <option value="">No VAE</option>}
                                            </select>
                                        </div>
                                        <div className="space-y-1">
                                            <div className="text-[10px] text-slate-600">Encoder 1</div>
                                            <select value={clipModel1} onChange={(e) => setClipModel1(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl px-2 py-1.5 text-[11px] text-white">
                                                {textEncoderModels.length > 0 ? textEncoderModels.map((name) => <option key={`a_${name}`} value={name}>{name}</option>) : <option value="">None</option>}
                                            </select>
                                        </div>
                                        <div className="space-y-1">
                                            <div className="text-[10px] text-slate-600">Encoder 2</div>
                                            <select value={clipModel2} onChange={(e) => setClipModel2(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl px-2 py-1.5 text-[11px] text-white">
                                                {textEncoderModels.length > 0 ? textEncoderModels.map((name) => <option key={`b_${name}`} value={name}>{name}</option>) : <option value="">None</option>}
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                {!aceReady && (
                                    <button onClick={() => refreshAceModels()} className="w-full py-2 rounded-xl font-bold text-xs uppercase bg-white/10 text-white hover:bg-white/20">
                                        Refresh ACE Models
                                    </button>
                                )}
                            </div>
                        )}

                        {/* AI Prompt Architect (collapsed) */}
                        <button
                            onClick={() => setShowArchitect(!showArchitect)}
                            className="w-full flex items-center justify-between py-2 text-[11px] text-slate-500 hover:text-slate-300 uppercase tracking-widest"
                        >
                            <span className="flex items-center gap-1.5"><Sparkles className="w-3 h-3" /> AI Prompt Architect</span>
                            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showArchitect ? 'rotate-180' : ''}`} />
                        </button>

                        {showArchitect && (
                            <div className="space-y-3 border-t border-white/5 pt-3">
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
                                    rows={3}
                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                                    placeholder="Describe the song idea, style, mood..."
                                />

                                <input
                                    value={favoriteArtist}
                                    onChange={(e) => setFavoriteArtist(e.target.value)}
                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                                    placeholder="Favorite artist (style inspiration)"
                                />

                                <input
                                    value={referenceUrl}
                                    onChange={(e) => setReferenceUrl(e.target.value)}
                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                                    placeholder="YouTube reference link"
                                />

                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        onClick={handleAnalyzeAndApplyReference}
                                        disabled={isAnalyzingReference || !referenceUrl.trim()}
                                        className="py-2 rounded-xl font-bold text-[11px] uppercase bg-white text-black hover:bg-slate-200 disabled:opacity-40"
                                    >
                                        {isAnalyzingReference ? <Loader2 className="w-3 h-3 inline animate-spin mr-1" /> : null}
                                        Analyze + Apply
                                    </button>
                                    <button
                                        onClick={handleDraftBlueprint}
                                        disabled={isPlanning || !plannerModel}
                                        className="py-2 rounded-xl font-bold text-[11px] uppercase bg-white/10 text-white hover:bg-white/20 disabled:opacity-40"
                                    >
                                        {isPlanning ? <Loader2 className="w-3 h-3 inline animate-spin mr-1" /> : <Sparkles className="w-3 h-3 inline mr-1" />}
                                        Draft Blueprint
                                    </button>
                                </div>

                                {referenceInfo && (
                                    <div className="bg-black/30 border border-white/10 rounded-xl p-3 text-[11px] text-slate-400 space-y-1">
                                        <div className="text-slate-300 font-semibold">{referenceInfo.title}</div>
                                        {referenceSuggestions && <div>BPM: {referenceSuggestions.bpm} / Duration: {referenceSuggestions.seconds}s</div>}
                                    </div>
                                )}

                                {plannerError && (
                                    <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-2 text-[11px] text-red-300">{plannerError}</div>
                                )}
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
















































