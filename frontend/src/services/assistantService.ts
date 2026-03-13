import { ollamaService } from './ollamaService';

// Include the system prompt text directly or load it from a file if feasible. 
// For simplicity in the frontend, we'll embed the core instruction here.
// You could also fetch this from '/assets/instructions/ollama/t2i.txt' if you prefer to keep it separate.

const T2I_SYSTEM_PROMPT = `You are an expert AI image prompt engineer specialized in creating ultra-detailed, cinematic Flux-style prompts from very short user inputs.

GENERAL BEHAVIOR
- The user will usually give you only a few words or a short, messy idea.
- Your ONLY job is to transform that into ONE single, fully-formed, highly descriptive image prompt.
- Do NOT ask questions.
- Do NOT explain what you are doing.
- Do NOT add pre-text or post-text.
- Output ONLY the final prompt as plain text.

STYLE & FORMAT
- Write a single paragraph prompt, in natural English.
- Aim for 70–200 words depending on how much detail makes sense.
- Always include: subject, clothing or body details (if relevant), scene, environment, mood, lighting, colors, camera / lens, composition, style tags.
- Prefer Flux-friendly language like: "highly detailed", "cinematic lighting", "sharp focus", "subtle film grain".

INSTRUCTIONS SUMMARY
- Transform any short input into one long, rich, cinematic Flux-style image prompt.
- Never say anything except the final prompt.`;

const I2T_SYSTEM_PROMPT = `You are an expert AI image analyst.
GENERAL BEHAVIOR
- User provides an image.
- Output ONE single, fully-formed, highly descriptive image caption (50-150 words).
- Cover: subject, clothing, environment, lighting, style.
- NO extra text. Just the caption.
- Be brutally honest and detailed.
`;

const WAN2_SYSTEM_PROMPT = `You are "Wan2.2 Prompt Engineer", an expert at writing prompts and settings for the Wan2.2 Mixture-of-Experts video diffusion model.

Your job:
- Take a high-level idea from the user.
- Turn it into a *single* highly structured response that my app can feed into a local Wan2.2 / ComfyUI workflow.
- Never include explanations, markdown, or extra commentary.
- Always respond with **valid, minified JSON only**.

The JSON schema you must output is exactly:
{
  "mode": "t2v" | "i2v",
  "description_summary": string,
  "prompt": string,
  "negative_prompt": string,
  "resolution": { "width": number, "height": number },
  "num_frames": number,
  "fps": number,
  "sampler": string,
  "steps": number,
  "cfg_scale": number,
  "high_noise_steps": number,
  "low_noise_steps": number,
  "use_speed_lora": boolean,
  "notes": string
}

General rules:
- Assume the underlying pipeline is Wan2.2 text-to-video unless the user clearly says there is an input image, in which case use mode = "i2v".
- For text-to-video, describe subject, scene, motion, aesthetics, and camera in one coherent sentence or paragraph.
- For image-to-video, focus the prompt on movement, camera work, atmosphere, and effects; do NOT re-describe appearance already visible in the image.
- Use cinematic, film-language wording. Prefer concrete adjectives over vague ones.
- Always fill in every JSON field with a sensible value.

Prompt construction rules (field: prompt):
- Follow this order inside the positive prompt where possible:
  1) Subject: who or what is the main focus, including age, clothing, key physical traits.
  2) Scene: environment, time of day, weather, background elements.
  3) Motion: what moves, how, and how fast.
  4) Aesthetic control: lighting type and quality, shot size, composition, color tone.
  5) Camera work: camera movement and angle.
  6) Stylization and special effects if the user wants a specific style.
- Separate clauses with commas; avoid long stories or multiple sentences.
- Use vocabularies Wan2.2 responds well to, such as:
  - Lighting: daylight, sunset, nighttime, neon, soft rim light, backlight, overcast, warm light, cool light.
  - Shot size: close-up, medium shot, long shot, establishing shot.
  - Camera: low angle, high angle, top-down, over-the-shoulder, handheld, dolly in, dolly out, pan left/right, tilt up/down, orbit.
  - Style: realistic, cinematic, anime, watercolor, 3D cartoon, 3D game, oil painting, black-and-white.
- If the user wants realism, avoid obviously stylized terms like "anime" or "cartoon." If the user wants a specific style, make that explicit.

Negative prompt rules (field: negative_prompt):
- Always start from this base list:
  "blurry, low resolution, distorted anatomy, extra limbs, logo watermark, text overlay, flickering, stuttering, washed-out colors, overexposed, underexposed, glitch, noisy, JPEG artifacts".
- Add more items if the user specifies dislikes (for example: "no gore", "no fast camera shake", "no text").

Resolution and duration defaults:
- If the user does not specify otherwise, use resolution width = 960 and height = 540 for faster previews.
- If the user explicitly asks for high quality, cinematic, or final output, use 1280x720.
- If the user does not specify clip length, set num_frames = 64 and fps = 24.
- If the user wants very short clips, reduce num_frames (e.g., 32 or 48); for longer clips, increase up to 120.

Sampler, steps, and CFG defaults:
- Default sampler: "euler" for compatibility.
- If the user explicitly asks for very fast previews, you may set sampler to "lcm" and set use_speed_lora = true.
- When use_speed_lora = false, use steps = 18 and cfg_scale = 3.5 by default.
- When use_speed_lora = true, use steps between 4 and 8 and cfg_scale = 2.5–3, choosing a single integer steps value.
- Split high_noise_steps and low_noise_steps so that high_noise_steps + low_noise_steps = steps, and high_noise_steps is roughly one third of the total steps (round as needed).

Clarification behavior:
- If any of these are missing and critically important, ask at most 3 short clarification questions before producing JSON: subject identity, desired style (realistic vs stylized), approximate clip length intention (short, medium, long), and SFW vs NSFW constraints.
- If the user message is already specific enough, skip questions and respond with JSON immediately.

Output rules:
- Respond with JSON only, no markdown, no code fences, no additional text.
- Make sure the JSON is valid and minified: no trailing commas, double quotes around all keys and string values.
- Do not invent technical parameters beyond the fields in the schema; assume the host application controls all other settings.`;


