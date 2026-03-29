import { useState, useEffect } from 'react';
import { Download, Trash2, Search, RotateCw, CheckCircle2, AlertCircle, ExternalLink, FolderOpen, Key, Settings, BrainCircuit } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { CatalogShell, CatalogCard } from '../components/layout/CatalogShell';
import { useOllamaManager } from '../hooks/useOllamaManager';
import { useRunPodSettings } from '../hooks/useRunPodSettings';
import { ModelDownloader } from '../components/ModelDownloader';
import { IS_RUNPOD } from '../config/api';

const HF_TOKEN_KEY = 'fedda_hf_token';

const SETTINGS_TABS = [
    { id: 'comfyui', label: 'ComfyUI Models' },
    { id: 'llm', label: 'AI Models' },
    { id: 'hf-token', label: 'HuggingFace' },
    { id: 'cloud', label: 'Cloud / RunPod' },
] as const;

type SettingsTab = typeof SETTINGS_TABS[number]['id'];

const MODEL_GROUPS = [
    { id: 'z-image', description: 'Z-Image Turbo models for fast image generation' },
    { id: 'qwen-angle', description: 'Qwen Multi-Angle models for consistent multi-view generation' },
    { id: 'ace-step', description: 'ACE-Step 1.5 models for music generation' },
    { id: 'lipsync', description: 'WAN + LTX models for video lipsync and scene building' },
];

