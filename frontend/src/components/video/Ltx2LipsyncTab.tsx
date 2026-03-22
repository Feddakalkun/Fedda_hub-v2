import { useState } from 'react';
import { Upload, FileAudio, Mic, X, ChevronRight, ImageIcon } from 'lucide-react';
import { Button } from '../ui/Button';
import { useComfyExecution } from '../../contexts/ComfyExecutionContext';
import { comfyService } from '../../services/comfyService';
import { GalleryModal } from '../GalleryModal';
import { useToast } from '../ui/Toast';
import { BACKEND_API } from '../../config/api';
import { usePersistentState } from '../../hooks/usePersistentState';

type PresetTier = 'fast' | 'balanced' | 'quality';

const PRESETS: Record<PresetTier, { label: string; description: string; steps: number; cfg: number; strength: number }> = {
    fast: { label: 'Fast', description: 'Quick preview', steps: 8, cfg: 1, strength: 0.7 },
    balanced: { label: 'Balanced', description: 'Good sync quality', steps: 14, cfg: 1, strength: 0.8 },
    quality: { label: 'Quality', description: 'Best lipsync', steps: 20, cfg: 1, strength: 0.85 },
};

const ASPECT_RATIOS = [
    { label: '1:1', width: 512, height: 512 },
    { label: '9:16', width: 432, height: 768 },
    { label: '16:9', width: 768, height: 432 },
    { label: '3:4', width: 448, height: 600 },
    { label: '4:3', width: 600, height: 448 },
];

