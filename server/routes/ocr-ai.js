const express = require('express');

const router = express.Router();

function getVisionConfig() {
    if (process.env.DASHSCOPE_API_KEY) {
        return {
            provider: 'dashscope',
            apiKey: process.env.DASHSCOPE_API_KEY,
            model: process.env.DASHSCOPE_VISION_MODEL || 'qwen3.6-plus',
            url: process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
        };
    }

    if (process.env.GEMINI_API_KEY) {
        const model = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';
        return {
            provider: 'gemini',
            apiKey: process.env.GEMINI_API_KEY,
            model,
            url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`
        };
    }

    if (
        process.env.AZURE_OPENAI_ENDPOINT &&
        process.env.AZURE_OPENAI_API_KEY &&
        process.env.AZURE_OPENAI_DEPLOYMENT
    ) {
        const endpoint = String(process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/+$/, '');
        const deployment = String(process.env.AZURE_OPENAI_DEPLOYMENT || '').trim();
        const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-10-21';
        return {
            provider: 'azure-openai',
            apiKey: process.env.AZURE_OPENAI_API_KEY,
            deployment,
            apiVersion,
            url: `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`
        };
    }

    if (process.env.OCR_VISION_API_KEY && process.env.OCR_VISION_MODEL) {
        return {
            provider: 'custom',
            apiKey: process.env.OCR_VISION_API_KEY,
            model: process.env.OCR_VISION_MODEL,
            url: process.env.OCR_VISION_BASE_URL || 'https://api.openai.com/v1/chat/completions'
        };
    }

    if (process.env.OPENAI_API_KEY) {
        return {
            provider: 'openai',
            apiKey: process.env.OPENAI_API_KEY,
            model: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini',
            url: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions'
        };
    }

    if (process.env.GITHUB_TOKEN && process.env.GITHUB_MODELS_MODEL) {
        return {
            provider: 'github-models',
            apiKey: process.env.GITHUB_TOKEN,
            model: process.env.GITHUB_MODELS_MODEL,
            url: process.env.GITHUB_MODELS_URL || 'https://models.inference.ai.azure.com/chat/completions'
        };
    }

    return null;
}

function extractMessageText(payload) {
    const message = payload && payload.choices && payload.choices[0] && payload.choices[0].message;
    const content = message && message.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .map(part => {
                if (!part) return '';
                if (typeof part === 'string') return part;
                if (typeof part.text === 'string') return part.text;
                return '';
            })
            .join('\n')
            .trim();
    }
    return '';
}

function extractGeminiText(payload) {
    const candidates = Array.isArray(payload && payload.candidates) ? payload.candidates : [];
    const parts = candidates[0] && candidates[0].content && Array.isArray(candidates[0].content.parts)
        ? candidates[0].content.parts
        : [];
    return parts
        .map(part => String(part && part.text || ''))
        .join('\n')
        .trim();
}

function parseJsonObject(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;

    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : raw;

    try {
        return JSON.parse(candidate);
    } catch (_) {
        const objectMatch = candidate.match(/\{[\s\S]*\}/);
        if (!objectMatch) return null;
        try {
            return JSON.parse(objectMatch[0]);
        } catch (_) {
            return null;
        }
    }
}

function normalizeSentence(text) {
    return String(text || '')
        .replace(/^\s*\d{1,2}[.\s、:]+/, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function sanitizeSentences(list) {
    const seen = new Set();
    return (Array.isArray(list) ? list : [])
        .map(normalizeSentence)
        .filter(item => item && /[A-Za-z]{2,}/.test(item))
        .filter(item => {
            const key = item.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

async function callVisionModel(imageData, fileName, hintText) {
    const config = getVisionConfig();
    if (!config) {
        return { available: false, sentences: [] };
    }

    const prompt = [
        'Read this English exercise image carefully.',
        'If the image is a numbered sentence-translation exercise, extract the COMPLETE English sentence after each Arabic numeral.',
        'Do not truncate sentences. Preserve punctuation, apostrophes, slashes, and choice forms like keep/kept or made/makes.',
        'Ignore Chinese translations and headers except to decide whether the exercise is about sentences.',
        'If the image is not a sentence exercise, return an empty array.',
        'Return ONLY JSON in this exact shape: {"sentences":["..."]}.',
        fileName ? `File name hint: ${fileName}` : '',
        hintText ? `OCR hint text: ${String(hintText).slice(0, 4000)}` : ''
    ].filter(Boolean).join('\n');

    if (config.provider === 'gemini') {
        const dataUrlMatch = imageData.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,(.+)$/);
        if (!dataUrlMatch) {
            throw new Error('Invalid image data URL');
        }

        const response = await fetch(config.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 900,
                    responseMimeType: 'application/json'
                },
                contents: [
                    {
                        role: 'user',
                        parts: [
                            { text: prompt },
                            {
                                inlineData: {
                                    mimeType: dataUrlMatch[1],
                                    data: dataUrlMatch[2]
                                }
                            }
                        ]
                    }
                ]
            })
        });

        if (!response.ok) {
            const message = await response.text().catch(() => '');
            throw new Error(`Vision API failed: ${response.status} ${message}`.trim());
        }

        const payload = await response.json();
        const parsed = parseJsonObject(extractGeminiText(payload));
        return {
            available: true,
            provider: config.provider,
            sentences: sanitizeSentences(parsed && parsed.sentences)
        };
    }

    const headers = {
        'Content-Type': 'application/json'
    };
    if (config.provider === 'azure-openai') {
        headers['api-key'] = config.apiKey;
    } else {
        headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    const imageContent = config.provider === 'dashscope'
        ? { type: 'image_url', image_url: imageData }
        : { type: 'image_url', image_url: { url: imageData } };

    const body = {
        temperature: 0.1,
        max_tokens: 900,
        messages: [
            {
                role: 'system',
                content: 'You extract complete English exercise sentences from images and respond with JSON only.'
            },
            {
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    imageContent
                ]
            }
        ]
    };
    if (config.provider !== 'azure-openai') {
        body.model = config.model;
    }

    const response = await fetch(config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw new Error(`Vision API failed: ${response.status} ${message}`.trim());
    }

    const payload = await response.json();
    const parsed = parseJsonObject(extractMessageText(payload));
    return {
        available: true,
        provider: config.provider,
        sentences: sanitizeSentences(parsed && parsed.sentences)
    };
}

router.post('/ai-sentences', async (req, res) => {
    try {
        const imageData = String(req.body && req.body.imageData || '').trim();
        const fileName = String(req.body && req.body.fileName || '').trim();
        const hintText = String(req.body && req.body.hintText || '').trim();

        if (!imageData.startsWith('data:image/')) {
            return res.status(400).json({ error: 'imageData is required' });
        }

        const result = await callVisionModel(imageData, fileName, hintText);
        if (!result.available) {
            return res.status(503).json({ error: 'AI OCR not configured' });
        }

        return res.json({
            sentences: result.sentences,
            provider: result.provider || 'unknown'
        });
    } catch (err) {
        console.warn('[ocr-ai] request failed:', err.message);
        return res.status(500).json({ error: 'AI OCR failed' });
    }
});

module.exports = router;
