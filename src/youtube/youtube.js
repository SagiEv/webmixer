"use strict";


/* ============================================================
   STATE
============================================================ */

let video = null;

let browseItems = [];

let browseIndex = 0;

let lastState = null;

let audioCtx = null;
let eqVideoElement = null;
let filterHigh = null;
let filterMid = null;
let filterLow = null;

// Effect Nodes
let effectInput = null;
let effectOutput = null;
let effectDry = null;
let effectWet = null;
let effectRouter = null;
let activeEffectNodes = {}; // Container for dynamic effect nodes
let currentBpm = 120; // Default fallback BPM


/* ============================================================
   HELPERS
============================================================ */

function findVideo() {
    const videos = document.querySelectorAll("video");

    if (!videos.length) {
        return null;
    }

    let v = videos[0];
    // Prefer a video that has fully loaded its duration
    for (const vid of videos) {
        if (Number.isFinite(vid.duration) && vid.duration > 0) {
            v = vid;
            break;
        }
    }

    video = v;
    setupAudioEQ(video);
    
    return video;
}

function setupAudioEQ(v) {
    if (eqVideoElement === v) return; // Already attached to this video element

    try {
        if (!audioCtx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AudioContext();

            // EQ Nodes
            filterLow = audioCtx.createBiquadFilter();
            filterLow.type = "lowshelf";
            filterLow.frequency.value = 250;
            
            filterMid = audioCtx.createBiquadFilter();
            filterMid.type = "peaking";
            filterMid.frequency.value = 1000;
            filterMid.Q.value = 1;

            filterHigh = audioCtx.createBiquadFilter();
            filterHigh.type = "highshelf";
            filterHigh.frequency.value = 4000;

            // Effects Routing
            effectInput = audioCtx.createGain();
            effectOutput = audioCtx.createGain();
            effectDry = audioCtx.createGain();
            effectWet = audioCtx.createGain();
            effectRouter = audioCtx.createGain();
            
            effectDry.gain.value = 1.0;
            effectWet.gain.value = 0.0;
            effectRouter.gain.value = 1.0;

            // Connect EQ chain
            filterLow.connect(filterMid);
            filterMid.connect(filterHigh);
            
            // Connect EQ to Effects Input
            filterHigh.connect(effectInput);
            
            // Split to Dry and Router
            effectInput.connect(effectDry);
            effectInput.connect(effectRouter);

            // Merge back to Output
            effectDry.connect(effectOutput);
            effectWet.connect(effectOutput);
            
            // Output to destination
            effectOutput.connect(audioCtx.destination);
        }

        // Connect the current video element to the filter chain
        const sourceNode = audioCtx.createMediaElementSource(v);
        sourceNode.connect(filterLow);
        
        eqVideoElement = v;
        
        // Very basic pseudo-BPM detection: attempt to extract a BPM based on energy (mock implementation for now)
        // In reality, robust real-time BPM detection in JS is complex and requires analyzing audio buffers.
        // We will default to 120 and let the user override or just stick to 120 for this prototype.
        currentBpm = 125; 
        
    } catch (e) {
        if (e.name === "InvalidStateError" || (e.message && e.message.includes("Extension context invalidated"))) {
            // Ignore InvalidStateError or invalidated context on reload
        } else {
            console.debug("Could not setup Web Audio API EQ for video:", e);
        }
    }
}

// Cleans up existing effect nodes
function cleanupEffects() {
    if (activeEffectNodes.lfo) {
        try { activeEffectNodes.lfo.stop(); } catch(e){}
    }
    
    // Disconnect the router so old nodes get garbage collected
    if (effectRouter) {
        try { effectRouter.disconnect(); } catch(e){}
    }
    
    // Disconnect all active nodes
    for (const key in activeEffectNodes) {
        if (activeEffectNodes[key] && activeEffectNodes[key].disconnect) {
            try { activeEffectNodes[key].disconnect(); } catch(e){}
        }
    }
    activeEffectNodes = {};
}

// Maps value from [0, 1] to [min, max]
function mapRange(val, min, max) {
    return min + val * (max - min);
}

// Maps value from [0, 1] to [min, max] logarithmically
function mapLog(val, min, max) {
    return min * Math.pow(max / min, val);
}

