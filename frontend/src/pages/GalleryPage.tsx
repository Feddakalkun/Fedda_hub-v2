// Advanced Gallery Manager with RunPod Job Tracker
import { useState, useEffect, useRef, useCallback } from 'react';
import { Images, Trash2, Search, CheckSquare, Square, Download, Cloud, Loader2, CheckCircle2, AlertCircle, X, Film } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import { BACKEND_API } from '../config/api';
import { CatalogShell, CatalogCard } from '../components/layout/CatalogShell';
import { directDownload } from '../utils/directDownload';

const api = (endpoint: string) => `${BACKEND_API.BASE_URL}${endpoint}`;

interface MediaFile {
    filename: string;
    subfolder: string;
    type: 'output' | 'input' | 'temp';
    url: string;
    dateFolder: string;
    model: string;
    timestamp: number;
    selected: boolean;
    isVideo: boolean;
}

interface RunPodJob {
    promptId: string;
    status: 'uploading' | 'queued' | 'processing' | 'completed' | 'error' | 'pod_loading';
    statusText: string;
    startedAt: number;
    outputs: RunPodOutput[];
}

interface RunPodOutput {
    filename: string;
    subfolder: string;
    type: string;
    preview_url: string;
    local_url?: string;
}

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.gif'];
const POLL_INTERVAL = 3000;

