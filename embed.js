(function () {
    // --- Configuration ---
    let config = {
        selector: 'article',
        apiUrl: 'http://localhost:8002',
        position: 'bottom-right'
    };

    // Expose Global API
    window.TTSWidget = {
        init: function (userConfig) {
            config = { ...config, ...userConfig };
            loadWidget();
        }
    };

    // --- CSS Injection ---
    const styles = `
    :root {
        --primary-color: #2563eb;
        --widget-bg: #2C4F5B; /* User requested colour */
        --widget-text: #ffffff;
        --highlight-current-word: #fde047;
    }
    
    /* Highlight Classes */
    .tts-word {
        transition: background-color 0.2s ease;
        border-radius: 3px;
        cursor: pointer;
    }
    .tts-word:hover { background-color: rgba(44, 79, 91, 0.1); }
    .tts-active {
        background-color: var(--highlight-current-word);
        color: #000;
        box-shadow: 0 0 0 2px var(--highlight-current-word);
    }
    
    /* Settings Panel - Hidden for sleekness, but keeping styles just in case */
    .tts-settings-panel {
        display: none; /* User requested hide */
    }
    
    /* Floating Widget */
    .tts-widget {
        position: fixed;
        bottom: 30px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 15px;
        padding: 10px 20px;
        
        background: var(--widget-bg);
        color: var(--widget-text);
        
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 50px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
        z-index: 9999;
        font-family: 'Outfit', sans-serif;
        font-size: 15px;
    }
    
    /* Buttons */
    .tts-controls { display: flex; align-items: center; gap: 8px; }
    
    .control-btn {
        background: rgba(255,255,255,0.15);
        color: white;
        border: none;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        cursor: pointer;
        font-size: 0.9rem;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
    }
    .control-btn:hover {
        background: white;
        color: var(--widget-bg);
        transform: scale(1.05);
    }
    
    /* Status Text */
    .tts-status {
        font-weight: 500;
        min-width: 140px;
        text-align: center;
        letter-spacing: 0.5px;
        white-space: nowrap;
    }
    
    /* Hide Settings Cog */
    .tts-settings-toggle { display: none; }
    `;

    // --- HTML Injection ---
    function loadWidget() {
        // Inject CSS
        const styleEl = document.createElement('style');
        styleEl.textContent = styles;
        document.head.appendChild(styleEl);

        // Inject Font Awesome (if not present) and Fonts
        if (!document.querySelector('link[href*="font-awesome"]')) {
            const fontAwesome = document.createElement('link');
            fontAwesome.rel = 'stylesheet';
            fontAwesome.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
            document.head.appendChild(fontAwesome);
        }

        // Inject Google Fonts (Outfit)
        const fontLink = document.createElement('link');
        fontLink.rel = 'stylesheet';
        fontLink.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600&display=swap';
        document.head.appendChild(fontLink);

        // Inject Widget HTML
        const widgetHtml = `
            <div class="tts-widget" id="tts-widget" style="display:none;"> <!-- Hidden initially -->
                <div class="tts-settings-panel hidden" id="settings-panel">
                    <div class="setting-group">
                        <label for="voice-select">Voice</label>
                        <select id="voice-select"></select>
                    </div>
                    <div class="setting-group">
                        <label for="backend-rate-slider">Speed</label>
                        <input type="range" id="rate-slider" min="0.5" max="2" value="1" step="0.1">
                    </div>
                </div>

                <div class="tts-controls">
                    <button id="btn-play" class="control-btn" aria-label="Play">
                        <i class="fa-solid fa-play"></i>
                    </button>
                    <button id="btn-pause" class="control-btn hidden" aria-label="Pause">
                        <i class="fa-solid fa-pause"></i>
                    </button>
                    <button id="btn-stop" class="control-btn" aria-label="Stop">
                        <i class="fa-solid fa-stop"></i>
                    </button>
                </div>
                <div class="tts-status">
                    <span id="status-text">Listen to this article</span>
                </div>
                <div class="tts-settings-toggle" id="btn-settings">
                    <i class="fa-solid fa-gear"></i>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', widgetHtml);

        // Initialize Logic
        initLogic();
    }

    // --- Widget Logic ---
    function initLogic() {
        const contentContainer = document.querySelector(config.selector);
        if (!contentContainer) {
            console.error('TTSWidget: Content selector not found:', config.selector);
            return;
        }

        const widget = document.getElementById('tts-widget');
        widget.style.display = 'flex'; // Show widget

        const playBtn = document.getElementById('btn-play');
        const pauseBtn = document.getElementById('btn-pause');
        const stopBtn = document.getElementById('btn-stop');
        const statusText = document.getElementById('status-text');
        const voiceSelect = document.getElementById('voice-select');
        const rateSlider = document.getElementById('rate-slider');
        const settingsPanel = document.getElementById('settings-panel');
        const settingsBtn = document.getElementById('btn-settings');

        let textElements = [];
        let globalText = "";
        let charIndexMap = [];
        let currentAudio = new Audio();
        let currentAlignment = [];
        let animationFrameId = null;
        let isPaused = false;

        // 1. Process Content (Wrap words & Indexing)
        function processContent() {
            // A. Wrap text in Spans (Visual Only)
            // Target all potential text containers including DIVs this time
            const elements = contentContainer.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, th, td, blockquote, div');

            elements.forEach(el => {
                if (el.classList.contains('tts-processed') || !el.textContent.trim()) return;

                // Crucial: Only process "Leaf-like" blocks. 
                // If it contains other block-level elements, skip it (let recursion find them).
                if (el.querySelector('p, table, div, ul, ol, h1, h2, h3, h4, h5, h6, li')) return;

                const text = el.textContent;
                // Split by whitespace
                const words = text.split(/(\s+)/);
                el.innerHTML = '';
                el.classList.add('tts-processed');

                words.forEach(word => {
                    const trimmed = word.trim();
                    if (trimmed.length > 0) {
                        const span = document.createElement('span');
                        span.textContent = word; // visual keeps full text
                        span.className = 'tts-word';
                        el.appendChild(span);
                    } else {
                        el.appendChild(document.createTextNode(word));
                    }
                });
            });

            // B. Build Global Text & Index Map (Logical Order)
            globalText = "";
            charIndexMap = [];

            function appendSpan(span) {
                const word = span.textContent;

                // SIMPLE SANITIZATION:
                // Remove emojis/symbols from the AUDIO text to match standard TTS behavior.
                // We keep them in the visual span, but don't map offsets for them.
                // Regex: Keep Letters, Numbers, Punctuation, Whitespace.
                const speakableWord = word.replace(/[^\p{L}\p{N}\p{P}\s]/gu, '');

                if (!speakableWord.trim()) return; // Nothing to speak here

                const startIndex = globalText.length;
                globalText += speakableWord;
                const endIndex = startIndex + speakableWord.length;

                for (let i = startIndex; i < endIndex; i++) {
                    charIndexMap[i] = span;
                }
            }

            function appendPause(str = " ") {
                const startIndex = globalText.length;
                globalText += str;
                for (let i = startIndex; i < globalText.length; i++) {
                    charIndexMap[i] = null;
                }
            }

            // Recursive Traversal Helper
            function traverse(node) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    const tag = node.tagName;

                    // Skip hidden elements or scripts
                    if (tag === 'SCRIPT' || tag === 'STYLE' || node.style.display === 'none') return;

                    // 1. Tables: Column-wise
                    if (tag === 'TABLE') {
                        const rows = Array.from(node.querySelectorAll('tr'));
                        if (rows.length === 0) return;
                        let maxCols = 0;
                        rows.forEach(r => maxCols = Math.max(maxCols, r.cells.length));

                        for (let c = 0; c < maxCols; c++) {
                            rows.forEach(r => {
                                if (r.cells[c]) {
                                    const cellSpans = r.cells[c].querySelectorAll('.tts-word');
                                    cellSpans.forEach(s => { appendSpan(s); appendPause(" "); });
                                    appendPause(". ");
                                }
                            });
                            appendPause(" . . . ");
                        }
                        return; // Done
                    }

                    // 2. Headings
                    if (['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(tag)) {
                        const spans = node.querySelectorAll('.tts-word');
                        spans.forEach(s => { appendSpan(s); appendPause(" "); });
                        appendPause(" . . . ");
                        return;
                    }

                    // 3. List Items
                    if (tag === 'LI') {
                        const spans = node.querySelectorAll('.tts-word');
                        spans.forEach(s => { appendSpan(s); appendPause(" "); });
                        appendPause(" . ");
                        return;
                    }

                    // 4. Generic Text Blocks (P, DIV, etc.)
                    // Check if this specific node was processed as a text container
                    if (node.classList.contains('tts-processed')) {
                        const spans = node.querySelectorAll('.tts-word');
                        spans.forEach(s => { appendSpan(s); appendPause(" "); });
                        // Add pause after block-level text containers
                        if (['P', 'DIV', 'BLOCKQUOTE'].includes(tag)) appendPause(" . ");
                        return;
                    }

                    // Continue recursion
                    Array.from(node.children).forEach(child => traverse(child));
                }
            }

            traverse(contentContainer);
        }

        processContent();

        // 2. Load Voices
        let voices = [
            { name: "Natasha (Neural) - AU", id: "en-AU-NatashaNeural" },
            { name: "Carly (Neural) - AU", id: "en-AU-CarlyNeural" },
            { name: "William (Neural) - AU", id: "en-AU-WilliamNeural" },
            { name: "Sonia (Neural) - UK", id: "en-GB-SoniaNeural" },
            { name: "Ryan (Neural) - UK", id: "en-GB-RyanNeural" },
            { name: "Jenny (Neural) - US", id: "en-US-JennyNeural" },
            { name: "Guy (Neural) - US", id: "en-US-GuyNeural" }
        ];

        voices.forEach((voice) => {
            const option = document.createElement('option');
            option.textContent = voice.name;
            option.value = voice.id;
            voiceSelect.appendChild(option);
        });
        voiceSelect.selectedIndex = 0;

        settingsBtn.addEventListener('click', () => {
            settingsPanel.classList.toggle('hidden');
        });

        // 3. Playback Logic
        async function startSpeaking() {
            if (!currentAudio.paused && isPaused) {
                currentAudio.play();
                isPaused = false;
                toggleButtons(true);
                statusText.textContent = "Resuming...";
                startSyncLoop();
                return;
            }

            if (!currentAudio.paused) {
                stopSpeaking();
            }

            toggleButtons(true);
            statusText.textContent = "Generating...";

            try {
                const selectedVoiceId = voiceSelect.value;
                const rateVal = parseFloat(rateSlider.value);

                const response = await fetch(`${config.apiUrl}/api/tts`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: globalText,
                        voice: selectedVoiceId,
                        rate: rateVal
                    })
                });

                if (!response.ok) throw new Error("TTS Failed");

                const data = await response.json();
                const audioUrl = `${config.apiUrl}${data.audio_url}`;
                currentAlignment = data.alignment; // List of {start, end, text_offset...}

                currentAudio.src = audioUrl;
                currentAudio.playbackRate = 1.0;

                currentAudio.onplay = () => {
                    statusText.textContent = "Reading...";
                    startSyncLoop();
                };

                // Add error handler
                currentAudio.onerror = (e) => {
                    console.error("Audio Playback Error", e);
                    statusText.textContent = "Error";
                    toggleButtons(false);
                };

                currentAudio.onended = () => {
                    stopSpeaking();
                };

                currentAudio.play();

            } catch (err) {
                console.error(err);
                statusText.textContent = "Error";
                toggleButtons(false);
            }
        }

        function stopSpeaking() {
            currentAudio.pause();
            currentAudio.currentTime = 0;
            isPaused = false;
            if (animationFrameId) cancelAnimationFrame(animationFrameId);

            // Clear highlights
            const active = contentContainer.querySelectorAll('.tts-active');
            active.forEach(el => el.classList.remove('tts-active'));

            toggleButtons(false);
            statusText.textContent = "Ready";
        }

        function pauseSpeaking() {
            if (!currentAudio.paused) {
                currentAudio.pause();
                isPaused = true;
                toggleButtons(false);
                statusText.textContent = "Paused";
                if (animationFrameId) cancelAnimationFrame(animationFrameId); // Stop sync loop on pause
            }
        }

        // 4. Synchronization Loop (The "Engine")
        function startSyncLoop() {
            // Bias reset to near-zero as text lengths now match.
            const LATENCY_BIAS = 0.05;

            function loop() {
                if (currentAudio.paused || !currentAlignment) return;

                const t = currentAudio.currentTime + LATENCY_BIAS;

                // Find matching word
                const match = currentAlignment.find(a => t >= a.start && t < a.end);

                // Clear previous (only if changing or if invalid)
                const active = contentContainer.querySelector('.tts-active');
                if (active && (!match || charIndexMap[match.text_offset] !== active)) {
                    active.classList.remove('tts-active');
                }

                if (match) {
                    const span = charIndexMap[match.text_offset];
                    if (span) {
                        span.classList.add('tts-active');

                        // Auto-scroll logic
                        const rect = span.getBoundingClientRect();
                        const safeZoneTop = window.innerHeight * 0.3;
                        const safeZoneBottom = window.innerHeight * 0.7;

                        if (rect.top < safeZoneTop || rect.bottom > safeZoneBottom) {
                            span.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                    }
                }
                animationFrameId = requestAnimationFrame(loop);
            }
            animationFrameId = requestAnimationFrame(loop);
        }

        function clearHighlights() {
            if (currentHighlightedSpan) {
                currentHighlightedSpan.classList.remove('tts-active');
                currentHighlightedSpan = null;
            }
            document.querySelectorAll('.tts-active').forEach(el => el.classList.remove('tts-active'));
        }

        function toggleButtons(isPlaying) {
            if (isPlaying) {
                playBtn.classList.add('hidden');
                pauseBtn.classList.remove('hidden');
            } else {
                playBtn.classList.remove('hidden');
                pauseBtn.classList.add('hidden');
            }
        }

        function resetUI() {
            toggleButtons(false);
            statusText.textContent = "Listen to this article";
            clearHighlights();
            isPaused = false;
        }

        playBtn.addEventListener('click', startSpeaking);
        pauseBtn.addEventListener('click', pauseSpeaking);
        stopBtn.addEventListener('click', stopSpeaking);
    }
})();
