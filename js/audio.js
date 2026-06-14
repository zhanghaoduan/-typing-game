/* ============================================
   Audio Module - Speech Synthesis & Sound Effects
   语音合成和音效模块
   
   Known issues with speechSynthesis:
   - Edge/Chrome: cancel() can permanently block subsequent speak() calls
   - Fix: use resume() periodically and avoid cancel() when possible
   - Alternative: create fresh SpeechSynthesisUtterance each time
   ============================================ */

const Audio = (() => {
    // State
    let currentVoice = null;
    let speechRate = 1;
    let sfxEnabled = true;
    let voices = [];
    let voicesLoaded = false;

    // AudioContext for sound effects
    let audioCtx = null;

    function getAudioContext() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        // Resume if suspended (browser autoplay policy)
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        return audioCtx;
    }

    // Initialize
    function init() {
        if ('speechSynthesis' in window) {
            loadVoices();
            // Voices may load async
            if (speechSynthesis.onvoiceschanged !== undefined) {
                speechSynthesis.onvoiceschanged = loadVoices;
            }
        }

        // Load saved settings
        const savedRate = localStorage.getItem('typing_game_rate');
        const savedSFX = localStorage.getItem('typing_game_sfx');
        if (savedRate) speechRate = parseFloat(savedRate);
        if (savedSFX) sfxEnabled = savedSFX === 'on';
    }

    function loadVoices() {
        voices = speechSynthesis.getVoices();
        if (voices.length > 0) {
            voicesLoaded = true;
            populateVoiceSelect();
            console.log('[Audio] Voices loaded:', voices.length, 
                'English:', voices.filter(v => v.lang.startsWith('en')).length);
        }
    }

    // Populate voice selector in settings
    function populateVoiceSelect() {
        const select = document.getElementById('setting-voice');
        if (!select) return;

        const englishVoices = voices.filter(v => v.lang.startsWith('en'));
        select.innerHTML = '<option value="default">默认 Default</option>';

        englishVoices.forEach((voice, i) => {
            const option = document.createElement('option');
            option.value = i.toString();
            option.textContent = `${voice.name} (${voice.lang})`;
            select.appendChild(option);
        });
    }

    // Core speak function - with Edge hang recovery
    // Edge bug: after ~6 consecutive speaks, the engine hangs permanently
    // Fix: force cancel+resume cycle and use timeout-based recovery
    let speakTimer = null;
    let speakCount = 0;
    let preferredVoice = null; // Cache the best American voice

    function findAmericanVoice() {
        if (preferredVoice) return preferredVoice;
        if (voices.length === 0) return null;

        // Priority list for natural American English voices in Edge
        const priorities = [
            'Jenny',     // Microsoft Jenny Online (Natural) - US female, very natural
            'Aria',      // Microsoft Aria Online (Natural) - US female
            'Guy',       // Microsoft Guy Online (Natural) - US male
            'Eric',      // Microsoft Eric Online (Natural) - US male
            'Michelle',  // Microsoft Michelle Online (Natural) - US female
        ];

        // Try to find a natural US voice
        for (const name of priorities) {
            const found = voices.find(v => 
                v.name.includes(name) && v.lang === 'en-US'
            );
            if (found) {
                preferredVoice = found;
                console.log('[Audio] Selected voice:', found.name);
                return found;
            }
        }

        // Fallback: any en-US voice
        const usVoice = voices.find(v => v.lang === 'en-US');
        if (usVoice) {
            preferredVoice = usVoice;
            console.log('[Audio] Fallback voice:', usVoice.name);
            return usVoice;
        }

        return null;
    }

    function speak(text, slow = false) {
        if (!text) return;
        if (!('speechSynthesis' in window)) return;

        // Ensure voices are loaded
        if (!voicesLoaded || voices.length === 0) {
            voices = speechSynthesis.getVoices();
            voicesLoaded = voices.length > 0;
        }

        // Clear any pending speak timer
        if (speakTimer) {
            clearTimeout(speakTimer);
            speakTimer = null;
        }

        // Every 5 speaks, do a hard reset to prevent Edge hang
        speakCount++;
        if (speakCount >= 5) {
            speakCount = 0;
            speechSynthesis.cancel();
            // Longer delay after hard reset
            speakTimer = setTimeout(() => {
                _doSpeak(text, slow);
            }, 500);
            return;
        }

        // Normal path: cancel if speaking, then speak
        if (speechSynthesis.speaking || speechSynthesis.pending) {
            speechSynthesis.cancel();
            speakTimer = setTimeout(() => {
                _doSpeak(text, slow);
            }, 300);
        } else {
            speakTimer = setTimeout(() => {
                _doSpeak(text, slow);
            }, 50);
        }
    }

    function _doSpeak(text, slow) {
        // Safety: resume in case it's paused
        speechSynthesis.resume();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = slow ? 0.55 : speechRate;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        utterance.lang = 'en-US';

        // Select best American voice
        const voice = findAmericanVoice();
        if (voice) {
            utterance.voice = voice;
        }

        // If user manually chose a voice in settings, use that instead
        if (currentVoice !== null) {
            const englishVoices = voices.filter(v => v.lang.startsWith('en'));
            if (englishVoices[currentVoice]) {
                utterance.voice = englishVoices[currentVoice];
            }
        }

        // Debug logging
        utterance.onstart = () => console.log('[Audio] Speaking:', text);
        utterance.onerror = (e) => {
            console.error('[Audio] Speech error:', e.error, text);
            // On error, reset the engine for next attempt
            speechSynthesis.cancel();
            speakCount = 5; // Force hard reset on next speak
        };
        utterance.onend = () => console.log('[Audio] Finished:', text);

        speechSynthesis.speak(utterance);

        // Timeout recovery: if speech hasn't started in 3 seconds, force reset
        setTimeout(() => {
            if (speechSynthesis.pending && !speechSynthesis.speaking) {
                console.warn('[Audio] Speech hung, forcing reset');
                speechSynthesis.cancel();
                speakCount = 5;
            }
        }, 3000);
    }

    // Current word for replay
    let currentWord = '';

    function setCurrentWord(word) {
        currentWord = word;
    }

    function replayCurrentWord(slow = false) {
        if (!currentWord) return;
        console.log('[Audio] Replay requested:', currentWord, 'slow:', slow);
        // Force reset before replay to ensure it works
        speechSynthesis.cancel();
        speakCount = 0; // Reset counter so it doesn't trigger hard reset
        setTimeout(() => {
            _doSpeak(currentWord, slow);
        }, 400);
    }

    // Sound Effects using Web Audio API (no external files needed)
    function playCorrect() {
        if (!sfxEnabled) return;
        const ctx = getAudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523, ctx.currentTime);
        osc.frequency.setValueAtTime(659, ctx.currentTime + 0.1);
        osc.frequency.setValueAtTime(784, ctx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.4);
    }

    function playWrong() {
        if (!sfxEnabled) return;
        const ctx = getAudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(200, ctx.currentTime);
        osc.frequency.setValueAtTime(150, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
    }

    function playLevelComplete() {
        if (!sfxEnabled) return;
        const ctx = getAudioContext();
        const notes = [523, 587, 659, 784, 880, 1047];
        notes.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.1);
            gain.gain.setValueAtTime(0.2, ctx.currentTime + i * 0.1);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.1 + 0.3);
            osc.start(ctx.currentTime + i * 0.1);
            osc.stop(ctx.currentTime + i * 0.1 + 0.3);
        });
    }

    function playAchievement() {
        if (!sfxEnabled) return;
        const ctx = getAudioContext();
        const notes = [784, 988, 1175, 1319, 1568];
        notes.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.08);
            gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.08);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.08 + 0.4);
            osc.start(ctx.currentTime + i * 0.08);
            osc.stop(ctx.currentTime + i * 0.08 + 0.4);
        });
    }

    function playCombo() {
        if (!sfxEnabled) return;
        const ctx = getAudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.2);
    }

    // Settings
    function setVoice(value) {
        currentVoice = value === 'default' ? null : parseInt(value);
    }

    function setRate(value) {
        speechRate = parseFloat(value);
        localStorage.setItem('typing_game_rate', value);
    }

    function setSFX(value) {
        sfxEnabled = value === 'on';
        localStorage.setItem('typing_game_sfx', value);
    }

    function isSupported() {
        return 'speechSynthesis' in window;
    }

    return {
        init,
        speak,
        setCurrentWord,
        replayCurrentWord,
        playCorrect,
        playWrong,
        playLevelComplete,
        playAchievement,
        playCombo,
        setVoice,
        setRate,
        setSFX,
        isSupported
    };
})();
