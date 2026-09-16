"use strict";


let state = null;

let midiAccess = null;

let midiInput = null;

let midiOutput = null;

function sendMidiLED(note, on) {
    if (!midiOutput) return;
    try {
        midiOutput.send([0x90, note, on ? 127 : 0]);
    } catch (e) {
        console.warn("MIDI LED error", e);
    }
}

const synthCtx = new (window.AudioContext || window.webkitAudioContext)();

// Pre-generate a long noise buffer so we don't create one per call
const _scratchNoiseLen = synthCtx.sampleRate; // 1 second
const _scratchNoiseBuf = synthCtx.createBuffer(1, _scratchNoiseLen, synthCtx.sampleRate);
{
    const d = _scratchNoiseBuf.getChannelData(0);
    for (let i = 0; i < _scratchNoiseLen; i++) {
        d[i] = Math.random() * 2 - 1;
    }
}

function playScratchSound(delta) {
    if (synthCtx.state === 'suspended') synthCtx.resume();

    const now = synthCtx.currentTime;
    const speed = Math.abs(delta);
    const direction = delta >= 0 ? 1 : -1;

    // Duration: short bursts that scale slightly with speed
    const dur = Math.max(0.03, Math.min(0.12, 0.03 + speed * 0.0006));

    // Master gain — fast attack, smooth decay
    const master = synthCtx.createGain();
    const vol = Math.min(0.6, 0.2 + speed * 0.004);
    master.gain.setValueAtTime(0.001, now);
    master.gain.linearRampToValueAtTime(vol, now + 0.003);
    master.gain.setValueAtTime(vol, now + dur * 0.3);
    master.gain.exponentialRampToValueAtTime(0.001, now + dur);
    master.connect(synthCtx.destination);

    // ── PRIMARY: Bandpass-filtered noise — the core vinyl friction ──
    const noise1 = synthCtx.createBufferSource();
    noise1.buffer = _scratchNoiseBuf;
    // Random start offset so each scratch sounds different
    noise1.start(now, Math.random() * 0.7, dur + 0.01);

    const bp = synthCtx.createBiquadFilter();
    bp.type = 'bandpass';
    // Vinyl scratch lives in 1.5kHz–6kHz range
    const startFreq = direction > 0
        ? 2200 + speed * 30 + Math.random() * 300
        : 4500 + speed * 15 + Math.random() * 400;
    const endFreq = direction > 0
        ? 4800 + speed * 20 + Math.random() * 500
        : 1800 + speed * 10 + Math.random() * 200;
    bp.frequency.setValueAtTime(startFreq, now);
    bp.frequency.linearRampToValueAtTime(endFreq, now + dur);
    // Low Q = wide band = natural friction; avoid resonant ringing
    bp.Q.value = 0.6 + Math.random() * 0.5;

    noise1.connect(bp);
    bp.connect(master);

    // ── SIBILANCE: Highpass noise layer for the sharp "zip" edge ──
    const noise2 = synthCtx.createBufferSource();
    noise2.buffer = _scratchNoiseBuf;
    noise2.start(now, Math.random() * 0.5, dur + 0.01);

    const hp = synthCtx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(5000 + speed * 40, now);
    hp.frequency.linearRampToValueAtTime(3000 + speed * 20, now + dur);
    hp.Q.value = 0.3;

    const sibilGain = synthCtx.createGain();
    sibilGain.gain.value = 0.25 + speed * 0.002;

    noise2.connect(hp);
    hp.connect(sibilGain);
    sibilGain.connect(master);

    // ── SUBTLE TONAL HINT: Very quiet, heavily filtered sawtooth ──
    // Just enough to give a slight "record" color, not a pitched tone
    if (speed > 15) {
        const osc = synthCtx.createOscillator();
        osc.type = 'sawtooth';
        const f = direction > 0 ? 120 + speed * 1.5 : 200 + speed * 1.2;
        osc.frequency.setValueAtTime(f, now);
        osc.frequency.linearRampToValueAtTime(f * (direction > 0 ? 0.8 : 1.15), now + dur);

        const oscLp = synthCtx.createBiquadFilter();
        oscLp.type = 'lowpass';
        oscLp.frequency.value = 800;
        oscLp.Q.value = 0.5;

        const oscGain = synthCtx.createGain();
        // Very quiet — just texture, not audible as a tone
        oscGain.gain.value = 0.06;

        osc.connect(oscLp);
        oscLp.connect(oscGain);
        oscGain.connect(master);
        osc.start(now);
        osc.stop(now + dur);
    }
}


/* ============================================================
   HELPERS
============================================================ */

function $(id) {

    return document.getElementById(id);
}


