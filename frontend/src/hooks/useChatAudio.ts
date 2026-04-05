import { useState, useRef, useEffect } from 'react';

// Automated expressive tag insertion
function autoTagText(text: string): string {
    let tagged = text;
    // Add [laughing] after sentences with "haha", "lol", or "funny"
    tagged = tagged.replace(/([.!?])\s*(ha(ha)+|lol|funny)/gi, '$1 [laughing] $2');
    // Add [excited] after exclamations
    tagged = tagged.replace(/!+/g, '! [excited]');
    // Add [pause] at long sentence breaks
    tagged = tagged.replace(/([.!?])\s+/g, '$1 [pause] ');
    // Add [sad] if text contains "sorry" or "sad"
    tagged = tagged.replace(/\b(sorry|sad|unfortunately)\b/gi, '[sad] $1');
    // Add [surprised] for "wow"
    tagged = tagged.replace(/\b(wow|amazing|unbelievable)\b/gi, '[surprised] $1');
    // Add [delight] for "great", "awesome"
    tagged = tagged.replace(/\b(great|awesome|fantastic|wonderful)\b/gi, '[delight] $1');
    // Add [sigh] for "oh well"
    tagged = tagged.replace(/oh well/gi, '[sigh] oh well');
    // Add [shocked] for "what?!"
    tagged = tagged.replace(/what\s*\?!/gi, 'what?! [shocked]');
    return tagged;
}

export interface PlayableMessage {
    id: string;
    role: string;
    type?: string;
    content: string;
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

export const useChatAudio = ({ setInput, appendMessage, autoPlayTTSMsg, ttsModel, referenceAudio, temperature = 0.7, topP = 0.7, chunkLength = 200, maxNewTokens = 192, repetitionPenalty = 1.2, seed = 42, language = 'auto', voiceEngine = 'fish' }: any) => {
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
                setInput((prev: string) => prev + (prev ? ' ' : '') + transcribedText);
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

            // Automated expressive tag insertion
            const expressiveText = autoTagText(text);

            // FishAudio/Clone/Edge: send as FormData
            const formData = new FormData();
            formData.append('text', expressiveText);
            if (ttsModel) formData.append('model', ttsModel);
            if (voiceStyle) formData.append('voice_style', voiceStyle);
            if (referenceAudio) formData.append('reference_audio', referenceAudio);
            // Advanced FishAudio params
            formData.append('temperature', String(temperature));
            formData.append('top_p', String(topP));
            formData.append('chunk_length', String(chunkLength));
            formData.append('max_new_tokens', String(maxNewTokens));
            formData.append('repetition_penalty', String(repetitionPenalty));
            formData.append('seed', String(seed));
            formData.append('language', language);
            formData.append('engine', voiceEngine);

            const response = await fetch('/api/audio/tts', {
                method: 'POST',
                body: formData
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