export const Ltx2LipsyncTab = () => {
    const { queueWorkflow } = useComfyExecution();
    const { toast } = useToast();

    // Face image
    const [faceImage, setFaceImage] = useState<string | null>(null);
    const [faceImageName, setFaceImageName] = useState<string | null>(null);
    const [showGalleryModal, setShowGalleryModal] = useState(false);

    // Audio input
    const [audioMode, setAudioMode] = usePersistentState<'upload' | 'tts'>('ltx2_lipsync_audio_mode', 'upload');
    const [audioFile, setAudioFile] = useState<File | null>(null);
    const [ttsText, setTtsText] = usePersistentState('ltx2_lipsync_tts_text', '');
    const [voiceStyle, setVoiceStyle] = usePersistentState('ltx2_lipsync_voice_style', 'female, clear voice');
    const [isGeneratingTts, setIsGeneratingTts] = useState(false);

    // Parameters
    const [prompt, setPrompt] = usePersistentState('ltx2_lipsync_prompt', 'S looks directly at the camera with a loving smile, and lip-syncing with emotion');
    const [negativePrompt, setNegativePrompt] = usePersistentState('ltx2_lipsync_negative', 'blurry, low quality, distorted face, deformed, artifacts, watermark');
    const [preset, setPreset] = usePersistentState<PresetTier>('ltx2_lipsync_preset', 'balanced');
    const [audioDuration, setAudioDuration] = usePersistentState('ltx2_lipsync_duration', 2);
    const [audioStart, setAudioStart] = usePersistentState('ltx2_lipsync_audio_start', 0);
    const [aspectRatio, setAspectRatio] = usePersistentState('ltx2_lipsync_aspect', '1:1');
    const [steps, setSteps] = usePersistentState('ltx2_lipsync_steps', PRESETS.balanced.steps);
    const [cfg, setCfg] = usePersistentState('ltx2_lipsync_cfg', PRESETS.balanced.cfg);
    const [strength, setStrength] = usePersistentState('ltx2_lipsync_strength', PRESETS.balanced.strength);
    const [seed, setSeed] = usePersistentState('ltx2_lipsync_seed', -1);
    const [showAdvanced, setShowAdvanced] = usePersistentState('ltx2_lipsync_show_advanced', false);
    const [isGenerating, setIsGenerating] = useState(false);

    const selectedAR = ASPECT_RATIOS.find(a => a.label === aspectRatio) || ASPECT_RATIOS[0];

    const applyPreset = (tier: PresetTier) => {
        setPreset(tier);
        setSteps(PRESETS[tier].steps);
        setCfg(PRESETS[tier].cfg);
        setStrength(PRESETS[tier].strength);
    };

    const handleGenerate = async () => {
        if (!faceImage) {
            toast('Please upload a face image', 'error');
            return;
        }
        if (audioMode === 'upload' && !audioFile) {
            toast('Please upload an audio file', 'error');
            return;
        }
        if (audioMode === 'tts' && !ttsText.trim()) {
            toast('Please enter text for TTS', 'error');
            return;
        }

        setIsGenerating(true);

        try {
            let audioFilename = '';

            // Handle audio
            if (audioMode === 'tts') {
                setIsGeneratingTts(true);
                toast('Generating speech...', 'info');
                const ttsResponse = await fetch(`${BACKEND_API.BASE_URL}${BACKEND_API.ENDPOINTS.AUDIO_TTS}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: ttsText, voice_style: voiceStyle }),
                });
                if (!ttsResponse.ok) throw new Error('TTS generation failed');
                const audioBlob = await ttsResponse.blob();
                const ttsFile = new File([audioBlob], 'tts_audio.flac', { type: 'audio/flac' });
                const uploaded = await comfyService.uploadAudio(ttsFile);
                audioFilename = uploaded.name;
                setIsGeneratingTts(false);
            } else {
                const uploaded = await comfyService.uploadAudio(audioFile!);
                audioFilename = uploaded.name;
            }

            // Upload face image
            let faceFilename = faceImageName || 'face.png';
            if (faceImage.startsWith('http') || faceImage.startsWith('blob:')) {
                const imgRes = await fetch(faceImage);
                const blob = await imgRes.blob();
                const file = new File([blob], faceFilename, { type: blob.type });
                const uploadRes = await comfyService.uploadImage(file);
                faceFilename = uploadRes.name;
            }

            // Load LTX-2 Lipsync workflow
            const response = await fetch(`/workflows/LTX2lipsync.json?v=${Date.now()}`);
            if (!response.ok) throw new Error('Failed to load LTX-2 Lipsync workflow');
            const workflow = await response.json();

            const activeSeed = seed === -1 ? Math.floor(Math.random() * 1000000000000000) : seed;
            const runTag = Date.now().toString(36);

            // Remove HuggingFaceDownloader + ShowText nodes
            delete workflow['139'];
            delete workflow['143'];
            delete workflow['455'];

            // Node 392: LoadImage (face)
            if (workflow['392']) workflow['392'].inputs.image = faceFilename;

            // Node 404: LoadAudio
            if (workflow['404']) workflow['404'].inputs.audio = audioFilename;

            // Node 402: CR Prompt Text (positive prompt)
            if (workflow['402']) workflow['402'].inputs.prompt = prompt;

            // Node 403: CLIPTextEncode (negative prompt)
            if (workflow['403']) workflow['403'].inputs.text = negativePrompt;

            // Node 393: Audio start time
            if (workflow['393']) workflow['393'].inputs.value = audioStart;

            // Node 394: Audio duration
            if (workflow['394']) workflow['394'].inputs.value = audioDuration;

            // Node 395: AspectRatioImageSize (resolution)
            if (workflow['395']) {
                workflow['395'].inputs.width = selectedAR.width;
                workflow['395'].inputs.height = selectedAR.height;
                workflow['395'].inputs.aspect_ratio = aspectRatio;
            }

            // Node 405: RandomNoise (seed)
            if (workflow['405']) workflow['405'].inputs.noise_seed = activeSeed;

            // Node 310:296: RandomNoise (upscale pass seed)
            if (workflow['310:296']) workflow['310:296'].inputs.noise_seed = activeSeed + 1;

            // Node 425: BasicScheduler (steps)
            if (workflow['425']) workflow['425'].inputs.steps = steps;

            // Node 426: CFGGuider (cfg)
            if (workflow['426']) workflow['426'].inputs.cfg = cfg;

            // Node 410: LTXVImgToVideoInplace (denoise strength)
            if (workflow['410']) workflow['410'].inputs.strength = strength;

            // Node 396: VHS_VideoCombine (output filename)
            if (workflow['396']) workflow['396'].inputs.filename_prefix = `VIDEO/LTX2/LIPSYNC_${runTag}`;

            // Node 470: SaveImage (last frame)
            if (workflow['470']) workflow['470'].inputs.filename_prefix = `VIDEO/LTX2/LIPSYNC_LAST_${runTag}`;

            await queueWorkflow(workflow);
            toast('LTX-2 Lipsync queued!', 'success');

        } catch (error: any) {
            console.error('LTX-2 Lipsync generation failed:', error);
            toast(error?.message || 'Generation failed', 'error');
        } finally {
            setIsGenerating(false);
            setIsGeneratingTts(false);
        }
    };

    return (
        <>
            <GalleryModal
                isOpen={showGalleryModal}
                onClose={() => setShowGalleryModal(false)}
                onSelect={(url, filename) => {
                    setFaceImage(url);
                    setFaceImageName(filename);
                    setShowGalleryModal(false);
                }}
            />

            <div className="space-y-5">
                {/* Face Image Upload */}
                <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-2">Face Image</label>
                    <div
                        onDrop={(e) => {
                            e.preventDefault();
                            const file = e.dataTransfer.files[0];
                            if (file && file.type.startsWith('image/')) {
                                setFaceImage(URL.createObjectURL(file));
                                setFaceImageName(file.name);
                            }
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        className={`relative border-2 border-dashed rounded-xl h-44 transition-all overflow-hidden ${
                            faceImage ? 'border-white/20 bg-black' : 'border-white/10 hover:border-white/20 bg-white/[0.02]'
                        }`}
                    >
                        {faceImage ? (
                            <>
                                <img src={faceImage} alt="Face" className="w-full h-full object-contain" />
                                <button
                                    onClick={() => { setFaceImage(null); setFaceImageName(null); }}
                                    className="absolute top-2 right-2 p-1 bg-black/60 hover:bg-red-500/80 rounded-lg text-white/70 hover:text-white transition-colors"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </>
                        ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                                <ImageIcon className="w-8 h-8 text-slate-600" />
                                <p className="text-[10px] text-slate-600">Drop face image or click to upload</p>
                                <button
                                    onClick={() => setShowGalleryModal(true)}
                                    className="px-3 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[10px] text-slate-400 hover:text-white transition-colors"
                                >
                                    Browse Gallery
                                </button>
                            </div>
                        )}
                        <input
                            type="file" accept="image/*"
                            className="absolute inset-0 opacity-0 cursor-pointer"
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                    setFaceImage(URL.createObjectURL(file));
                                    setFaceImageName(file.name);
                                }
                            }}
                        />
                    </div>
                </div>

                {/* Audio Input */}
                <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-2">Audio Input</label>

                    {/* Mode Toggle */}
                    <div className="flex gap-1 mb-3 bg-black/40 rounded-lg p-1 border border-white/5">
                        <button
                            onClick={() => setAudioMode('upload')}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                                audioMode === 'upload' ? 'bg-white text-black' : 'text-slate-500 hover:text-white'
                            }`}
                        >
                            <FileAudio className="w-3 h-3" /> Upload
                        </button>
                        <button
                            onClick={() => setAudioMode('tts')}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                                audioMode === 'tts' ? 'bg-white text-black' : 'text-slate-500 hover:text-white'
                            }`}
                        >
                            <Mic className="w-3 h-3" /> Text-to-Speech
                        </button>
                    </div>

                    {audioMode === 'upload' ? (
                        <div className="border border-white/10 rounded-xl p-4 bg-[#0a0a0f]">
                            <label className="flex items-center gap-3 cursor-pointer group">
                                <Upload className="w-5 h-5 text-slate-500 group-hover:text-white transition-colors" />
                                <span className="text-sm text-slate-400 group-hover:text-white transition-colors">
                                    {audioFile ? audioFile.name : 'Choose audio file...'}
                                </span>
                                <input
                                    type="file"
                                    accept="audio/*"
                                    className="hidden"
                                    onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
                                />
                            </label>
                            {audioFile && (
                                <div className="mt-2 flex items-center gap-2">
                                    <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">Ready</span>
                                    <button onClick={() => setAudioFile(null)} className="text-[10px] text-red-400 hover:text-red-300">Clear</button>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <textarea
                                value={ttsText}
                                onChange={(e) => setTtsText(e.target.value)}
                                placeholder="Type text to convert to speech..."
                                className="w-full h-20 bg-[#0a0a0f] border border-white/10 rounded-xl p-3 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-white/20 resize-none"
                            />
                            <div>
                                <label className="block text-[10px] text-slate-600 mb-1">Voice Style</label>
                                <input
                                    type="text"
                                    value={voiceStyle}
                                    onChange={(e) => setVoiceStyle(e.target.value)}
                                    className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-white/20"
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Prompt */}
                <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-2">Motion Prompt</label>
                    <p className="text-[10px] text-slate-600 mb-1.5">Describe facial expressions and lip movement. Audio drives the actual sync.</p>
                    <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="S looks directly at the camera, lip-syncing with emotion..."
                        className="w-full h-20 bg-[#0a0a0f] border border-white/10 rounded-xl p-3 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-white/20 resize-none"
                    />
                </div>

                {/* Preset Picker */}
                <div>
                    <label className="block text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-2">Quality Preset</label>
                    <div className="flex gap-1 bg-black/40 rounded-lg p-1 border border-white/5">
                        {(Object.keys(PRESETS) as PresetTier[]).map((tier) => (
                            <button
                                key={tier}
                                onClick={() => applyPreset(tier)}
                                className={`flex-1 px-3 py-2 rounded-md text-xs font-medium transition-all ${
                                    preset === tier ? 'bg-white text-black' : 'text-slate-500 hover:text-white'
                                }`}
                            >
                                <div>{PRESETS[tier].label}</div>
                                <div className={`text-[9px] mt-0.5 ${preset === tier ? 'text-black/60' : 'text-slate-600'}`}>
                                    {PRESETS[tier].description}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Audio Duration + Aspect Ratio */}
                <div className="space-y-4 bg-[#0a0a0f] border border-white/10 rounded-xl p-4">
                    <div>
                        <div className="flex justify-between text-xs text-slate-400 mb-1">
                            <span>Audio Duration</span>
                            <span className="text-white font-mono">{audioDuration}s</span>
                        </div>
                        <input
                            type="range" min="1" max="16" value={audioDuration}
                            onChange={(e) => setAudioDuration(parseInt(e.target.value))}
                            className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-white"
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-slate-400 mb-2">Aspect Ratio</label>
                        <div className="flex gap-1.5">
                            {ASPECT_RATIOS.map((ar) => (
                                <button
                                    key={ar.label}
                                    onClick={() => setAspectRatio(ar.label)}
                                    className={`flex-1 px-2 py-1.5 rounded-md text-[10px] font-medium transition-all border ${
                                        aspectRatio === ar.label
                                            ? 'bg-white text-black border-white'
                                            : 'text-slate-500 hover:text-white border-white/5 hover:border-white/20'
                                    }`}
                                >
                                    {ar.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Advanced Settings */}
                <div className="border border-white/5 rounded-xl overflow-hidden">
                    <button
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        className="w-full flex items-center justify-between p-3 bg-black/20 hover:bg-black/40 transition-colors text-xs font-medium text-slate-400 hover:text-white"
                    >
                        <span>Advanced Settings</span>
                        <ChevronRight className={`w-3 h-3 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} />
                    </button>
                    {showAdvanced && (
                        <div className="p-4 bg-[#0a0a0f] space-y-4">
                            <div>
                                <div className="flex justify-between text-xs text-slate-400 mb-1">
                                    <span>Audio Start Time</span>
                                    <span className="text-white font-mono">{audioStart}s</span>
                                </div>
                                <input
                                    type="range" min="0" max="60" step="0.5" value={audioStart}
                                    onChange={(e) => setAudioStart(parseFloat(e.target.value))}
                                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-white"
                                />
                            </div>
                            <div>
                                <div className="flex justify-between text-xs text-slate-400 mb-1">
                                    <span>Steps</span>
                                    <span className="text-white font-mono">{steps}</span>
                                </div>
                                <input
                                    type="range" min="4" max="30" value={steps}
                                    onChange={(e) => setSteps(parseInt(e.target.value))}
                                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-white"
                                />
                            </div>
                            <div>
                                <div className="flex justify-between text-xs text-slate-400 mb-1">
                                    <span>CFG</span>
                                    <span className="text-white font-mono">{cfg.toFixed(1)}</span>
                                </div>
                                <input
                                    type="range" min="1" max="10" step="0.1" value={cfg}
                                    onChange={(e) => setCfg(parseFloat(e.target.value))}
                                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-white"
                                />
                            </div>
                            <div>
                                <div className="flex justify-between text-xs text-slate-400 mb-1">
                                    <span>Image Strength</span>
                                    <span className="text-white font-mono">{strength.toFixed(2)}</span>
                                </div>
                                <input
                                    type="range" min="0.3" max="1.0" step="0.05" value={strength}
                                    onChange={(e) => setStrength(parseFloat(e.target.value))}
                                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-white"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Seed (-1 = random)</label>
                                <input
                                    type="number" value={seed}
                                    onChange={(e) => setSeed(parseInt(e.target.value))}
                                    className="w-full bg-black border border-white/5 rounded-lg p-2 text-xs font-mono text-slate-300 focus:outline-none focus:border-white/20"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Negative Prompt</label>
                                <textarea
                                    value={negativePrompt}
                                    onChange={(e) => setNegativePrompt(e.target.value)}
                                    className="w-full h-16 bg-black border border-white/5 rounded-lg p-2 text-[10px] text-slate-400 focus:outline-none focus:border-white/20 resize-none"
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Generate */}
                <Button
                    variant="primary"
                    size="lg"
                    className="w-full h-12"
                    onClick={handleGenerate}
                    isLoading={isGenerating || isGeneratingTts}
                    disabled={isGenerating || isGeneratingTts}
                >
                    {isGeneratingTts ? 'Generating Speech...' : isGenerating ? 'Rendering...' : 'Generate Lipsync'}
                </Button>
            </div>
        </>
    );
};
