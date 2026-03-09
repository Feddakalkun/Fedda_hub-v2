import { useState, useEffect } from 'react';
import { Download, Trash2, BrainCircuit, Search, RotateCw, CheckCircle2, AlertCircle, ExternalLink, FolderOpen } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import { ollamaService } from '../services/ollamaService';
import type { OllamaModel, OllamaProgress } from '../services/ollamaService';
import { CatalogShell, CatalogCard } from '../components/layout/CatalogShell';

// Text / Chat Models
const TEXT_MODELS = [
    { id: 'goonsai/qwen2.5-3B-goonsai-nsfw-100k', label: 'Qwen 2.5 3B NSFW (Goonsai)', description: 'NSFW-tuned Qwen, great for creative prompts/roleplay.' },
    { id: 'zarigata/unfiltered-llama3', label: 'Unfiltered Llama 3', description: 'Fully unrestricted Llama3, no filters.' },
    { id: 'cognitivecomputations/dolphin-2.9.3-mistral-nemo-12b', label: 'Dolphin Mistral Nemo 12B', description: 'Strong for anything-goes tasks (active 2026).' },
    { id: 'ehartford/dolphin-2.7-mixtral-8x7b', label: 'Dolphin Mixtral 8x7B', description: 'Classic uncensored Mixtral, top for creative/NSFW.' }
];

// Vision / Captioning Models
const VISION_MODELS = [
    { id: 'llama3.2-vision', label: 'Llama 3.2 Vision (Original)', description: 'Meta\'s vision model, excels at detailed captioning.' },
    { id: 'llama3.2-vision:11b', label: 'Llama 3.2 Vision 11B (Light)', description: 'Lighter 11B version, good for ComfyUI workflows.' },
    { id: 'llava', label: 'LLaVA (General)', description: 'Solid for general image descriptions.' },
    { id: 'user-v4/joycaption-beta', label: 'JoyCaption Beta', description: 'Uncensored JoyCaption (Llama-based VLM).' }
];

export const SettingsPage = () => {
    const { toast } = useToast();
    const [installedModels, setInstalledModels] = useState<OllamaModel[]>([]);
    const [isLoadingModels, setIsLoadingModels] = useState(false);

    // Download UI State
    const [modelCategory, setModelCategory] = useState<'text' | 'vision'>('text');
    const activeList = modelCategory === 'text' ? TEXT_MODELS : VISION_MODELS;

    const [selectedModel, setSelectedModel] = useState(activeList[0].id);
    const [customModel, setCustomModel] = useState('');
    const [isPulling, setIsPulling] = useState(false);
    const [pullProgress, setPullProgress] = useState<OllamaProgress | null>(null);
    const [pullError, setPullError] = useState('');

    // RunPod state
    const [runpodUrl, setRunpodUrl] = useState('');
    const [runpodToken, setRunpodToken] = useState('');
    const [runpodExplorerUrl, setRunpodExplorerUrl] = useState('');

    useEffect(() => {
        refreshModels();
        // Load RunPod settings
        setRunpodUrl(localStorage.getItem('runpodUrl') || '');
        setRunpodToken(localStorage.getItem('runpodToken') || '');
        setRunpodExplorerUrl(localStorage.getItem('runpodExplorerUrl') || '');
    }, []);

    const saveRunpodSettings = () => {
        localStorage.setItem('runpodUrl', runpodUrl);
        localStorage.setItem('runpodToken', runpodToken);
        localStorage.setItem('runpodExplorerUrl', runpodExplorerUrl);
        toast('RunPod settings saved!', 'success');
    };
    const deriveRunpodBase = (url: string) => {
        const trimmed = url.trim();
        if (!trimmed) return '';
        return trimmed.replace(/\/prompt\/?$/i, '');
    };

    const runpodBaseUrl = deriveRunpodBase(runpodUrl);
    const resolvedExplorerUrl = runpodExplorerUrl.trim() || (runpodBaseUrl ? `${runpodBaseUrl}/` : '');

    const openExternal = (url: string, label: string) => {
        if (!url) {
            toast(`No ${label} URL configured yet.`, 'error');
            return;
        }
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    // Update selected model when category changes
    useEffect(() => {
        setSelectedModel(activeList[0].id);
    }, [modelCategory]);

    const refreshModels = async () => {
        setIsLoadingModels(true);
        try {
            const models = await ollamaService.getModels();
            // Sort by recent
            models.sort((a, b) => new Date(b.modified_at).getTime() - new Date(a.modified_at).getTime());
            setInstalledModels(models);
        } catch (error) {
            console.error('Failed to load models', error);
        } finally {
            setIsLoadingModels(false);
        }
    };

    const handlePull = async () => {
        const modelToPull = customModel.trim() || selectedModel;
        if (!modelToPull) return;

        setIsPulling(true);
        setPullProgress({ status: 'Initiating download...' });
        setPullError('');

        try {
            await ollamaService.pullModel(modelToPull, (progress) => {
                setPullProgress(progress);
                if (progress.status === 'success') {
                    // Slight delay to show success before refresh
                    setTimeout(refreshModels, 1000);
                }
            });
            setCustomModel('');
        } catch (error) {
            setPullError('Failed to download model. Ensure Ollama is running.');
        } finally {
            setIsPulling(false);
        }
    };

    const handleDelete = async (name: string) => {
        if (!confirm(`Are you sure you want to delete ${name}?`)) return;
        try {
            await ollamaService.deleteModel(name);
            refreshModels();
        } catch (error) {
            toast('Failed to delete model', 'error');
        }
    };

    const formatSize = (bytes: number) => {
        const gb = bytes / (1024 * 1024 * 1024);
        return `${gb.toFixed(2)} GB`;
    };

    return (
        <CatalogShell
            title="AI Model Manager"
            subtitle="Manage your Ollama models for Text generation and Image captioning."
            icon={BrainCircuit}
            maxWidthClassName="max-w-6xl"
        >
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
                            <BrainCircuit className="w-5 h-5 text-blue-400" /> Installed Models
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

            {/* RunPod Settings Section */}
            <CatalogCard className="p-6 shadow-xl space-y-6">
                <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                    ☁️ Cloud Engines / RunPod Integration
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
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <Button variant="secondary" onClick={() => openExternal(runpodBaseUrl ? `${runpodBaseUrl}/` : '', 'RunPod Comfy UI')}>
                            <ExternalLink className="w-4 h-4" /> Open RunPod UI
                        </Button>
                        <Button variant="secondary" onClick={() => openExternal(resolvedExplorerUrl, 'RunPod File Explorer')}>
                            <FolderOpen className="w-4 h-4" /> Open File Explorer
                        </Button>
                        <Button variant="primary" onClick={saveRunpodSettings}>
                            Save Cloud Settings
                        </Button>
                    </div>
                </div>
            </CatalogCard>

        </CatalogShell>
    );
};

