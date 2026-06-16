/* ============================================
   OCR Module - Image upload and text recognition
   图片上传与文字识别模块
   
   Uses Tesseract.js to recognize English text
   from uploaded images (textbook photos, test papers).
   Includes smart structured parsing, proofreading,
   and save/load for unit practice.
   ============================================ */

const ImageOCR = (() => {
    let recognizedData = createEmptyRecognizedData();
    let previewObjectUrl = null;
    let translationRequestSeq = 0;
    let uploadedImageReferences = [];

    function createEmptyRecognizedData(raw = '') {
        return {
            unitName: '',
            publisher: '',
            grade: '',
            book: '',
            unitNo: 0,
            words: [],
            phrases: [],
            sentences: [],
            raw,
            _editingIdx: null,
            _editingServerId: null
        };
    }

    function cloneRecognizedData(data) {
        return {
            unitName: data.unitName || '',
            publisher: data.publisher || '',
            grade: data.grade || '',
            book: data.book || '',
            unitNo: data.unitNo || 0,
            words: (data.words || []).map(item => ({ ...item })),
            phrases: (data.phrases || []).map(item => ({ ...item })),
            sentences: (data.sentences || []).map(item => ({ ...item })),
            raw: data.raw || '',
            _editingIdx: data._editingIdx ?? null,
            _editingServerId: data._editingServerId ?? null
        };
    }

    function attachSourceReference(data, sourceRef) {
        ['words', 'phrases', 'sentences'].forEach(type => {
            data[type].forEach(item => {
                item._sourceRef = sourceRef ? { ...sourceRef } : null;
            });
        });
        return data;
    }

    function reclassifyForcedSectionItems(data, forceSection) {
        if (!forceSection) return data;

        const moved = [];
        ['words', 'phrases', 'sentences'].forEach(type => {
            data[type].forEach(item => moved.push({ ...item }));
            if (type !== forceSection) data[type] = [];
        });

        const dedupe = new Set();
        data[forceSection] = moved.filter(item => {
            const key = String(item.en || '').trim().toLowerCase();
            if (!key || dedupe.has(key)) return false;
            dedupe.add(key);
            return true;
        });

        return data;
    }

    function mergeRecognizedData(target, incoming) {
        if (!target.unitName && incoming.unitName) target.unitName = incoming.unitName;
        if (!target.publisher && incoming.publisher) target.publisher = incoming.publisher;
        if (!target.grade && incoming.grade) target.grade = incoming.grade;
        if (!target.book && incoming.book) target.book = incoming.book;
        if (!target.unitNo && incoming.unitNo) target.unitNo = incoming.unitNo;
        if (incoming.raw) {
            target.raw = target.raw ? `${target.raw}\n${incoming.raw}` : incoming.raw;
        }

        ['words', 'phrases', 'sentences'].forEach(type => {
            incoming[type].forEach(item => {
                const existing = target[type].find(entry => entry.en.toLowerCase() === item.en.toLowerCase());
                if (!existing) {
                    target[type].push({ ...item });
                    return;
                }
                if (!existing.cn && item.cn) existing.cn = item.cn;
                if (!existing._sourceRef && item._sourceRef) existing._sourceRef = { ...item._sourceRef };
            });
        });
    }

    function normalizeSentencePrefix(text) {
        return String(text || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function sanitizeItemForPersistence(item) {
        return {
            en: String(item && item.en || '').trim(),
            cn: String(item && item.cn || '').trim(),
            difficulty: Number(item && item.difficulty) || 1
        };
    }

    function buildPersistableUnit(unit) {
        return {
            ...unit,
            words: (unit.words || []).map(sanitizeItemForPersistence),
            phrases: (unit.phrases || []).map(sanitizeItemForPersistence),
            sentences: (unit.sentences || []).map(sanitizeItemForPersistence)
        };
    }

    function expandSentenceItemsFromFullOcr(data, fullOcrText) {
        if (!data || !Array.isArray(data.sentences) || data.sentences.length === 0) return data;

        const candidates = [...extractNumberedSentenceFallbacks(fullOcrText).values()];
        if (candidates.length === 0) return data;

        data.sentences = data.sentences.map(item => {
            const current = String(item.en || '').trim();
            if (!current) return item;

            const currentWords = countEnglishWords(current);
            const needsExpansion = currentWords <= 5 || !/[.!?]$/.test(current);
            if (!needsExpansion) return item;

            const currentPrefix = normalizeSentencePrefix(current);
            if (!currentPrefix) return item;

            let best = '';
            candidates.forEach(candidate => {
                const normalizedCandidate = normalizeSentencePrefix(candidate);
                if (!normalizedCandidate || normalizedCandidate === currentPrefix) return;
                if (!normalizedCandidate.startsWith(currentPrefix)) return;
                if (countEnglishWords(candidate) < currentWords + 2) return;
                if (!best || countEnglishWords(candidate) > countEnglishWords(best)) {
                    best = candidate;
                }
            });

            if (!best) return item;

            return {
                ...item,
                en: best,
                cn: autoTranslate(best),
                difficulty: countEnglishWords(best) <= 5 ? 2 : 3
            };
        });

        return data;
    }

    function detectSourceParseHint(fileName, rawOcrText) {
        const name = String(fileName || '').toLowerCase();
        const raw = String(rawOcrText || '');
        const compactRaw = raw.replace(/\s+/g, '');
        const normalizedRaw = raw.toLowerCase();
        const topLines = raw
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .slice(0, 8);
        const titleContext = topLines
            .filter(line => /[\u4e00-\u9fff]/.test(line) || /^[一二三四五六七八九十][、.]/.test(line))
            .join(' ');
        const normalizedTitleContext = titleContext.toLowerCase();
        const compactTitleContext = titleContext.replace(/\s+/g, '');

        const sentenceSignals = [
            '句子', '翻译句子', '根据句子意思', '完成句子', '英译汉', '汉译英',
            'translate the sentences', 'translate sentences', 'complete the sentences', 'sentence'
        ];
        const phraseSignals = ['短语', '词组', 'phrase', 'phrases'];
        const wordSignals = ['单词', '词汇', 'word', 'words', 'vocabulary'];

        const hasSignal = (signals) => signals.some(signal =>
            normalizedRaw.includes(signal.toLowerCase()) ||
            compactRaw.includes(signal.replace(/\s+/g, ''))
        );
        const hasFileNameSignal = (signals) => signals.some(signal => name.includes(signal.toLowerCase()));
        const hasTitleSignal = (signals) => signals.some(signal =>
            normalizedTitleContext.includes(signal.toLowerCase()) ||
            compactTitleContext.includes(signal.replace(/\s+/g, ''))
        );

        const hasSentenceTitleSignal = hasTitleSignal(sentenceSignals);
        const hasPhraseTitleSignal = hasTitleSignal(phraseSignals);
        const hasWordTitleSignal = hasTitleSignal(wordSignals);

        const hasSentenceSignal = hasSignal(sentenceSignals);
        const hasPhraseSignal = hasSignal(phraseSignals);
        const hasWordSignal = hasSignal(wordSignals);
        const hasSentenceFileNameSignal = hasFileNameSignal(sentenceSignals);
        const hasPhraseFileNameSignal = hasFileNameSignal(phraseSignals);
        const hasWordFileNameSignal = hasFileNameSignal(wordSignals);

        const titleSectionSignalCount = [hasWordTitleSignal, hasPhraseTitleSignal, hasSentenceTitleSignal].filter(Boolean).length;
        const bodySectionSignalCount = [hasWordSignal, hasPhraseSignal, hasSentenceSignal].filter(Boolean).length;
        const mixedSections = titleSectionSignalCount >= 2 || bodySectionSignalCount >= 2;
        const unitNameHint = stripFileExtension(fileName).match(/Unit\s*\d+[\s:.\-]*[A-Za-z][A-Za-z\s'-]*/i)?.[0]?.trim() || '';

        let forceSection = null;
        if (!mixedSections) {
            if (hasSentenceTitleSignal) forceSection = 'sentences';
            else if (hasPhraseTitleSignal) forceSection = 'phrases';
            else if (hasWordTitleSignal) forceSection = 'words';
            else if (hasSentenceSignal) forceSection = 'sentences';
            else if (hasPhraseSignal) forceSection = 'phrases';
            else if (hasWordSignal) forceSection = 'words';
        }

        const numberedLines = raw
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => /^\s*\d{1,2}[.\s、:]/.test(line) && /[A-Za-z]{2,}/.test(line));

        const sentenceLikeCount = numberedLines.filter(line => {
            const english = extractEnglish(line) || trimTrailingOcrNoise(line.replace(/^\s*\d{1,2}[.\s、:]*/g, '').trim());
            const wordCount = countEnglishWords(english);
            if (wordCount < 3) return false;
            if (wordCount >= 6) return true;
            if (/[,.!?]/.test(english)) return true;
            if (/^[A-Z]/.test(english)) return true;
            if (/^(i|we|you|he|she|it|they|this|that|these|those|my|our|his|her|their|tom|love|a|an|the|in|hard)\b/i.test(english)) return true;
            if (/\b(keep|kept|make|made|give|gave|love|loved|is|are|was|were|do|did|have|had|can|could|will|would|should|there|happy|work|working)\b/i.test(english)) return true;
            return false;
        }).length;

        const avgWords = numberedLines.length > 0
            ? numberedLines.reduce((sum, line) => {
                const english = extractEnglish(line) || trimTrailingOcrNoise(line.replace(/^\s*\d{1,2}[.\s、:]*/g, '').trim());
                return sum + countEnglishWords(english);
            }, 0) / numberedLines.length
            : 0;
        const phraseLikeCount = numberedLines.filter(line => {
            const english = extractEnglish(line) || trimTrailingOcrNoise(line.replace(/^\s*\d{1,2}[.\s、:]*/g, '').trim());
            return isLikelyPhraseCandidate(english);
        }).length;

        const strongSentenceContent = numberedLines.length >= 3 && (
            sentenceLikeCount >= Math.max(3, Math.ceil(numberedLines.length * 0.6)) ||
            avgWords >= 5 ||
            numberedLines.filter(line => {
                const english = extractEnglish(line) || trimTrailingOcrNoise(line.replace(/^\s*\d{1,2}[.\s、:]*/g, '').trim());
                return countEnglishWords(english) >= 5;
            }).length >= Math.max(3, numberedLines.length - 1)
        );
        const strongPhraseContent = numberedLines.length >= 3 && (
            phraseLikeCount >= Math.max(3, Math.ceil(numberedLines.length * 0.7)) &&
            sentenceLikeCount <= Math.floor(numberedLines.length * 0.4)
        );

        // Strong numbered phrase content can override a misleading file name,
        // but not an explicit sentence/word title recognized from the image itself.
        if (
            !hasSentenceTitleSignal &&
            !hasWordTitleSignal &&
            !hasSentenceSignal &&
            !hasWordSignal &&
            !hasSentenceFileNameSignal &&
            !hasWordFileNameSignal &&
            strongPhraseContent
        ) {
            forceSection = 'phrases';
        }

        // Strong numbered sentence content can override a misleading file name,
        // but not explicit phrase/word signals recognized from the image itself.
        if (
            !hasPhraseTitleSignal &&
            !hasWordTitleSignal &&
            !hasPhraseSignal &&
            !hasWordSignal &&
            !hasPhraseFileNameSignal &&
            !hasWordFileNameSignal &&
            strongSentenceContent
        ) {
            forceSection = 'sentences';
        }

        if (!forceSection && numberedLines.length >= 3 && !hasPhraseFileNameSignal && !hasWordFileNameSignal) {
            const sentenceStarters = /^(i|we|you|he|she|it|they|this|that|these|those|my|our|his|her|their|tom|love|a|an|the|in|hard)\b/i;
            const fallbackSentenceLikeCount = numberedLines.filter(line => {
                const english = extractEnglish(line) || trimTrailingOcrNoise(line.replace(/^\s*\d{1,2}[.\s、:]*/g, '').trim());
                const wordCount = countEnglishWords(english);
                if (wordCount < 3) return false;
                if (wordCount >= 6) return true;
                if (/[,.!?]/.test(english)) return true;
                if (/^[A-Z]/.test(english)) return true;
                if (sentenceStarters.test(english)) return true;
                if (/\b(keep|kept|make|made|give|gave|love|loved|is|are|was|were|do|did|have|had|can|could|will|would|should|there|happy|work|working)\b/i.test(english)) return true;
                return false;
            }).length;

            if (
                fallbackSentenceLikeCount >= Math.max(3, Math.ceil(numberedLines.length * 0.6)) ||
                avgWords >= 5
            ) {
                forceSection = 'sentences';
            }
        }

        if (!forceSection && !mixedSections) {
            if (hasSentenceFileNameSignal) forceSection = 'sentences';
            else if (hasPhraseFileNameSignal) forceSection = 'phrases';
            else if (hasWordFileNameSignal) forceSection = 'words';
        }

        return { forceSection, mixedSections, unitNameHint };
    }

    function createParseSeed(baseData) {
        const seed = createEmptyRecognizedData();
        if (!baseData) return seed;
        seed.unitName = baseData.unitName || '';
        seed.publisher = baseData.publisher || '';
        seed.grade = baseData.grade || '';
        seed.book = baseData.book || '';
        seed.unitNo = baseData.unitNo || 0;
        return seed;
    }

    function buildRecognizedDataFromAiStructure(aiResult, baseData, rawText = '') {
        const snapshot = recognizedData;
        recognizedData = createParseSeed(baseData);
        recognizedData.raw = rawText;

        ['words', 'phrases', 'sentences'].forEach(type => {
            (aiResult[type] || []).forEach(item => {
                addToSection(item.en, type, { forceSection: true, presetCn: item.cn || '' });
            });
        });

        autoTranslateAll();
        const parsed = cloneRecognizedData(recognizedData);
        recognizedData = snapshot;
        return parsed;
    }

    function detectExpectedNumberedItemCount(text) {
        const matches = [...String(text || '').matchAll(/(?:^|\s)(\d{1,2})[.\s、:]+/g)];
        if (matches.length === 0) return 0;
        return matches.reduce((max, match) => Math.max(max, Number(match[1]) || 0), 0);
    }

    function shouldUseAiForImage(parseHint, rawText, fileName = '') {
        const text = String(rawText || '').trim();
        const expectedCount = detectExpectedNumberedItemCount(text);
        if (parseHint && parseHint.mixedSections) return false;
        if (parseHint && parseHint.forceSection === 'sentences') return true;
        if (expectedCount > 0) return true;
        if (!text || countEnglishWords(text) < 3) return true;
        if (parseHint && (parseHint.forceSection === 'words' || parseHint.forceSection === 'phrases')) return false;
        if (/句子|sentence/i.test(fileName) || countEnglishWords(text) >= 12) return true;
        return false;
    }

    function needsSentenceAiRetry(aiResult, expectedCount = 0, expectedSection = '') {
        if (!aiResult || expectedSection !== 'sentences') return false;
        const sentences = Array.isArray(aiResult.sentences) ? aiResult.sentences : [];
        if (expectedCount > 0 && sentences.length < expectedCount) return true;
        return sentences.some(item => {
            const text = String(item && item.en || '').trim();
            const words = countEnglishWords(text);
            return words <= 4 || /\b(?:made\/makes me|can give|is like)\b\s*$/i.test(text);
        });
    }

    async function fetchAiStructureFromImage(imageData, fileName, hintText = '', expectedSection = '') {
        const expectedCount = detectExpectedNumberedItemCount(hintText);
        try {
            const requestAi = async (extraHint = '') => fetch('/api/ocr/ai-sentences', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    imageData,
                    fileName,
                    hintText: `${hintText}${extraHint}`,
                    expectedSection,
                    expectedCount
                })
            });

            const parseAi = async (response) => {
                if (!response.ok) return null;
                const data = await response.json();
                if (!data) return null;
                return {
                    section: data.section || 'mixed',
                    words: Array.isArray(data.words) ? data.words : [],
                    phrases: Array.isArray(data.phrases) ? data.phrases : [],
                    sentences: Array.isArray(data.sentences) ? data.sentences : []
                };
            };

            let aiResult = await parseAi(await requestAi(''));
            if (needsSentenceAiRetry(aiResult, expectedCount, expectedSection)) {
                aiResult = await parseAi(await requestAi(`\nRe-read the image. Output exactly ${expectedCount || 'all visible'} numbered sentence items and make every sentence complete.`)) || aiResult;
            }
            return aiResult;
        } catch (err) {
            console.warn('[OCR] AI structure extraction failed:', err);
            return null;
        }
    }

    function hasAiItems(aiResult) {
        return !!aiResult && ['words', 'phrases', 'sentences'].some(type => Array.isArray(aiResult[type]) && aiResult[type].length > 0);
    }

    function parseOcrTextToRecognizedData(rawText, baseData, parseHint = {}) {
        const snapshot = recognizedData;
        recognizedData = createParseSeed(baseData);
        if (parseHint.forceSection === 'sentences') {
            parseForcedSentenceSection(rawText, parseHint);
        } else {
            smartParse(rawText, parseHint);
        }
        const parsed = cloneRecognizedData(recognizedData);
        recognizedData = snapshot;
        return reclassifyForcedSectionItems(parsed, parseHint.forceSection);
    }

    // Sort/filter mode for the saved units list (persisted)
    const SORT_KEY = 'savedUnitsSortMode';
    const GRADE_FILTER_KEY = 'savedUnitsGradeFilter';
    let sortMode = (typeof localStorage !== 'undefined' && localStorage.getItem(SORT_KEY)) || 'unit';
    // null = use user's profile grade, '' (after explicit "全部") = no filter, otherwise specific grade
    let gradeFilter = null;

    const PUBLISHER_OPTIONS = ['外研版', '人教版', '译林版', '北师大版', '冀教版', '沪教版', '牛津版'];
    const GRADE_OPTIONS = [
        '小学三年级上','小学三年级下','小学四年级上','小学四年级下','小学五年级上','小学五年级下','小学六年级上','小学六年级下',
        '初一上','初一下','初二上','初二下','初三上','初三下',
        '高一上','高一下','高二上','高二下','高三上','高三下'
    ];
    const COMMON_SHORT_WORDS = new Set([
        'a','an','as','at','be','by','do','go','he','if','in','is','it','me','my',
        'of','on','or','so','to','up','we','am','are','off','out','for','the','and',
        'you','she','her','his','our','ago','air'
    ]);

    // Initialize upload area event listeners
    function init() {
        const dropzone = document.getElementById('upload-dropzone');
        const fileInput = document.getElementById('upload-input');
        const directoryInput = document.getElementById('upload-directory-input');
        const chooseFilesBtn = document.getElementById('choose-files-btn');
        const chooseFolderBtn = document.getElementById('choose-folder-btn');

        if (!dropzone || !fileInput || !directoryInput) return;

        // Click to upload
        dropzone.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            fileInput.click();
        });
        chooseFilesBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            fileInput.click();
        });
        chooseFolderBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            directoryInput.click();
        });

        // File selected
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleFiles(Array.from(e.target.files));
            }
        });

        directoryInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleFiles(Array.from(e.target.files));
            }
        });

        // Drag and drop
        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        });

        dropzone.addEventListener('dragleave', () => {
            dropzone.classList.remove('dragover');
        });

        dropzone.addEventListener('drop', async (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');

            const files = await extractDroppedFiles(e.dataTransfer);
            if (files.length > 0) {
                handleFiles(files);
            }
        });

        // Restore saved filter (if explicitly set by user previously)
        try {
            const stored = localStorage.getItem(GRADE_FILTER_KEY);
            if (stored !== null) gradeFilter = stored;  // '' means All; specific grade string keeps it
        } catch (e) {}

        // Render saved units list
        renderSavedUnits();
    }

    async function extractDroppedFiles(dataTransfer) {
        const items = Array.from(dataTransfer?.items || []);
        if (items.length === 0) {
            return Array.from(dataTransfer?.files || []);
        }

        const nestedFiles = await Promise.all(items.map(async (item) => {
            const entry = item.webkitGetAsEntry?.();
            if (entry) {
                return readEntryFiles(entry);
            }

            const file = item.getAsFile?.();
            return file ? [file] : [];
        }));

        return nestedFiles.flat();
    }

    function readEntryFiles(entry) {
        return new Promise((resolve) => {
            if (entry.isFile) {
                entry.file((file) => resolve([file]), () => resolve([]));
                return;
            }

            if (!entry.isDirectory) {
                resolve([]);
                return;
            }

            const reader = entry.createReader();
            const entries = [];

            const readBatch = () => {
                reader.readEntries(async (results) => {
                    if (!results.length) {
                        const nested = await Promise.all(entries.map(child => readEntryFiles(child)));
                        resolve(nested.flat());
                        return;
                    }

                    entries.push(...results);
                    readBatch();
                }, () => resolve([]));
            };

            readBatch();
        });
    }

    function filterSupportedFiles(files) {
        const seen = new Set();
        return files.filter(file => {
            if (!file) return false;
            const isImage = file.type.startsWith('image/');
            const isCsv = file.type === 'text/csv' || /\.csv$/i.test(file.name);
            if (!isImage && !isCsv) return false;

            const key = [file.name, file.size, file.lastModified].join('|');
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    // Handle uploaded files
    async function handleFiles(files) {
        const supportedFiles = filterSupportedFiles(files);
        if (supportedFiles.length === 0) {
            alert('请上传图片、CSV 文件，或拖拽包含这些文件的文件夹\nPlease upload images, CSV files, or a folder containing them');
            return;
        }

        showSelectionPreview(supportedFiles);
        await processUploadFiles(supportedFiles);
    }

    function showSelectionPreview(files) {
        const previewImage = document.getElementById('preview-image');
        const summaryEl = document.getElementById('preview-summary');
        const fileListEl = document.getElementById('preview-file-list');
        const images = files.filter(file => file.type.startsWith('image/'));
        const csvs = files.filter(file => file.type === 'text/csv' || /\.csv$/i.test(file.name));

        if (previewObjectUrl) {
            URL.revokeObjectURL(previewObjectUrl);
            previewObjectUrl = null;
        }

        if (images.length > 0) {
            previewObjectUrl = URL.createObjectURL(images[0]);
            previewImage.src = previewObjectUrl;
            previewImage.style.display = 'block';
        } else {
            previewImage.removeAttribute('src');
            previewImage.style.display = 'none';
        }

        summaryEl.textContent = `共 ${files.length} 个文件：${images.length} 张图片，${csvs.length} 个 CSV。系统会合并图片识别结果，并从 CSV 中自动提取单词列。`;
        fileListEl.innerHTML = files.slice(0, 10).map(file => {
            const icon = file.type.startsWith('image/') ? '🖼️' : '📄';
            return `<span class="upload-file-pill">${icon} ${escapeHtml(file.webkitRelativePath || file.name)}</span>`;
        }).join('');

        if (files.length > 10) {
            fileListEl.innerHTML += `<span class="upload-file-pill">+${files.length - 10} more</span>`;
        }

        document.getElementById('upload-preview').style.display = 'block';
        document.getElementById('upload-area').style.display = 'none';
    }

    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });
    }

    function readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result || '');
            reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
            reader.readAsText(file, 'utf-8');
        });
    }

    function loadImageElement(src) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('Failed to load image'));
            image.src = src;
        });
    }

    async function optimizeImageDataForOcr(imageDataUrl) {
        const image = await loadImageElement(imageDataUrl);
        const maxDimension = 1600;
        const longestSide = Math.max(image.naturalWidth || image.width || 0, image.naturalHeight || image.height || 0);
        if (!longestSide || longestSide <= maxDimension) {
            return imageDataUrl;
        }

        const scale = maxDimension / longestSide;
        const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
        const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return imageDataUrl;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(image, 0, 0, width, height);
        return canvas.toDataURL('image/jpeg', 0.9);
    }

    function buildSourceProgressLabel(kind, current, total, name) {
        return `${kind} ${current}/${total}: ${name}`;
    }

    function updateOverallProgress(progressFill, statusEl, sourceIndex, totalSources, innerProgress, label) {
        const ratio = totalSources > 0 ? ((sourceIndex + innerProgress) / totalSources) : innerProgress;
        const percent = Math.max(5, Math.min(100, Math.round(ratio * 100)));
        progressFill.style.width = `${percent}%`;
        statusEl.textContent = label;
    }

    function normalizeOcrLineText(text) {
        return String(text || '')
            .replace(/\s+/g, ' ')
            .replace(/[|¦]/g, 'I')
            .trim();
    }

    function looksLikeOcrGarbage(text) {
        const normalized = normalizeOcrLineText(text);
        if (!normalized) return true;

        const tokens = normalized.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g) || [];
        if (tokens.length === 0) return true;

        const alphaChars = (normalized.match(/[A-Za-z]/g) || []).length;
        const alphaRatio = alphaChars / Math.max(normalized.length, 1);
        if (alphaRatio < 0.45) return true;

        const singleLetterCount = tokens.filter(t => t.length === 1).length;
        if (singleLetterCount >= 2) return true;

        const allCapsLong = tokens.filter(t => t.length >= 3 && t === t.toUpperCase()).length;
        if (allCapsLong >= 2) return true;

        const noVowelTokens = tokens.filter(t => {
            if (t.length < 4) return false;
            if (/[aeiouy]/i.test(t)) return false;
            return !/^(rhythms?|myths?|lymph|glyph|lynx)$/i.test(t);
        }).length;
        if (noVowelTokens >= 2 && noVowelTokens >= Math.ceil(tokens.length * 0.5)) return true;

        return false;
    }

    function normalizeTokenCore(token) {
        return String(token || '')
            .replace(/^[^A-Za-z]+|[^A-Za-z'.-]+$/g, '')
            .trim();
    }

    function isSuspiciousTrailingToken(token, afterSuspiciousSuffix = false) {
        const core = normalizeTokenCore(token);
        const lettersOnly = core.replace(/[^A-Za-z]/g, '');
        if (!lettersOnly) return afterSuspiciousSuffix;

        const lower = lettersOnly.toLowerCase();
        if (/(.)\1{3,}/i.test(lettersOnly)) return true;
        if (/[a-z][A-Z]|[A-Z][a-z].*[A-Z]/.test(core)) return true;
        if (lettersOnly.length <= 1) return true;
        if (lettersOnly === lettersOnly.toUpperCase() && lettersOnly.length >= 2 && !COMMON_SHORT_WORDS.has(lower)) return true;
        if (lettersOnly.length <= 2 && /^[A-Z][a-z]*$/.test(lettersOnly) && !COMMON_SHORT_WORDS.has(lower)) return true;
        if (lettersOnly.length >= 4 && !/[aeiouy]/i.test(lettersOnly) && !/^(rhythms?|myths?|lymph|glyph|lynx)$/i.test(lettersOnly)) return true;
        if (afterSuspiciousSuffix && lettersOnly.length <= 3 && !COMMON_SHORT_WORDS.has(lower)) return true;
        return false;
    }

    function trimTrailingOcrNoise(text) {
        const normalized = normalizeOcrLineText(text);
        const tokens = normalized.split(/\s+/).filter(Boolean);
        if (tokens.length < 2) return normalized;

        const englishWordCount = countEnglishWords(normalized);
        const minKeep = englishWordCount >= 5 ? 3 : 1;
        let cutIndex = tokens.length;
        let suspiciousSuffix = false;

        for (let i = tokens.length - 1; i >= minKeep; i--) {
            if (isSuspiciousTrailingToken(tokens[i], suspiciousSuffix)) {
                cutIndex = i;
                suspiciousSuffix = true;
                continue;
            }
            if (suspiciousSuffix) break;
        }

        const cleaned = suspiciousSuffix ? tokens.slice(0, cutIndex).join(' ') : normalized;
        return cleaned
            .replace(/\s+([,!?;:])/g, '$1')
            .replace(/\.{4,}/g, '...')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function fixCommonOcrTextIssues(text, preferSentence = false) {
        let fixed = String(text || '').trim();
        if (!fixed) return fixed;

        fixed = fixed
            .replace(/^T(?=\s+(?:am|was|have|had|can|could|will|would|should|may|might|must|love|loved|like|liked|keep|kept|play|played|want|wanted|decide|decided|make|made|go|went|feel|felt)\b)/, 'I')
            .replace(/^Alife\b/i, 'A life')
            .replace(/^Ayear\b/i, 'A year')
            .replace(/\b([A-Za-z]+)\.\s+([A-Za-z]+)\.\.\./g, '$1...$2...')
            .replace(/\bkeepkept\b/ig, 'keep/kept')
            .replace(/\bmademakes\b/ig, 'made/makes')
            .replace(/\bworkWorking\b/g, 'work/Working');

        if (preferSentence) {
            fixed = fixed
                .replace(/^l(?=\s+(?:am|was|have|had|can|could|will|would|should)\b)/, 'I')
                .replace(/^1(?=\s+(?:am|was|have|had|can|could|will|would|should)\b)/, 'I');
        }

        return fixed;
    }

    function extractNumberedSentenceFallbacks(rawText) {
        const text = String(rawText || '').replace(/\r/g, ' ').replace(/\n+/g, ' ');
        const starts = [];
        const startRegex = /(?:^|\s)(\d{1,2})[.\s、:]+/g;
        let match;

        while ((match = startRegex.exec(text)) !== null) {
            const offset = /^\s/.test(match[0]) ? 1 : 0;
            starts.push({
                number: Number(match[1]),
                pos: match.index + offset,
                length: match[0].trimStart().length
            });
        }

        const fallbacks = new Map();

        starts.forEach((start, index) => {
            const startPos = start.pos + start.length;
            const endPos = index + 1 < starts.length ? starts[index + 1].pos : text.length;
            const block = text.slice(startPos, endPos).trim();
            const english = extractEnglish(block);
            if (!english) return;
            const normalized = fixCommonOcrTextIssues(trimTrailingCarryover(trimTrailingOcrNoise(english)), true);
            if (!normalized) return;
            const existing = fallbacks.get(start.number);
            if (!existing || countEnglishWords(normalized) > countEnglishWords(existing)) {
                fallbacks.set(start.number, normalized);
            }
        });

        return fallbacks;
    }

    function completeForcedSentence(text, number, fallbackMap) {
        const current = fixCommonOcrTextIssues(trimTrailingCarryover(trimTrailingOcrNoise(text)), true).trim();
        if (!current) return current;
        if (!fallbackMap || !number) return current;

        const fallback = String(fallbackMap.get(Number(number)) || '').trim();
        if (!fallback) return current;

        const currentWords = countEnglishWords(current);
        const fallbackWords = countEnglishWords(fallback);
        const currentNormalized = current.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const fallbackNormalized = fallback.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

        if (fallbackNormalized === currentNormalized) return current;
        if (fallbackNormalized.startsWith(currentNormalized) && fallbackWords >= currentWords + 2) return fallback;
        if (currentWords <= 4 && fallbackWords > currentWords) return fallback;
        if (!/[.!?]$/.test(current) && fallbackWords >= Math.max(6, currentWords + 2)) return fallback;
        return current;
    }

    function parseForcedSentenceSection(rawText, parseHint = {}) {
        const prevMeta = {
            publisher: recognizedData.publisher || '',
            grade: recognizedData.grade || '',
            book: recognizedData.book || ''
        };
        recognizedData = createEmptyRecognizedData(rawText);
        recognizedData.publisher = prevMeta.publisher;
        recognizedData.grade = prevMeta.grade;
        recognizedData.book = prevMeta.book;

        const lines = String(rawText || '').split('\n').map(line => line.trim()).filter(Boolean);
        const fallbackSentences = extractNumberedSentenceFallbacks(parseHint.fullOcrText || rawText);
        let currentSentence = '';
        let currentNumber = null;

        for (const rawLine of lines) {
            const line = fixCommonOcrTextIssues(trimTrailingOcrNoise(rawLine), true);

            const unitMatch = line.match(/Unit\s*\d+[\s:.\-]*[A-Za-z\s]+/i);
            if (unitMatch && !recognizedData.unitName) {
                recognizedData.unitName = unitMatch[0].trim();
                continue;
            }

            if (isHeaderOrGarbage(line)) continue;

            const numberedMatch = line.match(/^\s*(\d{1,2})[.\s、:]+(.*)$/);
            if (numberedMatch) {
                if (currentSentence) {
                    addToSection(completeForcedSentence(currentSentence, currentNumber, fallbackSentences), 'sentences', { forceSection: true });
                }
                currentNumber = Number(numberedMatch[1]);
                currentSentence = fixCommonOcrTextIssues(
                    trimTrailingOcrNoise(numberedMatch[2] || ''),
                    true
                );
                continue;
            }

            const english = extractEnglish(line);
            if (english) {
                currentSentence = currentSentence
                    ? joinSentenceParts(currentSentence, english)
                    : fixCommonOcrTextIssues(english, true);
            }
        }

        if (currentSentence) {
            addToSection(completeForcedSentence(currentSentence, currentNumber, fallbackSentences), 'sentences', { forceSection: true });
        }

        autoTranslateAll();
    }

    function buildUsableRawTextFromOcr(ocrData) {
        const rawText = String((ocrData && ocrData.text) || '').trim();
        const lines = Array.isArray(ocrData && ocrData.lines) ? ocrData.lines : [];
        if (lines.length === 0) return rawText;

        const kept = lines
            .map(line => {
                const text = fixCommonOcrTextIssues(trimTrailingOcrNoise(line && line.text), true);
                const confidence = Number(line && (line.confidence ?? line.conf)) || 0;
                return { text, confidence };
            })
            .filter(line => {
                if (!line.text) return false;
                if (!/[A-Za-z]{2,}/.test(line.text)) return false;
                if (looksLikeOcrGarbage(line.text)) return false;
                if (line.confidence >= 45) return true;
                if (line.confidence >= 30 && countEnglishWords(line.text) >= 3) return true;
                if (/^\s*\d{1,2}[.\s、:]/.test(line.text) && line.confidence >= 20) return true;
                return false;
            })
            .map(line => line.text);

        const filtered = kept.join('\n').trim();
        if (!filtered) return rawText;

        const filteredWords = countEnglishWords(filtered);
        const rawWords = countEnglishWords(rawText);
        if (filteredWords >= 8 || filteredWords >= Math.max(4, Math.floor(rawWords * 0.35))) {
            return filtered;
        }
        return rawText;
    }

    function buildSentenceExerciseRawTextFromOcr(ocrData) {
        const rawText = String((ocrData && ocrData.text) || '').trim();
        const lines = Array.isArray(ocrData && ocrData.lines) ? ocrData.lines : [];
        if (lines.length === 0) return rawText;

        const kept = lines
            .map(line => {
                const text = fixCommonOcrTextIssues(trimTrailingOcrNoise(line && line.text), true);
                const confidence = Number(line && (line.confidence ?? line.conf)) || 0;
                return { text, confidence };
            })
            .filter(line => {
                if (!line.text) return false;
                const hasEnglish = /[A-Za-z]{2,}/.test(line.text);
                const isHeader = /[\u4e00-\u9fff]/.test(line.text) || /^[一二三四五六七八九十][、.]/.test(line.text);
                if (!hasEnglish && !isHeader) return false;
                if (looksLikeOcrGarbage(line.text) && !/^\s*\d{1,2}[.\s、:]/.test(line.text)) return false;
                if (line.confidence >= 12) return true;
                if (/^\s*\d{1,2}[.\s、:]/.test(line.text)) return true;
                if (countEnglishWords(line.text) >= 2) return true;
                return false;
            })
            .map(line => line.text);

        const filtered = kept.join('\n').trim();
        if (!filtered) return rawText;

        const filteredWords = countEnglishWords(filtered);
        const rawWords = countEnglishWords(rawText);
        if (filteredWords >= Math.max(6, Math.floor(rawWords * 0.5))) {
            return filtered;
        }
        return rawText;
    }

    // Process images/CSV files
    async function processUploadFiles(files) {
        const progressEl = document.getElementById('upload-progress');
        const progressFill = document.getElementById('ocr-progress-fill');
        const statusEl = document.getElementById('ocr-status');
        const imageFiles = files.filter(file => file.type.startsWith('image/'));
        const csvFiles = files.filter(file => file.type === 'text/csv' || /\.csv$/i.test(file.name));
        const totalSources = imageFiles.length + csvFiles.length;
        const csvImports = [];
        const aggregateData = createEmptyRecognizedData();

        translationRequestSeq += 1;
        uploadedImageReferences = [];
        progressEl.style.display = 'block';
        document.getElementById('upload-results').style.display = 'none';
        recognizedData = createEmptyRecognizedData();

        try {
            let sourceIndex = 0;

            for (let i = 0; i < imageFiles.length; i++) {
                const file = imageFiles[i];
                const imageData = await readFileAsDataUrl(file);
                const optimizedImageData = await optimizeImageDataForOcr(imageData);
                updateOverallProgress(
                    progressFill,
                    statusEl,
                    sourceIndex,
                    totalSources,
                    0.05,
                    `正在识别图片 ${i + 1}/${imageFiles.length}... Recognizing image ${i + 1}/${imageFiles.length}...`
                );

                const result = await Tesseract.recognize(optimizedImageData, 'eng', {
                    logger: (m) => {
                        if (m.status === 'recognizing text') {
                            updateOverallProgress(
                                progressFill,
                                statusEl,
                                sourceIndex,
                                totalSources,
                                0.1 + m.progress * 0.9,
                                `${buildSourceProgressLabel('图片 Image', i + 1, imageFiles.length, file.name)} ${Math.round(m.progress * 100)}%`
                            );
                        }
                    }
                });

                const sourceRef = {
                    kind: 'image',
                    index: i,
                    name: file.name,
                    imageSrc: imageData,
                    rawText: String((result.data && result.data.text) || '')
                };
                uploadedImageReferences.push(sourceRef);
                const baseRawText = buildUsableRawTextFromOcr(result.data);
                const parseHint = detectSourceParseHint(file.name, result.data.text || baseRawText);
                parseHint.fullOcrText = String((result.data && result.data.text) || baseRawText || '');
                const rawText = parseHint.forceSection === 'sentences'
                    ? buildSentenceExerciseRawTextFromOcr(result.data)
                    : baseRawText;
                let parsedData = null;

                if (shouldUseAiForImage(parseHint, rawText, file.name)) {
                    updateOverallProgress(
                        progressFill,
                        statusEl,
                        sourceIndex,
                        totalSources,
                        0.96,
                        `正在智能分析 ${i + 1}/${imageFiles.length}... AI analyzing ${i + 1}/${imageFiles.length}...`
                    );
                    const aiResult = await fetchAiStructureFromImage(
                        optimizedImageData,
                        file.name,
                        parseHint.fullOcrText,
                        parseHint.forceSection || ''
                    );
                    if (hasAiItems(aiResult)) {
                        parsedData = buildRecognizedDataFromAiStructure(aiResult, aggregateData, rawText);
                    }
                }

                if (!parsedData) {
                    parsedData = expandSentenceItemsFromFullOcr(
                        parseOcrTextToRecognizedData(rawText, aggregateData, parseHint),
                        parseHint.fullOcrText
                    );
                }
                attachSourceReference(parsedData, sourceRef);
                mergeRecognizedData(aggregateData, parsedData);
                sourceIndex += 1;
            }

            for (let i = 0; i < csvFiles.length; i++) {
                const file = csvFiles[i];
                updateOverallProgress(
                    progressFill,
                    statusEl,
                    sourceIndex,
                    totalSources,
                    0.2,
                    `正在导入 CSV ${i + 1}/${csvFiles.length}... Importing CSV ${i + 1}/${csvFiles.length}...`
                );

                const csvText = await readFileAsText(file);
                csvImports.push(parseCsvWords(csvText, file.name));
                sourceIndex += 1;
                updateOverallProgress(
                    progressFill,
                    statusEl,
                    sourceIndex - 1,
                    totalSources,
                    1,
                    `${buildSourceProgressLabel('CSV', i + 1, csvFiles.length, file.name)} imported`
                );
            }

            recognizedData = cloneRecognizedData(aggregateData);

            csvImports.forEach((csvData) => {
                csvData.words.forEach(word => addToSection(word, 'words'));
                if (!recognizedData.unitName && csvData.unitName) {
                    recognizedData.unitName = csvData.unitName;
                }
            });

            if (!recognizedData.unitName) {
                recognizedData.unitName = deriveUnitNameFromFiles(files);
            }

            console.log('[OCR] Raw text:', recognizedData.raw);
            autoTranslateAll();

            const totalItems = recognizedData.words.length + recognizedData.phrases.length + recognizedData.sentences.length;
            if (totalItems === 0) {
                throw new Error('未识别到可导入内容。图片请换更清晰的截图；CSV 请确认包含英文单词列。');
            }

            // Show proofreading UI after short delay
            progressFill.style.width = '100%';
            statusEl.textContent = '识别完成！Recognition complete!';
            setTimeout(() => {
                progressEl.style.display = 'none';
                showProofreadUI();
            }, 800);

        } catch (err) {
            console.error('[OCR] Error:', err);
            statusEl.textContent = '识别失败 Recognition failed: ' + err.message;
            progressFill.style.width = '0%';
        }
    }

    // ========== AUTO-TRANSLATE DICTIONARY ==========
    // Common Grade 7 vocabulary with Chinese translations
    const DICT = {
        delicious:'美味的',porridge:'粥',menu:'菜单',medicine:'药',remained:'保持;剩余',
        mixture:'混合物',plate:'盘子',snack:'零食',dangerous:'危险的',western:'西方的',
        store:'储存;商店',carrots:'胡萝卜',diet:'饮食',emperor:'皇帝',slices:'片;切片',
        food:'食物',taste:'味道',smell:'气味',memories:'记忆',cultures:'文化',
        bridge:'桥梁',borders:'边界',sweet:'甜的',certain:'某个;确定的',bodies:'身体',
        salt:'盐',fat:'脂肪',porridge:'粥',great:'伟大的;很棒的',kind:'种类;善良的',
        folk:'民间的',tale:'故事',twin:'双胞胎',brothers:'兄弟',suffer:'遭受',
        school:'学校',teacher:'老师',student:'学生',homework:'家庭作业',subject:'科目',
        english:'英语',chinese:'中文',math:'数学',science:'科学',history:'历史',
        geography:'地理',music:'音乐',sports:'运动',art:'艺术',computer:'电脑',
        animal:'动物',cat:'猫',dog:'狗',bird:'鸟',fish:'鱼',rabbit:'兔子',
        weather:'天气',sunny:'晴天',rainy:'下雨的',cloudy:'多云的',windy:'有风的',
        hot:'热的',cold:'冷的',warm:'温暖的',cool:'凉爽的',temperature:'温度',
        travel:'旅行',visit:'参观',museum:'博物馆',library:'图书馆',hospital:'医院',
        restaurant:'餐厅',supermarket:'超市',cinema:'电影院',park:'公园',hotel:'宾馆',
        breakfast:'早餐',lunch:'午餐',dinner:'晚餐',rice:'米饭',noodles:'面条',
        bread:'面包',milk:'牛奶',juice:'果汁',water:'水',coffee:'咖啡',tea:'茶',
        fruit:'水果',apple:'苹果',banana:'香蕉',orange:'橙子',grape:'葡萄',
        vegetable:'蔬菜',potato:'土豆',tomato:'番茄',chicken:'鸡肉',beef:'牛肉',
        hobby:'爱好',reading:'阅读',swimming:'游泳',running:'跑步',singing:'唱歌',
        dancing:'跳舞',painting:'绘画',cooking:'烹饪',shopping:'购物',playing:'玩耍',
        family:'家庭',father:'父亲',mother:'母亲',brother:'兄弟',sister:'姐妹',
        uncle:'叔叔',aunt:'阿姨',cousin:'表亲',grandpa:'爷爷',grandma:'奶奶',
        happy:'高兴的',sad:'悲伤的',angry:'生气的',tired:'累的',excited:'兴奋的',
        beautiful:'美丽的',wonderful:'极好的',terrible:'糟糕的',important:'重要的',
        healthy:'健康的',different:'不同的',popular:'流行的',famous:'著名的',
        interesting:'有趣的',difficult:'困难的',easy:'容易的',expensive:'昂贵的',
        cheap:'便宜的',comfortable:'舒适的',traditional:'传统的',modern:'现代的',
        festival:'节日',spring:'春天',summer:'夏天',autumn:'秋天',winter:'冬天',
        january:'一月',february:'二月',march:'三月',april:'四月',monday:'星期一',
        future:'未来',plan:'计划',dream:'梦想',hope:'希望',wish:'愿望',
        remember:'记住',forget:'忘记',believe:'相信',decide:'决定',practice:'练习',
        exercise:'锻炼',protect:'保护',discover:'发现',invent:'发明',develop:'发展',
        happen:'发生',remain:'保持',cross:'穿过',bring:'带来',often:'经常',
        usually:'通常',sometimes:'有时',always:'总是',never:'从不',already:'已经'
    };

    // ========== PHRASE & SENTENCE DICTIONARIES ==========
    // Common Grade 7 phrases with full Chinese translations
    const PHRASE_DICT = {
        'see...as': '把……看作',
        'see as': '把……看作',
        'is a lot like': '很像；和……很相似',
        'a lot like': '很像',
        'is a bridge between': '是……之间的桥梁',
        'a bridge between': '……之间的桥梁',
        'came from': '来自',
        'come from': '来自',
        'folk tale': '民间故事',
        'suffer from': '遭受；患……病',
        'twin brothers': '双胞胎兄弟',
        'all the way back to': '一直追溯到',
        'all the way': '一路；一直',
        'back to': '回到',
        'bring back': '带回；使回忆起',
        'bring back memories': '唤起回忆',
        'in its own way': '以它自己的方式',
        'each kind of': '每一种',
        'a certain': '某个；某种',
        'work well': '运作良好',
        'look like': '看起来像',
        'a lot of': '许多',
        'lots of': '许多',
        'be good at': '擅长',
        'be interested in': '对……感兴趣',
        'would like to': '想要',
        'have to': '不得不',
        'used to': '过去常常',
        'be able to': '能够',
        'look forward to': '期待',
        'take care of': '照顾',
        'get up': '起床',
        'go to school': '去上学',
        'go home': '回家',
        'do homework': '做家庭作业',
        'play sports': '做运动',
        'listen to': '听',
        'talk about': '谈论',
        'think about': '考虑',
        'learn about': '了解',
        'find out': '发现；查明',
        'make friends': '交朋友',
        'have fun': '玩得开心',
        'on time': '准时',
        'at first': '起初',
        'in fact': '事实上',
        'of course': '当然',
        'for example': '例如',
        'such as': '例如',
        'as well': '也',
        'so far': '到目前为止',
        'at least': '至少',
        'at most': '最多',
        'no longer': '不再',
        'not only but also': '不仅……而且',
        'between cultures': '文化之间',
        'cross borders': '跨越边界',
        'sweet things': '美好的事物',
        'can happen': '会发生',
        'taste great': '味道很棒',
        'tastes great': '味道很棒'
    };

    // Common sentences with translations
    const SENTENCE_DICT = {
        'the taste and smell of a certain food can often bring back memories': '某种食物的味道和气味往往能唤起回忆。',
        'each kind of porridge tastes great in its own way': '每种粥都以自己的方式味道很好。',
        'we need fat and salt for our bodies to work well': '我们的身体需要脂肪和盐才能正常运作。',
        'food is a bridge between cultures': '食物是文化之间的桥梁。',
        'when food crosses borders, sweet things can happen': '当食物跨越国界时，美好的事情就会发生。',
        'what would you like to eat': '你想吃什么？',
        'how much is it': '多少钱？',
        'what time do you get up': '你几点起床？',
        'where are you from': '你来自哪里？',
        'what do you usually do on weekends': '你周末通常做什么？',
        'i like reading books in my free time': '我空闲时间喜欢读书。',
        'she is good at playing the piano': '她擅长弹钢琴。',
        'we should protect the environment': '我们应该保护环境。',
        'he wants to be a doctor in the future': '他将来想成为一名医生。',
        'they are going to visit the museum tomorrow': '他们明天要去参观博物馆。'
    };

    // Auto-translate: smart lookup with phrase/sentence support
    function autoTranslate(text) {
        if (!text) return '';
        const lower = text.toLowerCase().trim().replace(/[.!?]+$/, '').trim();

        // 1. Try exact sentence match
        if (SENTENCE_DICT[lower]) return SENTENCE_DICT[lower];

        // 2. Try exact phrase match
        if (PHRASE_DICT[lower]) return PHRASE_DICT[lower];

        // 3. Try phrase match with variations (with/without dots)
        const noDots = lower.replace(/\.\.\./g, '').replace(/…/g, '').replace(/\s+/g, ' ').trim();
        if (PHRASE_DICT[noDots]) return PHRASE_DICT[noDots];

        // 4. Single word - direct dictionary lookup
        if (lower.split(/\s+/).length === 1) {
            const word = lower.replace(/[^a-z]/g, '');
            return DICT[word] || DICT[word.replace(/s$/, '')] || DICT[word.replace(/ed$/, '')] || 
                   DICT[word.replace(/ing$/, '')] || DICT[word.replace(/ly$/, '')] || '';
        }

        // 5. Try partial phrase matching (look for known phrases within the text)
        for (const [phrase, translation] of Object.entries(PHRASE_DICT)) {
            if (lower.includes(phrase) && phrase.split(/\s+/).length >= 2) {
                return translation;
            }
        }

        // 6. For multi-word text, try to build a meaningful translation
        // Don't do word-by-word for sentences (looks bad), just return empty
        const wordCount = lower.split(/\s+/).length;
        if (wordCount >= 5) {
            // It's a sentence - don't attempt word-by-word
            return '';
        }

        // For short phrases (2-4 words), try combined lookup
        const words = lower.split(/\s+/).filter(w => w.length >= 2);
        const meaningful = words.map(w => {
            const clean = w.replace(/[^a-z]/g, '');
            return DICT[clean] || DICT[clean.replace(/s$/, '')] || '';
        }).filter(t => t);

        // Only return if we translated most words meaningfully
        if (meaningful.length >= Math.ceil(words.length * 0.6)) {
            return meaningful.join('');
        }

        return '';
    }

    function stripFileExtension(fileName = '') {
        return fileName.replace(/\.[^.]+$/, '').trim();
    }

    function deriveUnitNameFromFiles(files) {
        const names = (files || []).map(file => String(file && file.name || '')).filter(Boolean);
        if (names.length === 0) return '';

        const unitStyleName = names
            .map(stripFileExtension)
            .map(name => name.match(/Unit\s*\d+[\s:.\-]*[A-Za-z][A-Za-z\s'-]*/i)?.[0]?.trim() || '')
            .find(Boolean);
        if (unitStyleName) return unitStyleName;

        const dateMatches = names
            .flatMap(name => [...name.matchAll(/(20\d{6})/g)].map(match => match[1]))
            .sort();

        let dateLabel = '';
        if (dateMatches.length > 0) {
            const first = dateMatches[0];
            const last = dateMatches[dateMatches.length - 1];
            dateLabel = first === last ? first : `${first}-${last.slice(-2)}`;
        }

        const hasLesson = names.some(name => /课文/.test(name));
        const parts = [];
        if (recognizedData.words.length > 0) parts.push('单词');
        if (recognizedData.phrases.length > 0) parts.push('短语');
        if (recognizedData.sentences.length > 0) parts.push('句子');

        const body = `${hasLesson ? '课文' : ''}${parts.join('')}` || stripFileExtension(names[0]);
        return [dateLabel, body].filter(Boolean).join(' ');
    }

    function parseCsvRows(text) {
        const rows = [];
        let row = [];
        let cell = '';
        let inQuotes = false;

        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            const next = text[i + 1];

            if (ch === '"') {
                if (inQuotes && next === '"') {
                    cell += '"';
                    i += 1;
                } else {
                    inQuotes = !inQuotes;
                }
                continue;
            }

            if (ch === ',' && !inQuotes) {
                row.push(cell);
                cell = '';
                continue;
            }

            if ((ch === '\n' || ch === '\r') && !inQuotes) {
                if (ch === '\r' && next === '\n') i += 1;
                row.push(cell);
                rows.push(row);
                row = [];
                cell = '';
                continue;
            }

            cell += ch;
        }

        if (cell.length > 0 || row.length > 0) {
            row.push(cell);
            rows.push(row);
        }

        return rows
            .map(r => r.map(col => (col || '').trim()))
            .filter(r => r.some(col => col.length > 0));
    }

    function normalizeCsvHeader(text) {
        return text.toLowerCase().replace(/[\s_-]+/g, '');
    }

    function countEnglishWords(text) {
        return (text.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g) || []).length;
    }

    function looksLikeEnglishText(text) {
        return /[A-Za-z]{2,}/.test(text) && !/[\u4e00-\u9fff]/.test(text);
    }

    function normalizeWordCandidate(text) {
        return text.replace(/^[^A-Za-z]+|[^A-Za-z'-]+$/g, '').replace(/\s+/g, ' ').trim();
    }

    function isLikelyWordEntry(text) {
        if (!text || !looksLikeEnglishText(text)) return false;
        if (/[;:!?]/.test(text)) return false;
        return /^[A-Za-z]+(?:['-][A-Za-z]+)?$/.test(text.trim());
    }

    function detectCsvWordColumn(rows) {
        const firstRow = rows[0] || [];
        const headerBoost = /(word|words|singleword|english|vocabulary|vocab|term|spelling|单词|词汇|英文)/i;
        const wrongHeader = /(phrase|phrases|sentence|sentences|translation|meaning|example|中文|释义|句子|短语|词组|例句)/i;
        const hasHeader = firstRow.some(col => headerBoost.test(col) || wrongHeader.test(col));
        const dataRows = hasHeader ? rows.slice(1) : rows;
        const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0);

        let bestIndex = -1;
        let bestScore = -Infinity;

        for (let colIdx = 0; colIdx < maxCols; colIdx++) {
            const header = normalizeCsvHeader(firstRow[colIdx] || '');
            let score = 0;
            let singleWordCount = 0;
            let englishCount = 0;

            if (hasHeader) {
                if (headerBoost.test(header)) score += 18;
                if (wrongHeader.test(header)) score -= 18;
            }

            dataRows.forEach(row => {
                const value = normalizeWordCandidate(row[colIdx] || '');
                if (!value) return;

                if (isLikelyWordEntry(value)) {
                    singleWordCount += 1;
                    englishCount += 1;
                    score += 6;
                } else if (looksLikeEnglishText(value)) {
                    englishCount += 1;
                    score += 1;
                    if (countEnglishWords(value) > 1) score -= 3;
                } else {
                    score -= 2;
                }
            });

            if (singleWordCount === 0 && englishCount === 0) continue;

            score += singleWordCount * 2;
            if (score > bestScore) {
                bestScore = score;
                bestIndex = colIdx;
            }
        }

        return bestScore >= 6 ? { index: bestIndex, hasHeader } : { index: -1, hasHeader };
    }

    function parseCsvWords(text, fileName) {
        const rows = parseCsvRows(text);
        if (rows.length === 0) {
            return { unitName: stripFileExtension(fileName), words: [] };
        }

        const { index, hasHeader } = detectCsvWordColumn(rows);
        if (index < 0) {
            return { unitName: stripFileExtension(fileName), words: [] };
        }

        const dataRows = hasHeader ? rows.slice(1) : rows;
        const dedupe = new Set();
        const words = [];

        dataRows.forEach(row => {
            const normalized = normalizeWordCandidate(row[index] || '');
            if (!isLikelyWordEntry(normalized)) return;

            const key = normalized.toLowerCase();
            if (dedupe.has(key)) return;
            dedupe.add(key);
            words.push(normalized);
        });

        return {
            unitName: stripFileExtension(fileName),
            words
        };
    }

    function detectExplicitSectionHeader(line) {
        const text = String(line || '').trim().toLowerCase();
        if (!text) return null;
        if (/(看音标写单词|写单词|单词|词汇|vocabulary|words?)/i.test(text)) return 'words';
        if (/(词组练习|词组|短语|phrases?)/i.test(text)) return 'phrases';
        if (/(翻译句子|句子|translate the sentences|translate sentences|sentences?)/i.test(text)) return 'sentences';
        return null;
    }

    function parseMixedSectionExercise(rawText, parseHint = {}) {
        const prevMeta = {
            publisher: recognizedData.publisher || '',
            grade: recognizedData.grade || '',
            book: recognizedData.book || ''
        };
        recognizedData = createEmptyRecognizedData(rawText);
        recognizedData.publisher = prevMeta.publisher;
        recognizedData.grade = prevMeta.grade;
        recognizedData.book = prevMeta.book;
        recognizedData.unitName = parseHint.unitNameHint || '';

        const lines = String(rawText || '').split('\n').map(line => line.trim()).filter(Boolean);
        const fallbackSentences = extractNumberedSentenceFallbacks(parseHint.fullOcrText || rawText);
        let activeSection = null;
        let currentSentence = '';
        let currentNumber = null;

        const flushSentence = () => {
            if (!currentSentence) return;
            addToSection(
                completeForcedSentence(currentSentence, currentNumber, fallbackSentences),
                'sentences',
                { forceSection: true }
            );
            currentSentence = '';
            currentNumber = null;
        };

        for (const rawLine of lines) {
            const line = fixCommonOcrTextIssues(trimTrailingOcrNoise(rawLine), true);
            if (!line) continue;

            const unitMatch = line.match(/Unit\s*\d+[\s:.\-]*[A-Za-z][A-Za-z\s'-]*/i);
            if (unitMatch && !recognizedData.unitName) {
                recognizedData.unitName = unitMatch[0].trim();
            }

            const headerSection = detectExplicitSectionHeader(line);
            if (headerSection) {
                flushSentence();
                activeSection = headerSection;
                continue;
            }

            if (!activeSection) continue;

            if (activeSection === 'sentences') {
                const numberedItems = extractItems(line);
                if (numberedItems.length > 1) {
                    flushSentence();
                    numberedItems.forEach(item => addToSection(item, 'sentences', { forceSection: true }));
                    continue;
                }

                const numberedMatch = line.match(/^\s*(\d{1,2})[.\s、:]+(.*)$/);
                if (numberedMatch) {
                    flushSentence();
                    currentNumber = Number(numberedMatch[1]);
                    currentSentence = fixCommonOcrTextIssues(trimTrailingCarryover(trimTrailingOcrNoise(numberedMatch[2] || '')), true);
                    continue;
                }

                const english = extractEnglish(line);
                if (english) {
                    currentSentence = currentSentence
                        ? joinSentenceParts(currentSentence, english)
                        : fixCommonOcrTextIssues(english, true);
                }
                continue;
            }

            const items = extractItems(line);
            if (items.length > 0) {
                items.forEach(item => addToSection(item, activeSection, { forceSection: true }));
                continue;
            }

            const english = extractEnglish(line);
            if (!english) continue;
            if (activeSection === 'words') {
                addToSection(english, 'words', { forceSection: true });
            } else {
                splitSemicolonPhraseCandidates(english).forEach(item => addToSection(item, 'phrases', { forceSection: true }));
            }
        }

        flushSentence();
        if (!recognizedData.unitName) {
            recognizedData.unitName = parseHint.unitNameHint || '';
        }
        autoTranslateAll();
        return recognizedData.words.length + recognizedData.phrases.length + recognizedData.sentences.length;
    }

    // ========== SMART STRUCTURED PARSING ==========
    function smartParse(rawText, parseHint = {}) {
        const prevMeta = {
            publisher: recognizedData.publisher || '',
            grade: recognizedData.grade || '',
            book: recognizedData.book || ''
        };
        recognizedData = createEmptyRecognizedData(rawText);
        recognizedData.publisher = prevMeta.publisher;
        recognizedData.grade = prevMeta.grade;
        recognizedData.book = prevMeta.book;

        const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const forcedSection = parseHint.forceSection || null;

        if (parseHint.mixedSections) {
            const mixedTotal = parseMixedSectionExercise(rawText, parseHint);
            if (mixedTotal >= 5) {
                console.log('[OCR] Mixed-section parsed:', recognizedData.unitName,
                    '| Words:', recognizedData.words.length,
                    '| Phrases:', recognizedData.phrases.length,
                    '| Sentences:', recognizedData.sentences.length
                );
                return;
            }

            recognizedData = createEmptyRecognizedData(rawText);
            recognizedData.publisher = prevMeta.publisher;
            recognizedData.grade = prevMeta.grade;
            recognizedData.book = prevMeta.book;
        }

        // 1. Detect unit name
        for (const line of lines) {
            const unitMatch = line.match(/Unit\s*\d+[\s:.\-]*[A-Za-z][A-Za-z\s'-]*/i);
            if (unitMatch) {
                recognizedData.unitName = unitMatch[0].trim();
                break;
            }
        }
        if (!recognizedData.unitName && parseHint.unitNameHint) {
            recognizedData.unitName = parseHint.unitNameHint;
        }

        // 2. Collect all content lines (lines with valid English)
        // Strategy: Group lines into sections by detecting "number restart" (1. appears again)
        // and by detecting garbage/header lines between content groups
        const contentGroups = []; // Array of groups, each group = { lines: [], type: 'words'|'phrases'|'sentences' }
        let currentGroup = null;
        let lastNumber = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Skip unit title
            if (/Unit\s*\d+/i.test(line) && line.match(/[A-Z]/)) {
                if (recognizedData.unitName === '') {
                    const m = line.match(/Unit\s*\d+[\s:.\-]*[A-Za-z][A-Za-z\s'-]*/i);
                    if (m) recognizedData.unitName = m[0].trim();
                }
                continue;
            }

            // Check if this line has valid English numbered content
            const hasEnglish = line.match(/[a-zA-Z]{2,}/);
            const firstNum = line.match(/^\s*(\d{1,2})[.\s、:]/);
            const hasNumberedContent = firstNum && hasEnglish;

            // Detect if this is a non-content/header line (Chinese header or OCR garbage)
            const isGarbageLine = isHeaderOrGarbage(line);

            if (isGarbageLine) {
                // This might be a section header - start a new group
                if (currentGroup && currentGroup.items.length > 0) {
                    contentGroups.push(currentGroup);
                }
                currentGroup = null;
                lastNumber = 0;
                continue;
            }

            if (!hasEnglish) continue;

            // If we see numbering restart (back to 1, 2, etc. after higher numbers)
            if (firstNum) {
                const num = parseInt(firstNum[1]);
                if (num === 1 && lastNumber > 1) {
                    // Numbering restarted → new section
                    if (currentGroup && currentGroup.items.length > 0) {
                        contentGroups.push(currentGroup);
                    }
                    currentGroup = null;
                }
                lastNumber = num;
            }

            // Extract items from this line
            const items = extractItems(line);
            if (items.length > 0) {
                if (!currentGroup) {
                    currentGroup = { items: [], avgWordCount: 0, forcedSection };
                }
                currentGroup.items.push(...items);
                // Track the last number seen
                const nums = line.match(/\d{1,2}(?=[.\s、:])/g);
                if (nums) {
                    lastNumber = Math.max(lastNumber, ...nums.map(n => parseInt(n)));
                }
            } else {
                // Line has English but no numbered items - might be a sentence without number
                const english = extractEnglish(line);
                if (english) {
                    if (!currentGroup) {
                        currentGroup = { items: [], avgWordCount: 0, forcedSection };
                    }
                    if (forcedSection === 'sentences' && currentGroup.items.length > 0) {
                        const lastIndex = currentGroup.items.length - 1;
                        currentGroup.items[lastIndex] = joinSentenceParts(currentGroup.items[lastIndex], english);
                    } else {
                        splitSemicolonPhraseCandidates(english).forEach(item => currentGroup.items.push(item));
                    }
                }
            }
        }

        // Push last group
        if (currentGroup && currentGroup.items.length > 0) {
            contentGroups.push(currentGroup);
        }

        // 3. Classify each group as words, phrases, or sentences
        contentGroups.forEach((group, idx) => {
            const avgWords = group.items.reduce((sum, item) => sum + item.split(/\s+/).length, 0) / group.items.length;

            let section;
            if (group.forcedSection) {
                section = group.forcedSection;
            } else if (avgWords <= 1.3) {
                section = 'words';
            } else if (avgWords <= 4.5) {
                section = 'phrases';
            } else {
                section = 'sentences';
            }

            // Respect expected order: if previous groups were already 'words' then 'phrases',
            // this one should be 'sentences' even if avgWords is low
            if (idx > 0) {
                const prevSections = contentGroups.slice(0, idx)
                    .map(g => g.assignedSection)
                    .filter(Boolean);
                if (prevSections.includes('words') && prevSections.includes('phrases') && section !== 'sentences') {
                    section = 'sentences';
                } else if (prevSections.includes('words') && !prevSections.includes('phrases') && section === 'words') {
                    section = 'phrases';
                }
            }

            group.assignedSection = section;

            group.items.forEach(item => {
                addToSection(item, section, { forceSection: !!group.forcedSection });
            });
        });

        // If parsing found very little, use enhanced fallback
        const total = recognizedData.words.length + recognizedData.phrases.length + recognizedData.sentences.length;
        if (total < 5) {
            enhancedFallbackParse(lines, parseHint);
        }

        // Auto-translate all items
        autoTranslateAll();

        console.log('[OCR] Smart parsed:', recognizedData.unitName,
            '| Words:', recognizedData.words.length,
            '| Phrases:', recognizedData.phrases.length,
            '| Sentences:', recognizedData.sentences.length
        );
    }

    // Detect if a line is a header/garbage (Chinese section header or OCR noise)
    function isHeaderOrGarbage(line) {
        if (looksLikeOcrGarbage(line)) return true;
        // Contains Chinese section markers
        if (/[一二三四五六七八九十][、.,\s]/.test(line)) return true;
        if (/[Ⅰ-Ⅹ][、.,\s]/.test(line)) return true;
        // Contains many Chinese characters
        const chineseCount = (line.match(/[\u4e00-\u9fff]/g) || []).length;
        if (chineseCount >= 3) return true;
        // Very short line with no real English words (OCR garbage from Chinese)
        const englishWords = (line.match(/\b[a-zA-Z]{2,}\b/g) || []);
        if (line.length < 20 && englishWords.length === 0) return true;
        // Contains typical OCR garbage patterns (random uppercase, %, symbols)
        if (/^[—\-]+[.\s]/.test(line)) return true; // "—. BERGER." type garbage
        if (line.match(/[%@#$&]{2,}/)) return true;
        // Short line with mostly non-alpha characters
        const alphaRatio = (line.match(/[a-zA-Z]/g) || []).length / Math.max(line.length, 1);
        if (line.length < 25 && alphaRatio < 0.4 && !line.match(/\d+[.\s]+[a-zA-Z]{3,}/)) return true;
        return false;
    }

    // Extract items from a line - handles numbered multi-column layouts
    function extractItems(line) {
        const items = [];

        // First, split by patterns where a new numbered item starts
        // Handle: "1. delicious 2. porridge 3. menu" and "1. see...as 2. is a lot like"
        // Key: split at positions where \d+. or \d+<space> indicates a new item
        
        // Find all numbered item start positions
        const starts = [];
        const startRegex = /(?:^|\s)(\d{1,2})[.\s、:]+/g;
        let m;
        while ((m = startRegex.exec(line)) !== null) {
            starts.push({ pos: m.index + (m[0].startsWith(' ') || m[0].startsWith('\t') ? 1 : 0), fullMatch: m[0] });
        }

        if (starts.length === 0) return items;

        // Extract text between consecutive starts
        for (let i = 0; i < starts.length; i++) {
            const startPos = starts[i].pos + starts[i].fullMatch.trimStart().length;
            const endPos = (i + 1 < starts.length) ? starts[i + 1].pos : line.length;
            let text = line.substring(startPos, endPos).trim();

            // Clean: remove trailing numbers that are part of next item
            text = text.replace(/\s+\d{1,2}[.\s]*$/, '').trim();
            // Remove trailing punctuation garbage
            text = text.replace(/[,;\s]+$/, '').trim();

            // Validate: must have at least one real English word (2+ alpha chars)
            if (text.length >= 2 && text.match(/[a-zA-Z]{2,}/)) {
                // Remove non-English garbage but keep dots/ellipsis (for "see...as")
                const cleaned = trimTrailingCarryover(
                    trimTrailingOcrNoise(text.replace(/[^a-zA-Z0-9\s.,!?'"\-\/…]/g, '').trim())
                );
                if (cleaned.length >= 2) {
                    splitSemicolonPhraseCandidates(cleaned).forEach(item => items.push(item));
                }
            }
        }

        return items;
    }

    function isLikelyPhraseCandidate(text) {
        const cleaned = text.trim();
        if (!cleaned) return false;
        const wordCount = countEnglishWords(cleaned);
        if (wordCount === 0 || wordCount > 6) return false;
        if (/[.!?]$/.test(cleaned)) return false;
        if (/^(what|when|where|why|how|who|which)\b/i.test(cleaned) && wordCount >= 4) return false;
        if (/^(the|we|i|you|he|she|it|they|this|that|these|those)\b/i.test(cleaned) && wordCount >= 5) return false;
        return true;
    }

    function trimTrailingCarryover(text) {
        let cleaned = String(text || '').trim();
        if (!cleaned) return cleaned;

        cleaned = cleaned
            .replace(/\s+["“”']?\d{1,2}\s+\d{1,2}[.\s、:]+\s*[A-Za-z].*$/g, '')
            .replace(/\s+\d+(?:[&:]\d+)+(?:\s+\d+)*\s*$/g, '')
            .replace(/\s+\d{1,2}[.\s、:]+\s*[A-Za-z]{1,4}\s*$/g, '')
            .replace(/\s+\d{1,2}\s+[A-Za-z]{1,4}\s*$/g, '')
            .replace(/\s+\d{1,2}\s*$/g, '')
            .trim();

        return cleaned;
    }

    function splitSemicolonPhraseCandidates(text) {
        const normalized = text.replace(/[；]/g, ';').replace(/\s*;\s*/g, ';').trim();
        if (!normalized.includes(';')) {
            return [text.trim()];
        }

        const parts = normalized
            .split(';')
            .map(part => part.trim())
            .filter(Boolean);

        if (parts.length >= 2 && parts.every(isLikelyPhraseCandidate)) {
            return parts;
        }

        return [text.trim()];
    }

    function joinSentenceParts(base, continuation) {
        const first = String(base || '').trim();
        const second = String(continuation || '').trim();
        if (!first) return second;
        if (!second) return first;

        const joined = `${first.replace(/[.,;:]+$/g, '').trim()} ${second.replace(/^[,.;:]+/g, '').trim()}`
            .replace(/\s+/g, ' ')
            .trim();

        return trimTrailingOcrNoise(joined);
    }

    // Extract English text from a mixed line - improved
    function extractEnglish(line) {
        // Remove Chinese characters and special markers
        let english = line.replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, ' ');
        // Remove leading numbers/dots/markers
        english = english.replace(/^\s*\d+[.\s、:]*/g, '');
        // Clean up extra spaces
        english = english.replace(/\s+/g, ' ').trim();
        // Remove trailing garbage
        english = english.replace(/[^\w\s.,!?'";\-]$/g, '').trim();
        english = trimTrailingOcrNoise(english);
        english = trimTrailingCarryover(english);

        if (english.match(/[a-zA-Z]{2,}/) && countEnglishWords(english) >= 2 && !looksLikeOcrGarbage(english)) {
            return english;
        }
        return null;
    }

    // Add item to appropriate section - respects assigned section
    function addToSection(text, section, options = {}) {
        const forceSection = !!options.forceSection;
        const presetCn = String(options.presetCn || '').trim();
        text = fixCommonOcrTextIssues(
            trimTrailingCarryover(trimTrailingOcrNoise(text)),
            section === 'sentences' || forceSection
        ).trim();
        if (!text || text.length < 2) return;

        // Filter out obvious garbage
        if (/^[—\-\s.%]+$/.test(text)) return;
        if (!text.match(/[a-zA-Z]{2,}/)) return;
        if (looksLikeOcrGarbage(text)) return;

        let targetSection = section || 'words';
        const wordCount = text.split(/\s+/).length;

        if (!forceSection && splitSemicolonPhraseCandidates(text).length > 1) {
            targetSection = 'phrases';
        }

        // If explicitly assigned to a section, trust it
        // But do a sanity check for obvious mismatches
        if (targetSection === 'words' && wordCount > 2 && !text.includes('...')) {
            targetSection = isSentence(text) ? 'sentences' : 'phrases';
        }
        if (!forceSection && targetSection === 'sentences' && isLikelyPhraseCandidate(text)) {
            targetSection = 'phrases';
        }

        const cn = presetCn || autoTranslate(text);
        const item = {
            en: text,
            cn: cn,
            difficulty: wordCount === 1 ? 1 : (wordCount <= 5 ? 2 : 3)
        };

        // Avoid duplicates
        const list = recognizedData[targetSection];
        if (!list.find(existing => existing.en.toLowerCase() === item.en.toLowerCase())) {
            list.push(item);
        }
    }

    // Determine if text is a sentence (vs phrase)
    function isSentence(text) {
        if (splitSemicolonPhraseCandidates(text).length > 1) return false;
        const wordCount = text.split(/\s+/).length;
        if (wordCount >= 6) return true;
        if (/^[A-Z]/.test(text) && /[.!?]$/.test(text)) return true;
        if (/^(The|We|I|You|He|She|It|They|Each|When|Food|This|That)\s/i.test(text) && wordCount >= 5) return true;
        return false;
    }

    // Enhanced fallback parse when structured detection fails
    function enhancedFallbackParse(lines, parseHint = {}) {
        const forcedSection = parseHint.forceSection || null;
        lines.forEach(line => {
            if (isHeaderOrGarbage(line)) return;
            const items = extractItems(line);
            if (items.length > 0) {
                items.forEach(item => {
                    const wc = item.split(/\s+/).length;
                    if (forcedSection) addToSection(item, forcedSection, { forceSection: true });
                    else if (wc === 1) addToSection(item, 'words');
                    else if (wc <= 5) addToSection(item, 'phrases');
                    else addToSection(item, 'sentences');
                });
            } else {
                const english = extractEnglish(line);
                if (english) {
                    const items = forcedSection === 'sentences' ? [english] : splitSemicolonPhraseCandidates(english);
                    items.forEach(item => {
                        const wc = item.split(/\s+/).length;
                        addToSection(item, forcedSection || (wc >= 6 ? 'sentences' : 'phrases'), { forceSection: !!forcedSection });
                    });
                }
            }
        });
    }

    // Auto-translate all items after parsing (sync — uses local dictionary)
    function autoTranslateAll() {
        ['words', 'phrases', 'sentences'].forEach(type => {
            recognizedData[type].forEach(item => {
                if (!item.cn) {
                    item.cn = autoTranslate(item.en);
                }
            });
        });
    }

    // Async: ask the backend to translate ALL items, and override the local-dict
    // placeholders with the richer ECDICT (POS-tagged) results when available.
    async function fetchRemoteTranslations() {
        const requestId = ++translationRequestSeq;
        const all = [];
        ['words', 'phrases', 'sentences'].forEach(type => {
            recognizedData[type].forEach(item => {
                if (item.en) all.push(item.en);
            });
        });
        if (all.length === 0) return;
        try {
            const uniqueTexts = [...new Set(all)];
            const map = {};
            const batchSize = 80;

            for (let i = 0; i < uniqueTexts.length; i += batchSize) {
                const batch = uniqueTexts.slice(i, i + batchSize);
                const res = await fetch('/api/translate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ texts: batch })
                });
                if (!res.ok) {
                    console.warn('[OCR] remote translate batch failed:', res.status);
                    continue;
                }
                const data = await res.json();
                Object.assign(map, (data && data.translations) || {});
            }

            if (requestId !== translationRequestSeq) return;

            ['words', 'phrases', 'sentences'].forEach(type => {
                recognizedData[type].forEach((item, idx) => {
                    if (item.en && map[item.en] && map[item.en] !== item.cn) {
                        item.cn = map[item.en];
                        // Update the on-screen input/textarea if it exists
                        const sel = `.proofread-section[data-type="${type}"] .proofread-cn[data-idx="${idx}"]`;
                        const el = document.querySelector(sel);
                        if (el) {
                            el.value = item.cn;
                            if (el.tagName === 'TEXTAREA') {
                                el.style.height = 'auto';
                                el.style.height = el.scrollHeight + 'px';
                            }
                        }
                    }
                });
            });
        } catch (err) {
            console.warn('[OCR] remote translate failed:', err);
        }
    }

    // ========== PROOFREADING UI ==========
    function showProofreadUI() {
        const resultsEl = document.getElementById('upload-results');
        resultsEl.style.display = 'block';
        const referenceSrc = getReferenceImageSrc();
        const referenceSummary = escapeHtml(document.getElementById('preview-summary')?.textContent || '原图参考 Original image reference');

        let html = '';

        // Unit name & metadata input
        const unitNoVal = recognizedData.unitNo || (recognizedData.unitName.match(/Unit\s*(\d+)/i)?.[1] ?? '');
        html += `<div class="proofread-header">
            <label>📚 单元名称 Unit Name:</label>
            <input type="text" id="proofread-unit-name" class="proofread-input-title" 
                   value="${escapeHtml(recognizedData.unitName)}" 
                   placeholder="例如: Unit 3 Food matters">
            <div class="proofread-meta">
                <input type="text" id="proofread-publisher" list="publisher-options" placeholder="出版社 (如 外研版)" value="${escapeHtml(recognizedData.publisher || '')}">
                <input type="text" id="proofread-grade" list="grade-options" placeholder="年级学期 (如 初一下)" value="${escapeHtml(recognizedData.grade || '')}">
                <input type="text" id="proofread-book" placeholder="册次 (可选)" value="${escapeHtml(recognizedData.book || '')}">
                <input type="number" id="proofread-unit-no" placeholder="Unit#" min="0" value="${escapeHtml(String(unitNoVal))}">
            </div>
            <datalist id="publisher-options">${PUBLISHER_OPTIONS.map(p => `<option value="${escapeHtml(p)}">`).join('')}</datalist>
            <datalist id="grade-options">${GRADE_OPTIONS.map(g => `<option value="${escapeHtml(g)}">`).join('')}</datalist>
        </div>`;

        // Words section
        html += buildEditableSection('words', '📝 单词 Words', recognizedData.words);
        // Phrases section
        html += buildEditableSection('phrases', '📖 词组 Phrases', recognizedData.phrases);
        // Sentences section
        html += buildEditableSection('sentences', '💬 句子 Sentences', recognizedData.sentences);

        // Action buttons
        html += `<div class="proofread-actions">
            <button class="btn btn-primary btn-large" onclick="ImageOCR.saveUnit()">
                💾 保存单元 Save Unit
            </button>
            <button class="btn btn-secondary" onclick="ImageOCR.startPracticeFromProofread('all')">
                🎮 直接练习 Practice Now
            </button>
        </div>`;

        if (referenceSrc) {
            html += `<div class="proofread-reference-panel" id="proofread-reference-panel" style="display:none;">
                <div class="proofread-reference-header">
                    <strong>🖼️ 原图对照 Original Image</strong>
                    <button type="button" class="btn-icon proofread-reference-close" onclick="ImageOCR.hideReferenceImagePanel()" title="关闭">✕</button>
                </div>
                <p class="proofread-reference-summary">${referenceSummary}</p>
                <img id="proofread-reference-image" src="${escapeHtml(referenceSrc)}" alt="Original upload reference">
            </div>`;
        }

        document.getElementById('recognized-items').innerHTML = html;

        // Kick off remote translation for items the local dict couldn't cover.
        // Runs asynchronously; updates DOM in-place when results arrive.
        fetchRemoteTranslations();
    }

    // Build an editable section for proofreading
    function buildEditableSection(type, title, items) {
        let html = `<div class="proofread-section" data-type="${type}">
            <div class="proofread-section-header">
                <h4>${title} (${items.length})</h4>
                <button class="btn btn-small btn-outline" onclick="ImageOCR.addItem('${type}')">
                    ➕ 添加 Add
                </button>
            </div>
            <div class="proofread-items" id="proofread-${type}">`;

        items.forEach((item, idx) => {
            html += buildItemRow(type, idx, item);
        });

        html += `</div></div>`;
        return html;
    }

    // Build a single editable item row
    function buildItemRow(type, idx, item) {
        if (type === 'sentences') {
            // Use textarea for sentences to show full text
            return `<div class="proofread-item proofread-item-sentence" data-idx="${idx}">
                <span class="proofread-num">${idx + 1}.</span>
                <div class="proofread-sentence-fields">
                    <textarea class="proofread-en proofread-textarea" rows="2"
                       placeholder="English sentence" data-type="${type}" data-idx="${idx}"
                       onfocus="ImageOCR.onProofreadEnglishFocus(this)"
                       onchange="ImageOCR.onEnglishEdit(this)" onblur="ImageOCR.onEnglishEdit(this)"
                       oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'">${escapeHtml(item.en)}</textarea>
                    <textarea class="proofread-cn proofread-textarea" rows="1"
                       placeholder="中文翻译" data-type="${type}" data-idx="${idx}"
                       oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'">${escapeHtml(item.cn)}</textarea>
                </div>
                <button class="btn-icon btn-delete" onclick="ImageOCR.removeItem('${type}', ${idx})" title="删除">✕</button>
            </div>`;
        }
        return `<div class="proofread-item" data-idx="${idx}">
            <span class="proofread-num">${idx + 1}.</span>
            <input type="text" class="proofread-en" value="${escapeHtml(item.en)}" 
                   placeholder="English" data-type="${type}" data-idx="${idx}"
                   onfocus="ImageOCR.onProofreadEnglishFocus(this)"
                   onchange="ImageOCR.onEnglishEdit(this)" onblur="ImageOCR.onEnglishEdit(this)">
            <input type="text" class="proofread-cn" value="${escapeHtml(item.cn)}" 
                   placeholder="中文释义(可选)" data-type="${type}" data-idx="${idx}">
            <button class="btn-icon btn-delete" onclick="ImageOCR.removeItem('${type}', ${idx})" title="删除">✕</button>
        </div>`;
    }

    // Auto-translate when English input is edited
    function onEnglishEdit(inputEl) {
        const type = inputEl.dataset.type;
        const idx = parseInt(inputEl.dataset.idx);
        const newText = inputEl.value.trim();

        if (!recognizedData[type] || !recognizedData[type][idx]) return;

        // Update recognizedData
        recognizedData[type][idx].en = newText;

        // Auto-translate and ALWAYS update Chinese field
        const cnInput = inputEl.parentElement.querySelector('.proofread-cn');
        if (cnInput && newText) {
            const translation = autoTranslate(newText);
            cnInput.value = translation; // Always update, even if empty
            recognizedData[type][idx].cn = translation;
            fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ texts: [newText] })
            }).then(r => r.ok ? r.json() : null).then(data => {
                const zh = data && data.translations && data.translations[newText];
                if (zh && recognizedData[type][idx] && recognizedData[type][idx].en === newText && recognizedData[type][idx].cn !== zh) {
                    recognizedData[type][idx].cn = zh;
                    cnInput.value = zh;
                    if (cnInput.tagName === 'TEXTAREA') {
                        cnInput.style.height = 'auto';
                        cnInput.style.height = cnInput.scrollHeight + 'px';
                    }
                }
            }).catch(() => {});
        }
    }

    // Add a new empty item to a section
    function addItem(type) {
        collectEdits(false);
        recognizedData[type].push({ en: '', cn: '', difficulty: type === 'sentences' ? 3 : (type === 'phrases' ? 2 : 1) });
        refreshSection(type, { preserveEmpty: true, focusNewItem: true });
    }

    // Remove an item from a section
    function removeItem(type, idx) {
        collectEdits(false); // Save current edits first
        recognizedData[type].splice(idx, 1);
        refreshSection(type);
    }

    // Refresh a single section's HTML
    function refreshSection(type, options = {}) {
        const { preserveEmpty = false, focusNewItem = false } = options;
        collectEdits(!preserveEmpty); // Collect any edits user made in other sections
        const container = document.getElementById(`proofread-${type}`);
        if (!container) return;
        let html = '';
        recognizedData[type].forEach((item, idx) => {
            html += buildItemRow(type, idx, item);
        });
        container.innerHTML = html;
        // Update count in header
        const titleMap = { words: '📝 单词 Words', phrases: '📖 词组 Phrases', sentences: '💬 句子 Sentences' };
        const section = container.closest('.proofread-section');
        if (section) {
            section.querySelector('h4').textContent = `${titleMap[type]} (${recognizedData[type].length})`;
        }
        if (focusNewItem && recognizedData[type].length > 0) {
            const lastInput = container.querySelector(`.proofread-en[data-type="${type}"][data-idx="${recognizedData[type].length - 1}"]`);
            if (lastInput) {
                lastInput.focus();
                if (typeof lastInput.select === 'function') lastInput.select();
            }
        }
    }

    // Collect all edits from the proofreading UI into recognizedData
    function collectEdits(removeEmpty = true) {
        // Unit name
        const nameInput = document.getElementById('proofread-unit-name');
        if (nameInput) {
            recognizedData.unitName = nameInput.value.trim();
        }
        // Metadata
        const pub = document.getElementById('proofread-publisher');
        const grd = document.getElementById('proofread-grade');
        const bk  = document.getElementById('proofread-book');
        const un  = document.getElementById('proofread-unit-no');
        if (pub) recognizedData.publisher = pub.value.trim();
        if (grd) recognizedData.grade = grd.value.trim();
        if (bk)  recognizedData.book = bk.value.trim();
        if (un) {
            const n = parseInt(un.value, 10);
            recognizedData.unitNo = isNaN(n) ? 0 : n;
        }
        if (!recognizedData.unitNo) {
            const m = (recognizedData.unitName || '').match(/Unit\s*(\d+)/i);
            recognizedData.unitNo = m ? parseInt(m[1], 10) : 0;
        }

        // Collect items from each section
        ['words', 'phrases', 'sentences'].forEach(type => {
            const inputs = document.querySelectorAll(`.proofread-en[data-type="${type}"]`);
            const cnInputs = document.querySelectorAll(`.proofread-cn[data-type="${type}"]`);
            inputs.forEach((input, idx) => {
                if (recognizedData[type][idx]) {
                    recognizedData[type][idx].en = input.value.trim();
                }
            });
            cnInputs.forEach((input, idx) => {
                if (recognizedData[type][idx]) {
                    recognizedData[type][idx].cn = input.value.trim();
                }
            });
        });

        // Remove empty items
        if (removeEmpty) {
            ['words', 'phrases', 'sentences'].forEach(type => {
                recognizedData[type] = recognizedData[type].filter(item => item.en.length > 0);
            });
        }
    }

    function getReferenceImageSrc() {
        const previewImage = document.getElementById('preview-image');
        return previewImage && previewImage.getAttribute('src') ? previewImage.getAttribute('src') : '';
    }

    function getReferenceForItem(type, idx) {
        const item = recognizedData[type] && recognizedData[type][idx];
        if (item && item._sourceRef && item._sourceRef.imageSrc) {
            return item._sourceRef;
        }
        return uploadedImageReferences[0] || null;
    }

    function onProofreadEnglishFocus(inputEl) {
        const panel = document.getElementById('proofread-reference-panel');
        const image = document.getElementById('proofread-reference-image');
        const summary = panel ? panel.querySelector('.proofread-reference-summary') : null;
        const type = inputEl.dataset.type;
        const idx = parseInt(inputEl.dataset.idx, 10);
        const sourceRef = getReferenceForItem(type, idx);
        const src = sourceRef && sourceRef.imageSrc ? sourceRef.imageSrc : getReferenceImageSrc();
        if (!panel || !image || !src) return;

        image.src = src;
        if (summary) {
            const itemText = inputEl.value.trim();
            summary.textContent = sourceRef && sourceRef.name
                ? `当前内容：${itemText || '（空）'} ｜ 来源图片：${sourceRef.name}`
                : `当前内容：${itemText || '（空）'} ｜ 原图参考 Original image reference`;
        }
        panel.style.display = 'block';
        panel.classList.add('is-visible');
        inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function hideReferenceImagePanel() {
        const panel = document.getElementById('proofread-reference-panel');
        if (!panel) return;
        panel.style.display = 'none';
        panel.classList.remove('is-visible');
    }

    // ========== SAVE / LOAD UNITS ==========
    const STORAGE_KEY = 'typing_game_custom_units';

    // Get saved units - from API if logged in, localStorage as fallback
    function getSavedUnits() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    function saveSavedUnits(units) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(units));
    }

    // Fetch units from server
    async function fetchServerUnits() {
        if (!AuthUI.isLoggedIn()) return { myUnits: [], publicUnits: [] };
        try {
            const res = await AuthUI.apiRequest('/units');
            if (!res.ok) return { myUnits: [], publicUnits: [] };
            return await res.json();
        } catch (e) {
            return { myUnits: [], publicUnits: [] };
        }
    }

    // Save unit to server
    async function saveUnitToServer(unit) {
        if (!AuthUI.isLoggedIn()) return null;
        try {
            const persistableUnit = buildPersistableUnit(unit);
            const res = await AuthUI.apiRequest('/units', {
                method: 'POST',
                body: JSON.stringify({
                    name: persistableUnit.name,
                    words: persistableUnit.words,
                    phrases: persistableUnit.phrases,
                    sentences: persistableUnit.sentences,
                    publisher: persistableUnit.publisher || '',
                    grade: persistableUnit.grade || '',
                    book: persistableUnit.book || '',
                    unit_no: persistableUnit.unitNo || 0
                })
            });
            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            return null;
        }
    }

    // Update unit on server
    async function updateUnitOnServer(id, unit) {
        if (!AuthUI.isLoggedIn()) return null;
        try {
            const persistableUnit = buildPersistableUnit(unit);
            const res = await AuthUI.apiRequest(`/units/${id}`, {
                method: 'PUT',
                body: JSON.stringify({
                    name: persistableUnit.name,
                    words: persistableUnit.words,
                    phrases: persistableUnit.phrases,
                    sentences: persistableUnit.sentences,
                    publisher: persistableUnit.publisher || '',
                    grade: persistableUnit.grade || '',
                    book: persistableUnit.book || '',
                    unit_no: persistableUnit.unitNo || 0
                })
            });
            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            return null;
        }
    }

    // Delete unit from server
    async function deleteUnitFromServer(id) {
        if (!AuthUI.isLoggedIn()) return false;
        try {
            const res = await AuthUI.apiRequest(`/units/${id}`, { method: 'DELETE' });
            return res.ok;
        } catch (e) {
            return false;
        }
    }

    // Save current unit to server (and localStorage as backup)
    async function saveUnit() {
        collectEdits();

        const unitName = recognizedData.unitName || '未命名单元 Unnamed Unit';
        const totalItems = recognizedData.words.length + recognizedData.phrases.length + recognizedData.sentences.length;

        if (totalItems === 0) {
            alert('没有内容可保存 No content to save');
            return;
        }

        const unit = {
            id: 'custom_' + Date.now(),
            name: unitName,
            createdAt: new Date().toISOString(),
            publisher: recognizedData.publisher || '',
            grade: recognizedData.grade || getEffectiveGradeFilter() || getUserGrade() || '',
            book: recognizedData.book || '',
            unitNo: recognizedData.unitNo || 0,
            words: [...recognizedData.words],
            phrases: [...recognizedData.phrases],
            sentences: [...recognizedData.sentences]
        };
        const persistableUnit = buildPersistableUnit(unit);

        // Save to server if logged in
        if (AuthUI.isLoggedIn()) {
            if (recognizedData._editingServerId) {
                // Update existing unit on server
                const editingServerId = recognizedData._editingServerId;
                const result = await updateUnitOnServer(editingServerId, persistableUnit);
                if (result) {
                    recognizedData._editingServerId = null;
                    recognizedData._editingIdx = null;
                    await renderSavedUnits({ focusUnitId: editingServerId });
                    alert(`✅ 已更新 "${unitName}"\n单词: ${unit.words.length} | 词组: ${unit.phrases.length} | 句子: ${unit.sentences.length}`);
                    return;
                }
            } else {
                // Save new unit to server
                const result = await saveUnitToServer(persistableUnit);
                if (result) {
                    await renderSavedUnits({ focusUnitId: result.id });
                    alert(`✅ 已保存 "${unitName}"\n单词: ${unit.words.length} | 词组: ${unit.phrases.length} | 句子: ${unit.sentences.length}`);
                    return;
                }
            }
            alert('服务器保存失败，已保存到本地 Server save failed, saved locally');
        }

        // Fallback: save to localStorage
        const units = getSavedUnits();
        if (recognizedData._editingIdx !== undefined && recognizedData._editingIdx !== null) {
            const editIdx = recognizedData._editingIdx;
            if (editIdx >= 0 && editIdx < units.length) {
                persistableUnit.id = units[editIdx].id;
                persistableUnit.createdAt = units[editIdx].createdAt;
                persistableUnit.updatedAt = new Date().toISOString();
                units[editIdx] = persistableUnit;
            } else {
                units.push(persistableUnit);
            }
            recognizedData._editingIdx = null;
        } else {
            const existingIdx = units.findIndex(u => u.name === unitName);
            if (existingIdx >= 0) {
                if (!confirm(`"${unitName}" 已存在，是否覆盖？\n"${unitName}" already exists. Overwrite?`)) {
                    return;
                }
                persistableUnit.id = units[existingIdx].id || persistableUnit.id;
                persistableUnit.createdAt = units[existingIdx].createdAt || persistableUnit.createdAt;
                units[existingIdx] = persistableUnit;
            } else {
                units.push(persistableUnit);
            }
        }

        saveSavedUnits(units);
        renderSavedUnits({ focusUnitId: persistableUnit.id });
        alert(`✅ 已保存 "${unitName}"\n单词: ${unit.words.length} | 词组: ${unit.phrases.length} | 句子: ${unit.sentences.length}\n\nSaved! Words: ${unit.words.length} | Phrases: ${unit.phrases.length} | Sentences: ${unit.sentences.length}`);
    }

    // Build a card HTML for a unit (used by both my/public sections)
    function buildUnitCardHtml(unit, opts) {
        const date = new Date(unit.created_at).toLocaleDateString('zh-CN');
        const total = (unit.words || []).length + (unit.phrases || []).length + (unit.sentences || []).length;
        const badge = unit.is_public ? '<span class="public-badge">公开</span>' : '';
        const author = opts && opts.showAuthor ? `👤 ${escapeHtml(unit.author || '')} | ` : '';
        const editable = !(opts && opts.showAuthor); // public-library cards are read-only
        const actions = editable
            ? `<button class="btn btn-small btn-info" onclick="ImageOCR.editServerUnit(${unit.id})" title="修改编辑">✏️</button>
               <button class="btn btn-small btn-danger" onclick="ImageOCR.deleteServerUnit(${unit.id})" title="删除">🗑️</button>`
            : '';
        return `<div class="saved-unit-card${opts && opts.showAuthor ? ' public-unit' : ''}" data-unit-id="${escapeHtml(String(unit.id || ''))}">
            <div class="saved-unit-info">
                <h4>${escapeHtml(unit.name)} ${editable ? badge : ''}</h4>
                <p>${author}📅 ${date} | 📝 ${(unit.words||[]).length}词 + ${(unit.phrases||[]).length}短语 + ${(unit.sentences||[]).length}句子 = ${total}项</p>
            </div>
            <div class="saved-unit-actions">
                <button class="btn btn-small btn-primary" onclick="ImageOCR.practiceServerUnit(${unit.id}, 'words')">单词</button>
                <button class="btn btn-small btn-secondary" onclick="ImageOCR.practiceServerUnit(${unit.id}, 'phrases')">词组</button>
                <button class="btn btn-small btn-accent" onclick="ImageOCR.practiceServerUnit(${unit.id}, 'sentences')">句子</button>
                <button class="btn btn-small btn-warning" onclick="ImageOCR.practiceServerUnit(${unit.id}, 'listening')">听力</button>
                <button class="btn btn-small btn-outline" onclick="ImageOCR.practiceServerUnit(${unit.id}, 'all')">全部</button>
                ${actions}
            </div>
        </div>`;
    }

    // Group units by publisher → grade → book; render with sort mode
    function renderUnitGroup(units, headerHtml, opts) {
        if (!units || units.length === 0) return '';
        let html = headerHtml;

        if (sortMode === 'time') {
            const sorted = [...units].sort((a, b) =>
                new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at)
            );
            sorted.forEach(u => { html += buildUnitCardHtml(u, opts); });
            return html;
        }

        // sortMode === 'unit' (default): group by publisher/grade/book, then sort by unit_no asc
        const groups = new Map();
        for (const u of units) {
            const key = `${u.publisher || ''}|${u.grade || ''}|${u.book || ''}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(u);
        }
        // Sort group keys: non-empty first, alphabetical
        const sortedKeys = [...groups.keys()].sort((a, b) => {
            const aEmpty = a === '||', bEmpty = b === '||';
            if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
            return a.localeCompare(b, 'zh-Hans');
        });
        for (const key of sortedKeys) {
            const [pub, grd, bk] = key.split('|');
            const label = [pub, grd, bk].filter(Boolean).join(' · ') || '未分类 Uncategorized';
            html += `<div class="unit-group-label">📂 ${escapeHtml(label)}</div>`;
            const arr = groups.get(key).sort((a, b) => {
                const an = a.unit_no || 0, bn = b.unit_no || 0;
                if (an !== bn) return an - bn;
                return (a.name || '').localeCompare(b.name || '', 'zh-Hans');
            });
            arr.forEach(u => { html += buildUnitCardHtml(u, opts); });
        }
        return html;
    }

    // Toolbar with sort toggle + grade filter
    function buildSortToolbar() {
        const userGrade = getUserGrade();
        const effectiveFilter = getEffectiveGradeFilter();
        const allSel = (effectiveFilter === '') ? ' selected' : '';
        return `<div class="saved-units-toolbar">
            <span style="color:#666;font-size:0.9em;">年级 Grade:</span>
            <select class="grade-filter-select" onchange="ImageOCR.setGradeFilter(this.value)">
                <option value="__ALL__"${allSel}>全部年级 All grades</option>
                ${GRADE_OPTIONS.map(g => {
                    const sel = (effectiveFilter === g) ? ' selected' : '';
                    const label = g + (g === userGrade ? ' (我的)' : '');
                    return `<option value="${escapeHtml(g)}"${sel}>${escapeHtml(label)}</option>`;
                }).join('')}
            </select>
            <span style="color:#666;font-size:0.9em;margin-left:12px;">排序 Sort:</span>
            <button class="btn btn-small ${sortMode === 'unit' ? 'btn-primary' : 'btn-outline'}"
                    onclick="ImageOCR.setSortMode('unit')">按 Unit 号 By Unit#</button>
            <button class="btn btn-small ${sortMode === 'time' ? 'btn-primary' : 'btn-outline'}"
                    onclick="ImageOCR.setSortMode('time')">按时间 By Time</button>
        </div>`;
    }

    function getUserGrade() {
        try {
            const u = (typeof AuthUI !== 'undefined' && AuthUI.getUser) ? AuthUI.getUser() : null;
            return (u && u.grade) ? u.grade : '';
        } catch (e) { return ''; }
    }

    // null filter = default to user's profile grade (if any); otherwise use stored filter
    function getEffectiveGradeFilter() {
        if (gradeFilter !== null) return gradeFilter;
        return getUserGrade();   // empty string if no profile grade -> shows all
    }

    function setGradeFilter(val) {
        // val is either '__ALL__' or a grade string from <select>
        gradeFilter = (val === '__ALL__') ? '' : String(val || '');
        try { localStorage.setItem(GRADE_FILTER_KEY, gradeFilter); } catch (e) {}
        renderSavedUnits();
    }

    function setSortMode(mode) {
        sortMode = mode === 'time' ? 'time' : 'unit';
        try { localStorage.setItem(SORT_KEY, sortMode); } catch (e) {}
        renderSavedUnits();
    }

    function focusRenderedUnit(container, unitId) {
        if (!container || unitId === undefined || unitId === null) return;
        const card = container.querySelector(`[data-unit-id="${String(unitId).replace(/"/g, '\\"')}"]`);
        if (!card) return;
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('flash-highlight');
        setTimeout(() => card.classList.remove('flash-highlight'), 2200);
    }

    // Render the list of saved custom units (from server + local)
    async function renderSavedUnits(options = {}) {
        const container = document.getElementById('saved-units-list');
        if (!container) return;

        // If logged in, fetch from server
        if (AuthUI.isLoggedIn()) {
            container.innerHTML = '<p class="empty-hint">加载中... Loading...</p>';
            const serverData = await fetchServerUnits();
            const myUnits = serverData.myUnits || [];
            const publicUnits = serverData.publicUnits || [];

            if (myUnits.length === 0 && publicUnits.length === 0) {
                container.innerHTML = '<p class="empty-hint">暂无已保存的单元 No saved units yet</p>';
                return;
            }

            let html = buildSortToolbar();

            // Filter by selected grade (or user's profile grade by default)
            const filt = getEffectiveGradeFilter();
            const applyFilter = (arr) => {
                if (!filt) return arr;
                return arr.filter(u => (u.grade || '') === filt);
            };
            const myFiltered = applyFilter(myUnits);
            const pubFiltered = applyFilter(publicUnits);

            if (filt && myFiltered.length === 0 && pubFiltered.length === 0) {
                html += `<p class="empty-hint">该年级暂无内容（共 ${myUnits.length + publicUnits.length} 个其他年级）。请切换"全部年级"或选择其他。</p>`;
                container.innerHTML = html;
                _cachedServerUnits = [...myUnits, ...publicUnits];
                return;
            }

            html += renderUnitGroup(
                myFiltered,
                '<h4 style="margin:8px 0;color:var(--primary);">📁 我的单元 My Units</h4>',
                { showAuthor: false }
            );
            html += renderUnitGroup(
                pubFiltered,
                '<h4 style="margin:16px 0 8px;color:var(--success);">🌍 公共库 Public Library</h4>',
                { showAuthor: true }
            );

            container.innerHTML = html;
            focusRenderedUnit(container, options.focusUnitId);

            // Cache server units locally for practice (unfiltered, so "play" still works)
            _cachedServerUnits = [...myUnits, ...publicUnits];
            return;
        }

        // Fallback: show localStorage units
        const units = getSavedUnits();
        if (units.length === 0) {
            container.innerHTML = '<p class="empty-hint">暂无已保存的单元 No saved units yet</p>';
            return;
        }

        let html = '';
        units.forEach((unit, idx) => {
            const date = new Date(unit.createdAt).toLocaleDateString('zh-CN');
            const total = (unit.words || []).length + (unit.phrases || []).length + (unit.sentences || []).length;
            html += `<div class="saved-unit-card">
                <div class="saved-unit-info">
                    <h4>${escapeHtml(unit.name)}</h4>
                    <p>📅 ${date} | 📝 ${(unit.words||[]).length}词 + ${(unit.phrases||[]).length}短语 + ${(unit.sentences||[]).length}句子 = ${total}项</p>
                </div>
                <div class="saved-unit-actions">
                    <button class="btn btn-small btn-primary" onclick="ImageOCR.practiceUnit(${idx}, 'words')">单词</button>
                    <button class="btn btn-small btn-secondary" onclick="ImageOCR.practiceUnit(${idx}, 'phrases')">词组</button>
                    <button class="btn btn-small btn-accent" onclick="ImageOCR.practiceUnit(${idx}, 'sentences')">句子</button>
                    <button class="btn btn-small btn-warning" onclick="ImageOCR.practiceUnit(${idx}, 'listening')">听力</button>
                    <button class="btn btn-small btn-outline" onclick="ImageOCR.practiceUnit(${idx}, 'all')">全部</button>
                    <button class="btn btn-small btn-info" onclick="ImageOCR.editUnit(${idx})" title="修改编辑">✏️</button>
                    <button class="btn btn-small btn-danger" onclick="ImageOCR.deleteUnit(${idx})" title="删除">🗑️</button>
                </div>
            </div>`;
        });

        container.innerHTML = html;
        focusRenderedUnit(container, options.focusUnitId);
    }

    // Cache for server units (to avoid re-fetching for practice)
    let _cachedServerUnits = [];

    // Practice a server unit
    function practiceServerUnit(unitId, type) {
        const unit = _cachedServerUnits.find(u => u.id === unitId);
        if (!unit) return;

        let items = [];
        if (type === 'words' || type === 'all' || type === 'listening') {
            (unit.words || []).forEach(w => {
                items.push({ type: 'word', en: w.en, cn: w.cn || '(自定义)', difficulty: w.difficulty || 1 });
            });
        }
        if (type === 'phrases' || type === 'all' || type === 'listening') {
            (unit.phrases || []).forEach(p => {
                items.push({ type: 'phrase', en: p.en, cn: p.cn || '(自定义)', difficulty: p.difficulty || 2 });
            });
        }
        if (type === 'sentences' || type === 'all') {
            (unit.sentences || []).forEach(s => {
                items.push({ type: 'sentence', en: s.en, cn: s.cn || '(自定义)', difficulty: s.difficulty || 3 });
            });
        }

        if (items.length === 0) {
            alert('该类别没有内容 No content in this category');
            return;
        }

        for (let i = items.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [items[i], items[j]] = [items[j], items[i]];
        }

        Game.startCustomPractice(items, type === 'listening' ? 'listening' : 'mixed');
    }

    // Edit a server unit
    function editServerUnit(unitId) {
        const unit = _cachedServerUnits.find(u => u.id === unitId);
        if (!unit) return;

        recognizedData.unitName = unit.name;
        recognizedData.publisher = unit.publisher || '';
        recognizedData.grade = unit.grade || '';
        recognizedData.book = unit.book || '';
        recognizedData.unitNo = unit.unit_no || 0;
        recognizedData.words = (unit.words || []).map(w => ({ en: w.en, cn: w.cn || '' }));
        recognizedData.phrases = (unit.phrases || []).map(p => ({ en: p.en, cn: p.cn || '' }));
        recognizedData.sentences = (unit.sentences || []).map(s => ({ en: s.en, cn: s.cn || '' }));
        recognizedData._editingServerId = unitId;
        recognizedData._editingIdx = null;

        showProofreadUI();
    }

    // Delete a server unit
    async function deleteServerUnit(unitId) {
        if (!confirm('确定删除？\nConfirm delete?')) return;
        const success = await deleteUnitFromServer(unitId);
        if (success) {
            await renderSavedUnits();
        } else {
            alert('删除失败 Delete failed');
        }
    }

    // Practice a saved unit
    function practiceUnit(unitIdx, type) {
        const units = getSavedUnits();
        const unit = units[unitIdx];
        if (!unit) return;

        let items = [];

        if (type === 'words' || type === 'all' || type === 'listening') {
            (unit.words || []).forEach(w => {
                items.push({ type: 'word', en: w.en, cn: w.cn || '(自定义)', difficulty: w.difficulty || 1 });
            });
        }
        if (type === 'phrases' || type === 'all' || type === 'listening') {
            (unit.phrases || []).forEach(p => {
                items.push({ type: 'phrase', en: p.en, cn: p.cn || '(自定义)', difficulty: p.difficulty || 2 });
            });
        }
        if (type === 'sentences' || type === 'all') {
            (unit.sentences || []).forEach(s => {
                items.push({ type: 'sentence', en: s.en, cn: s.cn || '(自定义)', difficulty: s.difficulty || 3 });
            });
        }

        if (items.length === 0) {
            alert('该类别没有内容 No content in this category');
            return;
        }

        // Shuffle
        for (let i = items.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [items[i], items[j]] = [items[j], items[i]];
        }

        Game.startCustomPractice(items, type === 'listening' ? 'listening' : 'mixed');
    }

    // Delete a saved unit
    function deleteUnit(unitIdx) {
        const units = getSavedUnits();
        const unit = units[unitIdx];
        if (!unit) return;
        if (!confirm(`确定删除 "${unit.name}"？\nDelete "${unit.name}"?`)) return;
        units.splice(unitIdx, 1);
        saveSavedUnits(units);
        renderSavedUnits();
    }

    // Edit a saved unit - load it into proofreading UI
    function editUnit(unitIdx) {
        const units = getSavedUnits();
        const unit = units[unitIdx];
        if (!unit) return;

        // Load unit data into recognizedData
        recognizedData.unitName = unit.name;
        recognizedData.words = (unit.words || []).map(w => ({ en: w.en, cn: w.cn || '' }));
        recognizedData.phrases = (unit.phrases || []).map(p => ({ en: p.en, cn: p.cn || '' }));
        recognizedData.sentences = (unit.sentences || []).map(s => ({ en: s.en, cn: s.cn || '' }));

        // Store which unit we're editing so save overwrites it
        recognizedData._editingIdx = unitIdx;

        // Show the proofreading UI
        showProofreadUI();

        // Scroll to the proofreading area
        const proofArea = document.getElementById('proofread-results');
        if (proofArea) proofArea.scrollIntoView({ behavior: 'smooth' });
    }

    // Start practice directly from proofreading (without saving)
    function startPracticeFromProofread(type) {
        collectEdits();
        startPractice(type);
    }

    // Start practice with current recognizedData
    function startPractice(type) {
        let items = [];

        if (type === 'words' || type === 'all' || type === 'listening') {
            recognizedData.words.forEach(w => {
                items.push({ type: 'word', en: w.en, cn: w.cn || '(图片识别)', difficulty: w.difficulty || 1 });
            });
        }
        if (type === 'phrases' || type === 'all' || type === 'listening') {
            recognizedData.phrases.forEach(p => {
                items.push({ type: 'phrase', en: p.en, cn: p.cn || '(图片识别)', difficulty: p.difficulty || 2 });
            });
        }
        if (type === 'sentences' || type === 'all') {
            recognizedData.sentences.forEach(s => {
                items.push({ type: 'sentence', en: s.en, cn: s.cn || '(图片识别)', difficulty: s.difficulty || 3 });
            });
        }

        if (items.length === 0) {
            alert('没有可用的练习内容 No items available for practice');
            return;
        }

        // Shuffle
        for (let i = items.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [items[i], items[j]] = [items[j], items[i]];
        }

        Game.startCustomPractice(items, type === 'listening' ? 'listening' : 'mixed');
    }

    // Clear uploaded image and results
    function clearImage() {
        translationRequestSeq += 1;
        uploadedImageReferences = [];
        hideReferenceImagePanel();
        document.getElementById('upload-preview').style.display = 'none';
        document.getElementById('upload-area').style.display = 'block';
        document.getElementById('upload-progress').style.display = 'none';
        document.getElementById('upload-results').style.display = 'none';
        document.getElementById('upload-input').value = '';
        const directoryInput = document.getElementById('upload-directory-input');
        if (directoryInput) directoryInput.value = '';
        if (previewObjectUrl) {
            URL.revokeObjectURL(previewObjectUrl);
            previewObjectUrl = null;
        }
        document.getElementById('preview-image').src = '';
        document.getElementById('preview-image').style.display = 'none';
        document.getElementById('preview-summary').textContent = '';
        document.getElementById('preview-file-list').innerHTML = '';
        recognizedData = createEmptyRecognizedData();
    }

    // Utility: escape HTML
    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    return {
        init,
        startPractice,
        startPracticeFromProofread,
        clearImage,
        addItem,
        removeItem,
        onEnglishEdit,
        onProofreadEnglishFocus,
        hideReferenceImagePanel,
        saveUnit,
        practiceUnit,
        editUnit,
        deleteUnit,
        renderSavedUnits,
        practiceServerUnit,
        editServerUnit,
        deleteServerUnit,
        setSortMode,
        setGradeFilter
    };
})();