const ACE_STEP_ARCHITECT_SYSTEM_PROMPT = `You are ACE-Step 1.5 Prompt Architect, an expert creative director for text-to-music prompting.

Goal:
- Convert a rough user brief into a detailed, original, production-ready song blueprint for ACE-Step 1.5.
- Return data in strict JSON so the host app can apply the result directly.

Hard rules:
- Output valid JSON only. No markdown, no code fence, no commentary.
- Never ask follow-up questions.
- If details are missing, infer sensible defaults and record them in assumptions.
- Never attempt to clone a copyrighted track. Use broad style references only.
- If a user names an artist, convert that request into style attributes (era, groove, instrumentation, vocal character) and note the conversion in assumptions.
- Keep lyrics clean unless the user explicitly requests explicit content.

JSON schema (all keys required):
{
  "title": "string",
  "overview": {
    "intent": "string",
    "mood_imagery": "string"
  },
  "music_metadata": {
    "genre": "string",
    "influences": ["string"],
    "tempo_bpm": "string",
    "key_and_scale": "string",
    "time_signature": "string",
    "song_length": "string",
    "energy_curve": "string"
  },
  "structure": {
    "sections_ordered": [
      { "name": "string", "duration": "string", "details": "string" }
    ],
    "transitions": ["string"]
  },
  "instrumentation_and_sound_design": {
    "core_elements": {
      "drums": "string",
      "bass": "string",
      "harmony": "string",
      "lead": "string"
    },
    "additional_elements": {
      "fx_atmos": "string",
      "ear_candy": "string"
    },
    "mix_notes": ["string"]
  },
  "vocals_and_lyrics": {
    "vocals_presence": "string",
    "vocal_character": "string",
    "language": "string",
    "perspective": "string",
    "theme": "string",
    "imagery_and_motifs": "string",
    "rhyme_and_flow": {
      "rhyme_scheme": "string",
      "syllable_feel": "string"
    }
  },
  "lyrics_draft": {
    "sectioned_lyrics": "string",
    "hook_phrases": ["string"]
  },
  "ace_step_prompt": "string",
  "negative_instructions": ["string"],
  "assumptions": ["string"],
  "ui_suggestions": {
    "tags": "string",
    "lyrics": "string",
    "seconds": 120,
    "steps": 50,
    "cfg": 4,
    "lyrics_strength": 1.0
  }
}

Quality rules:
- ace_step_prompt must be one dense paragraph with genre, mood, arrangement, instrumentation, vocal approach, language, and hook concept.
- ui_suggestions.tags must be comma-separated style tags and include a tempo hint.
- ui_suggestions.lyrics must be sectioned with labels like [Intro], [Verse], [Chorus], [Bridge], [Outro].
- Keep ui_suggestions.seconds between 20 and 240.
- Keep ui_suggestions.steps between 20 and 80.
- Keep ui_suggestions.cfg between 2 and 7.
- Keep ui_suggestions.lyrics_strength between 0.3 and 1.3.
`;
export interface Wan2Spec {
    mode: 't2v' | 'i2v';
    description_summary: string;
    prompt: string;
    negative_prompt: string;
    resolution: { width: number, height: number };
    num_frames: number;
    fps: number;
    sampler: string;
    steps: number;
    cfg_scale: number;
    high_noise_steps: number;
    low_noise_steps: number;
    use_speed_lora: boolean;
    notes: string;
}


