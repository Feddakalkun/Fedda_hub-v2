export interface AngleConfig {
    horizontal: number;
    vertical: number;
    zoom: number;
    label: string;
}

// Node IDs per pipeline in the workflow
export const PIPELINES = [
    { camera: '93', sampler: '197:108' },
    { camera: '218', sampler: '213:108' },
    { camera: '226', sampler: '221:108' },
    { camera: '234', sampler: '229:108' },
    { camera: '242', sampler: '237:108' },
    { camera: '250', sampler: '245:108' },
];

export const PRESETS: Record<string, AngleConfig[]> = {
    'Character Sheet': [
        { horizontal: 0, vertical: 0, zoom: 5, label: 'Front' },
        { horizontal: 90, vertical: 0, zoom: 5, label: 'Right' },
        { horizontal: 180, vertical: 0, zoom: 5, label: 'Back' },
        { horizontal: 270, vertical: 0, zoom: 5, label: 'Left' },
        { horizontal: 45, vertical: 0, zoom: 5, label: '3/4 Right' },
        { horizontal: 0, vertical: 30, zoom: 1, label: 'Close-up' },
    ],
    'Product Spin': [
        { horizontal: 0, vertical: 15, zoom: 5, label: '0 deg' },
        { horizontal: 60, vertical: 15, zoom: 5, label: '60 deg' },
        { horizontal: 120, vertical: 15, zoom: 5, label: '120 deg' },
        { horizontal: 180, vertical: 15, zoom: 5, label: '180 deg' },
        { horizontal: 240, vertical: 15, zoom: 5, label: '240 deg' },
        { horizontal: 300, vertical: 15, zoom: 5, label: '300 deg' },
    ],
    'Dynamic Angles': [
        { horizontal: 90, vertical: 0, zoom: 5, label: 'Right' },
        { horizontal: 0, vertical: -30, zoom: 5, label: 'Low Front' },
        { horizontal: 0, vertical: 30, zoom: 5, label: 'High Front' },
        { horizontal: 135, vertical: 60, zoom: 5, label: "Bird's Eye" },
        { horizontal: 225, vertical: 0, zoom: 8, label: 'Wide Back Left' },
        { horizontal: 0, vertical: 30, zoom: 1, label: 'Close High' },
    ],
    'MLS Photoreal Clean': [
        { horizontal: 0, vertical: 2, zoom: 7, label: 'Front Hero' },
        { horizontal: 35, vertical: 4, zoom: 7, label: '3/4 Right' },
        { horizontal: 325, vertical: 4, zoom: 7, label: '3/4 Left' },
        { horizontal: 90, vertical: 2, zoom: 8, label: 'Right Side' },
        { horizontal: 270, vertical: 2, zoom: 8, label: 'Left Side' },
        { horizontal: 180, vertical: 3, zoom: 8, label: 'Rear' },
    ],
    'MLS Ultra Clean': [
        { horizontal: 0, vertical: 2, zoom: 8, label: 'Front Hero Wide' },
        { horizontal: 30, vertical: 3, zoom: 8, label: '3/4 Right Wide' },
        { horizontal: 330, vertical: 3, zoom: 8, label: '3/4 Left Wide' },
        { horizontal: 90, vertical: 2, zoom: 9, label: 'Right Side Wide' },
        { horizontal: 270, vertical: 2, zoom: 9, label: 'Left Side Wide' },
        { horizontal: 180, vertical: 3, zoom: 9, label: 'Rear Wide' },
    ],
};

export const MLS_NEGATIVE_PROMPT = 'low quality, blurry, noisy, grainy, oversharpened, cgi, 3d render, cartoon, plastic texture, waxy walls, warped windows, distorted roof lines';
export const MLS_ULTRA_NEGATIVE_PROMPT = 'low quality, blurry, noisy, grainy, oversharpened, cgi, 3d render, cartoon, anime, game render, plastic texture, waxy walls, fake grass, fake sky, warped windows, distorted roof lines, texture flicker, banding, halos';
export const MLS_STRICT_PRESERVE_NEGATIVE_PROMPT = 'new objects, extra buildings, extra people, extra vehicles, extra trees, added furniture, changed architecture, changed facade, changed layout, moved landmarks, wrong placement, text, logo, watermark, low quality, blurry, noisy, grainy, oversharpened, cgi, 3d render, cartoon, anime, game render, plastic texture, waxy surfaces, warped geometry, distorted lines, fake sky, fake grass, hallucinated details';

export const QUALITY_PRESETS = {
    Fast: { steps: 4, cfg: 1.0, sampler: 'euler', scheduler: 'simple' },
    Balanced: { steps: 8, cfg: 1.2, sampler: 'euler', scheduler: 'simple' },
    Quality: { steps: 12, cfg: 1.3, sampler: 'euler', scheduler: 'simple' },
} as const;

export type QualityPresetKey = keyof typeof QUALITY_PRESETS;

export const QUICK_PICKS = [
    { label: 'Front', h: 0, v: 0 },
    { label: '3/4 R', h: 45, v: 0 },
    { label: 'Right', h: 90, v: 0 },
    { label: 'Back', h: 180, v: 0 },
    { label: '3/4 L', h: 315, v: 0 },
    { label: 'Left', h: 270, v: 0 },
    { label: 'Top', h: 0, v: 60 },
    { label: 'Low', h: 0, v: -30 },
];

export function getAngleLabel(h: number, v: number, z: number): string {
    const dirs = ['Front', '3/4 R', 'Right', 'Back R', 'Back', 'Back L', 'Left', '3/4 L'];
    const idx = Math.round(((h % 360) / 360) * 8) % 8;
    let label = dirs[idx];

    if (v > 20) label += ' Hi';
    else if (v < -10) label += ' Lo';

    if (z <= 2) label = `Close ${label}`;
    else if (z >= 8) label = `Wide ${label}`;

    return label;
}
