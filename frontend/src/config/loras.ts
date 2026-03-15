// Free LoRA Pack Configuration
export interface LoRAInfo {
    id: string;
    name: string;
    filename: string;
    emoji: string;
    description: string;
    size_mb: number;
    url: string;
}

const BASE_URL = 'https://huggingface.co/datasets/FeddaKalkun/free-loras/resolve/main';

export const FREE_LORAS: LoRAInfo[] = [
    {
        id: 'emmy',
        name: 'Emmy',
        filename: 'Emmy.safetensors',
        emoji: '👱‍♀️',
        description: 'Scandinavian blonde character LoRA',
        size_mb: 325,
        url: `${BASE_URL}/Emmy/Emmy.safetensors`,
    },
    {
        id: 'sana',
        name: 'Sana',
        filename: 'sana.safetensors',
        emoji: '👤',
        description: 'Character LoRA for portraits',
        size_mb: 162,
        url: `${BASE_URL}/Sana/sana.safetensors`,
    },
    {
        id: 'maya',
        name: 'Maya',
        filename: 'Maya-Sol.safetensors',
        emoji: '👩🏻',
        description: 'Maya character LoRA',
        size_mb: 324,
        url: `${BASE_URL}/Maya/Maya-Sol.safetensors`,
    },
];

export const TOTAL_LORA_SIZE_MB = FREE_LORAS.reduce((sum, lora) => sum + lora.size_mb, 0);
