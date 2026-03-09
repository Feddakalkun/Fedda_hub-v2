import { useState } from 'react';
import { Upload, FileAudio, Mic, X, ChevronRight, ImageIcon } from 'lucide-react';
import { Button } from '../ui/Button';
import { useComfyExecution } from '../../contexts/ComfyExecutionContext';
import { comfyService } from '../../services/comfyService';
import { GalleryModal } from '../GalleryModal';
import { useToast } from '../ui/Toast';
import { BACKEND_API } from '../../config/api';
import { usePersistentState } from '../../hooks/usePersistentState';

export const LipsyncTab = () => {
    const { queueWorkflow } = useComfyExecution();
    const { toast } = useToast();

    // Face image
    const [faceImage, setFaceImage] = useState<string | null>(null);
    const [faceImageName, setFaceImageName] = useState<string | null>(null);
    const [showGalleryModal, setShowGalleryModal] = useState(false);

    // Audio input
    const [audioMode, setAudioMode] = usePersistentState<'upload' | 'tts'>('video_lipsync_audio_mode', 'upload');
    const [audioFile, setAudioFile] = useState<File | null>(null);
    const [ttsText, setTtsText] = usePersistentState('video_lipsync_tts_text', '');
    const [voiceStyle, setVoiceStyle] = usePersistentState('video_lipsync_voice_style', 'female, clear voice');
    const [isGeneratingTts, setIsGeneratingTts] = useState(false);

    // Parameters
    const [prompt, setPrompt] = usePersistentState('video_lipsync_prompt', 'a woman lipsyncing');
    const [negativePrompt, setNegativePrompt] = usePersistentState('video_lipsync_negative_prompt', 'bright tones, overexposed, static, blurred details, subtitles, style, works, paintings, images, static, overall gray, worst quality, low quality, JPEG compression residue, ugly, incomplete, extra fingers, poorly drawn hands, poorly drawn faces, deformed, disfigured, misshapen limbs, fused fingers, still picture, messy background, three legs, many people in the background, walking backwards');
    const [audioDuration, setAudioDuration] = usePersistentState('video_lipsync_audio_duration', 5);
    const [steps, setSteps] = usePersistentState('video_lipsync_steps', 4);
    const [seed, setSeed] = usePersistentState('video_lipsync_seed', -1);
    const [resolution, setResolution] = usePersistentState('video_lipsync_resolution', 512);
    const [showAdvanced, setShowAdvanced] = usePersistentState('video_lipsync_show_advanced', false);
    const [isGenerating, setIsGenerating] = useState(false);

    const handleFaceImageDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            setFaceImage(URL.createObjectURL(file));
            setFaceImageName(file.name);
        }
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
            // Clear VRAM
            try { await comfyService.freeMemory(true, true); } catch {}

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

            // Load workflow
            const response = await fetch(`/workflows/wan-infinite-talk.json?v=${Date.now()}`);
            if (!response.ok) throw new Error('Failed to load lipsync workflow');
            const workflow = await response.json();

            const activeSeed = seed === -1 ? Math.floor(Math.random() * 1000000000000000) : seed;

            // Inject parameters
            // Node 284: LoadImage (face)
            if (workflow['284']) workflow['284'].inputs.image = faceFilename;

            // Node 125: LoadAudio
            if (workflow['125']) workflow['125'].inputs.audio = audioFilename;

            // Node 159: AudioCrop (duration)
            if (workflow['159']) {
                workflow['159'].inputs.start_time = '0';
                workflow['159'].inputs.end_time = String(audioDuration);
            }

            // Node 241: WanVideoTextEncodeCached (prompts)
            if (workflow['241']) {
                workflow['241'].inputs.positive_prompt = prompt;
                workflow['241'].inputs.negative_prompt = negativePrompt;
            }

            // Node 128: WanVideoSampler
            if (workflow['128']) {
                workflow['128'].inputs.steps = steps;
                workflow['128'].inputs.seed = activeSeed;
            }

            // Node 537: AspectRatioResizeImage (width)
            if (workflow['537']) {
                workflow['537'].inputs.width = resolution;
            }

            await queueWorkflow(workflow);
            toast('Lipsync video queued!', 'success');

        } catch (error: any) {
            console.error('Lipsync generation failed:', error);
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
                        onDrop={handleFaceImageDrop}
                        onDragOver={(e) => e.preventDefault()}
                        className={`relative border-2 border-dashed rounded-xl h-52 transition-all overflow-hidden ${
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
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                                <div className="p-3 rounded-full bg-white/5">
                                    <ImageIcon className="w-6 h-6 text-white/30" />
                                </div>
                                <p className="text-xs text-slate-500">Drag & drop face image</p>
                                <Button size="sm" variant="ghost" onClick={() => setShowGalleryModal(true)}>
                                    Browse Gallery
                                </Button>
                            </div>
                        )}
                        <input
                            type="file"
                            accept="image/*"
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
                    <label className="block text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-2">Prompt</label>
                    <input
                        type="text"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        className="w-full bg-[#0a0a0f] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-white/20"
                    />
                </div>

                {/* Controls */}
                <div className="space-y-4 bg-[#0a0a0f] border border-white/10 rounded-xl p-4">
                    <div>
                        <div className="flex justify-between text-xs text-slate-400 mb-1">
                            <span>Audio Duration</span>
                            <span className="text-white font-mono">{audioDuration}s</span>
                        </div>
                        <input
                            type="range" min="1" max="30" value={audioDuration}
                            onChange={(e) => setAudioDuration(parseInt(e.target.value))}
                            className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-white"
                        />
                    </div>
                    <div>
                        <div className="flex justify-between text-xs text-slate-400 mb-1">
                            <span>Resolution</span>
                            <span className="text-white font-mono">{resolution}px</span>
                        </div>
                        <input
                            type="range" min="256" max="1024" step="32" value={resolution}
                            onChange={(e) => setResolution(parseInt(e.target.value))}
                            className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-white"
                        />
                    </div>
                </div>

                {/* Advanced */}
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
                                    <span>Steps</span>
                                    <span className="text-white font-mono">{steps}</span>
                                </div>
                                <input
                                    type="range" min="1" max="20" value={steps}
                                    onChange={(e) => setSteps(parseInt(e.target.value))}
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