function send(message) {

    return new Promise(resolve => {

        chrome.runtime.sendMessage(
            message,
            response => {

                if (
                    chrome.runtime.lastError
                ) {

                    resolve({
                        ok: false,

                        error:
                            chrome.runtime.lastError.message
                    });

                    return;
                }


                resolve(
                    response
                );
            }
        );
    });
}


function formatTime(
    seconds
) {


    if (
        !Number.isFinite(seconds)
    ) {
        return "0:00";
    }


    seconds =
        Math.max(
            0,
            Math.floor(seconds)
        );


    const minutes =
        Math.floor(
            seconds / 60
        );


    const remaining =
        seconds % 60;


    return (
        `${minutes}:` +
        `${String(
            remaining
        ).padStart(
            2,
            "0"
        )}`
    );
}

async function refreshYouTubeTabSelectors() {

    const response = await send({
        type: "GET_YOUTUBE_TABS"
    });

    if (!response?.ok) {
        return;
    }

    const tabs = response.tabs || [];

    for (const deck of ["A", "B"]) {

        const select =
            $(`tabSelect${deck}`);

        if (!select) {
            continue;
        }

        const currentTab =
            state?.deckTabs?.[deck];

        select.innerHTML = "";

        const empty =
            document.createElement("option");

        empty.value = "";
        empty.textContent =
            "Choose YouTube tab...";

        select.appendChild(empty);


        for (const tab of tabs) {

            const option =
                document.createElement("option");

            option.value =
                String(tab.id);

            let label =
                tab.title || "YouTube";

            if (tab.active) {
                label = "▶ " + label;
            }

            if (tab.audible) {
                label += " 🔊";
            }

            option.textContent =
                label;

            if (
                Number(currentTab) ===
                Number(tab.id)
            ) {
                option.selected = true;
            }

            select.appendChild(option);
        }
    }
}

async function refreshDeckTitles() {

    for (const deck of ["A", "B"]) {

        const tabId =
            state?.deckTabs?.[deck];

        const titleElement =
            $(`title${deck}`);

        if (!tabId) {

            titleElement.textContent =
                "No YouTube tab";

            continue;
        }

        try {

            const tab =
                await chrome.tabs.get(tabId);

            titleElement.textContent =
                tab.title ||
                "YouTube";

        } catch {

            titleElement.textContent =
                "Tab closed";
        }
    }

    await refreshYouTubeTabSelectors();
}

for (const deck of ["A", "B"]) {
    $(`tabSelect${deck}`).addEventListener("change", async event => {
        const tabId = Number(event.target.value);
        if (!tabId) {
            return;
        }

        const response = await send({ type: "SET_DECK_TAB", deck, tabId });
        if (!response?.ok) {
            return;
        }

        state = response.state;
        renderState();
        await refreshDeckTitles();
        await refreshTitles();

        try {
            const tabResponse = await chrome.tabs.sendMessage(tabId, { type: "GET_STATE" });
            if (tabResponse?.state) {
                renderVideoState(deck, tabResponse.state);
            }
        } catch (error) {
            console.warn("Could not sync initial state:", error);
        }

        if (stateResponse?.state) {
            renderVideoState(deck, stateResponse.state);
        }

        if (state.activeDeck === deck) {
            await showBrowse();
        }
    });
}

/* ============================================================
   INIT
============================================================ */

async function init() {

    const response =
        await send({
            type:
                "CONTROLLER_READY"
        });


    if (
        response?.state
    ) {

        state =
            response.state;

        renderState();

        await refreshDeckTitles();
        await refreshTitles();
    } else {
        // Fetch and render YouTube tabs even if state isn't initialized yet
        await refreshYouTubeTabSelectors();
    }

    const controllerSelect = $("controllerSelect");
    if (controllerSelect && state && state.selectedControllerPreference) {
        controllerSelect.value = state.selectedControllerPreference;
    }

    if (controllerSelect) {
        controllerSelect.addEventListener("change", async (event) => {
            const preference = event.target.value;
            await send({ type: "SET_CONTROLLER_PREFERENCE", preference });
        });
    }

    await connectMIDI();
}


/* ============================================================
   STATE RENDER
============================================================ */

