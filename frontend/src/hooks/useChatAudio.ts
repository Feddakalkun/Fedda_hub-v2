import { useState, useRef, useEffect, type Dispatch, type SetStateAction } from 'react';

interface PlayableMessage {
    id: string;
    role: string;
    type?: string;
    content: string;
}

interface UseChatAudioProps {
    setInput: Dispatch<SetStateAction<string>>;
    appendMessage: (role: 'user' | 'assistant', content: string) => void;
    autoPlayTTSMsg?: PlayableMessage | null;
}

export interface VoiceOption {
    id: string;
    name: string;
    engine?: string;
}

const FALLBACK_VOICES: VoiceOption[] = [
    { id: 'female, clear voice', name: 'Female (Default)' },
    { id: 'man with low pitch tembre', name: 'Male Deep' },
    { id: 'cheerful woman', name: 'Cheerful' },
    { id: 'professional male narrator', name: 'Professional' },
];

export const useChatAudio = ({ setInput, appendMessage, autoPlayTTSMsg }: UseChatAudioProps) => {
    // Mic state
    const [isRecording, setIsRecording] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [recordingMode, setRecordingMode] = useState<'hold' | 'toggle'>('hold');
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const recordingTimeoutRef = useRef<number | null>(null);

    // TTS state
    const [ttsEnabled, setTtsEnabled] = useState(false);
    const [playingMsgId, setPlayingMsgId] = useState<string | null>(null);
    const [generatingTtsId, setGeneratingTtsId] = useState<string | null>(null);
    const [voiceStyle, setVoiceStyle] = useState(() => localStorage.getItem('fedda_voice_style') || 'female, clear voice');
    const [availableVoices, setAvailableVoices] = useState<VoiceOption[]>(FALLBACK_VOICES);
    const [isLoadingVoices, setIsLoadingVoices] = useState(false);
    const [isUnloadingAudio, setIsUnloadingAudio] = useState(false);
    const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

    // ======== MIC RECORDING ========

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Use webm/opus for best compatibility and smallest size
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : 'audio/webm';

            const mediaRecorder = new MediaRecorder(stream, { mimeType });
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
                stream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
                await transcribeAudio(audioBlob);
            };

            mediaRecorder.start();
            setIsRecording(true);

            // Auto-stop after 30 seconds
            recordingTimeoutRef.current = window.setTimeout(() => {
                if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                    stopRecording();
                }
            }, 30000);

        } catch (error) {
            console.error('Error accessing microphone:', error);
            appendMessage('assistant', '⚠️ Could not access microphone. Please check permissions.');
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
            setIsRecording(false);

            if (recordingTimeoutRef.current) {
                clearTimeout(recordingTimeoutRef.current);
                recordingTimeoutRef.current = null;
            }
        }
    };

    const transcribeAudio = async (audioBlob: Blob) => {
        setIsTranscribing(true);
        try {
            const formData = new FormData();
            formData.append('audio', audioBlob, 'recording.webm');

            const response = await fetch('/api/audio/transcribe', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error('Transcription failed');
            }

            const data = await response.json();
            const transcribedText = data.text || '';

            if (transcribedText.trim()) {
                setInput(prev => prev + (prev ? ' ' : '') + transcribedText);
            } else {
                throw new Error('No speech detected');
            }

        } catch (error) {
            console.error('Transcription error:', error);
            appendMessage('assistant', '⚠️ Could not transcribe audio. Please try again.');
        } finally {
            setIsTranscribing(false);
        }
    };

    const handleMicMouseDown = () => {
        if (recordingMode === 'hold') {
            startRecording();
        }
    };

    const handleMicMouseUp = () => {
        if (recordingMode === 'hold' && isRecording) {
            stopRecording();
        }
    };

    const handleMicClick = () => {
        if (recordingMode === 'toggle') {
            if (isRecording) {
                stopRecording();
            } else {
                startRecording();
            }
        }
    };

    // ======== TEXT TO SPEECH ========

    const playTTS = async (messageId: string, text: string) => {
        try {
            if (!text?.trim()) return;
            setGeneratingTtsId(messageId);

            // Generate TTS
            const response = await fetch('/api/audio/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text,
                    voice_style: voiceStyle
                })
            });

            if (!response.ok) {
                let detail = 'TTS generation failed';
                try {
                    const err = await response.json();
                    detail = err?.detail || detail;
                } catch {
                    // keep fallback detail
                }
                throw new Error(detail);
            }

            // Get audio blob
            const audioBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioBlob);

            // Stop any currently playing audio
            if (audioPlayerRef.current) {
                audioPlayerRef.current.pause();
                audioPlayerRef.current = null;
            }

            // Create and play audio
            const audio = new Audio(audioUrl);
            audioPlayerRef.current = audio;
            setPlayingMsgId(messageId);
            setGeneratingTtsId(null);

            audio.onended = () => {
                setPlayingMsgId(null);
                URL.revokeObjectURL(audioUrl);
            };

            audio.onerror = () => {
                setPlayingMsgId(null);
                setGeneratingTtsId(null);
                URL.revokeObjectURL(audioUrl);
            };

            await audio.play();

        } catch (error) {
            console.error('TTS error:', error);
            setPlayingMsgId(null);
            setGeneratingTtsId(null);
            appendMessage('assistant', `⚠️ Voice playback failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    };

    const stopTTS = () => {
        if (audioPlayerRef.current) {
            audioPlayerRef.current.pause();
            audioPlayerRef.current = null;
        }
        setPlayingMsgId(null);
    };

    const fetchAvailableVoices = async () => {
        setIsLoadingVoices(true);
        try {
            const resp = await fetch('/api/audio/voices');
            if (!resp.ok) throw new Error('Voice list request failed');
            const data = await resp.json();
            const voices = Array.isArray(data?.voices) ? data.voices : [];
            const normalized: VoiceOption[] = voices
                .map((v: any) => ({
                    id: String(v?.name || v?.id || '').trim(),
                    name: String(v?.name || v?.id || '').trim(),
                    engine: v?.engine ? String(v.engine) : undefined
                }))
                .filter((v: VoiceOption) => v.id.length > 0);

            if (normalized.length > 0) {
                setAvailableVoices(normalized);
                if (!normalized.some(v => v.id === voiceStyle)) {
                    setVoiceStyle(normalized[0].id);
                }
            } else {
                setAvailableVoices(FALLBACK_VOICES);
            }
        } catch (error) {
            console.warn('Voice list fallback:', error);
            setAvailableVoices(FALLBACK_VOICES);
        } finally {
            setIsLoadingVoices(false);
        }
    };

    const unloadAudioModels = async () => {
        setIsUnloadingAudio(true);
        try {
            const resp = await fetch('/api/audio/unload', { method: 'POST' });
            if (!resp.ok) throw new Error('Unload request failed');
            appendMessage('assistant', '🔋 Voice models unloaded from VRAM. Ready for heavy image/video jobs.');
        } catch (error) {
            appendMessage('assistant', `⚠️ Could not unload voice models: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsUnloadingAudio(false);
        }
    };

    useEffect(() => {
        fetchAvailableVoices();
    }, []);

    useEffect(() => {
        localStorage.setItem('fedda_voice_style', voiceStyle);
    }, [voiceStyle]);

    useEffect(() => {
        if (!ttsEnabled || !autoPlayTTSMsg) return;

        if (autoPlayTTSMsg.role === 'assistant' && autoPlayTTSMsg.type === 'text' && !playingMsgId && !generatingTtsId) {
            // Auto-play with a slight delay to feel natural
            const timer = setTimeout(() => {
                playTTS(autoPlayTTSMsg.id, autoPlayTTSMsg.content);
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [autoPlayTTSMsg, ttsEnabled]);

    return {
        // Mic exports
        isRecording,
        isTranscribing,
        recordingMode,
        setRecordingMode,
        handleMicMouseDown,
        handleMicMouseUp,
        handleMicClick,

        // TTS exports
        ttsEnabled,
        setTtsEnabled,
        playingMsgId,
        generatingTtsId,
        voiceStyle,
        setVoiceStyle,
        availableVoices,
        isLoadingVoices,
        playTTS,
        stopTTS,
        fetchAvailableVoices,
        unloadAudioModels,
        isUnloadingAudio,
    };
};
