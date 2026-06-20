const express = require('express');
const { authenticate, requireAdmin } = require('../auth');

const router = express.Router();

router.use(authenticate);
router.use(requireAdmin);

// ---------------------------------------------------------------------------
// Lazy-loaded document parsers. These are optional dependencies; if they are
// not installed the corresponding file type simply returns empty text and the
// caller surfaces a friendly error.
// ---------------------------------------------------------------------------
function tryRequire(name) {
    try {
        return require(name);
    } catch (_) {
        return null;
    }
}

const MAX_TEXT_CHARS = 60000;

async function extractPdfText(buffer) {
    const pdfParse = tryRequire('pdf-parse');
    if (!pdfParse) {
        throw new Error('PDF 解析依赖未安装（请运行 npm install pdf-parse）');
    }
    const data = await pdfParse(buffer);
    return String(data && data.text || '');
}

async function extractDocxText(buffer) {
    const mammoth = tryRequire('mammoth');
    if (!mammoth) {
        throw new Error('Word 解析依赖未安装（请运行 npm install mammoth）');
    }
    const result = await mammoth.extractRawText({ buffer });
    return String(result && result.value || '');
}

function extractXlsxText(buffer) {
    const xlsx = tryRequire('xlsx');
    if (!xlsx) {
        throw new Error('Excel 解析依赖未安装（请运行 npm install xlsx）');
    }
    const wb = xlsx.read(buffer, { type: 'buffer' });
    const lines = [];
    wb.SheetNames.forEach((sheetName) => {
        const sheet = wb.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
        rows.forEach((row) => {
            const cells = (Array.isArray(row) ? row : [])
                .map(c => String(c == null ? '' : c).trim())
                .filter(Boolean);
            if (cells.length) lines.push(cells.join('\t'));
        });
    });
    return lines.join('\n');
}

function extractPlainText(buffer) {
    return buffer.toString('utf8');
}

function detectFileType(fileName, mimeType) {
    const name = String(fileName || '').toLowerCase();
    const mime = String(mimeType || '').toLowerCase();
    if (name.endsWith('.pdf') || mime.includes('pdf')) return 'pdf';
    if (name.endsWith('.docx') || mime.includes('officedocument.wordprocessingml')) return 'docx';
    if (name.endsWith('.doc') || mime === 'application/msword') return 'doc';
    if (name.endsWith('.xlsx') || name.endsWith('.xlsm') || mime.includes('spreadsheetml')) return 'xlsx';
    if (name.endsWith('.xls') || mime === 'application/vnd.ms-excel') return 'xls';
    if (name.endsWith('.csv') || mime.includes('csv')) return 'csv';
    if (name.endsWith('.txt') || mime.startsWith('text/')) return 'txt';
    return '';
}

async function extractTextFromBuffer(buffer, fileType) {
    switch (fileType) {
        case 'pdf':
            return extractPdfText(buffer);
        case 'docx':
            return extractDocxText(buffer);
        case 'doc':
            // Legacy binary .doc is not supported by mammoth; try best-effort text.
            throw new Error('暂不支持旧版 .doc，请另存为 .docx 后再上传');
        case 'xlsx':
        case 'xls':
            return extractXlsxText(buffer);
        case 'csv':
        case 'txt':
            return extractPlainText(buffer);
        default:
            throw new Error('不支持的文件类型，请上传 PDF / Word(docx) / Excel(xlsx/xls) / CSV / TXT');
    }
}

// ---------------------------------------------------------------------------
// File name hints: e.g. "2025春七下新外研版英语单词中译英Unit1.pdf"
// ---------------------------------------------------------------------------
const CN_NUM = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };

function deriveHintsFromFileName(fileName) {
    const base = String(fileName || '').replace(/\.[^.]+$/, '');
    const hints = { name: base, publisher: '', grade: '', book: '', unit_no: 0 };

    const unitMatch = base.match(/Unit\s*(\d+)/i) || base.match(/第\s*(\d+)\s*单元/);
    if (unitMatch) hints.unit_no = parseInt(unitMatch[1], 10) || 0;

    const pub = base.match(/(外研版|人教版|译林版|北师大版|牛津版|新外研版|沪教版|冀教版|鲁教版)/);
    if (pub) hints.publisher = pub[1];

    // grade like 七下 / 七年级下 / 八上
    const gradeCn = base.match(/([一二三四五六七八九])\s*(?:年级)?\s*([上下])/);
    if (gradeCn) {
        const g = CN_NUM[gradeCn[1]] || 0;
        const half = gradeCn[2] === '上' ? '上' : '下';
        if (g) {
            hints.grade = `${gradeCn[1]}年级${half}`;
            hints.book = half === '上' ? '上册' : '下册';
        }
    }
    return hints;
}

// ---------------------------------------------------------------------------
// LLM helpers (text completion). Prefer DeepSeek, then OpenAI-compatible chat
// providers reused from the same env vars as the OCR feature.
// ---------------------------------------------------------------------------
function getTextModelConfig() {
    if (process.env.DEEPSEEK_API_KEY) {
        return {
            provider: 'deepseek',
            apiKey: process.env.DEEPSEEK_API_KEY,
            model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
            url: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/chat/completions',
            authHeader: 'bearer'
        };
    }
    if (process.env.OPENAI_API_KEY) {
        return {
            provider: 'openai',
            apiKey: process.env.OPENAI_API_KEY,
            model: process.env.OPENAI_MODEL || process.env.OPENAI_VISION_MODEL || 'gpt-4.1-mini',
            url: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions',
            authHeader: 'bearer'
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
            url: `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`,
            authHeader: 'api-key'
        };
    }
    if (process.env.DASHSCOPE_API_KEY) {
        return {
            provider: 'dashscope',
            apiKey: process.env.DASHSCOPE_API_KEY,
            model: process.env.DASHSCOPE_TEXT_MODEL || process.env.DASHSCOPE_VISION_MODEL || 'qwen-plus',
            url: process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
            authHeader: 'bearer'
        };
    }
    if (process.env.GITHUB_TOKEN && process.env.GITHUB_MODELS_MODEL) {
        return {
            provider: 'github-models',
            apiKey: process.env.GITHUB_TOKEN,
            model: process.env.GITHUB_MODELS_MODEL,
            url: process.env.GITHUB_MODELS_URL || 'https://models.inference.ai.azure.com/chat/completions',
            authHeader: 'bearer'
        };
    }
    if (process.env.OCR_VISION_API_KEY && process.env.OCR_VISION_MODEL) {
        return {
            provider: 'custom',
            apiKey: process.env.OCR_VISION_API_KEY,
            model: process.env.OCR_VISION_MODEL,
            url: process.env.OCR_VISION_BASE_URL || 'https://api.openai.com/v1/chat/completions',
            authHeader: 'bearer'
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
            .map(part => (part && typeof part.text === 'string') ? part.text : (typeof part === 'string' ? part : ''))
            .join('\n')
            .trim();
    }
    return '';
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

async function callTextModel(systemPrompt, userPrompt) {
    const config = getTextModelConfig();
    if (!config) return null;

    const headers = { 'Content-Type': 'application/json' };
    if (config.authHeader === 'api-key') headers['api-key'] = config.apiKey;
    else headers['Authorization'] = `Bearer ${config.apiKey}`;

    const body = {
        temperature: 0.2,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ]
    };
    if (config.provider !== 'azure-openai') body.model = config.model;

    const response = await fetch(config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw new Error(`Text model failed: ${response.status} ${message}`.trim());
    }

    const payload = await response.json();
    return { provider: config.provider, text: extractMessageText(payload) };
}

function buildGeneratePrompt(rawText, hints) {
    const hintLines = [
        hints.name ? `Source file (without extension): ${hints.name}` : '',
        hints.publisher ? `Detected publisher hint: ${hints.publisher}` : '',
        hints.grade ? `Detected grade hint: ${hints.grade}` : '',
        hints.book ? `Detected book hint: ${hints.book}` : '',
        hints.unit_no ? `Detected unit number hint: ${hints.unit_no}` : ''
    ].filter(Boolean).join('\n');

    return [
        'You convert raw text extracted from a Chinese English-textbook material into typing-practice data.',
        'The material may contain vocabulary words, fixed phrases, or full sentences, often with Chinese translations.',
        'Classify every English item as exactly one of:',
        '  - word     : a single English word (a hyphenated word counts as one).',
        '  - phrase   : a fixed expression of 2-7 words that is NOT a complete sentence.',
        '  - sentence : a complete English sentence (subject + verb), usually ending with . ? or !',
        'For every item provide its Chinese meaning in "cn". If the source already gives a translation, use it; otherwise translate accurately.',
        'Remove leading numbering (e.g. "1.", "①"), page headers, and noise. Do not invent items that are not in the text.',
        'Also infer metadata: a concise unit name, publisher, grade, book (上册/下册), and unit_no (integer).',
        'Use the file-name hints below when the text itself is ambiguous.',
        'Return ONLY JSON in this exact shape:',
        '{"name":"","publisher":"","grade":"","book":"","unit_no":0,"words":[{"en":"","cn":""}],"phrases":[{"en":"","cn":""}],"sentences":[{"en":"","cn":""}]}',
        '',
        hintLines,
        '',
        'Raw extracted text:',
        '"""',
        String(rawText || '').slice(0, MAX_TEXT_CHARS),
        '"""'
    ].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// Sanitizers
// ---------------------------------------------------------------------------
function normalizeEn(text) {
    return String(text || '')
        .replace(/^\s*(?:\d{1,3}|[①-⑳])[.\u3001\):、\s]+/, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeCn(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

function classifyEnglish(en) {
    const text = String(en || '').trim();
    if (!text) return null;
    if (/[.?!]$/.test(text) && /\s/.test(text)) return 'sentence';
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= 1) return 'word';
    if (words.length >= 8) return 'sentence';
    return 'phrase';
}

function sanitizeItems(list) {
    const seen = new Set();
    return (Array.isArray(list) ? list : [])
        .map(item => {
            if (typeof item === 'string') return { en: normalizeEn(item), cn: '' };
            return { en: normalizeEn(item && item.en), cn: normalizeCn(item && item.cn) };
        })
        .filter(item => item.en && /[A-Za-z]{2,}/.test(item.en))
        .filter(item => {
            const key = item.en.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function sanitizeGenerated(payload, hints) {
    const out = {
        name: normalizeCn(payload && payload.name) || hints.name || '智能录入单元',
        publisher: normalizeCn(payload && payload.publisher) || hints.publisher || '',
        grade: normalizeCn(payload && payload.grade) || hints.grade || '',
        book: normalizeCn(payload && payload.book) || hints.book || '',
        unit_no: parseInt(payload && payload.unit_no, 10) || hints.unit_no || 0,
        words: sanitizeItems(payload && payload.words),
        phrases: sanitizeItems(payload && payload.phrases),
        sentences: sanitizeItems(payload && payload.sentences)
    };
    return out;
}

// Section-header lines that should never become practice items.
const HEADER_EN = new Set(['word', 'words', 'phrase', 'phrases', 'sentence', 'sentences', 'vocabulary', 'english', 'chinese', 'meaning', 'translation', 'no']);

function isSectionHeaderLine(line, en) {
    const enKey = String(en || '').toLowerCase().replace(/[^a-z]/g, '');
    if (HEADER_EN.has(enKey)) {
        // Only treat as header when there is no extra English content.
        const englishWords = String(en || '').split(/\s+/).filter(Boolean);
        if (englishWords.length <= 1) return true;
    }
    return false;
}

// Heuristic fallback when no LLM is configured: split text into lines and try to
// separate the English part from the Chinese part, then classify by structure.
function heuristicGenerate(rawText, hints) {
    const result = { words: [], phrases: [], sentences: [] };
    const seen = new Set();
    const lines = String(rawText || '')
        .split(/\r?\n/)
        .map(l => l.replace(/\t+/g, ' ').trim())
        .filter(Boolean);

    for (const line of lines) {
        const cleaned = normalizeEn(line);
        const enMatch = cleaned.match(/[A-Za-z][A-Za-z'’.,!?;:\-\/ ]*[A-Za-z.!?]/);
        if (!enMatch) continue;
        const en = enMatch[0].replace(/\s+/g, ' ').trim();
        if (!en || !/[A-Za-z]{2,}/.test(en)) continue;
        if (isSectionHeaderLine(line, en)) continue;
        const cn = (line.match(/[\u4e00-\u9fff][\u4e00-\u9fff\u3001\uff0c\uff1b\u3002\uff08\uff09\s]*/g) || [])
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        const key = en.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const kind = classifyEnglish(en);
        if (kind === 'word') result.words.push({ en, cn });
        else if (kind === 'phrase') result.phrases.push({ en, cn });
        else result.sentences.push({ en, cn });
    }

    return sanitizeGenerated({ ...hints, ...result }, hints);
}

// ---------------------------------------------------------------------------
// POST /api/material/generate
// Body: { fileName, mimeType, fileData (base64, may be a data URL) }
// ---------------------------------------------------------------------------
router.post('/generate', async (req, res) => {
    try {
        const fileName = String(req.body && req.body.fileName || '').trim();
        const mimeType = String(req.body && req.body.mimeType || '').trim();
        let fileData = String(req.body && req.body.fileData || '');

        if (!fileData) {
            return res.status(400).json({ error: '缺少文件数据 Missing file data' });
        }

        const fileType = detectFileType(fileName, mimeType);
        if (!fileType) {
            return res.status(400).json({ error: '不支持的文件类型，请上传 PDF / Word(docx) / Excel(xlsx/xls) / CSV / TXT' });
        }

        // Strip data URL prefix if present.
        const commaIdx = fileData.indexOf(',');
        if (fileData.startsWith('data:') && commaIdx !== -1) {
            fileData = fileData.slice(commaIdx + 1);
        }

        let buffer;
        try {
            buffer = Buffer.from(fileData, 'base64');
        } catch (_) {
            return res.status(400).json({ error: '文件数据无法解码 Invalid file data' });
        }
        if (!buffer || buffer.length === 0) {
            return res.status(400).json({ error: '文件内容为空 Empty file' });
        }

        let rawText = '';
        try {
            rawText = await extractTextFromBuffer(buffer, fileType);
        } catch (err) {
            return res.status(422).json({ error: err.message || '文件解析失败 Failed to parse file' });
        }

        rawText = String(rawText || '').replace(/\u0000/g, '').trim();
        if (!rawText || !/[A-Za-z]{2,}/.test(rawText)) {
            return res.status(422).json({
                error: '未从文件中提取到可用的英文内容。请确认文件包含可选中的文字（非纯图片扫描）。'
            });
        }

        const hints = deriveHintsFromFileName(fileName);

        let generated = null;
        let provider = 'heuristic';

        if (getTextModelConfig()) {
            try {
                const llm = await callTextModel(
                    'You are a precise assistant that structures English learning materials and replies with JSON only.',
                    buildGeneratePrompt(rawText, hints)
                );
                const parsed = llm && parseJsonObject(llm.text);
                if (parsed) {
                    generated = sanitizeGenerated(parsed, hints);
                    provider = (llm && llm.provider) || 'llm';
                }
            } catch (err) {
                console.warn('[material] LLM generation failed, falling back:', err.message);
            }
        }

        if (!generated) {
            generated = heuristicGenerate(rawText, hints);
        }

        const total = generated.words.length + generated.phrases.length + generated.sentences.length;
        if (total === 0) {
            return res.status(422).json({
                error: '未能从文件中生成练习内容，请检查文件内容或换一份材料。'
            });
        }

        return res.json({
            provider,
            fileType,
            charCount: rawText.length,
            unit: generated
        });
    } catch (err) {
        console.warn('[material] generate failed:', err.message);
        return res.status(500).json({ error: '智能生成失败 Smart generation failed' });
    }
});

module.exports = router;