function renderState() {

    if (!state) {
        return;
    }

    const controllerSelect = $("controllerSelect");
    if (controllerSelect && state.selectedControllerPreference && controllerSelect.value !== state.selectedControllerPreference) {
        controllerSelect.value = state.selectedControllerPreference;
    }

    /*
     * Active deck
     */

    $("deckA")
        .classList.toggle(
            "active",
            state.activeDeck === "A"
        );


    $("deckB")
        .classList.toggle(
            "active",
            state.activeDeck === "B"
        );


    $("browseDeck")
        .textContent =
        state.activeDeck;

    /*
     * EQ & Scratch Mode
     */
    const eqModeBtn = $("toggleEqMode");
    if (eqModeBtn) {
        const is3Band = state.eqMode === 3;
        eqModeBtn.innerHTML = is3Band ? "3 EQ" : "2 EQ";
        eqModeBtn.classList.toggle("neon-blue", is3Band);
        
        // Show/Hide MID and VOLUME
        $("midContainerA").style.display = is3Band ? "flex" : "none";
        $("midContainerB").style.display = is3Band ? "flex" : "none";
        $("volContainerA").style.display = is3Band ? "none" : "flex";
        $("volContainerB").style.display = is3Band ? "none" : "flex";

        // Update Labels (2EQ: TREBLE/BASS, 3EQ: HIGH/LOW)
        $("highLabelA").textContent = is3Band ? "HIGH" : "TREBLE";
        $("highLabelB").textContent = is3Band ? "HIGH" : "TREBLE";
        $("lowLabelA").textContent = is3Band ? "LOW" : "BASS";
        $("lowLabelB").textContent = is3Band ? "LOW" : "BASS";
    }
    
    const scratchBtn = $("toggleScratchMode");
    if (scratchBtn) {
        scratchBtn.innerHTML = "SCRATCH";
        scratchBtn.classList.toggle("neon-yellow", state.scratchMode);
    }
    
    // Update Scratch LED (0x48)
    sendMidiLED(0x48, state.scratchMode);
    
    // Set EQ sliders
    if (state.deckEQ) {
        $("highA").value = Math.round(state.deckEQ.A.high * 100);
        $("midA").value = Math.round(state.deckEQ.A.mid * 100);
        $("lowA").value = Math.round(state.deckEQ.A.low * 100);
        
        $("highB").value = Math.round(state.deckEQ.B.high * 100);
        $("midB").value = Math.round(state.deckEQ.B.mid * 100);
        $("lowB").value = Math.round(state.deckEQ.B.low * 100);
    }

    /*
     * Mixer
     */

    $("volumeA").value =
        Math.round(
            state.deckVolume.A * 100
        );


    $("volumeB").value =
        Math.round(
            state.deckVolume.B * 100
        );


    $("masterVolume").value =
        Math.round(
            state.masterVolume * 100
        );


    $("crossfader").value =
        Math.round(
            state.crossfader * 100
        );


    updateCrossText();


    /*
     * Rates
     */

    $("rateA")
        .textContent =
        `${state.rate.A.toFixed(2)}x`;


    $("rateB")
        .textContent =
        `${state.rate.B.toFixed(2)}x`;

    renderEffectsState();
}


/* ============================================================
   MIDI
============================================================ */

async function connectMIDI() {

    if (
        !navigator.requestMIDIAccess
    ) {

        setMidiStatus(
            "unsupported"
        );

        return;
    }


    setMidiStatus(
        "searching"
    );


    try {

        midiAccess =
            await navigator.requestMIDIAccess();


        midiAccess.onstatechange =
            handleMIDIStateChange;


        findMIDIInput();


    } catch (error) {

        console.error(
            "MIDI access failed:",
            error
        );


        setMidiStatus(
            "error"
        );
    }
}


function findMIDIInput() {

    if (!midiAccess) {
        return;
    }


    const inputs =
        Array.from(
            midiAccess.inputs.values()
        );


    if (!inputs.length) {

        midiInput = null;

        setMidiStatus(
            "disconnected"
        );

        $("midiDevice")
            .textContent =
            "No MIDI input detected.";

        return;
    }


    /*
     * Prefer ION / Discover / DJ devices.
     */

    const preferred =
        inputs.find(
            input => {

                const name =
                    (
                        input.name ||
                        ""
                    ).toLowerCase();


                return (
                    name.includes("ion") ||
                    name.includes("discover") ||
                    name.includes("dj")
                );
            }
        );


    midiInput =
        preferred ||
        inputs[0];


    midiInput.onmidimessage =
        handleMIDIMessage;

    // Get corresponding output
    const outputs = Array.from(midiAccess.outputs.values());
    const preferredOut = outputs.find(output => {
        const name = (output.name || "").toLowerCase();
        return name.includes("ion") || name.includes("discover") || name.includes("dj");
    });
    midiOutput = preferredOut || outputs[0] || null;

    if (state) {
        sendMidiLED(0x48, state.scratchMode);
    }


    setMidiStatus(
        "connected",
        midiInput.name
    );


    $("midiDevice")
        .textContent =
        midiInput.name ||
        "MIDI controller";
}


function handleMIDIStateChange() {

    findMIDIInput();
}


function handleMIDIMessage(
    event
) {

    const data =
        Array.from(
            event.data
        );


    send({
        type:
            "MIDI_MESSAGE",

        data
    });
}


