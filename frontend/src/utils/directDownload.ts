const CONTENT_DISPOSITION_FILENAME_REGEX = /filename\*?=(?:UTF-8''|")?([^\";\n]+)/i;

const sanitizeFilename = (value: string): string => value.replace(/[\\/:*?"<>|]+/g, '_').trim();

const inferFilenameFromUrl = (url: string): string => {
    try {
        const parsed = new URL(url, window.location.origin);
        const fromQuery = parsed.searchParams.get('filename');
        if (fromQuery) return sanitizeFilename(decodeURIComponent(fromQuery));

        const pathname = parsed.pathname.split('/').filter(Boolean);
        const tail = pathname[pathname.length - 1];
        if (tail) return sanitizeFilename(decodeURIComponent(tail));
    } catch {
        // ignore and use fallback
    }
    return 'download';
};

const inferFilenameFromResponse = (response: Response): string | null => {
    const header = response.headers.get('content-disposition');
    if (!header) return null;
    const match = header.match(CONTENT_DISPOSITION_FILENAME_REGEX);
    if (!match?.[1]) return null;
    return sanitizeFilename(decodeURIComponent(match[1].replace(/\"/g, '')));
};

const triggerAnchorDownload = (href: string, filename: string) => {
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = sanitizeFilename(filename || 'download');
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
};

export const directDownload = async (url: string, suggestedFilename?: string): Promise<string> => {
    const fallbackName = sanitizeFilename(suggestedFilename || inferFilenameFromUrl(url) || 'download');
    try {
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const finalFilename = inferFilenameFromResponse(response) || fallbackName;
        triggerAnchorDownload(objectUrl, finalFilename);
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
        return finalFilename;
    } catch {
        triggerAnchorDownload(url, fallbackName);
        return fallbackName;
    }
};