// Builds the synthetic reverb network (Schroeder-style simple reverb)
function buildAlgorithmicReverb() {
    const inputGain = audioCtx.createGain();
    inputGain.gain.value = 0.5; // Attenuate input to prevent clipping
    const outputGain = audioCtx.createGain();
    outputGain.gain.value = 0.25; // Attenuate sum of 4 parallel comb filters
    
    // 4 parallel comb filters
    const combDelays = [0.0297, 0.0371, 0.0411, 0.0437];
    const combNodes = [];
    const combGains = [];
    
    for (let i = 0; i < 4; i++) {
        const delay = audioCtx.createDelay(1.0);
        delay.delayTime.value = combDelays[i];
        
        const feedback = audioCtx.createGain();
        feedback.gain.value = 0.7; // Resonance (will be modified by Y)
        
        const filter = audioCtx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 3000;
        
        inputGain.connect(delay);
        delay.connect(filter);
        filter.connect(feedback);
        feedback.connect(delay);
        
        delay.connect(outputGain);
        
        combNodes.push({ delay, feedback, filter });
    }
    
    // 2 series allpass filters
    const allpass1 = audioCtx.createBiquadFilter();
    allpass1.type = "allpass";
    allpass1.frequency.value = 100;
    
    const allpass2 = audioCtx.createBiquadFilter();
    allpass2.type = "allpass";
    allpass2.frequency.value = 300;
    
    outputGain.connect(allpass1);
    allpass1.connect(allpass2);
    
    activeEffectNodes.reverbCombs = combNodes;
    activeEffectNodes.reverbInput = inputGain;
    activeEffectNodes.reverbOutput = allpass2;
    
    effectRouter.connect(inputGain);
    allpass2.connect(effectWet);
}

