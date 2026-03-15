// LoRA Library - Automatic Download System
import { Package } from 'lucide-react';
import { CatalogShell, CatalogCard } from '../components/layout/CatalogShell';
import { LoRADownloader } from '../components/LoRADownloader';

export const LibraryPage = () => {
    return (
        <CatalogShell
            title="LoRA Library"
            subtitle="Free character LoRAs for image generation"
            icon={Package}
        >
            {/* Automatic Download Component */}
            <CatalogCard className="p-0">
                <LoRADownloader />
            </CatalogCard>

            {/* Info */}
            <CatalogCard className="p-6 mt-6">
                <div className="max-w-2xl">
                    <h4 className="text-sm font-semibold text-white mb-3">Installation Location</h4>
                    <div className="bg-white/5 rounded-lg p-4 font-mono text-xs text-slate-400 break-all">
                        {window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
                            ? 'ComfyUI\\models\\loras\\premium\\'
                            : '/workspace/models/comfyui/loras/premium/'}
                    </div>
                    <p className="text-xs text-slate-500 mt-3">
                        LoRAs will appear in the LoRA picker when generating images. ComfyUI refreshes automatically after downloads complete.
                    </p>
                </div>
            </CatalogCard>
        </CatalogShell>
    );
};