export const GalleryPage = () => {
    const { toast } = useToast();
    const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [filterModel, setFilterModel] = useState<string>('all');
    const [filterDate, setFilterDate] = useState<string>('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState<'all' | 'images' | 'videos'>('all');
    const [sortBy, setSortBy] = useState<'date' | 'model' | 'name'>('date');
    const [isAnimatingRunPod, setIsAnimatingRunPod] = useState(false);

    // RunPod Job Tracker
    const [runpodJobs, setRunpodJobs] = useState<RunPodJob[]>([]);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        loadGallery();
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, []);

    // Start/stop polling based on active jobs
    useEffect(() => {
        const activeJobs = runpodJobs.filter(j => !['completed', 'error'].includes(j.status));
        if (activeJobs.length > 0 && !pollRef.current) {
            pollRef.current = setInterval(() => pollRunPodJobs(), POLL_INTERVAL);
        } else if (activeJobs.length === 0 && pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }, [runpodJobs]);

    const pollRunPodJobs = useCallback(async () => {
        const runpodUrl = localStorage.getItem('runpodUrl') || '';
        const runpodToken = localStorage.getItem('runpodToken') || '';
        if (!runpodUrl) return;

        setRunpodJobs(prev => {
            const activeJobs = prev.filter(j => !['completed', 'error'].includes(j.status));
            if (activeJobs.length === 0) return prev;

            activeJobs.forEach(async (job) => {
                try {
                    const res = await fetch(api(BACKEND_API.ENDPOINTS.RUNPOD_STATUS), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ prompt_id: job.promptId, runpod_url: runpodUrl, runpod_token: runpodToken })
                    });
                    const data = await res.json();

                    setRunpodJobs(current => current.map(j => {
                        if (j.promptId !== job.promptId) return j;

                        if (data.completed) {
                            data.outputs?.forEach(async (output: RunPodOutput) => {
                                try {
                                    const dlRes = await fetch(api(BACKEND_API.ENDPOINTS.RUNPOD_DOWNLOAD), {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            runpod_url: runpodUrl, runpod_token: runpodToken,
                                            filename: output.filename, subfolder: output.subfolder, file_type: output.type
                                        })
                                    });
                                    const dlData = await dlRes.json();
                                    if (dlData.success) output.local_url = dlData.url;
                                } catch (e) { console.error('Download error:', e); }
                            });

                            toast('RunPod render complete! Video downloaded.', 'success');
                            setTimeout(() => loadGallery(), 2000);
                            return { ...j, status: 'completed' as const, statusText: 'Video ready!', outputs: data.outputs || [] };
                        }

                        let status: RunPodJob['status'] = 'queued';
                        if (data.status === 'processing') status = 'processing';
                        else if (data.status === 'pod_loading') status = 'pod_loading';
                        return { ...j, status, statusText: data.status };
                    }));
                } catch (e) { console.error('Poll error:', e); }
            });

            return prev;
        });
    }, []);

    const loadGallery = async () => {
        setIsLoading(true);
        try {
            const response = await fetch(api(BACKEND_API.ENDPOINTS.FILES_LIST));
            if (!response.ok) throw new Error('Failed to load gallery');

            const data = await response.json();
            const files: MediaFile[] = data.files.map((file: any) => ({
                filename: file.filename,
                subfolder: file.subfolder,
                type: file.type,
                url: file.url,
                dateFolder: file.dateFolder,
                model: file.model,
                timestamp: file.modified * 1000,
                selected: false,
                isVideo: VIDEO_EXTENSIONS.some(ext => file.filename.toLowerCase().endsWith(ext))
            }));

            setMediaFiles(files);
        } catch (error) {
            console.error('Gallery load error:', error);
            toast('Failed to load gallery. Is backend running?', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleDelete = async (file: MediaFile) => {
        if (!confirm(`Delete ${file.filename} permanently from disk?`)) return;
        try {
            const response = await fetch(api(BACKEND_API.ENDPOINTS.FILES_DELETE), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: file.filename, subfolder: file.subfolder, type: file.type })
            });
            if (!response.ok) throw new Error('Delete failed');
            setMediaFiles(prev => prev.filter(f => f.filename !== file.filename));
            toast(`Deleted ${file.filename}`, 'success');
        } catch (error) {
            console.error('Delete error:', error);
            toast('Failed to delete file.', 'error');
        }
    };

    const handleDeleteSelected = async () => {
        const selected = mediaFiles.filter(f => f.selected);
        if (selected.length === 0) return;
        if (!confirm(`Delete ${selected.length} selected files permanently from disk?`)) return;

        let successCount = 0;
        for (const file of selected) {
            try {
                await fetch(api(BACKEND_API.ENDPOINTS.FILES_DELETE), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: file.filename, subfolder: file.subfolder, type: file.type })
                });
                successCount++;
            } catch (error) {
                console.error(`Failed to delete ${file.filename}`, error);
            }
        }
        setMediaFiles(prev => prev.filter(f => !f.selected));
        toast(`Deleted ${successCount} of ${selected.length} files`, 'success');
    };

    const handleCleanupOrphans = async () => {
        if (!confirm('Delete all orphaned files (files not in ComfyUI history)?')) return;
        try {
            const response = await fetch(api(BACKEND_API.ENDPOINTS.FILES_CLEANUP), { method: 'POST' });
            if (!response.ok) throw new Error('Cleanup failed');
            const result = await response.json();
            toast(`Cleanup complete! Deleted ${result.deleted_count} orphaned files`, 'success');
            loadGallery();
        } catch (error) {
            console.error('Cleanup error:', error);
            toast('Failed to cleanup.', 'error');
        }
    };

    const toggleSelect = (filename: string) => {
        setMediaFiles(prev => prev.map(f =>
            f.filename === filename ? { ...f, selected: !f.selected } : f
        ));
    };

    const toggleSelectAll = () => {
        const allSelected = filteredFiles.every(f => f.selected);
        setMediaFiles(prev => prev.map(f =>
            filteredFiles.includes(f) ? { ...f, selected: !allSelected } : f
        ));
    };

    const handleRunPodAnimate = async () => {
        const runpodUrl = localStorage.getItem('runpodUrl');
        if (!runpodUrl) {
            toast('Configure your RunPod Endpoint URL in Settings first!', 'error');
            return;
        }

        const selected = mediaFiles.filter(f => f.selected);
        if (selected.length === 0) return;

        setIsAnimatingRunPod(true);

        const tempJobId = `uploading_${Date.now()}`;
        setRunpodJobs(prev => [...prev, {
            promptId: tempJobId,
            status: 'uploading',
            statusText: `Uploading ${selected.length} images to RunPod...`,
            startedAt: Date.now(),
            outputs: []
        }]);

        try {
            const response = await fetch(api(BACKEND_API.ENDPOINTS.RUNPOD_ANIMATE), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    files: selected.map(f => ({ filename: f.filename, subfolder: f.subfolder, type: f.type })),
                    runpod_url: runpodUrl,
                    runpod_token: localStorage.getItem('runpodToken') || ''
                })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || 'RunPod error');

            setRunpodJobs(prev => prev.map(j =>
                j.promptId === tempJobId
                    ? { ...j, promptId: data.prompt_id, status: 'queued' as const, statusText: 'Job queued on RunPod' }
                    : j
            ));
            toast('Job sent to RunPod! Tracking progress...', 'success');
            setMediaFiles(prev => prev.map(f => ({ ...f, selected: false })));

        } catch (error: any) {
            console.error('RunPod trigger error:', error);
            setRunpodJobs(prev => prev.map(j =>
                j.promptId === tempJobId
                    ? { ...j, status: 'error' as const, statusText: error.message }
                    : j
            ));
            toast(`RunPod error: ${error.message}`, 'error');
        } finally {
            setIsAnimatingRunPod(false);
        }
    };

    const dismissJob = (promptId: string) => {
        setRunpodJobs(prev => prev.filter(j => j.promptId !== promptId));
    };

    const getElapsedTime = (startedAt: number) => {
        const seconds = Math.floor((Date.now() - startedAt) / 1000);
        if (seconds < 60) return `${seconds}s`;
        const minutes = Math.floor(seconds / 60);
        return `${minutes}m ${seconds % 60}s`;
    };

    const handleDownloadFile = async (url: string, filename: string) => {
        try {
            const savedAs = await directDownload(url, filename);
            toast(`Downloaded ${savedAs}`, 'success');
        } catch {
            toast('Failed to download file', 'error');
        }
    };


    // Filtering and sorting
    const filteredFiles = mediaFiles
        .filter(f => filterModel === 'all' || f.model === filterModel)
        .filter(f => filterDate === 'all' || f.dateFolder === filterDate)
        .filter(f => filterType === 'all' || (filterType === 'videos' ? f.isVideo : !f.isVideo))
        .filter(f => f.filename.toLowerCase().includes(searchTerm.toLowerCase()))
        .sort((a, b) => {
            if (sortBy === 'date') return b.timestamp - a.timestamp;
            if (sortBy === 'model') return a.model.localeCompare(b.model);
            return a.filename.localeCompare(b.filename);
        });

    const uniqueModels = Array.from(new Set(mediaFiles.map(f => f.model)));
    const uniqueDates = Array.from(new Set(mediaFiles.map(f => f.dateFolder))).sort().reverse();
    const selectedCount = mediaFiles.filter(f => f.selected).length;

    return (
        <CatalogShell
            title="Gallery Manager"
            subtitle={`${filteredFiles.length} files${selectedCount > 0 ? ` • ${selectedCount} selected` : ''}`} 
            icon={Images}
            actions={
                <>
                    <Button variant="ghost" onClick={loadGallery}>
                        <Download className="w-4 h-4 mr-2" />
                        Refresh
                    </Button>
                    <Button variant="ghost" onClick={handleCleanupOrphans} className="text-orange-400 hover:text-orange-300">
                        Cleanup Orphans
                    </Button>
                    {selectedCount > 0 && (
                        <>
                            <Button
                                variant="primary"
                                onClick={handleRunPodAnimate}
                                isLoading={isAnimatingRunPod}
                                className="bg-blue-600 hover:bg-blue-500 text-white"
                            >
                                <Cloud className="w-4 h-4 mr-1" />
                                Animate in RunPod ({selectedCount})
                            </Button>
                            <Button variant="ghost" onClick={handleDeleteSelected} className="text-red-400 hover:text-red-300">
                                <Trash2 className="w-4 h-4 mr-2" />
                                Delete {selectedCount}
                            </Button>
                        </>
                    )}
                </>
            }
        >
            {/* RunPod Job Tracker */}
            {runpodJobs.length > 0 && (
                <div className="space-y-3">
                    {runpodJobs.map((job) => (
                        <div
                            key={job.promptId}
                            className={`relative bg-[#121218] border rounded-2xl p-5 transition-all ${
                                job.status === 'completed' ? 'border-emerald-500/30' :
                                job.status === 'error' ? 'border-red-500/30' :
                                'border-blue-500/30'
                            }`}
                        >
                            {['completed', 'error'].includes(job.status) && (
                                <button onClick={() => dismissJob(job.promptId)} className="absolute top-3 right-3 text-slate-500 hover:text-white transition-colors">
                                    <X className="w-4 h-4" />
                                </button>
                            )}

                            <div className="flex items-center gap-4">
                                <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${
                                    job.status === 'completed' ? 'bg-emerald-500/20' :
                                    job.status === 'error' ? 'bg-red-500/20' : 'bg-blue-500/20'
                                }`}>
                                    {job.status === 'completed' ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> :
                                     job.status === 'error' ? <AlertCircle className="w-5 h-5 text-red-400" /> :
                                     <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />}
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm font-semibold text-white">RunPod Cloud Render</span>
                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                            job.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' :
                                            job.status === 'error' ? 'bg-red-500/20 text-red-400' :
                                            job.status === 'processing' ? 'bg-amber-500/20 text-amber-400' :
                                            job.status === 'pod_loading' ? 'bg-purple-500/20 text-purple-400' :
                                            'bg-blue-500/20 text-blue-400'
                                        }`}>
                                            {job.status === 'uploading' ? 'Uploading' :
                                             job.status === 'queued' ? 'In Queue' :
                                             job.status === 'processing' ? 'Rendering' :
                                             job.status === 'pod_loading' ? 'Pod Starting' :
                                             job.status === 'completed' ? 'Done' : 'Error'}
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-400 mt-1 truncate">
                                        {job.statusText}
                                        {!['completed', 'error'].includes(job.status) && (
                                            <span className="ml-2 text-slate-500">({getElapsedTime(job.startedAt)})</span>
                                        )}
                                    </p>
                                </div>

                                {!['completed', 'error'].includes(job.status) && (
                                    <div className="w-32">
                                        <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                                            <div className={`h-full rounded-full transition-all duration-1000 ${
                                                job.status === 'processing' ? 'bg-amber-400 animate-pulse' :
                                                job.status === 'pod_loading' ? 'bg-purple-400 animate-pulse' : 'bg-blue-400'
                                            }`} style={{
                                                width: job.status === 'uploading' ? '15%' :
                                                       job.status === 'queued' ? '25%' :
                                                       job.status === 'pod_loading' ? '20%' :
                                                       job.status === 'processing' ? '60%' : '0%'
                                            }} />
                                        </div>
                                    </div>
                                )}

                                {job.status === 'completed' && job.outputs.length > 0 && (
                                    <div className="flex gap-2">
                                        {job.outputs.map((output, i) => (
                                            <button key={i} onClick={() => handleDownloadFile(output.local_url || output.preview_url, output.filename)}
                                                className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-xs rounded-lg transition-colors">
                                                <Film className="w-3 h-3" />
                                                {output.filename}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Filters */}
            <CatalogCard className="p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                        <input type="text" placeholder="Search files..." value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 bg-[#0a0a0f] border border-white/10 rounded-lg text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-white/20" />
                    </div>
                    <select value={filterModel} onChange={(e) => setFilterModel(e.target.value)}
                        className="px-4 py-2 bg-[#0a0a0f] border border-white/10 rounded-lg text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-white/20">
                        <option value="all">All Models</option>
                        {uniqueModels.map(model => <option key={model} value={model}>{model}</option>)}
                    </select>
                    <select value={filterDate} onChange={(e) => setFilterDate(e.target.value)}
                        className="px-4 py-2 bg-[#0a0a0f] border border-white/10 rounded-lg text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-white/20">
                        <option value="all">All Dates</option>
                        {uniqueDates.map(date => <option key={date} value={date}>{date}</option>)}
                    </select>
                    <select value={filterType} onChange={(e) => setFilterType(e.target.value as any)}
                        className="px-4 py-2 bg-[#0a0a0f] border border-white/10 rounded-lg text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-white/20">
                        <option value="all">All Media</option>
                        <option value="images">Images Only</option>
                        <option value="videos">Videos Only</option>
                    </select>
                    <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}
                        className="px-4 py-2 bg-[#0a0a0f] border border-white/10 rounded-lg text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-white/20">
                        <option value="date">Sort by Date</option>
                        <option value="model">Sort by Model</option>
                        <option value="name">Sort by Name</option>
                    </select>
                </div>

                <button onClick={toggleSelectAll}
                    className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors">
                    {filteredFiles.every(f => f.selected) ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                    Select All ({filteredFiles.length})
                </button>
            </CatalogCard>
            {/* Gallery Grid */}
            {isLoading ? (
                <div className="text-center text-slate-500 py-20">Loading gallery...</div>
            ) : filteredFiles.length === 0 ? (
                <div className="text-center text-slate-500 py-20">No files found</div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
                    {filteredFiles.map((file) => (
                        <div
                            key={file.filename}
                            className={`group relative aspect-square bg-black/20 rounded-xl overflow-hidden border transition-all ${file.selected
                                ? 'border-white ring-2 ring-white'
                                : 'border-white/10 hover:border-white/50'
                            }`}
                        >
                            {/* Video or Image thumbnail */}
                            {file.isVideo ? (
                                <video
                                    src={file.url}
                                    className="w-full h-full object-cover"
                                    muted
                                    loop
                                    playsInline
                                    onMouseEnter={(e) => (e.target as HTMLVideoElement).play()}
                                    onMouseLeave={(e) => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
                                />
                            ) : (
                                <img src={file.url} alt={file.filename} draggable className="w-full h-full object-cover" />
                            )}

                            {/* Video badge */}
                            {file.isVideo && (
                                <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-black/60 rounded text-[10px] text-white font-medium backdrop-blur-sm flex items-center gap-1">
                                    <Film className="w-3 h-3" /> Video
                                </div>
                            )}

                            {/* Hover Overlay */}
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/60 transition-all opacity-0 group-hover:opacity-100 flex flex-col justify-between p-3">
                                <div className="flex justify-end">
                                    <button onClick={() => toggleSelect(file.filename)}
                                        className="p-2 bg-white/10 hover:bg-white/20 rounded-lg backdrop-blur-sm">
                                        {file.selected ? <CheckSquare className="w-4 h-4 text-white" /> : <Square className="w-4 h-4 text-white" />}
                                    </button>
                                </div>
                                <div className="space-y-2">
                                    <div className="text-xs text-white backdrop-blur-sm bg-black/40 rounded px-2 py-1">
                                        <div className="font-bold truncate">{file.model}</div>
                                        <div className="text-slate-300">{file.dateFolder}</div>
                                    </div>
                                    <button onClick={() => handleDownloadFile(file.url, file.filename)}
                                        className="w-full py-2 bg-emerald-500/20 hover:bg-emerald-500/30 rounded-lg backdrop-blur-sm flex items-center justify-center gap-2 text-emerald-300 text-sm">
                                        <Download className="w-4 h-4" /> Download
                                    </button>
                                    <button onClick={() => handleDelete(file)}
                                        className="w-full py-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg backdrop-blur-sm flex items-center justify-center gap-2 text-red-400 text-sm">
                                        <Trash2 className="w-4 h-4" /> Delete
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </CatalogShell>
    );
};