function setMidiStatus(
    status,
    name = ""
) {

    const element =
        $("midiStatus");


    if (
        status ===
        "connected"
    ) {

        element.textContent =
            "MIDI ✓";

        element.className =
            "midi connected";


        $("midiDevice")
            .textContent =
            name ||
            "ION controller";

        return;
    }


    if (
        status ===
        "searching"
    ) {

        element.textContent =
            "MIDI SEARCHING";

        element.className =
            "midi disconnected";

        return;
    }


    if (
        status ===
        "unsupported"
    ) {

        element.textContent =
            "MIDI UNSUPPORTED";

        element.className =
            "midi disconnected";

        return;
    }


    element.textContent =
        "MIDI DISCONNECTED";

    element.className =
        "midi disconnected";
}


/* ============================================================
   MANUAL MIDI CONNECT
============================================================ */

$("connectMidi")
    .addEventListener(
        "click",
        async () => {

            await connectMIDI();
        }
    );


/* ============================================================
   DECK FOCUS
============================================================ */

$("focusA")
    .addEventListener(
        "click",
        () => focusDeck("A")
    );


$("focusB")
    .addEventListener(
        "click",
        () => focusDeck("B")
    );


async function focusDeck(
    deck
) {

    await send({
        type:
            "SET_ACTIVE_DECK",

        deck
    });


    await send({
        type:
            "FOCUS_DECK",

        deck
    });


    state.activeDeck =
        deck;


    renderState();

    await showBrowse();
}


/* ============================================================
   PLAY
============================================================ */

$("playA")
    .addEventListener(
        "click",
        () =>
            send({
                type:
                    "DECK_COMMAND",

                deck:
                    "A",

                command:
                    "PLAY_PAUSE"
            })
    );


$("playB")
    .addEventListener(
        "click",
        () =>
            send({
                type:
                    "DECK_COMMAND",

                deck:
                    "B",

                command:
                    "PLAY_PAUSE"
            })
    );


/* ============================================================
   CUE
============================================================ */

$("cueA")
    .addEventListener(
        "click",
        () =>
            send({
                type: "DJ_ACTION",
                actionObj: { action: "CUE", deck: "A" }
            })
    );


$("cueB")
    .addEventListener(
        "click",
        () =>
            send({
                type: "DJ_ACTION",
                actionObj: { action: "CUE", deck: "B" }
            })
    );


/* ============================================================
   DECK VOLUME
============================================================ */

$("volumeA")
    .addEventListener(
        "input",
        async event => {

            const value =
                Number(
                    event.target.value
                ) / 100;


            state.deckVolume.A =
                value;


            await send({
                type:
                    "SET_DECK_VOLUME",

                deck:
                    "A",

                volume:
                    value
            });
        }
    );


$("volumeB")
    .addEventListener(
        "input",
        async event => {

            const value =
                Number(
                    event.target.value
                ) / 100;


            state.deckVolume.B =
                value;


            await send({
                type:
                    "SET_DECK_VOLUME",

                deck:
                    "B",

                volume:
                    value
            });
        }
    );


/* ============================================================
   MASTER
============================================================ */

$("masterVolume")
    .addEventListener(
        "input",
        async event => {

            const value =
                Number(
                    event.target.value
                ) / 100;


            state.masterVolume =
                value;


            await send({
                type:
                    "SET_MASTER_VOLUME",

                value
            });
        }
    );


// Helper for EQ sliders in UI
function setupEqSlider(deck, band) {
    const el = $(`${band}${deck}`);
    if (el) {
        el.addEventListener("input", async event => {
            const value = Number(event.target.value) / 100;
            if (!state.deckEQ) return;
            state.deckEQ[deck][band] = value;
            await send({
                type: "SET_EQ_UI",
                deck,
                band,
                value
            });
        });
    }
}
setupEqSlider("A", "high");
setupEqSlider("A", "mid");
setupEqSlider("A", "low");
setupEqSlider("B", "high");
setupEqSlider("B", "mid");
setupEqSlider("B", "low");

$("toggleEqMode")?.addEventListener("click", async () => {
    await send({ type: "TOGGLE_EQ_MODE" });
});

$("toggleScratchMode")?.addEventListener("click", async () => {
    await send({ type: "TOGGLE_SCRATCH_MODE" });
});


/* ============================================================
   EFFECTS
============================================================ */

$("effectType")?.addEventListener("change", async event => {
    if (!state) return;
    state.effects.type = event.target.value;
    await send({ type: "SET_EFFECT", effects: state.effects });
});

$("effectDeck")?.addEventListener("change", async event => {
    if (!state) return;
    state.effects.deck = event.target.value;
    await send({ type: "SET_EFFECT", effects: state.effects });
});

