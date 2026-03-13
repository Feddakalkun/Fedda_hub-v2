import { useState, useEffect } from 'react';
import { BACKEND_API } from '../config/api';

interface ModelStatus {
  name: string;
  size: string;
  installed: boolean;
  downloading: boolean;
  progress: number;
}

interface ModelsStatus {
  [key: string]: ModelStatus;
}

export function useModelDownload(modelId?: string) {
  const [models, setModels] = useState<ModelsStatus>({});
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch models status
  const fetchStatus = async () => {
    try {
      const response = await fetch(`${BACKEND_API.BASE_URL}/api/models/status`);
      const data = await response.json();

      if (data.success) {
        setModels(data.models);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch model status');
    } finally {
      setLoading(false);
    }
  };

  // Start model download
  const downloadModel = async (id: string) => {
    try {
      setDownloading(true);
      setError(null);

      const response = await fetch(`${BACKEND_API.BASE_URL}/api/models/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: id })
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || 'Download failed');
      }

      // Start polling for progress
      pollProgress(id);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
      setDownloading(false);
    }
  };

  // Poll download progress
  const pollProgress = (id: string) => {
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`${BACKEND_API.BASE_URL}/api/models/progress/${id}`);
        const data = await response.json();

        if (data.success && data.progress) {
          // Update model status with progress
          setModels(prev => ({
            ...prev,
            [id]: {
              ...prev[id],
              progress: data.progress.progress || 0,
              downloading: data.progress.status === 'downloading'
            }
          }));

          // Stop polling if completed or failed
          if (data.progress.status === 'completed' || data.progress.status === 'failed') {
            clearInterval(interval);
            setDownloading(false);
            fetchStatus(); // Refresh full status
          }
        } else {
          // No progress data means download finished
          clearInterval(interval);
          setDownloading(false);
          fetchStatus();
        }
      } catch (err) {
        console.error('Progress poll error:', err);
      }
    }, 2000); // Poll every 2 seconds

    // Cleanup on unmount
    return () => clearInterval(interval);
  };

  // Initial fetch
  useEffect(() => {
    fetchStatus();

    // Refresh status every 30 seconds
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  // Get specific model status if modelId provided
  const modelStatus = modelId ? models[modelId] : null;

  return {
    models,
    modelStatus,
    loading,
    downloading,
    error,
    downloadModel,
    refreshStatus: fetchStatus
  };
}
