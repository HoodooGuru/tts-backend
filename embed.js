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

        // 1. Process Content (Wrap words)
        function processContent() {
            // Select all readable elements: paragraphs, headings, lists, tables
            const paragraphs = contentContainer.querySelectorAll('p, h1, h2, h3, h4, li, td, th');

            paragraphs.forEach(p => {
                const text = p.textContent;
                const words = text.split(/(\s+)/);
                p.innerHTML = '';

                words.forEach(word => {
                    if (word.trim().length > 0) {
                        const span = document.createElement('span');
                        span.textContent = word;
                        span.className = 'tts-word';
                        span.addEventListener('click', () => { /* seek? */ });
                        p.appendChild(span);
                    } else {
                        p.appendChild(document.createTextNode(word));
                    }
                });
            });

            // Flatten for indexing
            const spans = contentContainer.querySelectorAll('.tts-word');
            globalText = "";
            charIndexMap = [];

            spans.forEach(span => {
                const word = span.textContent;
                const startIndex = globalText.length;
                globalText += word + " ";
                for (let i = 0; i < word.length; i++) {
                    charIndexMap[startIndex + i] = span;
                }
                charIndexMap[startIndex + word.length] = null;
            });
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
                currentAlignment = data.alignment;

                currentAudio.src = audioUrl;
                currentAudio.playbackRate = 1.0;

                currentAudio.onplay = () => {
                    statusText.textContent = "Reading...";
                    startSyncLoop();
                };

                currentAudio.onended = () => {
                    resetUI();
                    stopSyncLoop();
                    clearHighlights();
                };

                await currentAudio.play();
                isPaused = false;

            } catch (e) {
                console.error(e);
                statusText.textContent = "Error";
                toggleButtons(false);
            }
        }

        function stopSpeaking() {
            currentAudio.pause();
            currentAudio.currentTime = 0;
            isPaused = false;
            resetUI();
            stopSyncLoop();
            clearHighlights();
        }

        function pauseSpeaking() {
            if (!currentAudio.paused) {
                currentAudio.pause();
                isPaused = true;
                toggleButtons(false);
                statusText.textContent = "Paused";
                stopSyncLoop();
            }
        }

        // 4. Sync & Highlight
        function startSyncLoop() {
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
            function loop() {
                const currentTime = currentAudio.currentTime;
                const activeItem = currentAlignment.find(item =>
                    currentTime >= item.start && currentTime < item.end
                );

                if (activeItem) {
                    highlightWordAt(activeItem.text_offset);
                }

                if (!currentAudio.paused) {
                    animationFrameId = requestAnimationFrame(loop);
                }
            }
            loop();
        }

        function stopSyncLoop() {
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
        }

        let currentHighlightedSpan = null;
        function highlightWordAt(charIndex) {
            const span = charIndexMap[charIndex];
            if (span && span !== currentHighlightedSpan) {
                if (currentHighlightedSpan) {
                    currentHighlightedSpan.classList.remove('tts-active');
                }
                span.classList.add('tts-active');
                currentHighlightedSpan = span;

                // Robust Scroll Logic
                // Only scroll if the element is getting close to the edge of the viewport
                const rect = span.getBoundingClientRect();
                const safeZoneTop = window.innerHeight * 0.3; // Top 30%
                const safeZoneBottom = window.innerHeight * 0.7; // Bottom 70%

                // If element is outside the middle 40% of screen, scroll it to center
                // We use 'behavior: smooth' but only trigger when needed to avoid constant jank
                if (rect.top < safeZoneTop || rect.bottom > safeZoneBottom) {
                    span.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
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
