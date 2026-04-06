import { useState } from 'react';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';

interface ModelDownloaderProps {
  repo: string;
  label: string;
  subfolder: string;
}

export const ModelDownloader = ({ repo, label, subfolder }: ModelDownloaderProps) => {
  const [status, setStatus] = useState<any>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSync = async () => {
    setIsSyncing(true);
    setError(null);
    try {
      const resp = await fetch('/api/models/sync-hf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo, subfolder })
      });
      const data = await resp.json();
      if (!data.success) throw new Error(data.error || 'Sync failed');
      
      // Since it's a background thread, we just message "Started"
      setStatus({ status: 'running', message: 'Sync started...' });
    } catch (err: any) {
      setError(err.message);
      setIsSyncing(false);
    }
  };

  return (
    <div className="p-4 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-bold text-white truncate">{label}</h4>
        <p className="text-[10px] text-slate-500 truncate">{repo}</p>
      </div>

      <div className="flex items-center gap-3">
        {status?.status === 'running' && (
          <div className="flex items-center gap-2 text-[11px] text-amber-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Syncing...</span>
          </div>
        )}
        
        {error && (
          <div className="flex items-center gap-1 text-[10px] text-red-400">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Error</span>
          </div>
        )}

        <button
          onClick={handleSync}
          disabled={isSyncing}
          className="px-4 py-2 bg-white text-black text-xs font-bold rounded-lg hover:bg-slate-200 disabled:opacity-50 transition-all flex items-center gap-2"
        >
          {isSyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Sync Pack
        </button>
      </div>
    </div>
  );
};