// Apply the effect configuration
function applyEffect(opts) {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    const { type, paramX, paramY, beat } = opts;
    
    // If effect changed, rebuild nodes
    if (type !== activeEffectNodes.type) {
        cleanupEffects();
        activeEffectNodes.type = type;
        
        switch (type) {
            case "FLT":
                activeEffectNodes.filter = audioCtx.createBiquadFilter();
                activeEffectNodes.filter.type = "lowpass";
                effectRouter.connect(activeEffectNodes.filter);
                activeEffectNodes.filter.connect(effectWet);
                break;
                
            case "ECHO":
            case "DLY":
            case "ROL":
            case "RPT":
                activeEffectNodes.delay = audioCtx.createDelay(2.0);
                activeEffectNodes.feedback = audioCtx.createGain();
                
                effectRouter.connect(activeEffectNodes.delay);
                activeEffectNodes.delay.connect(activeEffectNodes.feedback);
                activeEffectNodes.feedback.connect(activeEffectNodes.delay);
                activeEffectNodes.delay.connect(effectWet);
                break;
                
            case "FLU":
            case "PHS":
                activeEffectNodes.delay = audioCtx.createDelay(1.0);
                activeEffectNodes.lfo = audioCtx.createOscillator();
                activeEffectNodes.lfoGain = audioCtx.createGain();
                activeEffectNodes.feedback = audioCtx.createGain();
                
                activeEffectNodes.lfo.type = "sine";
                activeEffectNodes.lfo.connect(activeEffectNodes.lfoGain);
                activeEffectNodes.lfoGain.connect(activeEffectNodes.delay.delayTime);
                
                effectRouter.connect(activeEffectNodes.delay);
                activeEffectNodes.delay.connect(activeEffectNodes.feedback);
                activeEffectNodes.feedback.connect(activeEffectNodes.delay);
                activeEffectNodes.delay.connect(effectWet);
                
                activeEffectNodes.lfo.start();
                break;
                
            case "REVERB":
                buildAlgorithmicReverb();
                break;
        }
    }
    
    // Apply parameters based on current type
    if (type === "NONE") {
        effectDry.gain.value = 1.0;
        effectWet.gain.value = 0.0;
        return;
    }
    
    // Default Wet/Dry (XY pads often map X to effect param and Y to depth/feedback)
    let wetMix = 0.5;
    let dryMix = 0.5;
    
    const delayTimeSec = (60 / currentBpm) * beat;
    
    switch (type) {
        case "FLT":
            if (paramX < 0.48) {
                activeEffectNodes.filter.type = "lowpass";
                // 0 to 0.48 -> 200Hz to 20000Hz
                activeEffectNodes.filter.frequency.setTargetAtTime(mapLog(paramX / 0.48, 200, 20000), audioCtx.currentTime, 0.05);
                wetMix = 1.0; dryMix = 0.0;
            } else if (paramX > 0.52) {
                activeEffectNodes.filter.type = "highpass";
                // 0.52 to 1.0 -> 20Hz to 10000Hz
                activeEffectNodes.filter.frequency.setTargetAtTime(mapLog((paramX - 0.52) / 0.48, 20, 10000), audioCtx.currentTime, 0.05);
                wetMix = 1.0; dryMix = 0.0;
            } else {
                // Center detent (pass-through)
                wetMix = 0.0; dryMix = 1.0;
            }
            // Y: Resonance (Q) (0.1 - 10 to prevent blowout)
            activeEffectNodes.filter.Q.setTargetAtTime(mapRange(paramY, 0.1, 10), audioCtx.currentTime, 0.05);
            break;
            
        case "ECHO":
        case "DLY":
            // X: Delay Time modifier (0.1x to 2x of beat time)
            activeEffectNodes.delay.delayTime.setTargetAtTime(delayTimeSec * mapRange(paramX, 0.1, 2.0), audioCtx.currentTime, 0.05);
            // Y: Feedback amount (safe max of 0.85 to prevent howling)
            activeEffectNodes.feedback.gain.setTargetAtTime(mapRange(paramY, 0.0, 0.85), audioCtx.currentTime, 0.05);
            wetMix = 0.5;
            dryMix = 1.0;
            break;
            
        case "ROL":
        case "RPT":
            // X: Roll size based on beat
            const fractions = [0.0625, 0.125, 0.25, 0.5, 1]; // 1/16, 1/8, 1/4, 1/2, 1
            const fractionIndex = Math.round(paramX * (fractions.length - 1));
            // Very fast transition for rhythmic snapping
            activeEffectNodes.delay.delayTime.setTargetAtTime((60 / currentBpm) * fractions[fractionIndex], audioCtx.currentTime, 0.01);
            
            // Y controls Feedback and Wet mix
            activeEffectNodes.feedback.gain.setTargetAtTime(mapRange(paramY, 0.5, 0.95), audioCtx.currentTime, 0.05);
            wetMix = paramY > 0.05 ? paramY : 0.0;
            dryMix = 1.0 - wetMix;
            break;
            
        case "FLU":
        case "PHS":
            // Flanger/Phaser using modulated delay
            // X: LFO Rate
            activeEffectNodes.lfo.frequency.setTargetAtTime(mapRange(paramX, 0.1, 5.0), audioCtx.currentTime, 0.05);
            // Base delay time
            activeEffectNodes.delay.delayTime.setTargetAtTime(type === "FLU" ? 0.005 : 0.002, audioCtx.currentTime, 0.05);
            // LFO Depth (Y) - Guaranteed not to exceed base delay
            activeEffectNodes.lfoGain.gain.setTargetAtTime(mapRange(paramY, 0.001, type === "FLU" ? 0.004 : 0.002), audioCtx.currentTime, 0.05);
            activeEffectNodes.feedback.gain.setTargetAtTime(0.6, audioCtx.currentTime, 0.05);
            
            wetMix = 0.5;
            dryMix = 0.5;
            break;
            
        case "REVERB":
            // X: Wet/Dry Mix
            wetMix = paramX;
            dryMix = 1.0 - paramX;
            
            // Y: Room size / Decay (Controls feedback of comb filters)
            if (activeEffectNodes.reverbCombs) {
                const decay = mapRange(paramY, 0.4, 0.88); // Reduced max decay to prevent howling
                activeEffectNodes.reverbCombs.forEach(comb => {
                    comb.feedback.gain.setTargetAtTime(decay, audioCtx.currentTime, 0.05);
                });
            }
            break;
    }
    
    // Smooth gain adjustments to avoid pops
    effectWet.gain.setTargetAtTime(wetMix, audioCtx.currentTime, 0.05);
    effectDry.gain.setTargetAtTime(dryMix, audioCtx.currentTime, 0.05);
}

// Convert 0..1 to dB (-40 to +12)
function eqToDb(val) {
    if (val === 0.5) return 0;
    if (val < 0.5) return -40 * (1 - (val * 2));
    return 12 * ((val - 0.5) * 2);
}

function applyEQ(eq) {
    if (!audioCtx) {
        // If not created yet (user hasn't interacted), we might need to resume it later
        return;
    }
    
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    
    if (filterHigh && eq.high !== undefined) filterHigh.gain.value = eqToDb(eq.high);
    if (filterMid && eq.mid !== undefined) filterMid.gain.value = eqToDb(eq.mid);
    if (filterLow && eq.low !== undefined) filterLow.gain.value = eqToDb(eq.low);
}


