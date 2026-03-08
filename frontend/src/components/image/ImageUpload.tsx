import { useState, useRef, useEffect } from 'react';
import { Upload, X } from 'lucide-react';

interface ImageUploadProps {
    onImageSelected: (file: File) => void;
    previewUrl: string | null;
    onClear: () => void;
    label?: string;
    initialUrl?: string | null;
}

export const ImageUpload = ({ onImageSelected, previewUrl, onClear, label = 'Upload Image', initialUrl }: ImageUploadProps) => {
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const lastLoadedUrl = useRef<string | null>(null);

    // Auto-load image from URL (e.g., gallery "Send to Img2Img")
    useEffect(() => {
        if (!initialUrl || initialUrl === lastLoadedUrl.current) return;
        lastLoadedUrl.current = initialUrl;

        (async () => {
            try {
                const resp = await fetch(initialUrl);
                const blob = await resp.blob();
                const ext = blob.type.split('/')[1] || 'png';
                const file = new File([blob], `gallery_image.${ext}`, { type: blob.type });
                onImageSelected(file);
            } catch (err) {
                console.error('Failed to load image from URL:', err);
            }
        })();
    }, [initialUrl, onImageSelected]);

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) onImageSelected(file);
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) onImageSelected(e.target.files[0]);
    };

    return (
        <div className="space-y-2">
            <label className="block text-xs text-slate-400 uppercase tracking-wider">{label}</label>
            {previewUrl ? (
                <div className="relative rounded-xl overflow-hidden border border-white/10">
                    <img src={previewUrl} alt="Input" className="w-full max-h-48 object-contain bg-black/30" />
                    <button onClick={onClear} className="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-red-500/80 rounded-full text-white transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            ) : (
                <div
                    className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${isDragging ? 'border-white/50 bg-white/5' : 'border-white/10 hover:border-white/30 hover:bg-white/5'}`}
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <Upload className="w-8 h-8 text-slate-500 mx-auto mb-2" />
                    <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Drop Image or Click to Browse</p>
                </div>
            )}
            <input ref={fileInputRef} type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
        </div>
    );
};