function handleSelectScroll(event) {
    if (!state) return;
    event.preventDefault();
    
    const select = event.currentTarget;
    const currentIndex = select.selectedIndex;
    let newIndex = currentIndex;
    
    if (event.deltaY > 0) {
        newIndex = Math.min(currentIndex + 1, select.options.length - 1);
    } else if (event.deltaY < 0) {
        newIndex = Math.max(currentIndex - 1, 0);
    }
    
    if (newIndex !== currentIndex) {
        select.selectedIndex = newIndex;
        select.dispatchEvent(new Event('change'));
    }
}

$("effectType")?.addEventListener("wheel", handleSelectScroll, { passive: false });
$("effectDeck")?.addEventListener("wheel", handleSelectScroll, { passive: false });

document.querySelectorAll(".beat-btn").forEach(btn => {
    btn.addEventListener("click", async event => {
        if (!state) return;
        document.querySelectorAll(".beat-btn").forEach(b => b.classList.remove("active"));
        event.target.classList.add("active");
        state.effects.beat = Number(event.target.dataset.beat);
        await send({ type: "SET_EFFECT", effects: state.effects });
    });
});

const xyPad = $("xyPad");
const xyNode = $("xyNode");
let xyActive = false;

function updateXyPad(clientX, clientY) {
    if (!state || !xyPad) return;
    const rect = xyPad.getBoundingClientRect();
    let x = (clientX - rect.left) / rect.width;
    let y = 1.0 - ((clientY - rect.top) / rect.height); // Invert Y so bottom is 0

    x = Math.max(0, Math.min(1, x));
    y = Math.max(0, Math.min(1, y));

    state.effects.paramX = x;
    state.effects.paramY = y;
    
    if (xyNode) {
        xyNode.style.left = `${x * 100}%`;
        xyNode.style.top = `${(1 - y) * 100}%`;
        
        // Create neon trail
        const trail = document.createElement('div');
        trail.className = 'xy-trail';
        trail.style.left = `${x * 100}%`;
        trail.style.top = `${(1 - y) * 100}%`;
        xyPad.appendChild(trail);
        
        setTimeout(() => {
            if (trail.parentNode) trail.parentNode.removeChild(trail);
        }, 400); // Remove after animation
    }

    send({ type: "SET_EFFECT", effects: state.effects });
}

xyPad?.addEventListener("pointerdown", event => {
    xyActive = true;
    xyPad.setPointerCapture(event.pointerId);
    updateXyPad(event.clientX, event.clientY);
});

xyPad?.addEventListener("pointermove", event => {
    if (!xyActive) return;
    updateXyPad(event.clientX, event.clientY);
});

xyPad?.addEventListener("pointerup", event => {
    xyActive = false;
    xyPad.releasePointerCapture(event.pointerId);
    if ($("xySnapToggle")?.checked) {
        state.effects.paramX = 0.5;
        state.effects.paramY = 0.5;
        if (xyNode) {
            xyNode.style.left = "50%";
            xyNode.style.top = "50%";
        }
        send({ type: "SET_EFFECT", effects: state.effects });
    }
});

function renderEffectsState() {
    if (!state || !state.effects) return;
    
    const typeSelect = $("effectType");
    if (typeSelect && typeSelect.value !== state.effects.type) {
        typeSelect.value = state.effects.type;
    }

    const deckSelect = $("effectDeck");
    if (deckSelect && deckSelect.value !== state.effects.deck) {
        deckSelect.value = state.effects.deck;
    }

    document.querySelectorAll(".beat-btn").forEach(btn => {
        if (Number(btn.dataset.beat) === state.effects.beat) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });

    if (xyNode && !xyActive) {
        xyNode.style.left = `${state.effects.paramX * 100}%`;
        xyNode.style.top = `${(1 - state.effects.paramY) * 100}%`;
    }
}


/* ============================================================
   CROSSFADER
============================================================ */

$("crossfader")
    .addEventListener(
        "input",
        async event => {

            const value =
                Number(
                    event.target.value
                ) / 100;


            state.crossfader =
                value;


            updateCrossText();


            await send({
                type:
                    "SET_CROSSFADER",

                value
            });
        }
    );


function updateCrossText() {

    if (!state) {
        return;
    }


    const value =
        state.crossfader;


    if (
        value < 0.48
    ) {

        $("crossValue")
            .textContent =
            `A ${Math.round(
                (1 - value) * 100
            )}%`;


    } else if (
        value > 0.52
    ) {

        $("crossValue")
            .textContent =
            `B ${Math.round(
                value * 100
            )}%`;


    } else {

        $("crossValue")
            .textContent =
            "CENTER";
    }
}


