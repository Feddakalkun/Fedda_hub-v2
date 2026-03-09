import { useState, useRef, useEffect } from 'react';
import { Download, User, Video, Loader2, CheckCircle, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { BACKEND_API } from '../../config/api';
import { useToast } from '../ui/Toast';
import { usePersistentState } from '../../hooks/usePersistentState';

const COOKIE_OPTIONS = [
    { value: 'none', label: 'No Cookies' },
    { value: 'chrome', label: 'Chrome' },
    { value: 'edge', label: 'Edge' },
    { value: 'firefox', label: 'Firefox' },
];

interface DownloadJob {
    jobId: string;
    type: 'profile' | 'video';
    url: string;
    status: 'downloading' | 'done' | 'error';
    message?: string;
    progress?: number;
    downloaded?: number;
    log?: string[];
    showLog?: boolean;
}

export const DownloadTab = ({ onDownloadComplete }: { onDownloadComplete?: () => void }) => {
    const { toast } = useToast();
    const [profileUrl, setProfileUrl] = usePersistentState('tiktok_download_profile_url', '');
    const [videoUrl, setVideoUrl] = usePersistentState('tiktok_download_video_url', '');
    const [cookieSource, setCookieSource] = usePersistentState('tiktok_download_cookie_source', 'none');
    const [limit, setLimit] = usePersistentState('tiktok_download_limit', '');
    const [jobs, setJobs] = useState<DownloadJob[]>([]);
    const pollRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

    // Poll job status
    const pollJob = (jobId: string) => {
        if (pollRef.current[jobId]) return;
        pollRef.current[jobId] = setInterval(async () => {
            try {
                const res = await fetch(`${BACKEND_API.BASE_URL}/api/tiktok/download-status/${jobId}`);
                if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
                const data = await res.json();
                setJobs(prev => prev.map(j => {
                    if (j.jobId !== jobId) return j;
                    if (data.status === 'done' || data.status === 'error') {
                        clearInterval(pollRef.current[jobId]);
                        delete pollRef.current[jobId];
                        if (data.status === 'done') {
                            toast('Download complete!', 'success');
                            onDownloadComplete?.();
                        } else {
                            // Extract meaningful error from log
                            const errLine = (data.log || []).find((l: string) =>
                                l.toLowerCase().includes('error') || l.toLowerCase().includes('failed')
                            ) || data.message || 'Download failed';
                            toast(`Download error: ${errLine}`, 'error');
                        }
                    }
                    return {
                        ...j,
                        status: data.status,
                        message: data.message,
                        progress: data.progress,
                        downloaded: data.downloaded,
                        log: data.log || [],
                    };
                }));
            } catch (err) {
                // keep polling silently
            }
        }, 1500);
    };

    useEffect(() => {
        return () => {
            Object.values(pollRef.current).forEach(clearInterval);
        };
    }, []);

    const handleDownloadProfile = async () => {
        if (!profileUrl.trim()) return;
        try {
            const res = await fetch(`${BACKEND_API.BASE_URL}/api/tiktok/download-profile`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: profileUrl.trim(),
                    cookie_source: cookieSource === 'none' ? 'none' : cookieSource,
                    limit: limit ? parseInt(limit) : null,
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ detail: res.statusText }));
                toast(`Failed to start download: ${err.detail || res.statusText}`, 'error');
                return;
            }
            const data = await res.json();
            if (data.job_id) {
                const job: DownloadJob = {
                    jobId: data.job_id,
                    type: 'profile',
                    url: profileUrl,
                    status: 'downloading',
                    log: [],
                };
                setJobs(prev => [job, ...prev]);
                pollJob(data.job_id);
                setProfileUrl('');
                toast('Profile download started', 'info');
            }
        } catch (err) {
            toast(`Could not reach backend: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
    };

    const handleDownloadVideo = async () => {
        if (!videoUrl.trim()) return;
        try {
            const res = await fetch(`${BACKEND_API.BASE_URL}/api/tiktok/download-video`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: videoUrl.trim(),
                    cookie_source: cookieSource === 'none' ? 'none' : cookieSource,
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ detail: res.statusText }));
                toast(`Failed to start download: ${err.detail || res.statusText}`, 'error');
                return;
            }
            const data = await res.json();
            if (data.job_id) {
                const job: DownloadJob = {
                    jobId: data.job_id,
                    type: 'video',
                    url: videoUrl,
                    status: 'downloading',
                    log: [],
                };
                setJobs(prev => [job, ...prev]);
                pollJob(data.job_id);
                setVideoUrl('');
                toast('Video download started', 'info');
            }
        } catch (err) {
            toast(`Could not reach backend: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
    };

    const toggleLog = (jobId: string) => {
        setJobs(prev => prev.map(j => j.jobId === jobId ? { ...j, showLog: !j.showLog } : j));
    };

    return (
        <div className="space-y-6">
            {/* Profile Download */}
            <div className="bg-[#121218] border border-white/5 rounded-2xl p-5 space-y-4">
                <div className="flex items-center gap-2 text-white font-semibold text-sm">
                    <User className="w-4 h-4 text-slate-400" />
                    Download Profile
                </div>
                <input
                    value={profileUrl}
                    onChange={e => setProfileUrl(e.target.value)}
                    placeholder="https://www.tiktok.com/@username"
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-white/20 transition-colors"
                    onKeyDown={e => e.key === 'Enter' && handleDownloadProfile()}
                />
                <div className="flex gap-3">
                    <input
                        value={limit}
                        onChange={e => setLimit(e.target.value.replace(/\D/g, ''))}
                        placeholder="Limit (blank = all)"
                        className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-white/20"
                    />
                    <select
                        value={cookieSource}
                        onChange={e => setCookieSource(e.target.value)}
                        className="bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-white/20"
                    >
                        {COOKIE_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                </div>
                <button
                    onClick={handleDownloadProfile}
                    disabled={!profileUrl.trim()}
                    className="w-full py-3 rounded-xl font-bold text-sm tracking-wider uppercase transition-all bg-white text-black hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                    <Download className="w-4 h-4 inline mr-2" />
                    Download Profile
                </button>
            </div>

            {/* Single Video Download */}
            <div className="bg-[#121218] border border-white/5 rounded-2xl p-5 space-y-4">
                <div className="flex items-center gap-2 text-white font-semibold text-sm">
                    <Video className="w-4 h-4 text-slate-400" />
                    Download Single Video
                </div>
                <input
                    value={videoUrl}
                    onChange={e => setVideoUrl(e.target.value)}
                    placeholder="https://www.tiktok.com/@user/video/1234567890"
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-white/20 transition-colors"
                    onKeyDown={e => e.key === 'Enter' && handleDownloadVideo()}
                />
                <button
                    onClick={handleDownloadVideo}
                    disabled={!videoUrl.trim()}
                    className="w-full py-3 rounded-xl font-bold text-sm tracking-wider uppercase transition-all bg-white/10 text-white hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                    <Download className="w-4 h-4 inline mr-2" />
                    Download Video
                </button>
            </div>

            {/* Active Jobs */}
            {jobs.length > 0 && (
                <div className="space-y-2">
                    <div className="text-xs font-bold uppercase tracking-widest text-slate-500 px-1">Downloads</div>
                    {jobs.map(job => (
                        <div key={job.jobId} className="bg-[#121218] border border-white/5 rounded-xl p-4 space-y-2">
                            <div className="flex items-center gap-3">
                                {job.status === 'downloading' && <Loader2 className="w-4 h-4 text-blue-400 animate-spin flex-shrink-0" />}
                                {job.status === 'done' && <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />}
                                {job.status === 'error' && <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />}
                                <div className="flex-1 min-w-0">
                                    <div className="text-xs text-white truncate">{job.url}</div>
                                    <div className="text-[10px] text-slate-500 mt-0.5">
                                        {job.message || (job.status === 'downloading' ? 'Starting...' : job.status)}
                                        {job.downloaded !== undefined && job.downloaded > 0 ? ` (${job.downloaded} downloaded)` : ''}
                                    </div>
                                </div>
                                {/* Progress bar */}
                                {job.status === 'downloading' && typeof job.progress === 'number' && job.progress > 0 && (
                                    <span className="text-[10px] text-slate-400 font-mono flex-shrink-0">{job.progress.toFixed(0)}%</span>
                                )}
                                {/* Log toggle */}
                                {job.log && job.log.length > 0 && (
                                    <button
                                        onClick={() => toggleLog(job.jobId)}
                                        className="text-slate-600 hover:text-slate-300 flex-shrink-0"
                                        title="Toggle log"
                                    >
                                        {job.showLog ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                    </button>
                                )}
                            </div>
                            {/* Progress bar */}
                            {job.status === 'downloading' && typeof job.progress === 'number' && job.progress > 0 && (
                                <div className="w-full h-0.5 bg-white/5 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-blue-500 transition-all"
                                        style={{ width: `${job.progress}%` }}
                                    />
                                </div>
                            )}
                            {/* Expandable log */}
                            {job.showLog && job.log && job.log.length > 0 && (
                                <div className="mt-2 bg-black/50 rounded-lg p-3 max-h-40 overflow-y-auto">
                                    {job.log.slice(-20).map((line, i) => (
                                        <div key={i} className="text-[9px] font-mono text-slate-400 leading-relaxed whitespace-pre-wrap break-all">
                                            {line}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

