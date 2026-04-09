import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Bot, MessageSquare, Mic, RotateCcw, Send, Volume2, VolumeX } from 'lucide-react';
import { BACKEND_API } from '../config/api';

type ChatRole = 'user' | 'assistant';

interface ChatMessage {
  role: ChatRole;
  content: string;
}

const SESSION_KEY = 'fedda_agent_session_id_v1';
const AUTO_SPEAK_KEY = 'fedda_agent_auto_speak_v1';
const VOICE_KEY = 'fedda_agent_voice_v1';
const FALLBACK_VOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'];
const DEFAULT_MEMORY_REFRESH_TURNS = 2;

function getSessionId(): string {
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = (globalThis.crypto?.randomUUID?.() ?? `session_${Date.now()}`).toString();
    localStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return `session_${Date.now()}`;
  }
}

function pcm16ToWavBlob(base64Pcm: string, sampleRate = 24000): Blob {
  const binary = atob(base64Pcm);
  const pcm = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) pcm[i] = binary.charCodeAt(i);

  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const dataSize = pcm.length;
  const fileSize = 36 + dataSize;
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);

  view.setUint32(0, 0x52494646, false);  // RIFF
  view.setUint32(4, fileSize, true);
  view.setUint32(8, 0x57415645, false);  // WAVE
  view.setUint32(12, 0x666d7420, false); // fmt
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);           // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  view.setUint32(36, 0x64617461, false); // data
  view.setUint32(40, dataSize, true);

  return new Blob([header, pcm], { type: 'audio/wav' });
}