/* ============================================================
   BROWSE DECK
============================================================ */

$("browseA")
    .addEventListener(
        "click",
        async () => {

            await setBrowseDeck(
                "A"
            );
        }
    );


$("browseB")
    .addEventListener(
        "click",
        async () => {

            await setBrowseDeck(
                "B"
            );
        }
    );


async function setBrowseDeck(
    deck
) {

    state.activeDeck =
        deck;


    await send({
        type:
            "SET_ACTIVE_DECK",

        deck
    });


    renderState();

    await showBrowse();
}


/* ============================================================
   SHOW BROWSE
============================================================ */

async function showBrowse() {

    const deck =
        state.activeDeck;


    const tabId =
        state.deckTabs[deck];


    if (!tabId) {

        $("browseTitle")
            .textContent =
            `No YouTube tab assigned to Deck ${deck}`;

        $("browseChannel")
            .textContent =
            "Open a YouTube tab first.";

        $("browsePosition")
            .textContent =
            "0 / 0";

        return;
    }


    /*
     * Ask the YouTube content script
     * for the current suggestion.
     */

    const response =
        await send({
            type:
                "BROWSE_MOVE",

            deck,

            delta:
                0
        });


    if (
        response?.result
    ) {

        renderBrowse(
            response.result
        );
    }
}


/* ============================================================
   BROWSE RENDER
============================================================ */

function renderBrowse(
    result
) {

    if (!result) {
        return;
    }


    if (
        !result.selected
    ) {

        $("browseTitle")
            .textContent =
            "No suggestions found";

        $("browseChannel")
            .textContent =
            "";

        $("browsePosition")
            .textContent =
            "0 / 0";

        return;
    }


    $("browseTitle")
        .textContent =
        result.selected.title ||
        "Untitled";


    $("browseChannel")
        .textContent =
        result.selected.channel ||
        "";


    $("browsePosition")
        .textContent =
        `${(result.index ?? 0) + 1} / ${result.count ?? 0
        }`;
}


/* ============================================================
   QUEUE
============================================================ */

$("queueSelected")
    .addEventListener(
        "click",
        async () => {

            const response =
                await send({
                    type:
                        "BROWSE_QUEUE_SELECTED",

                    deck:
                        state.activeDeck
                });


            if (
                response?.result?.message
            ) {

                $("browseTitle")
                    .textContent =
                    response.result.message;
            }
        }
    );


/* ============================================================
   REFRESH DECKS
============================================================ */

$("refresh")
    .addEventListener(
        "click",
        async () => {

            const response =
                await send({
                    type:
                        "REFRESH_TABS",

                    force:
                        false
                });


            if (
                response?.state
            ) {

                state =
                    response.state;


                renderState();


                await refreshTitles();

                await showBrowse();
            }
        }
    );

$("reloadTabA").addEventListener("click", () => {
    const tabId = state?.deckTabs?.["A"];
    if (tabId) chrome.tabs.reload(tabId);
});

$("reloadTabB").addEventListener("click", () => {
    const tabId = state?.deckTabs?.["B"];
    if (tabId) chrome.tabs.reload(tabId);
});


/* ============================================================
   TITLES
============================================================ */

async function refreshTitles() {

    for (
        const deck of [
            "A",
            "B"
        ]
    ) {

        const tabId =
            state.deckTabs[deck];


        if (!tabId) {

            $(`title${deck}`)
                .textContent =
                "No YouTube tab";


            $(`tab${deck}`)
                .textContent =
                "No tab";


            continue;
        }


        try {

            const tab =
                await chrome.tabs.get(
                    tabId
                );


            $(`title${deck}`)
                .textContent =
                tab.title ||
                "YouTube";


            $(`tab${deck}`)
                .textContent =
                `Tab ${tab.id}`;

        } catch {

            $(`title${deck}`)
                .textContent =
                "Tab closed";


            $(`tab${deck}`)
                .textContent =
                "Unavailable";
        }
    }
}


/* ============================================================
   BACKGROUND EVENTS
============================================================ */

