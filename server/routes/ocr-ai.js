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

function normalizeCn(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
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

function sanitizeStructuredItems(list) {
    const seen = new Set();
    return (Array.isArray(list) ? list : [])
        .map(item => {
            if (typeof item === 'string') {
                return { en: normalizeSentence(item), cn: '' };
            }
            return {
                en: normalizeSentence(item && item.en),
                cn: normalizeCn(item && item.cn)
            };
        })
        .filter(item => item.en && /[A-Za-z]{2,}/.test(item.en))
        .filter(item => {
            const key = item.en.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function sanitizeStructure(payload) {
    const section = ['words', 'phrases', 'sentences', 'mixed'].includes(payload && payload.section)
        ? payload.section
        : 'mixed';
    return {
        section,
        words: sanitizeStructuredItems(payload && payload.words),
        phrases: sanitizeStructuredItems(payload && payload.phrases),
        sentences: sanitizeStructuredItems(payload && payload.sentences)
    };
}

function buildVisionPrompt(fileName, hintText, expectedSection = '', expectedCount = 0) {
    const expected = expectedSection ? `Expected section hint: ${expectedSection}` : '';
    const expectedCountHint = expectedCount > 0 ? `Expected numbered item count: ${expectedCount}` : '';
    return [
        'Read this English exercise image carefully.',
        'Use the Chinese title/instruction in the image as the highest-priority signal to decide whether the content belongs to words, phrases, or sentences.',
        'If the image title says 短语 / 词组 / 课文短语翻译, put the extracted items in phrases.',
        'If the image title says 句子 / 根据句子意思和提示翻译句子 / 完成句子, put the extracted items in sentences.',
        'If the image title says 单词 / 词汇, put the extracted items in words.',
        'For numbered sentence exercises, extract the COMPLETE English sentence after each Arabic numeral. Never truncate.',
        'Preserve punctuation, apostrophes, slashes, ellipsis, and choice forms like keep/kept, made/makes, fill...with....',
        'For every extracted item, provide a concise Chinese translation in cn.',
        'If a section is absent, return an empty array for it.',
        'Never output truncated prefixes like "Tom made" or "Love can give" when the full sentence is visible in the image.',
        'Return ONLY JSON in this exact shape: {"section":"words|phrases|sentences|mixed","words":[{"en":"","cn":""}],"phrases":[{"en":"","cn":""}],"sentences":[{"en":"","cn":""}]}.',
        fileName ? `File name hint: ${fileName}` : '',
        expected,
        expectedCountHint,
        hintText ? `OCR hint text: ${String(hintText).slice(0, 5000)}` : ''
    ].filter(Boolean).join('\n');
}

async function callVisionModel(imageData, fileName, hintText, expectedSection = '', expectedCount = 0) {
    const config = getVisionConfig();
    if (!config) {
        return { available: false, section: 'mixed', words: [], phrases: [], sentences: [] };
    }

    const prompt = buildVisionPrompt(fileName, hintText, expectedSection, expectedCount);

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
        const parsed = sanitizeStructure(parseJsonObject(extractGeminiText(payload)) || {});
        return {
            available: true,
            provider: config.provider,
            ...parsed
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
    const parsed = sanitizeStructure(parseJsonObject(extractMessageText(payload)) || {});
    return {
        available: true,
        provider: config.provider,
        ...parsed
    };
}

function flattenSentences(result) {
    if (!result) return [];
    if (Array.isArray(result.sentences)) {
        return result.sentences.map(item => typeof item === 'string' ? item : item.en).filter(Boolean);
    }
    return [];
}

router.post('/ai-sentences', async (req, res) => {
    try {
        const imageData = String(req.body && req.body.imageData || '').trim();
        const fileName = String(req.body && req.body.fileName || '').trim();
        const hintText = String(req.body && req.body.hintText || '').trim();
        const expectedSection = String(req.body && req.body.expectedSection || '').trim();
        const expectedCount = Number(req.body && req.body.expectedCount) || 0;

        if (!imageData.startsWith('data:image/')) {
            return res.status(400).json({ error: 'imageData is required' });
        }

        const result = await callVisionModel(imageData, fileName, hintText, expectedSection, expectedCount);
        if (!result.available) {
            return res.status(503).json({ error: 'AI OCR not configured' });
        }

        return res.json({
            section: result.section,
            words: result.words,
            phrases: result.phrases,
            sentences: result.sentences,
            sentenceTexts: flattenSentences(result),
            provider: result.provider || 'unknown'
        });
    } catch (err) {
        console.warn('[ocr-ai] request failed:', err.message);
        return res.status(500).json({ error: 'AI OCR failed' });
    }
});

function getDeepSeekConfig() {
    if (!process.env.DEEPSEEK_API_KEY) return null;
    return {
        apiKey: process.env.DEEPSEEK_API_KEY,
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        url: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/chat/completions'
    };
}

function buildClassifyPrompt(items) {
    const lines = items.map((item, idx) => {
        const en = String(item.en || '').replace(/\s+/g, ' ').trim();
        const cn = String(item.cn || '').replace(/\s+/g, ' ').trim();
        return `${idx + 1}. en="${en}"${cn ? ` cn="${cn}"` : ''}`;
    });
    return [
        'You classify English study items extracted from Chinese textbook OCR.',
        'For each numbered item, decide if it is best practiced as:',
        '  - "word"     : a single English word (may include hyphen, e.g. "well-known")',
        '  - "phrase"   : a fixed expression of 2-7 words, NOT a complete sentence (no subject+verb+object forming a full clause), e.g. "look forward to", "make up of"',
        '  - "sentence" : a complete English sentence with subject and verb, usually ending with . ? !',
        'Use the meaning, length, and grammatical completeness to decide. Ignore item numbering.',
        'Preserve the original order. The output array length MUST match the input length.',
        'Return ONLY JSON in this exact shape: {"classifications":[{"index":1,"type":"word|phrase|sentence"}, ...]}',
        '',
        'Items:',
        ...lines
    ].join('\n');
}

async function callDeepSeekClassify(items) {
    const config = getDeepSeekConfig();
    if (!config) return null;

    const prompt = buildClassifyPrompt(items);
    const response = await fetch(config.url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
            model: config.model,
            temperature: 0,
            max_tokens: Math.min(4000, 60 + items.length * 25),
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: 'You are a strict English text classifier. Respond with JSON only.' },
                { role: 'user', content: prompt }
            ]
        })
    });

    if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw new Error(`DeepSeek classify failed: ${response.status} ${message}`.trim());
    }

    const payload = await response.json();
    const parsed = parseJsonObject(extractMessageText(payload));
    const list = parsed && Array.isArray(parsed.classifications) ? parsed.classifications : [];
    const allowed = new Set(['word', 'phrase', 'sentence']);
    const byIndex = new Map();
    list.forEach(entry => {
        const idx = Number(entry && entry.index);
        const type = String(entry && entry.type || '').toLowerCase();
        if (Number.isFinite(idx) && allowed.has(type)) byIndex.set(idx, type);
    });
    return items.map((_, i) => byIndex.get(i + 1) || null);
}

router.post('/ai-classify', async (req, res) => {
    try {
        const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
        const cleaned = items
            .map(it => ({ en: String(it && it.en || '').trim(), cn: String(it && it.cn || '').trim() }))
            .filter(it => it.en);

        if (cleaned.length === 0) {
            return res.status(400).json({ error: 'items is required' });
        }

        if (!getDeepSeekConfig()) {
            return res.status(503).json({ error: 'DeepSeek not configured' });
        }

        if (cleaned.length > 200) {
            return res.status(413).json({ error: 'Too many items (max 200)' });
        }

        const types = await callDeepSeekClassify(cleaned);
        if (!types) {
            return res.status(503).json({ error: 'DeepSeek not configured' });
        }

        return res.json({
            provider: 'deepseek',
            classifications: cleaned.map((it, i) => ({
                index: i + 1,
                en: it.en,
                type: types[i] || null
            }))
        });
    } catch (err) {
        console.warn('[ocr-ai] classify failed:', err.message);
        return res.status(500).json({ error: 'AI classify failed' });
    }
});

module.exports = router;