export const AgentChatPage = () => {
  const [sessionId] = useState<string>(getSessionId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [memory, setMemory] = useState('');
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isRefreshingMemory, setIsRefreshingMemory] = useState(false);
  const [localReady, setLocalReady] = useState(false);
  const [turnCount, setTurnCount] = useState(0);
  const [memoryRefreshEveryTurns, setMemoryRefreshEveryTurns] = useState(DEFAULT_MEMORY_REFRESH_TURNS);
  const [availableVoices, setAvailableVoices] = useState<string[]>(FALLBACK_VOICES);
  const [autoSpeak, setAutoSpeak] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AUTO_SPEAK_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [voiceName, setVoiceName] = useState<string>(() => {
    try {
      return localStorage.getItem(VOICE_KEY) || 'Kore';
    } catch {
      return 'Kore';
    }
  });
  const [panelOpen, setPanelOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    try {
      localStorage.setItem(AUTO_SPEAK_KEY, autoSpeak ? '1' : '0');
      localStorage.setItem(VOICE_KEY, voiceName);
    } catch {}
  }, [autoSpeak, voiceName]);

  useEffect(() => {
    const init = async () => {
      try {
        const localRes = await fetch(`${BACKEND_API.BASE_URL}/api/ollama/models`);
        const localData = await localRes.json();
        setLocalReady(Boolean(localData?.success && localData?.text_model));
      } catch {
        setLocalReady(false);
      }

      try {
        const voiceRes = await fetch(`${BACKEND_API.BASE_URL}/api/chat/voices`);
        const voiceData = await voiceRes.json();
        const voices = Array.isArray(voiceData?.voices)
          ? voiceData.voices
              .map((v: unknown) => {
                const voice = v as { id?: string; name?: string };
                return String(voice?.id || voice?.name || '').trim();
              })
              .filter((v: string) => v.length > 0)
          : [];
        if (voices.length > 0) {
          setAvailableVoices(voices);
          if (!voices.includes(voiceName)) {
            setVoiceName(voices[0]);
          }
        }
      } catch {
        setAvailableVoices(FALLBACK_VOICES);
      }

      try {
        const historyRes = await fetch(`${BACKEND_API.BASE_URL}/api/chat/history/${encodeURIComponent(sessionId)}`);
        const historyData = await historyRes.json();
        if (historyData?.success) {
          const parsed: ChatMessage[] = Array.isArray(historyData.history)
            ? historyData.history
                .filter((m: unknown) => typeof m === 'object' && m !== null)
                .map((m: unknown) => {
                  const msg = m as { role?: string; content?: string };
                  return {
                    role: msg.role === 'user' ? 'user' : 'assistant',
                    content: String(msg.content ?? ''),
                  };
                })
            : [];
          setMessages(parsed);
          setMemory(String(historyData.memory ?? ''));
          setTurnCount(Number(historyData.turn_count ?? 0) || 0);
          setMemoryRefreshEveryTurns(Number(historyData.memory_refresh_every_turns ?? DEFAULT_MEMORY_REFRESH_TURNS) || DEFAULT_MEMORY_REFRESH_TURNS);
        }
      } catch {
        // Keep page usable even if history endpoint fails.
      }
    };
    void init();
  }, [sessionId]);

  const sendMessage = async (evt?: FormEvent) => {
    evt?.preventDefault();
    const text = input.trim();
    if (!text || isSending) return;

    setInput('');
    setIsSending(true);
    const userMsg: ChatMessage = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch(`${BACKEND_API.BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          message: text,
          model: '',
          voice_name: voiceName,
          speak: autoSpeak,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.detail || data?.error || 'Chat request failed');
      }

      const reply = String(data.response ?? '');
      const ttsText = String(data.tts_text ?? reply);
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
      setMemory(String(data.memory ?? ''));
      setTurnCount(Number(data.turn_count ?? turnCount + 1) || 0);
      setMemoryRefreshEveryTurns(Number(data.memory_refresh_every_turns ?? memoryRefreshEveryTurns) || DEFAULT_MEMORY_REFRESH_TURNS);

      if (autoSpeak && typeof data.audio_base64 === 'string' && data.audio_base64) {
        await playTtsFromBase64(data.audio_base64, String(data.mime_type ?? 'audio/L16;rate=24000'));
      } else if (autoSpeak) {
        await playTts(ttsText);
      }
    } catch (error) {
      const err = error instanceof Error ? error.message : 'Unknown chat error';
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${err}` }]);
    } finally {
      setIsSending(false);
    }
  };

  const playTtsFromBase64 = async (audioBase64: string, mimeType: string) => {
    const rateMatch = /rate=(\d+)/i.exec(mimeType);
    const sampleRate = rateMatch ? Number.parseInt(rateMatch[1], 10) : 24000;
    const wavBlob = pcm16ToWavBlob(audioBase64, sampleRate);
    const url = URL.createObjectURL(wavBlob);
    const audio = new Audio(url);
    setIsSpeaking(true);
    await audio.play();
    audio.onended = () => {
      URL.revokeObjectURL(url);
      setIsSpeaking(false);
    };
  };

  const playTts = async (text: string) => {
    try {
      const res = await fetch(`${BACKEND_API.BASE_URL}/api/chat/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice_name: voiceName }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) return;
      if (data?.audio_base64) {
        await playTtsFromBase64(String(data.audio_base64), String(data.mime_type ?? 'audio/L16;rate=24000'));
        return;
      }
      if (data?.audio_url) {
        const audio = new Audio(String(data.audio_url));
        setIsSpeaking(true);
        await audio.play();
        audio.onended = () => setIsSpeaking(false);
      }
    } catch {
      // Silent fail for TTS to avoid blocking chat.
    }
  };

  const resetSession = async () => {
    try {
      await fetch(`${BACKEND_API.BASE_URL}/api/chat/reset/${encodeURIComponent(sessionId)}`, { method: 'POST' });
      setMessages([]);
      setMemory('');
      setTurnCount(0);
    } catch {
      // Ignore reset failures and keep current state.
    }
  };

  const refreshMemory = async () => {
    if (isRefreshingMemory) return;
    setIsRefreshingMemory(true);
    try {
      const res = await fetch(`${BACKEND_API.BASE_URL}/api/chat/memory/refresh/${encodeURIComponent(sessionId)}`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok || !data?.success) return;
      setMemory(String(data.memory ?? ''));
      setTurnCount(Number(data.turn_count ?? turnCount) || 0);
      setMemoryRefreshEveryTurns(Number(data.memory_refresh_every_turns ?? memoryRefreshEveryTurns) || DEFAULT_MEMORY_REFRESH_TURNS);
    } finally {
      setIsRefreshingMemory(false);
    }
  };

  const canSend = useMemo(() => input.trim().length > 0 && !isSending && localReady, [input, isSending, localReady]);
  const turnsUntilAutoRefresh = useMemo(() => {
    const every = Math.max(1, memoryRefreshEveryTurns);
    const remainder = turnCount % every;
    return remainder === 0 ? every : every - remainder;
  }, [turnCount, memoryRefreshEveryTurns]);

  return (
    <div className="h-full flex flex-col p-5 gap-4 overflow-hidden">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[12px] text-slate-400">
          <MessageSquare className="w-4 h-4 text-cyan-300" />
          <span className="font-semibold tracking-[0.12em] uppercase">Agent Chat</span>
          <span className={`px-2 py-0.5 rounded-full border text-[10px] ${
            localReady ? 'border-emerald-400/40 text-emerald-300' : 'border-amber-400/40 text-amber-300'
          }`}>
            {localReady ? 'Local Ready' : 'Local Model Missing'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoSpeak((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs ${
              autoSpeak ? 'border-emerald-400/40 text-emerald-300 bg-emerald-900/20' : 'border-white/10 text-slate-300 bg-white/[0.02]'
            }`}
          >
            {autoSpeak ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            Auto Voice
          </button>
          <button
            onClick={() => setPanelOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-xs text-slate-300 bg-white/[0.02]"
          >
            Chat Settings
          </button>
          <button
            onClick={resetSession}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-xs text-slate-300 bg-white/[0.02]"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-4">
        <section className="min-h-0 flex flex-col rounded-2xl border border-white/10 bg-black/30 overflow-hidden">
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-center text-slate-500">
                <Bot className="w-8 h-8 text-white/30" />
                <p className="text-sm">Send a message to start Agent Chat with memory and voice.</p>
              </div>
            )}

            {messages.map((msg, idx) => (
              <div key={`${msg.role}-${idx}`} className={`max-w-[88%] ${msg.role === 'user' ? 'ml-auto' : 'mr-auto'}`}>
                <div className={`rounded-xl px-4 py-3 text-sm leading-relaxed border ${
                  msg.role === 'user'
                    ? 'bg-cyan-500/10 border-cyan-400/30 text-cyan-100'
                    : 'bg-white/[0.03] border-white/10 text-slate-100'
                }`}>
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>
                {msg.role === 'assistant' && (
                  <button
                    onClick={() => void playTts(msg.content)}
                    className="mt-1 text-[11px] text-slate-400 hover:text-slate-200 inline-flex items-center gap-1"
                  >
                    <Mic className="w-3 h-3" />
                    Play voice
                  </button>
                )}
              </div>
            ))}
            <div ref={scrollRef} />
          </div>

          <form onSubmit={sendMessage} className="border-t border-white/10 p-3 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Send a message..."
              className="flex-1 rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-cyan-400/60"
            />
            <button
              type="submit"
              disabled={!canSend}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-cyan-500/20 border border-cyan-400/40 text-cyan-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
              {isSending ? 'Sending' : 'Send'}
            </button>
          </form>
        </section>

        <aside className={`rounded-2xl border border-white/10 bg-black/25 p-4 overflow-y-auto custom-scrollbar ${panelOpen ? 'block' : 'hidden xl:block'}`}>
          <h3 className="text-xs uppercase tracking-[0.16em] text-slate-400 mb-3">Chat Settings</h3>

          <label className="block text-[11px] text-slate-400 mb-1">Voice</label>
          <select
            value={voiceName}
            onChange={(e) => setVoiceName(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 mb-4"
          >
            {availableVoices.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>

          <div className="text-[11px] text-slate-500 mb-4">
            Local chat only. Voice choice changes local TTS synthesis profile.
          </div>

          <div className="mt-5 p-3 rounded-lg border border-white/10 bg-white/[0.02]">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h4 className="text-[11px] uppercase tracking-[0.12em] text-slate-400">Memory Snapshot</h4>
              <button
                onClick={() => void refreshMemory()}
                disabled={isRefreshingMemory}
                className="text-[10px] px-2 py-1 rounded border border-white/10 text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRefreshingMemory ? 'Refreshing' : 'Refresh now'}
              </button>
            </div>
            <p className="text-xs text-slate-300 whitespace-pre-wrap">
              {memory || 'Memory builds automatically while chatting.'}
            </p>
            <p className="mt-2 text-[10px] text-slate-500">
              Auto refresh every {memoryRefreshEveryTurns} turns. Next in {turnsUntilAutoRefresh} turn{turnsUntilAutoRefresh === 1 ? '' : 's'}.
            </p>
          </div>

          <div className="mt-4 text-[11px] text-slate-500">
            Session: {sessionId.slice(0, 12)}...
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Turns: {turnCount}
          </div>
          {isSpeaking && (
            <div className="mt-2 text-[11px] text-emerald-300 inline-flex items-center gap-1">
              <Volume2 className="w-3 h-3" />
              Speaking...
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
