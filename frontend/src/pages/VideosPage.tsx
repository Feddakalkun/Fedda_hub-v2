// Dedicated Videos Page — cinematic Netflix-style layout
import { useState, useEffect, useRef } from 'react';
import { Film, Play, Download, Trash2, Search, Maximize2 } from 'lucide-react';
import { useToast } from '../components/ui/Toast';
import { BACKEND_API } from '../config/api';
import { CatalogShell, CatalogCard } from '../components/layout/CatalogShell';
import { directDownload } from '../utils/directDownload';

const api = (endpoint: string) => `${BACKEND_API.BASE_URL}${endpoint}`;

interface VideoFile {
    filename: string;
    subfolder: string;
    type: string;
    url: string;
    dateFolder: string;
    model: string;
    timestamp: number;
}

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.gif'];

export const VideosPage = () => {
    const { toast } = useToast();
    const [videos, setVideos] = useState<VideoFile[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedVideo, setExpandedVideo] = useState<VideoFile | null>(null);
    const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

    useEffect(() => {
        loadVideos();
    }, []);

    const loadVideos = async () => {
        setIsLoading(true);
        try {
            const res = await fetch(api(BACKEND_API.ENDPOINTS.FILES_LIST));
            if (!res.ok) throw new Error('Failed to load');
            const data = await res.json();

            const vids: VideoFile[] = data.files
                .filter((f: any) => VIDEO_EXTENSIONS.some(ext => f.filename.toLowerCase().endsWith(ext)))
                .map((f: any) => ({
                    filename: f.filename,
                    subfolder: f.subfolder,
                    type: f.type,
                    url: f.url,
                    dateFolder: f.dateFolder,
                    model: f.model,
                    timestamp: f.modified * 1000,
                }))
                .sort((a: VideoFile, b: VideoFile) => b.timestamp - a.timestamp);

            setVideos(vids);
        } catch (error) {
            toast('Failed to load videos. Is backend running?', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleDelete = async (video: VideoFile) => {
        if (!confirm(`Delete ${video.filename} permanently?`)) return;
        try {
            const res = await fetch(api(BACKEND_API.ENDPOINTS.FILES_DELETE), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: video.filename, subfolder: video.subfolder, type: video.type })
            });
            if (!res.ok) throw new Error('Delete failed');
            setVideos(prev => prev.filter(v => v.filename !== video.filename));
            if (expandedVideo?.filename === video.filename) setExpandedVideo(null);
            toast(`Deleted ${video.filename}`, 'success');
        } catch {
            toast('Failed to delete video', 'error');
        }
    };

    const filteredVideos = videos.filter(v =>
        v.filename.toLowerCase().includes(searchTerm.toLowerCase()) ||
        v.model.toLowerCase().includes(searchTerm.toLowerCase())
    );
    const handleDownload = async (video: VideoFile) => {
        try {
            const savedAs = await directDownload(video.url, video.filename);
            toast(`Downloaded ${savedAs}`, 'success');
        } catch {
            toast('Failed to download video', 'error');
        }
    };

    // Group videos by date
    const groupedByDate = filteredVideos.reduce<Record<string, VideoFile[]>>((acc, v) => {
        const key = v.dateFolder || 'Unknown';
        if (!acc[key]) acc[key] = [];
        acc[key].push(v);
        return acc;
    }, {});

    const sortedDates = Object.keys(groupedByDate).sort().reverse();

    return (
        <CatalogShell
            title="Videos"
            subtitle={`${filteredVideos.length} videos`}
            icon={Film}
            actions={
                <CatalogCard className="p-2">
                    <div className="relative w-72">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                        <input
                            type="text"
                            placeholder="Search videos..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 bg-[#0a0a0f] border border-white/10 rounded-lg text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-white/20"
                        />
                    </div>
                </CatalogCard>
            }
        >
            {/* Expanded Video Player */}
            {expandedVideo && (
                <div className="bg-[#121218] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
                    <div className="relative aspect-video max-h-[70vh] bg-black flex items-center justify-center">
                        <video
                            src={expandedVideo.url}
                            className="max-w-full max-h-full"
                            controls
                            autoPlay
                            loop
                        />
                    </div>
                    <div className="p-5 flex items-center justify-between">
                        <div>
                            <h3 className="text-lg font-bold text-white">{expandedVideo.filename}</h3>
                            <p className="text-xs text-slate-400 mt-1">
                                {expandedVideo.model} &bull; {expandedVideo.dateFolder} &bull; {new Date(expandedVideo.timestamp).toLocaleString()}
                            </p>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => handleDownload(expandedVideo)}
                                className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm text-slate-300 flex items-center gap-2 transition-colors"
                            >
                                <Download className="w-4 h-4" /> Save
                            </button>
                            <button
                                onClick={() => handleDelete(expandedVideo)}
                                className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-sm text-red-400 flex items-center gap-2 transition-colors"
                            >
                                <Trash2 className="w-4 h-4" /> Delete
                            </button>
                            <button
                                onClick={() => setExpandedVideo(null)}
                                className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm text-slate-400 transition-colors"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Video Rows by Date */}
            {isLoading ? (
                <div className="text-center text-slate-500 py-20">Loading videos...</div>
            ) : filteredVideos.length === 0 ? (
                <div className="text-center text-slate-500 py-20">
                    <Film className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-lg">No videos yet</p>
                    <p className="text-sm mt-1">Rendered videos from RunPod will appear here</p>
                </div>
            ) : (
                sortedDates.map(date => (
                    <div key={date} className="space-y-3">
                        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider px-1">
                            {date}
                            <span className="text-slate-600 font-normal ml-2">({groupedByDate[date].length})</span>
                        </h2>

                        <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
                            {groupedByDate[date].map((video) => (
                                <div
                                    key={video.filename}
                                    className="group relative flex-shrink-0 w-80 aspect-video bg-black/40 rounded-xl overflow-hidden border border-white/5 hover:border-white/20 transition-all cursor-pointer"
                                >
                                    <video
                                        ref={(el) => { if (el) videoRefs.current.set(video.filename, el); }}
                                        src={video.url}
                                        className="w-full h-full object-cover"
                                        muted
                                        loop
                                        playsInline
                                        onMouseEnter={(e) => (e.target as HTMLVideoElement).play()}
                                        onMouseLeave={(e) => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
                                    />

                                    {/* Hover Overlay */}
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-all flex flex-col justify-end p-4">
                                        <div className="flex items-end justify-between">
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-bold text-white truncate">{video.filename}</p>
                                                <p className="text-[10px] text-slate-400 mt-0.5">{video.model}</p>
                                            </div>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setExpandedVideo(video); }}
                                                className="flex-shrink-0 p-2 bg-white/10 hover:bg-white/20 rounded-lg backdrop-blur-sm transition-colors ml-2"
                                            >
                                                <Maximize2 className="w-4 h-4 text-white" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Play indicator */}
                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                                        <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                                            <Play className="w-5 h-5 text-white ml-0.5" />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))
            )}
        </CatalogShell>
    );
};