export interface AceStepSection {
    name: string;
    duration: string;
    details: string;
}

export interface AceStepBlueprint {
    title: string;
    overview: {
        intent: string;
        mood_imagery: string;
    };
    music_metadata: {
        genre: string;
        influences: string[];
        tempo_bpm: string;
        key_and_scale: string;
        time_signature: string;
        song_length: string;
        energy_curve: string;
    };
    structure: {
        sections_ordered: AceStepSection[];
        transitions: string[];
    };
    instrumentation_and_sound_design: {
        core_elements: {
            drums: string;
            bass: string;
            harmony: string;
            lead: string;
        };
        additional_elements: {
            fx_atmos: string;
            ear_candy: string;
        };
        mix_notes: string[];
    };
    vocals_and_lyrics: {
        vocals_presence: string;
        vocal_character: string;
        language: string;
        perspective: string;
        theme: string;
        imagery_and_motifs: string;
        rhyme_and_flow: {
            rhyme_scheme: string;
            syllable_feel: string;
        };
    };
    lyrics_draft: {
        sectioned_lyrics: string;
        hook_phrases: string[];
    };
    ace_step_prompt: string;
    negative_instructions: string[];
    assumptions: string[];
    ui_suggestions: {
        tags: string;
        lyrics: string;
        seconds: number;
        steps: number;
        cfg: number;
        lyrics_strength: number;
    };
}
export const assistantService = {
    // Generate Wan2.2 Specification
    generateWan2Spec: async (modelName: string, userInstruction: string): Promise<Wan2Spec> => {
        try {
            const response = await fetch('/ollama/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: modelName,
                    prompt: userInstruction,
                    system: WAN2_SYSTEM_PROMPT,
                    stream: false,
                    format: 'json', // Ollama handles JSON enforcement if supported
                    options: { temperature: 0.7 }
                }),
            });
            if (!response.ok) throw new Error('Failed to generate Wan2 spec');
            const data = await response.json();

            // Handle case where Ollama might return a string that needs parsing
            // though 'format: json' should return an object if handled by proxy/backend correctly
            let result = data.response;
            if (typeof result === 'string') {
                try {
                    result = JSON.parse(result);
                } catch (e) {
                    console.error("Failed to parse JSON from Ollama response:", result);
                    throw new Error("Invalid JSON format from AI");
                }
            }
            // 🧹 Free VRAM immediately
            await ollamaService.unloadModel(modelName);

            return result as Wan2Spec;
        } catch (error) {
            console.error('Wan2 Spec Error:', error);
            throw error;
        }
    },

    generateAceStepBlueprint: async (modelName: string, userBrief: string): Promise<AceStepBlueprint> => {
        try {
            const response = await fetch('/ollama/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: modelName,
                    prompt: userBrief,
                    system: ACE_STEP_ARCHITECT_SYSTEM_PROMPT,
                    stream: false,
                    format: 'json',
                    options: { temperature: 0.75, num_predict: 1800 }
                }),
            });

            if (!response.ok) throw new Error('Failed to generate ACE-Step blueprint');
            const data = await response.json();

            let result = data.response;
            if (typeof result === 'string') {
                try {
                    result = JSON.parse(result);
                } catch {
                    throw new Error('AI returned invalid JSON for ACE blueprint');
                }
            }

            await ollamaService.unloadModel(modelName);

            const ui = result?.ui_suggestions ?? {};
            const sec = Number.isFinite(ui.seconds) ? Math.max(20, Math.min(240, Math.round(ui.seconds))) : 120;
            const stp = Number.isFinite(ui.steps) ? Math.max(20, Math.min(80, Math.round(ui.steps))) : 50;
            const cfg = Number.isFinite(ui.cfg) ? Math.max(2, Math.min(7, Number(ui.cfg))) : 4;
            const lyrStrength = Number.isFinite(ui.lyrics_strength)
                ? Math.max(0.3, Math.min(1.3, Number(ui.lyrics_strength)))
                : 1;

            const fallbackTags = [
                result?.music_metadata?.genre,
                result?.overview?.mood_imagery,
                result?.music_metadata?.tempo_bpm,
                result?.vocals_and_lyrics?.vocal_character,
            ]
                .filter((v: unknown) => typeof v === 'string' && v.trim().length > 0)
                .join(', ');

            const blueprint: AceStepBlueprint = {
                title: result?.title || 'Untitled Track',
                overview: {
                    intent: result?.overview?.intent || '',
                    mood_imagery: result?.overview?.mood_imagery || '',
                },
                music_metadata: {
                    genre: result?.music_metadata?.genre || '',
                    influences: Array.isArray(result?.music_metadata?.influences) ? result.music_metadata.influences : [],
                    tempo_bpm: result?.music_metadata?.tempo_bpm || '',
                    key_and_scale: result?.music_metadata?.key_and_scale || 'open',
                    time_signature: result?.music_metadata?.time_signature || '4/4',
                    song_length: result?.music_metadata?.song_length || `${sec}s`,
                    energy_curve: result?.music_metadata?.energy_curve || '',
                },
                structure: {
                    sections_ordered: Array.isArray(result?.structure?.sections_ordered) ? result.structure.sections_ordered : [],
                    transitions: Array.isArray(result?.structure?.transitions) ? result.structure.transitions : [],
                },
                instrumentation_and_sound_design: {
                    core_elements: {
                        drums: result?.instrumentation_and_sound_design?.core_elements?.drums || '',
                        bass: result?.instrumentation_and_sound_design?.core_elements?.bass || '',
                        harmony: result?.instrumentation_and_sound_design?.core_elements?.harmony || '',
                        lead: result?.instrumentation_and_sound_design?.core_elements?.lead || '',
                    },
                    additional_elements: {
                        fx_atmos: result?.instrumentation_and_sound_design?.additional_elements?.fx_atmos || '',
                        ear_candy: result?.instrumentation_and_sound_design?.additional_elements?.ear_candy || '',
                    },
                    mix_notes: Array.isArray(result?.instrumentation_and_sound_design?.mix_notes)
                        ? result.instrumentation_and_sound_design.mix_notes
                        : [],
                },
                vocals_and_lyrics: {
                    vocals_presence: result?.vocals_and_lyrics?.vocals_presence || '',
                    vocal_character: result?.vocals_and_lyrics?.vocal_character || '',
                    language: result?.vocals_and_lyrics?.language || '',
                    perspective: result?.vocals_and_lyrics?.perspective || '',
                    theme: result?.vocals_and_lyrics?.theme || '',
                    imagery_and_motifs: result?.vocals_and_lyrics?.imagery_and_motifs || '',
                    rhyme_and_flow: {
                        rhyme_scheme: result?.vocals_and_lyrics?.rhyme_and_flow?.rhyme_scheme || '',
                        syllable_feel: result?.vocals_and_lyrics?.rhyme_and_flow?.syllable_feel || '',
                    },
                },
                lyrics_draft: {
                    sectioned_lyrics: result?.lyrics_draft?.sectioned_lyrics || '',
                    hook_phrases: Array.isArray(result?.lyrics_draft?.hook_phrases) ? result.lyrics_draft.hook_phrases : [],
                },
                ace_step_prompt: result?.ace_step_prompt || '',
                negative_instructions: Array.isArray(result?.negative_instructions) ? result.negative_instructions : [],
                assumptions: Array.isArray(result?.assumptions) ? result.assumptions : [],
                ui_suggestions: {
                    tags: typeof ui.tags === 'string' && ui.tags.trim() ? ui.tags.trim() : fallbackTags,
                    lyrics: typeof ui.lyrics === 'string' && ui.lyrics.trim()
                        ? ui.lyrics
                        : (result?.lyrics_draft?.sectioned_lyrics || ''),
                    seconds: sec,
                    steps: stp,
                    cfg,
                    lyrics_strength: lyrStrength,
                },
            };

            return blueprint;
        } catch (error) {
            console.error('ACE-Step Blueprint Error:', error);
            throw error;
        }
    },
    enhancePrompt: async (modelName: string, userPrompt: string): Promise<string> => {
        try {
            const response = await fetch('/ollama/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: modelName,
                    prompt: userPrompt,
                    system: T2I_SYSTEM_PROMPT,
                    stream: false,
                    options: { temperature: 0.7 }
                }),
            });
            if (!response.ok) throw new Error('Failed to generate prompt');
            const data = await response.json();

            // 🧹 Free VRAM immediately
            await ollamaService.unloadModel(modelName);

            return data.response;
        } catch (error) {
            console.error('AI Assist Error:', error);
            throw error;
        }
    },

    describeImage: async (modelName: string, base64Image: string): Promise<string> => {
        try {
            // Remove header if present (data:image/png;base64,)
            const cleanBase64 = base64Image.replace(/^data:image\/[a-z]+;base64,/, "");

            const response = await fetch('/ollama/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: modelName,
                    prompt: "Describe this image in extreme detail.",
                    system: I2T_SYSTEM_PROMPT,
                    images: [cleanBase64],
                    stream: false,
                    options: { temperature: 0.2 } // Lower temp for more accurate description
                }),
            });
            if (!response.ok) throw new Error('Failed to describe image');
            const data = await response.json();

            // 🧹 Free VRAM
            await ollamaService.unloadModel(modelName);

            return data.response;
        } catch (error) {
            console.error('Vision Assist Error:', error);
            throw error;
        }
    },

    // Generate 6 consistent image prompts for scene building
    generateScenePrompts: async (
        modelName: string,
        description: string,
        loraStyle: string
    ): Promise<{ prompts: string[]; seed: number }> => {
        const systemPrompt = `You are a cinematic storyboard designer. Generate exactly 6 image prompts for keyframes of a video sequence.

Requirements:
- Each prompt describes ONE distinct frame/moment in the sequence
- Same character/subject throughout for visual consistency
- Vary the pose, action, and camera angle across the 6 frames to create motion
- Include style reference: "${loraStyle || 'photorealistic'}"
- Generate a random seed number (large integer) to be shared across all images
- Output ONLY valid JSON, no extra text

JSON format:
{
  "prompts": ["prompt 1", "prompt 2", "prompt 3", "prompt 4", "prompt 5", "prompt 6"],
  "seed": 123456789012345
}`;

        try {
            const response = await fetch('/ollama/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: modelName,
                    prompt: description,
                    system: systemPrompt,
                    stream: false,
                    format: 'json',
                    options: { temperature: 0.8 }
                }),
            });

            if (!response.ok) throw new Error('Failed to generate scene prompts');
            const data = await response.json();

            let result = data.response;
            if (typeof result === 'string') {
                result = JSON.parse(result);
            }

            await ollamaService.unloadModel(modelName);

            if (!result.prompts || result.prompts.length !== 6) {
                throw new Error('AI did not return exactly 6 prompts');
            }

            return result as { prompts: string[]; seed: number };
        } catch (error) {
            console.error('Scene prompt generation failed:', error);
            throw error;
        }
    },

    // General Chat (now using IF_AI_tools via backend)
    chat: async (modelName: string, messages: { role: string; content: string; images?: string[] }[]): Promise<string> => {
        try {
            const { BACKEND_API } = await import('../config/api');
            const response = await fetch(`${BACKEND_API.BASE_URL}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: modelName,
                    messages: messages
                }),
            });

            if (!response.ok) throw new Error('Chat request failed');
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Chat failed');
            }

            return data.response;
        } catch (error) {
            console.error('Chat Error:', error);
            throw error;
        }
    }
};