function getVideoState() {

    const v =
        findVideo();


    if (!v) {

        return {
            paused: true,
            currentTime: 0,
            duration: 0,
            volume: 1,
            rate: 1,
            title:
                document.title
        };
    }


    return {

        paused:
            v.paused,

        currentTime:
            v.currentTime || 0,

        duration:
            v.duration || 0,

        volume:
            v.volume,

        rate:
            v.playbackRate,

        title:
            document.title,
            
        cuePoint: v.dataset.ionCue ? Number(v.dataset.ionCue) : null,
        
        queue: getQueue()
    };
}


/* ============================================================
   VIDEO STATE REPORTING
============================================================ */

function reportState() {

    const state =
        getVideoState();


    const serialized =
        JSON.stringify(
            state
        );


    if (
        serialized ===
        lastState
    ) {
        return;
    }


    lastState =
        serialized;


    try {
        chrome.runtime.sendMessage({
            type: "VIDEO_STATE",
            state
        });
    } catch (e) {
        if (e.message && e.message.includes("Extension context invalidated")) {
            if (typeof monitorInterval !== "undefined" && monitorInterval) clearInterval(monitorInterval);
            if (typeof spaInterval !== "undefined" && spaInterval) clearInterval(spaInterval);
        }
    }
}


/* ============================================================
   VIDEO DISCOVERY & MONITORING
============================================================ */

let monitorInterval = null;
let hasRequestedNext = false; // Prevent multiple requests for next video

function startVideoMonitoring() {

    monitorInterval = setInterval(
        () => {

            const v = findVideo();

            reportState();
            
            // Check if video is ending to pop custom queue
            if (v && v.duration > 0 && !hasRequestedNext) {
                // If video has ended natively, or is within the last 0.5s of playing
                if (v.ended || (v.currentTime >= v.duration - 0.5 && !v.paused)) {
                    hasRequestedNext = true;
                    chrome.runtime.sendMessage({ type: "POP_CUSTOM_QUEUE" }).then(res => {
                        // If no custom video was popped, reset flag after a delay in case they replay
                        if (!res?.ok) {
                            setTimeout(() => { hasRequestedNext = false; }, 2000);
                        }
                    }).catch(() => {
                        hasRequestedNext = false;
                    });
                }
            }

        },
        500
    );
}

startVideoMonitoring();


/* ============================================================
   MESSAGE HANDLER
============================================================ */

chrome.runtime.onMessage.addListener(
    (
        message,
        sender,
        sendResponse
    ) => {

        if (
            message.type ===
            "GET_STATE"
        ) {

            sendResponse({
                ok: true,

                state:
                    getVideoState()
            });


            return true;
        }


        if (
            message.type ===
            "DECK_COMMAND"
        ) {

            handleDeckCommand(
                message.command,
                message.value
            )
                .then(
                    result =>
                        sendResponse(
                            result
                        )
                );


            return true;
        }


        if (
            message.type ===
            "BROWSE_MOVE"
        ) {

            const result =
                browseMove(
                    message.delta
                );


            sendResponse(
                result
            );


            return true;
        }


        if (
            message.type ===
            "BROWSE_QUEUE_SELECTED"
        ) {

            const result =
                queueSelected();


            sendResponse(
                result
            );


            return true;
        }
    }
);


/* ============================================================
   DECK COMMANDS
============================================================ */

async function handleDeckCommand(
    command,
    value
) {
    const v = findVideo();

    if (!v) {
        return { ok: false, error: "YouTube video element not found." };
    }

    try {
        switch (command) {

            case "PLAY_PAUSE":
                if (v.paused) {
                    // Remove 'await' and catch the error gracefully
                    v.play().catch(error => console.warn("Play blocked by browser:", error));
                } else {
                    v.pause();
                }
                break;


            case "VOLUME":

                v.volume =
                    Math.max(
                        0,
                        Math.min(
                            1,
                            Number(value)
                        )
                    );

                break;


            case "SEEK":

                v.currentTime =
                    Math.max(
                        0,
                        Math.min(
                            v.duration || Infinity,
                            v.currentTime +
                            Number(value)
                        )
                    );

                break;


            case "RATE":

                v.playbackRate =
                    Math.max(
                        0.25,
                        Math.min(
                            2,
                            Number(value)
                        )
                    );

                break;


            case "CUE_SET":

                v.dataset.ionCue =
                    String(
                        v.currentTime
                    );

                break;


            case "CUE_RETURN":
                if (v.dataset.ionCue) {
                    v.currentTime = Number(v.dataset.ionCue);
                }
                break;

            case "SET_EQ":
                applyEQ(value);
                break;

            case "SET_AUDIO_EFFECT":
                applyEffect(value);
                break;

            default:

                return {
                    ok: false,

                    error:
                        `Unknown command: ${command}`
                };
        }


        reportState();


        return {
            ok: true
        };

    } catch (error) {

        return {
            ok: false,

            error:
                error.message
        };
    }
}