chrome.runtime.onMessage.addListener(
    message => {

        if (
            message.type ===
            "MIDI_STATUS"
        ) {

            setMidiStatus(
                message.status,
                message.name
            );
        }


        if (
            message.type ===
            "MIXER_CHANGED"
        ) {

            state =
                message.state;

            renderState();
        }


        if (
            message.type ===
            "ACTIVE_DECK_CHANGED"
        ) {

            state.activeDeck =
                message.deck;

            renderState();

            showBrowse();
        }


        if (
            message.type ===
            "DECKS_CHANGED"
        ) {

            state =
                message.state;

            renderState();

            refreshDeckTitles();

            showBrowse();
        }


        if (
            message.type ===
            "BROWSE_RESULT"
        ) {

            if (
                message.deck ===
                state?.activeDeck
            ) {

                renderBrowse(
                    message.result
                );
            }
        }


        if (
            message.type ===
            "BROWSE_QUEUE_RESULT"
        ) {

            if (
                message.result?.message
            ) {

                $("browseTitle")
                    .textContent =
                    message.result.message;
            }
        }


        if (
            message.type ===
            "VIDEO_STATE"
        ) {

            renderVideoState(
                message.deck,
                message.state
            );
        }


        if (
            message.type ===
            "VIDEO_RATE"
        ) {

            if (
                state?.rate
            ) {

                state.rate[
                    message.deck
                ] =
                    message.rate;


                renderState();
            }
        }

        if (message.type === "EQ_CHANGED" || message.type === "SCRATCH_MODE_CHANGED" || message.type === "EFFECTS_CHANGED") {
            state = message.state;
            renderState();
        }

        if (message.type === "PLAY_SCRATCH_SOUND") {
            playScratchSound(message.delta);
        }

        /* --------------------------------------------------------
           HARDWARE BUTTON FEEDBACK
        -------------------------------------------------------- */
        if (message.type === "MIDI_BUTTON_STATE") {
            const buttonMap = {
                0x4A: "playA",
                0x4C: "playB",
                0x3B: "cueA",
                0x42: "cueB"
            };

            const btnId = buttonMap[message.note];
            if (btnId) {
                const btn = $(btnId);
                if (btn) {
                    if (message.pressed) {
                        btn.classList.add("btn-pressed");
                    } else {
                        btn.classList.remove("btn-pressed");
                    }
                }
            }
        }
    }
);


/* ============================================================
   VIDEO STATE
============================================================ */

function renderVideoState(
    deck,
    videoState
) {
    // Add this guard clause to prevent the 'timeundefined' crash
    if (!deck || !videoState) {
        return;
    }

    const current =
        Number(
            videoState.currentTime
        ) || 0;

    const duration =
        Number(
            videoState.duration
        ) || 0;

    $(`time${deck}`)
        .textContent =
        formatTime(current);

    $(`duration${deck}`)
        .textContent =
        formatTime(duration);


    const percentage =
        duration > 0
            ? (
                current /
                duration
            ) * 100
            : 0;


    $(`progress${deck}`)
        .style.width =
        `${Math.max(
            0,
            Math.min(
                100,
                percentage
            )
        )}%`;
        
    // Handle Cue Marker
    const marker = $(`cueMarker${deck}`);
    if (marker) {
        if (videoState.cuePoint != null && duration > 0) {
            const cuePct = (videoState.cuePoint / duration) * 100;
            marker.style.left = `${Math.max(0, Math.min(100, cuePct))}%`;
            marker.style.display = "block";
        } else {
            marker.style.display = "none";
        }
    }

    // Toggle active playing state on the button
    const playBtn = $(`play${deck}`);
    if (playBtn) {
        if (videoState.paused) {
            playBtn.classList.remove("btn-playing");
        } else {
            playBtn.classList.add("btn-playing");
        }
    }

    // Update LEDs for Play/Pause and Cue
    if (deck === "A") {
        sendMidiLED(0x4A, !videoState.paused); // Play A
        sendMidiLED(0x3B, videoState.paused);  // Cue A (on when paused)
    } else if (deck === "B") {
        sendMidiLED(0x4C, !videoState.paused); // Play B
        sendMidiLED(0x42, videoState.paused);  // Cue B
    }

    if (videoState.title) {
        let cleanTitle = videoState.title;
        if (cleanTitle.endsWith(" - YouTube")) {
            cleanTitle = cleanTitle.substring(0, cleanTitle.length - 10);
        }
        
        const titleElement = $(`title${deck}`);
        if (titleElement && titleElement.textContent !== cleanTitle) {
            titleElement.textContent = cleanTitle;
        }
    }
    
    if (videoState.queue !== undefined) {
        renderQueue(deck, videoState.queue);
    }
}

function renderQueue(deck, queue) {
    const listEl = $(`queueList${deck}`);
    const countEl = $(`queueCount${deck}`);
    
    if (!listEl || !countEl) return;
    
    const custom = state?.customQueue?.[deck] || [];
    const combinedQueue = [...(queue || []), ...custom];
    
    if (!combinedQueue || combinedQueue.length === 0) {
        countEl.textContent = "0";
        listEl.innerHTML = `<div class="queue-empty">Queue is empty</div>`;
        return;
    }
    
    countEl.textContent = String(combinedQueue.length);
    listEl.innerHTML = "";
    
    for (const item of combinedQueue) {
        const itemEl = document.createElement("div");
        itemEl.className = "queue-item";
        
        const titleEl = document.createElement("div");
        titleEl.className = "queue-item-title";
        
        // Indicate custom queued items with a different prefix if desired, or keep it the same
        titleEl.textContent = item.isPlaying ? "▶ " + item.title : item.title;
        
        if (item.isPlaying) {
            itemEl.classList.add("playing");
        }
        
        const channelEl = document.createElement("div");
        channelEl.className = "queue-item-channel";
        channelEl.textContent = item.channel;
        
        itemEl.appendChild(titleEl);
        itemEl.appendChild(channelEl);
        listEl.appendChild(itemEl);
    }
}