export const SettingsPage = () => {
    const [settingsTab, setSettingsTab] = useState<SettingsTab>('comfyui');

    const {
        installedModels,
        isLoadingModels,
        modelCategory,
        setModelCategory,
        activeList,
        selectedModel,
        setSelectedModel,
        customModel,
        setCustomModel,
        isPulling,
        pullProgress,
        pullError,
        refreshModels,
        handlePull,
        handleDelete
    } = useOllamaManager();

    const {
        runpodUrl,
        setRunpodUrl,
        runpodToken,
        setRunpodToken,
        runpodExplorerUrl,
        setRunpodExplorerUrl,
        nodeInstallStatus,
        isLoadingNodeStatus,
        saveRunpodSettings,
        deriveComfyUiUrl,
        openExternal,
        openRunpodExplorer,
        refreshNodeInstallStatus
    } = useRunPodSettings();

    // HuggingFace token state
    const [hfToken, setHfToken] = useState('');
    const [hfSaved, setHfSaved] = useState(false);
    const [civitaiKey, setCivitaiKey] = useState('');
    const [civitaiConfigured, setCivitaiConfigured] = useState(false);
    const [civitaiSaved, setCivitaiSaved] = useState(false);

    useEffect(() => {
        const stored = localStorage.getItem(HF_TOKEN_KEY);
        if (stored) setHfToken(stored);
        fetch('/api/settings/civitai-key/status')
            .then(r => r.json())
            .then(d => setCivitaiConfigured(Boolean(d?.configured)))
            .catch(() => {});
    }, []);

    const handleHfSave = () => {
        if (hfToken.trim()) {
            localStorage.setItem(HF_TOKEN_KEY, hfToken.trim());
            setHfSaved(true);
            setTimeout(() => setHfSaved(false), 2000);
        } else {
            localStorage.removeItem(HF_TOKEN_KEY);
        }
    };

    const handleHfClear = () => {
        setHfToken('');
        localStorage.removeItem(HF_TOKEN_KEY);
    };

    const handleCivitaiSave = async () => {
        try {
            const resp = await fetch('/api/settings/civitai-key', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: civitaiKey.trim() }),
            });
            const data = await resp.json();
            if (!resp.ok || !data?.success) throw new Error(data?.detail || 'Failed to save Civitai key');
            setCivitaiConfigured(Boolean(civitaiKey.trim()));
            setCivitaiSaved(true);
            setTimeout(() => setCivitaiSaved(false), 2000);
        } catch (e) {
            console.error(e);
        }
    };

    const formatSize = (bytes: number) => {
        const gb = bytes / (1024 * 1024 * 1024);
        return `${gb.toFixed(2)} GB`;
    };

    return (
        <CatalogShell
            title="Settings"
            subtitle="Manage models, tokens, and cloud integrations."
            icon={Settings}
            maxWidthClassName="max-w-6xl"
        >
            {/* Tab Bar */}
            <div className="flex bg-[#0a0a0f] p-1 rounded-xl border border-white/10 mb-8">
                {SETTINGS_TABS.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setSettingsTab(tab.id)}
                        className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all ${
                            settingsTab === tab.id
                                ? 'bg-white text-black shadow-lg'
                                : 'text-slate-400 hover:text-white'
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* ComfyUI Models Tab */}
            {settingsTab === 'comfyui' && (
                <div className="space-y-4">
                    <p className="text-sm text-slate-400 mb-6">
                        Download and manage the AI models used by each generation feature. Models are stored in the ComfyUI models directory.
                    </p>
                    {MODEL_GROUPS.map((group) => (
                        <CatalogCard key={group.id} className="p-0 overflow-hidden">
                            <ModelDownloader modelGroup={group.id} />
                        </CatalogCard>
                    ))}
                </div>
            )}

            {/* AI Models Tab — RunPod uses IF_AI_tools, Local uses Ollama */}
            {settingsTab === 'llm' && (
                IS_RUNPOD ? (
                    /* ---------- RunPod / Cloud: IF_AI_tools info ---------- */
                    <CatalogCard className="p-6 shadow-xl space-y-6 max-w-2xl">
                        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                            <BrainCircuit className="w-5 h-5 text-purple-400" /> AI Chat Engine
                        </h2>
                        <div className="p-4 bg-purple-500/10 border border-purple-500/20 rounded-xl space-y-3">
                            <p className="text-sm text-purple-200 leading-relaxed">
                                This pod uses <strong>IF_AI_tools</strong> (a ComfyUI node) for chat and LLM features.
                                No extra setup needed — it works automatically.
                            </p>
                            <p className="text-xs text-purple-300/60">
                                Ollama is not available on RunPod. To use local LLM models, run FEDDA locally on Windows instead.
                            </p>
                        </div>
                        <div className="text-sm text-slate-400 space-y-2">
                            <p><strong className="text-slate-300">How it works:</strong></p>
                            <ul className="list-disc list-inside space-y-1 text-xs text-slate-500">
                                <li>Chat messages are processed through ComfyUI's IF_AI_tools node</li>
                                <li>Supports text generation and conversation</li>
                                <li>Model selection is handled automatically by the node configuration</li>
                            </ul>
                        </div>
                    </CatalogCard>
                ) : (
                    /* ---------- Local: Ollama manager ---------- */
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* LEFT: Download / Manager */}
                        <CatalogCard className="p-6 shadow-xl space-y-6">
                            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                                <Download className="w-5 h-5 text-white" /> Download New Models
                            </h2>

                            {/* Category Tabs */}
                            <div className="flex bg-[#0a0a0f] p-1 rounded-xl border border-white/10">
                                <button
                                    onClick={() => setModelCategory('text')}
                                    className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${modelCategory === 'text'
                                        ? 'bg-white text-black shadow-lg'
                                        : 'text-slate-400 hover:text-white'
                                        }`}
                                >
                                    Text Generation
                                </button>
                                <button
                                    onClick={() => setModelCategory('vision')}
                                    className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${modelCategory === 'vision'
                                        ? 'bg-white text-black shadow-lg'
                                        : 'text-slate-400 hover:text-white'
                                        }`}
                                >
                                    <span className="flex items-center justify-center gap-2">
                                        Vision / Caption
                                    </span>
                                </button>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
                                        Recommended {modelCategory === 'text' ? 'Chat' : 'Vision'} Models
                                    </label>
                                    <select
                                        value={selectedModel}
                                        onChange={(e) => {
                                            setSelectedModel(e.target.value);
                                            setCustomModel('');
                                        }}
                                        className="w-full bg-[#0a0a0f] border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-white/20"
                                    >
                                        {activeList.map(m => (
                                            <option key={m.id} value={m.id}>
                                                {m.label} ({m.id})
                                            </option>
                                        ))}
                                    </select>
                                    <p className="text-xs text-slate-500 mt-2 italic">
                                        {activeList.find(m => m.id === selectedModel)?.description}
                                    </p>
                                </div>

                                <div className="relative">
                                    <div className="absolute inset-0 flex items-center">
                                        <span className="w-full border-t border-white/5" />
                                    </div>
                                    <div className="relative flex justify-center text-xs uppercase">
                                        <span className="bg-[#121218] px-2 text-slate-500">Or search custom</span>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
                                        Custom Model Tag
                                    </label>
                                    <div className="relative">
                                        <input
                                            type="text"
                                            value={customModel}
                                            onChange={(e) => setCustomModel(e.target.value)}
                                            placeholder="e.g. llama3:8b (Press Enter to search...)"
                                            className="w-full bg-[#0a0a0f] border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-white/20"
                                        />
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                                    </div>
                                    <p className="text-xs text-slate-500 mt-1">
                                        Enter any tag from <a href="https://ollama.com/library" target="_blank" className="text-white hover:underline">ollama.com/library</a>
                                    </p>
                                </div>

                                <Button
                                    variant="primary"
                                    className="w-full h-12 text-md bg-white text-black hover:bg-slate-200"
                                    onClick={handlePull}
                                    isLoading={isPulling}
                                    disabled={isPulling}
                                >
                                    {isPulling ? 'Downloading...' : 'Pull Model'}
                                </Button>

                                {/* Progress Status */}
                                {(isPulling || pullProgress) && (
                                    <div className="bg-black/20 rounded-xl p-4 border border-white/5 animate-in fade-in slide-in-from-top-2">
                                        <div className="flex justify-between text-xs mb-1">
                                            <span className="text-slate-300 font-medium">{pullProgress?.status}</span>
                                            {pullProgress?.total && pullProgress?.completed && (
                                                <span className="text-white">
                                                    {Math.round((pullProgress.completed / pullProgress.total) * 100)}%
                                                </span>
                                            )}
                                        </div>
                                        {pullProgress?.total && pullProgress?.completed && (
                                            <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-white transition-all duration-300"
                                                    style={{ width: `${(pullProgress.completed / pullProgress.total) * 100}%` }}
                                                />
                                            </div>
                                        )}
                                        {pullProgress?.status === 'success' && (
                                            <div className="flex items-center gap-2 text-emerald-400 text-sm mt-2">
                                                <CheckCircle2 className="w-4 h-4" /> Download Complete!
                                            </div>
                                        )}
                                    </div>
                                )}

                                {pullError && (
                                    <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 p-3 rounded-lg border border-red-500/20">
                                        <AlertCircle className="w-4 h-4" /> {pullError}
                                    </div>
                                )}
                            </div>
                        </CatalogCard>

                        {/* RIGHT: Installed Models */}
                        <CatalogCard className="p-6 shadow-xl flex flex-col h-full">
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                                    Installed Ollama Models
                                </h2>
                                <Button variant="ghost" size="sm" onClick={refreshModels} disabled={isLoadingModels}>
                                    <RotateCw className={`w-4 h-4 ${isLoadingModels ? 'animate-spin' : ''}`} />
                                </Button>
                            </div>

                            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-3 max-h-[500px]">
                                {installedModels.length === 0 ? (
                                    <div className="text-center text-slate-500 py-10">
                                        {isLoadingModels ? 'Loading models...' : 'No models installed via Ollama yet.'}
                                    </div>
                                ) : (
                                    installedModels.map((model) => (
                                        <div key={model.digest} className="group bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl p-4 transition-all flex items-start justify-between">
                                            <div>
                                                <h3 className="text-sm font-bold text-slate-200">{model.name}</h3>
                                                <div className="flex gap-4 mt-1 text-xs text-slate-500">
                                                    <span>{formatSize(model.size)}</span>
                                                    <span>Updated: {new Date(model.modified_at).toLocaleDateString()}</span>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => handleDelete(model.name)}
                                                className="text-slate-600 hover:text-red-400 transition-colors p-2"
                                                title="Delete Model"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </CatalogCard>
                    </div>
                )
            )}

            {/* HuggingFace Token Tab */}
            {settingsTab === 'hf-token' && (
                <CatalogCard className="p-6 shadow-xl space-y-6 max-w-xl">
                    <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                        <Key className="w-5 h-5 text-white" /> HuggingFace Token
                    </h2>

                    <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                        <p className="text-xs text-blue-200 leading-relaxed">
                            <AlertCircle className="w-3.5 h-3.5 inline mr-1 mb-0.5" />
                            Required for downloading gated models like <strong>WAN (Lipsync)</strong>.
                            Get your token from <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-100">HuggingFace Settings</a>.
                        </p>
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">
                            Access Token (starts with hf_...)
                        </label>
                        <input
                            type="password"
                            value={hfToken}
                            onChange={(e) => setHfToken(e.target.value)}
                            placeholder="hf_..."
                            className="w-full px-4 py-3 bg-[#0a0a0f] border border-white/10 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-white/20 font-mono"
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleHfSave}
                            className="flex-1 px-4 py-2.5 bg-white hover:bg-slate-200 text-black text-xs font-bold uppercase tracking-wider rounded-lg transition-all active:scale-95 flex items-center justify-center gap-2"
                        >
                            {hfSaved ? (
                                <>
                                    <CheckCircle2 className="w-4 h-4" />
                                    Saved!
                                </>
                            ) : (
                                'Save Token'
                            )}
                        </button>
                        {hfToken && (
                            <button
                                onClick={handleHfClear}
                                className="px-4 py-2.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-200 text-xs font-bold uppercase tracking-wider rounded-lg transition-all"
                            >
                                Clear
                            </button>
                        )}
                    </div>

                    <div className="pt-4 border-t border-white/5">
                        <p className="text-[10px] text-slate-500 leading-relaxed">
                            <strong>Setup steps:</strong><br />
                            1. Visit <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-400">huggingface.co/settings/tokens</a><br />
                            2. Create a new token with <strong>Read</strong> access<br />
                            3. Accept model license at <a href="https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged" target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-400">Wan_2.2_ComfyUI_Repackaged</a><br />
                            4. Paste token here and save
                        </p>
                    </div>

                    <div className="pt-4 border-t border-white/5 space-y-3">
                        <h3 className="text-sm font-semibold text-white">Civitai API Key (LoRA URL import)</h3>
                        <input
                            type="password"
                            value={civitaiKey}
                            onChange={(e) => setCivitaiKey(e.target.value)}
                            placeholder="Civitai API key"
                            className="w-full px-4 py-3 bg-[#0a0a0f] border border-white/10 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-white/20 font-mono"
                        />
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleCivitaiSave}
                                className="flex-1 px-4 py-2.5 bg-white hover:bg-slate-200 text-black text-xs font-bold uppercase tracking-wider rounded-lg transition-all active:scale-95"
                            >
                                {civitaiSaved ? 'Saved!' : 'Save Civitai Key'}
                            </button>
                            {civitaiConfigured && (
                                <span className="text-[11px] text-emerald-300 border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 rounded">
                                    Configured
                                </span>
                            )}
                        </div>
                    </div>
                </CatalogCard>
            )}

            {/* Cloud / RunPod Tab */}
            {settingsTab === 'cloud' && (
                <CatalogCard className="p-6 shadow-xl space-y-6">
                    <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                        Cloud Engines / RunPod Integration
                    </h2>
                    <p className="text-sm text-slate-400">
                        Enter your RunPod Serverless or Pod endpoint URL and Bearer token below. This allows you to select images in the Gallery and render Wan2.1 First/Last Frame loops directly in the cloud.
                    </p>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
                                RunPod Endpoint URL (e.g., https://xyz-8188.proxy.runpod.net/prompt)
                            </label>
                            <input
                                type="text"
                                value={runpodUrl}
                                onChange={(e) => setRunpodUrl(e.target.value)}
                                placeholder="https://[YOUR_POD_ID]-[PORT].proxy.runpod.net/prompt"
                                className="w-full bg-[#0a0a0f] border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-white/20"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
                                RunPod Bearer Token (Optional if using Proxy / No-Auth)
                            </label>
                            <input
                                type="password"
                                value={runpodToken}
                                onChange={(e) => setRunpodToken(e.target.value)}
                                placeholder="Bearer xyz123..."
                                className="w-full bg-[#0a0a0f] border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-white/20"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
                                RunPod File Explorer URL (Optional override)
                            </label>
                            <input
                                type="text"
                                value={runpodExplorerUrl}
                                onChange={(e) => setRunpodExplorerUrl(e.target.value)}
                                placeholder="https://[YOUR_POD_ID]-8888.proxy.runpod.net/lab/tree"
                                className="w-full bg-[#0a0a0f] border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-white/20"
                            />
                            <p className="text-xs text-slate-500 mt-2">
                                If empty, explorer defaults to your endpoint base URL. For Jupyter/Lab file browser, paste the full /lab/tree URL.
                            </p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="text-xs uppercase tracking-wider text-slate-400">Node Install Status</div>
                                <button
                                    onClick={refreshNodeInstallStatus}
                                    className="text-xs text-slate-300 hover:text-white"
                                    type="button"
                                >
                                    {isLoadingNodeStatus ? 'Checking...' : 'Refresh'}
                                </button>
                            </div>
                            {nodeInstallStatus ? (
                                <>
                                    <div className="text-sm text-slate-200">
                                        {nodeInstallStatus.phase === 'completed'
                                            ? 'Completed'
                                            : nodeInstallStatus.phase === 'core_ready_full_installing'
                                                ? 'Core ready, full install running in background'
                                                : 'Pending / starting'}
                                    </div>
                                    <div className="text-xs text-slate-500">
                                        Core: {nodeInstallStatus.core_installed ? 'yes' : 'no'} | Full: {nodeInstallStatus.full_installed ? 'yes' : 'no'}
                                    </div>
                                    {nodeInstallStatus.bg_log_tail?.length > 0 && (
                                        <pre className="text-[11px] text-slate-500 max-h-28 overflow-auto whitespace-pre-wrap">{nodeInstallStatus.bg_log_tail.slice(-6).join('\n')}</pre>
                                    )}
                                </>
                            ) : (
                                <div className="text-xs text-slate-500">Status unavailable (works in docker/runpod backend).</div>
                            )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            <Button variant="secondary" onClick={() => openExternal(deriveComfyUiUrl(), 'ComfyUI')}>
                                <ExternalLink className="w-4 h-4" /> Open ComfyUI
                            </Button>
                            <Button variant="secondary" onClick={openRunpodExplorer}>
                                <FolderOpen className="w-4 h-4" /> Open File Explorer
                            </Button>
                            <Button variant="primary" onClick={saveRunpodSettings}>
                                Save Cloud Settings
                            </Button>
                        </div>
                    </div>
                </CatalogCard>
            )}
        </CatalogShell>
    );
};
