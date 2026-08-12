import { NextResponse } from 'next/server';

export async function POST(req: Request) {
    try {
        const { prompt } = await req.json();
        
        if (!prompt) {
            return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
        }

        const apiKey = process.env.NVIDIA_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: "NVIDIA_API_KEY não configurada" }, { status: 500 });
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

        const response = await fetch("https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                prompt: prompt,
                width: 1024,
                height: 1024,
                seed: Math.floor(Math.random() * 10000),
                steps: 25
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`NVIDIA API Error ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        
        // A API pode retornar a imagem em diferentes caminhos dependendo do modelo
        let resultImage = null;
        if (data?.image) resultImage = data.image; // Padrão de algumas APIs NVIDIA
        else if (data?.artifacts?.[0]?.base64) resultImage = data.artifacts[0].base64; // Padrão NIM
        else if (data?.data?.[0]?.b64_json) resultImage = data.data[0].b64_json; // Padrão OpenAI SDK
        else if (data?.data?.[0]?.url) resultImage = data.data[0].url; // Caso retorne link
        else if (typeof data === 'string' && data.startsWith('/9j/')) resultImage = data;
        
        if (!resultImage) {
            console.error("Resposta da NVIDIA:", data);
            throw new Error("Resposta inválida da NVIDIA (Sem Imagem na estrutura json)");
        }

        // Se for b64, adicionamos o prefixo data:image para o html conseguir renderizar
        const finalImage = resultImage.startsWith("http") ? resultImage : `data:image/jpeg;base64,${resultImage}`;

        return NextResponse.json({ result: finalImage });

    } catch (error: unknown) {
        if (error instanceof Error && error.name === 'AbortError') {
            return NextResponse.json({ error: "Timeout na comunicação com a API da NVIDIA." }, { status: 504 });
        }
        console.error("NVIDIA Provider Error:", error);
        const message = error instanceof Error ? error.message : "Falha ao gerar imagem";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