/* ============================================================
   YOUTUBE SEARCH & DRAG/DROP
============================================================ */

let searchTimeout = null;
const searchInput = $("ytSearchInput");
const searchResults = $("ytSearchResults");

if (searchInput) {
    searchInput.addEventListener("input", (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value.trim();
        if (!query) {
            searchResults.style.display = "none";
            return;
        }
        searchTimeout = setTimeout(() => performSearch(query), 500);
    });
    
    // Hide results when clicking outside
    document.addEventListener("click", (e) => {
        if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
            searchResults.style.display = "none";
        }
    });
    
    searchInput.addEventListener("focus", () => {
        if (searchInput.value.trim() && searchResults.innerHTML !== "") {
            searchResults.style.display = "block";
        }
    });
}

async function performSearch(query) {
    searchResults.innerHTML = "<div style='padding: 10px; color: #888;'>Searching...</div>";
    searchResults.style.display = "block";
    
    try {
        const response = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
        const html = await response.text();
        
        // Extract ytInitialData
        const match = html.match(/var ytInitialData = ({.*?});<\/script>/);
        if (!match) {
            throw new Error("Could not find ytInitialData");
        }
        
        const data = JSON.parse(match[1]);
        const contents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
        
        let items = [];
        if (contents) {
            for (const section of contents) {
                if (section.itemSectionRenderer?.contents) {
                    items = items.concat(section.itemSectionRenderer.contents.filter(i => i.videoRenderer));
                }
            }
        }
        
        renderSearchResults(items.slice(0, 10));
    } catch (err) {
        console.error("Search error:", err);
        searchResults.innerHTML = "<div style='padding: 10px; color: #ef4444;'>Search failed</div>";
    }
}

function renderSearchResults(items) {
    searchResults.innerHTML = "";
    if (items.length === 0) {
        searchResults.innerHTML = "<div style='padding: 10px; color: #888;'>No results found</div>";
        return;
    }
    
    for (const item of items) {
        const video = item.videoRenderer;
        const id = video.videoId;
        const title = video.title?.runs?.[0]?.text || "Unknown";
        const channel = video.ownerText?.runs?.[0]?.text || "";
        const thumb = video.thumbnail?.thumbnails?.[0]?.url || "";
        
        const el = document.createElement("div");
        el.className = "search-result-item";
        el.draggable = true;
        
        el.innerHTML = `
            <img class="search-result-thumb" src="${thumb}" alt="thumb">
            <div class="search-result-info">
                <div class="search-result-title" title="${title}">${title}</div>
                <div class="search-result-channel">${channel}</div>
            </div>
        `;
        
        el.addEventListener("dragstart", (e) => {
            const dragData = { id, title, channel };
            e.dataTransfer.setData("application/json", JSON.stringify(dragData));
        });
        
        searchResults.appendChild(el);
    }
}

/* Setup Dropzones */
function setupDropzone(elementId, type, deck) {
    const el = $(elementId);
    if (!el) return;
    
    el.addEventListener("dragover", (e) => {
        e.preventDefault(); // Necessary to allow dropping
        el.classList.add("drag-over");
    });
    
    el.addEventListener("dragleave", (e) => {
        el.classList.remove("drag-over");
    });
    
    el.addEventListener("drop", async (e) => {
        e.preventDefault();
        el.classList.remove("drag-over");
        
        try {
            const dataStr = e.dataTransfer.getData("application/json");
            if (!dataStr) return;
            const videoData = JSON.parse(dataStr);
            
            if (type === "deck") {
                await send({ type: "LOAD_URL_IN_DECK", deck, videoId: videoData.id });
            } else if (type === "queue") {
                await send({ type: "ADD_TO_CUSTOM_QUEUE", deck, video: videoData });
            }
            
            searchResults.style.display = "none";
        } catch (err) {
            console.error("Drop error:", err);
        }
    });
}

setupDropzone("deckA", "deck", "A");
setupDropzone("deckB", "deck", "B");
setupDropzone("queueContainerA", "queue", "A");
setupDropzone("queueContainerB", "queue", "B");


/* ============================================================
   START
============================================================ */

init();