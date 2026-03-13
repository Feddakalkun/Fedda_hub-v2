import { Download, Check, Loader2 } from 'lucide-react';
import { useModelDownload } from '../hooks/useModelDownload';

interface ModelDownloadButtonProps {
  modelId: string;
  label?: string;
  className?: string;
}

export function ModelDownloadButton({ modelId, label, className = '' }: ModelDownloadButtonProps) {
  const { modelStatus, downloading, downloadModel } = useModelDownload(modelId);

  if (!modelStatus) {
    return null; // Loading or model not found
  }

  const { installed, downloading: isDownloading, progress, name, size } = modelStatus;

  if (installed) {
    return (
      <div className={`flex items-center gap-2 text-green-400 text-sm ${className}`}>
        <Check className="w-4 h-4" />
        <span>{label || name} installed</span>
      </div>
    );
  }

  if (isDownloading || downloading) {
    return (
      <div className={`flex items-center gap-3 ${className}`}>
        <div className="flex-1">
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-gray-300">Downloading {label || name}...</span>
            <span className="text-gray-400">{progress}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => downloadModel(modelId)}
      className={`flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors ${className}`}
    >
      <Download className="w-4 h-4" />
      <span>Download {label || name}</span>
      <span className="text-sm opacity-75">({size})</span>
    </button>
  );
}