/* ============================================================
   BROWSE
============================================================ */

function collectSuggestions() {
    // Look for both the old renderers and the new yt-lockup-view-model
    const containers = Array.from(document.querySelectorAll(
        "ytd-compact-video-renderer, ytd-video-renderer, ytd-rich-item-renderer, yt-lockup-view-model"
    ));

    const results = [];

    for (const container of containers) {
        // Find any watch link inside this container
        const link = container.querySelector("a[href*='/watch?v=']");
        if (!link) continue;

        const videoId = extractVideoId(link.href);
        if (!videoId || results.some(item => item.id === videoId)) continue;

        // Extract Title: Checks new h3 attributes and old structural elements
        const titleEl = container.querySelector("h3[title], .ytLockupMetadataViewModelHeadingReset, #video-title, .yt-core-attributed-string");
        let title = titleEl?.getAttribute("title") || titleEl?.getAttribute("aria-label") || titleEl?.textContent || link.getAttribute("title") || "YouTube Video";
        title = title.trim();

        // Extract Channel
        const channelEl = container.querySelector("ytd-channel-name, .ytContentMetadataViewModelMetadataText, .yt-core-attributed-string[aria-label]");
        let channel = channelEl?.textContent || "";
        channel = channel.trim();

        // YouTube sets tabindex="-1" on new thumbnails, which blocks standard .focus()
        // We force it to be focusable so the browser's native outline appears
        if (link.getAttribute("tabindex") === "-1") {
            link.setAttribute("tabindex", "0");
        }

        results.push({
            id: videoId,
            title,
            channel,
            url: link.href,
            domNode: link,
            container: container
        });
    }

    return results;
}


function extractVideoId(
    url
) {

    try {

        const parsed =
            new URL(
                url
            );


        return parsed.searchParams.get(
            "v"
        );

    } catch {

        return null;
    }
}


/* ============================================================
   BROWSE MOVE
============================================================ */

function browseMove(delta) {
    browseItems = collectSuggestions();

    if (!browseItems.length) {
        return { ok: true, index: 0, count: 0, selected: null };
    }

    browseIndex = Math.max(0, Math.min(browseItems.length - 1, browseIndex));

    if (delta !== 0) {
        browseIndex += delta;

        // Wrap around
        if (browseIndex < 0) browseIndex = browseItems.length - 1;
        if (browseIndex >= browseItems.length) browseIndex = 0;
    }

    const selected = browseItems[browseIndex];

    // --- EXECUTE NATIVE FOCUS & SCROLL ---
    if (selected && selected.domNode) {
        selected.domNode.focus();
        selected.domNode.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    /* 
     * Chrome Extensions cannot send raw DOM nodes via messaging.
     * We create a clean, serializable object to send back to the UI.
     */
    const safeSelected = {
        id: selected.id,
        title: selected.title,
        channel: selected.channel,
        url: selected.url
    };

    return {
        ok: true,
        index: browseIndex,
        count: browseItems.length,
        selected: safeSelected
    };
}


/* ============================================================
   QUEUE
============================================================ */

function queueSelected() {
    const activeEl = document.activeElement;

    if (!activeEl) {
        return { ok: false, message: "No active element focused." };
    }

    // Include the new yt-lockup-view-model in the closest search
    const container = activeEl.closest("ytd-compact-video-renderer, ytd-video-renderer, ytd-rich-item-renderer, yt-lockup-view-model");

    if (!container) {
        return { ok: false, message: "Please use the browse knob to focus a video first." };
    }

    const titleEl = container.querySelector("h3[title], .ytLockupMetadataViewModelHeadingReset, #video-title, .yt-core-attributed-string");
    const title = (titleEl?.getAttribute("title") || titleEl?.textContent || "Selected Video").trim();

    // Target the menu button via structural classes
    const menuButton = container.querySelector(".ytLockupMetadataViewModelMenuButton button, button[aria-label*='Action menu'], ytd-menu-renderer button");

    if (menuButton) {
        // Open the three-dot menu
        menuButton.click();

        // Poll for the popup menu to appear (up to 1.5 seconds)
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            
            // Find all potential menu items in the DOM
            const menuItems = Array.from(document.querySelectorAll("ytd-menu-service-item-renderer, yt-formatted-string, .ytListItemViewModelButtonOrAnchor"));

            // Search in reverse to prioritize the most recently appended popup
            const queueItem = menuItems.reverse().find(item => {
                const text = item.innerText || item.textContent || "";
                return /add to queue|queue|\u05d4\u05d5\u05e1\u05e4\u05d4 \u05dc\u05e8\u05e9\u05d9\u05de\u05ea \u05d4\u05d1\u05d0\u05d9\u05dd \u05d1\u05ea\u05d5\u05e8|\u05d1\u05ea\u05d5\u05e8/i.test(text);
            });

            if (queueItem) {
                clearInterval(interval);
                
                // Click the closest clickable parent element
                const clickable = queueItem.closest('button, yt-button-shape, tp-yt-paper-item, ytd-menu-service-item-renderer, .ytListItemViewModelButtonOrAnchor') || queueItem;
                clickable.click(); 

                // Return focus back to the thumbnail so you don't lose your place
                setTimeout(() => activeEl.focus(), 150);
            } else if (attempts > 15) { // 1.5 seconds timeout
                clearInterval(interval);
                console.warn("Queue menu item not found after waiting.");
                document.body.click(); // Close menu
            }
        }, 100);

        return { ok: true, message: `Queued: ${title}` };
    }

    return { ok: false, message: `Action menu not found for: ${title}` };
}

