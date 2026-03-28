export type MoodPresetKey = 'Sunset' | 'Golden Hour' | 'Blue Hour' | 'Overcast' | 'Night Neon';

export interface MoodPreset {
    label: MoodPresetKey;
    lightingPrompt: string;
}

export const MOOD_PRESETS: Record<MoodPresetKey, MoodPreset> = {
    Sunset: {
        label: 'Sunset',
        lightingPrompt: 'sunset lighting, warm orange and magenta sky tones, long soft shadows, realistic evening atmosphere',
    },
    'Golden Hour': {
        label: 'Golden Hour',
        lightingPrompt: 'golden hour sunlight, warm directional light, gentle highlights, natural cinematic glow',
    },
    'Blue Hour': {
        label: 'Blue Hour',
        lightingPrompt: 'blue hour mood, cool ambient sky light, subtle warm practical highlights, realistic dusk color balance',
    },
    Overcast: {
        label: 'Overcast',
        lightingPrompt: 'overcast daylight, soft diffused light, low contrast, realistic cloud-filtered illumination',
    },
    'Night Neon': {
        label: 'Night Neon',
        lightingPrompt: 'night scene with neon practical lights, realistic reflections, controlled contrast, cinematic night ambiance',
    },
};

export const HARD_LOCK_PRESERVE_PROMPT =
    'keep full consistency with the reference image; preserve exact composition, object placement, geometry, materials, and lens perspective; change only lighting mood and color grade';

export const HARD_LOCK_NEGATIVE_PROMPT =
    'new objects, extra objects, extra people, new buildings, new vehicles, changed geometry, changed architecture, moved landmarks, altered composition, reframed camera, text, logo, watermark, cgi, cartoon, blurry, low quality, distortion';

export const HARD_LOCK_DEFAULTS = {
    steps: 10,
    cfg: 1.15,
    defaultStrength: 34, // mapped to denoise 0.22
    minDenoise: 0.18,
    maxDenoise: 0.30,
    warningDenoise: 0.27,
} as const;

export function strengthToDenoise(strength: number): number {
    const clamped = Math.max(0, Math.min(100, strength));
    const ratio = clamped / 100;
    const denoise = HARD_LOCK_DEFAULTS.minDenoise + (HARD_LOCK_DEFAULTS.maxDenoise - HARD_LOCK_DEFAULTS.minDenoise) * ratio;
    return Math.round(denoise * 1000) / 1000;
}

