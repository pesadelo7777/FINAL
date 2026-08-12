class LifeVUEngine {
    constructor() {
        this.version = "LifeVU_CORE_DYNAMIC_SDK_V3";
        this.mode = 'render'; // 'render', 'reference', ou 'couple'
    }

    setMode(mode) {
        this.mode = mode;
    }

    async convertFileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    const MAX_WIDTH = 1024;
                    const MAX_HEIGHT = 1024;
                    if (width > height) {
                        if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
                    } else {
                        if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
                    resolve(compressedDataUrl.split(',')[1]);
                };
                img.onerror = (error) => reject(error);
            };
            reader.onerror = (error) => reject(error);
        });
    }

    // O Gemini roda somente no backend: o navegador envia a sessão, nunca a chave da API.
    async analyzeAndBuildPrompt(avatarBase64, refBase64, params, accessToken, avatar2Base64 = null) {
        let systemPrompt = "";

        if (this.mode === 'render') {
            systemPrompt = `
You are an Identity Transfer Engineer and Photorealistic Portrait Director.
Your task is to convert the provided avatar into a photorealistic human while preserving its visual identity.

=========================
IDENTITY PRIORITY
=========================
The reference image completely defines the character. Preserve overall identity, facial geometry, tattoos, piercings, accessories, jewelry. Do not redesign the character.

=========================
USER OVERRIDES
=========================
• Skin Texture: ${params.pele}
• Hairstyle/Color Modifier: ${params.cabelo}
• Facial Expression: ${params.expressao}
• Lighting / Mood: ${params.iluminacao}
• Background / Setting: ${params.fundo}
• Photography Style: ${params.estilo}
• Facial Fidelity Target: Level ${params.rosto}

=========================
REALISM & SAFETY
=========================
Replace only the rendering style. Output only an optimized English prompt for ${params.iaAlvo}.
CRITICAL SAFETY RULE: DO NOT include any words that could trigger NSFW, violence, or suggestive content filters. Keep the prompt extremely clean and safe for work, otherwise the image generator will block it and return a black image.
`;
        } else if (this.mode === 'reference') {
            systemPrompt = `
You are an Identity Fusion Engineer specialized in multi-reference image generation.

=========================
CRITICAL RULE: SINGLE SUBJECT ONLY
=========================
The final image MUST contain EXACTLY ONE (1) person.
NEVER generate two people side-by-side. You must REPLACE the subject in Image 2 with the identity of Image 1.

=========================
REFERENCE HIERARCHY
=========================
IMAGE 1: Character Identity (HIGHEST PRIORITY - Face, tattoos, piercings).
IMAGE 2: Scene Reference (SECONDARY PRIORITY - Pose, framing, background).

=========================
USER OVERRIDES
=========================
• Clothing Instructions: ${params.roupa}
• Skin Texture: ${params.pele}
• Hairstyle/Color Modifier: ${params.cabelo}
• Facial Expression: ${params.expressao}
• Lighting / Mood: ${params.iluminacao}
• Background Override: ${params.fundo}
• Photography Style: ${params.estilo}

Output only an optimized English prompt for ${params.iaAlvo}.
`;
        } else if (this.mode === 'couple') {
            systemPrompt = `
You are an Identity Fusion Engineer specialized in complex multi-subject image generation.

=========================
CRITICAL RULE: EXACTLY TWO SUBJECTS (COUPLE)
=========================
The final image MUST contain EXACTLY TWO (2) people interacting exactly as shown in Image 3.

=========================
REFERENCE HIERARCHY
=========================
IMAGE 1: Identity of Person A (Left/Primary subject).
IMAGE 2: Identity of Person B (Right/Secondary subject).
IMAGE 3: Scene Reference (Pose, interaction, background, lighting).

=========================
FUSION INSTRUCTIONS
=========================
1. Replace one person in Image 3 with the EXACT identity, facial features, tattoos, and styling of Image 1.
2. Replace the other person in Image 3 with the EXACT identity, facial features, tattoos, and styling of Image 2.
3. Maintain the physical interaction, framing, and environment of Image 3.

=========================
USER OVERRIDES
=========================
• Skin Texture: ${params.pele}
• Lighting / Mood: ${params.iluminacao}
• Background Override: ${params.fundo}
• Photography Style: ${params.estilo}

Produce a real photograph. Hollywood editorial quality. 8K. RAW. Output only an optimized English prompt for ${params.iaAlvo}.
`;
        }

        const customRules = params.customPrompt ? `\n=========================\nADDITIONAL USER REQUESTS\n=========================\nImplement the following details precisely: ${params.customPrompt}` : "";

        const finalSystemPrompt = systemPrompt + customRules;

        const input = [
            { type: "text", text: finalSystemPrompt },
            { type: "image", mime_type: "image/jpeg", data: avatarBase64 }
        ];

        // Ordem de injeção das imagens no Gemini: Texto -> Imagem 1 -> Imagem 2 -> Imagem 3
        if (this.mode === 'reference' && refBase64) {
            input.push({ type: "image", mime_type: "image/jpeg", data: refBase64 });
        } else if (this.mode === 'couple' && avatar2Base64 && refBase64) {
            input.push({ type: "image", mime_type: "image/jpeg", data: avatar2Base64 });
            input.push({ type: "image", mime_type: "image/jpeg", data: refBase64 });
        }

        const response = await fetch("/api/gemini", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${accessToken}`
            },
            body: JSON.stringify({ input })
        });

        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload.error || `Erro HTTP ${response.status} ao consultar o Gemini.`);
        }
        if (!payload.text) {
            throw new Error("O Gemini não retornou um prompt válido.");
        }

        return payload.text;
    }

    obfuscatePayload(promptText, iaAlvo) {
        // Bloco limpo. Sem provocar a IA com regras que ela pode ignorar.
        const cleanPayload = `
[LIFE_VU_RENDER_STREAM // TARGET: ${iaAlvo.toUpperCase()}]
${promptText}
[QUALITY: PHOTOREALISTIC_8K_RAW_DSLR]
        `.trim();
        
        const base64 = btoa(unescape(encodeURIComponent(cleanPayload)));
        return `--- BEGIN LIFE VU ENCRYPTED BUFFER ---\n${base64}\n--- END LIFE VU BUFFER ---`;
    }

    async generateFinalCopyPaste(avatarBase64, refBase64, params, accessToken, avatar2Base64 = null) {
        const optimalPrompt = await this.analyzeAndBuildPrompt(avatarBase64, refBase64, params, accessToken, avatar2Base64);
        return this.obfuscatePayload(optimalPrompt, params.iaAlvo);
    }
}

// Provider experimental preservado para testes futuros. Não participa do fluxo da LifeVU.
class NvidiaProvider {
    static async generateImage(prompt, options = {}) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 65000);

        try {
            const baseUrl = options.baseUrl || "http://localhost:3000";
            
            const response = await fetch(`${baseUrl}/api/nvidia`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ prompt }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || `Erro HTTP ${response.status}`);
            }

            if (!data.result) {
                throw new Error("Resposta inválida da NVIDIA.");
            }

            return data.result;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error("Timeout na comunicação com o backend (NVIDIA).");
            }
            throw error;
        }
    }
}

window.LifeVUEngine = LifeVUEngine;
window.NvidiaProvider = NvidiaProvider;