function getQueue() {
    // Attempt to find the queue elements. YouTube uses different containers depending on state.
    // miniplayer queue: ytd-miniplayer ytd-playlist-panel-video-renderer
    // playlist queue: ytd-playlist-panel-renderer ytd-playlist-panel-video-renderer
    // We'll select all visible ytd-playlist-panel-video-renderer items.
    const queueItems = document.querySelectorAll("ytd-playlist-panel-video-renderer");
    const queue = [];
    
    // Get the current playing video title to robustly match against queue items
    let playingTitle = document.title.replace(/^\(\d+\)\s+/, '').replace(/ - YouTube$/, '').trim();
    const h1Title = document.querySelector('h1.ytd-watch-metadata, h1.title.ytd-video-primary-info-renderer');
    if (h1Title) {
        playingTitle = h1Title.textContent.trim();
    }
    
    for (const item of queueItems) {
        // Skip hidden items or non-queue items
        if (item.offsetParent === null) continue;
        
        const titleEl = item.querySelector("#video-title");
        const channelEl = item.querySelector("#byline");
        
        if (titleEl) {
            const itemTitle = titleEl.textContent.trim() || titleEl.getAttribute("title") || "Unknown Title";
            
            // Check if this item is currently playing by matching titles
            let isPlaying = false;
            if (itemTitle === playingTitle || playingTitle.includes(itemTitle) || itemTitle.includes(playingTitle)) {
                isPlaying = true;
            } else {
                // Fallback: visual playing indicator
                const playbackIndicator = item.querySelector('ytd-thumbnail-overlay-playback-status-renderer, #playing-indicator, [id="playing-indicator"]');
                if (playbackIndicator && playbackIndicator.offsetParent !== null && playbackIndicator.textContent.includes("PLAYING")) {
                    isPlaying = true;
                }
            }

            queue.push({
                title: itemTitle,
                channel: channelEl ? channelEl.textContent.trim() : "",
                isPlaying: isPlaying
            });
        }
    }
    
    return queue;
}

function findSuggestionElement(
    videoId
) {

    const links =
        Array.from(
            document.querySelectorAll(
                "a[href*='/watch?v=']"
            )
        );


    for (
        const link of links
    ) {

        const id =
            extractVideoId(
                link.href
            );


        if (
            id === videoId
        ) {

            return (
                link.closest(
                    "ytd-compact-video-renderer"
                ) ||
                link.closest(
                    "ytd-video-renderer"
                ) ||
                link.closest(
                    "ytd-rich-item-renderer"
                ) ||
                link.parentElement
            );
        }
    }


    return null;
}


/* ============================================================
   SPA NAVIGATION
============================================================ */

let lastUrl =
    location.href;

let spaInterval = setInterval(
    () => {

        if (
            location.href !==
            lastUrl
        ) {

            lastUrl =
                location.href;


            browseItems = [];

            browseIndex = 0;

            setTimeout(
                reportState,
                1000
            );
        }

    },
    500
);