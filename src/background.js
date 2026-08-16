"use strict";

importScripts('midi_mappings.js');/* ============================================================
   AUTO-RELOAD EXISTING TABS ON UPDATE
============================================================ */
chrome.runtime.onInstalled.addListener(async () => {
    const tabs = await chrome.tabs.query({
        url: [
            "https://www.youtube.com/*",
            "https://youtube.com/*"
        ]
    });

    for (const tab of tabs) {
        if (tab.discarded) continue;
        try {
            // Reload the tab on extension update/install.
            // This is required to prevent InvalidStateError because the Web Audio API
            // does not allow calling createMediaElementSource() more than once per media element.
            // By reloading the tab, we reset the video element and ensure the EQ feature works.
            chrome.tabs.reload(tab.id);
        } catch (error) {
            // Silently ignore errors for restricted or suspended tabs
        }
    }
});

const CONTROLLER_PATH = "dj.html";


/* ============================================================
   MIDI MAPPING INCLUDES
============================================================ */

// Mappings are loaded via importScripts('midi_mappings.js')
// We store the active parser here
let activeControllerParser = null;
let activeControllerName = "Unknown Controller";

/* ============================================================
   DEFAULT STATE
============================================================ */

const DEFAULT_STATE = {

    controllerTabId: null,

    selectedControllerPreference: "auto",

    deckTabs: {
        A: null,
        B: null
    },

    activeDeck: "A",

    masterVolume: 1,

    deckVolume: {
        A: 1,
        B: 1
    },

    crossfader: 0.5,

    rate: {
        A: 1,
        B: 1
    },

    cue: {
        A: false,
        B: false
    },

    browseIndex: {
        A: 0,
        B: 0
    },

    eqMode: 2,

    scratchMode: false,

    deckEQ: {
        A: { high: 0.5, mid: 0.5, low: 0.5 },
        B: { high: 0.5, mid: 0.5, low: 0.5 }
    },

    effects: {
        type: "NONE",
        deck: "MASTER",
        paramX: 0.5,
        paramY: 0.5,
        beat: 1
    },
    
    customQueue: {
        A: [],
        B: []
    }
};


let state = structuredClone(DEFAULT_STATE);

let stateLoaded = false;


/* ============================================================
   STATE
============================================================ */

async function loadState() {

    if (stateLoaded) {
        return;
    }

    const result =
        await chrome.storage.local.get("djState");


    if (result.djState) {

        const saved =
            result.djState;


        state = {

            ...structuredClone(
                DEFAULT_STATE
            ),

            ...saved,


            deckTabs: {
                ...DEFAULT_STATE.deckTabs,
                ...(saved.deckTabs || {})
            },
            
            selectedControllerPreference: saved.selectedControllerPreference || DEFAULT_STATE.selectedControllerPreference,


            deckVolume: {
                ...DEFAULT_STATE.deckVolume,
                ...(saved.deckVolume || {})
            },


            rate: {
                ...DEFAULT_STATE.rate,
                ...(saved.rate || {})
            },


            cue: {
                ...DEFAULT_STATE.cue,
                ...(saved.cue || {})
            },


            browseIndex: {
                ...DEFAULT_STATE.browseIndex,
                ...(saved.browseIndex || {})
            },

            eqMode: saved.eqMode || DEFAULT_STATE.eqMode,

            scratchMode: saved.scratchMode || DEFAULT_STATE.scratchMode,

            deckEQ: {
                A: { ...DEFAULT_STATE.deckEQ.A, ...(saved.deckEQ?.A || {}) },
                B: { ...DEFAULT_STATE.deckEQ.B, ...(saved.deckEQ?.B || {}) }
            },

            effects: {
                ...DEFAULT_STATE.effects,
                ...(saved.effects || {})
            },
            
            customQueue: {
                A: saved.customQueue?.A || [],
                B: saved.customQueue?.B || []
            }
        };
    }


    stateLoaded = true;
}


async function saveState() {

    await chrome.storage.local.set({
        djState: state
    });
}


async function getState() {

    await loadState();

    return state;
}


/* ============================================================
   CONTROLLER WINDOW / TAB
============================================================ */

chrome.action.onClicked.addListener(
    async () => {

        await loadState();


        if (
            state.controllerTabId &&
            await tabExists(
                state.controllerTabId
            )
        ) {

            await focusTab(
                state.controllerTabId
            );

            return;
        }


        const tab =
            await chrome.tabs.create({
                url:
                    chrome.runtime.getURL(
                        CONTROLLER_PATH
                    )
            });


        state.controllerTabId =
            tab.id;


        await saveState();
    }
);


/* ============================================================
   CONTROLLER TAB CLEANUP
============================================================ */

chrome.tabs.onRemoved.addListener(
    async tabId => {

        await loadState();


        if (
            state.controllerTabId ===
            tabId
        ) {

            state.controllerTabId =
                null;

            await saveState();

            return;
        }


        let changed = false;


        if (
            state.deckTabs.A ===
            tabId
        ) {

            state.deckTabs.A =
                null;

            changed = true;
        }


        if (
            state.deckTabs.B ===
            tabId
        ) {

            state.deckTabs.B =
                null;

            changed = true;
        }


        if (changed) {
            await saveState();
        }
    }
);


/* ============================================================
   MESSAGES
============================================================ */

chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {

        handleMessage(
            message,
            sender
        )
            .then(sendResponse)
            .catch(error => {

                console.error(
                    "Background message error:",
                    error
                );


                sendResponse({
                    ok: false,
                    error:
                        error.message
                });
            });


        return true;
    }
);


async function handleMessage(
    message,
    sender
) {

    await loadState();


    /* --------------------------------------------------------
       CONTROLLER READY
    -------------------------------------------------------- */

    if (
        message.type ===
        "CONTROLLER_READY"
    ) {

        if (sender.tab?.id) {

            state.controllerTabId =
                sender.tab.id;

            await saveState();
        }


        await autoChooseDecks(
            false
        );


        return {
            ok: true,
            state
        };
    }

    if (message.type === "GET_YOUTUBE_TABS") {

        const tabs = await chrome.tabs.query({
            url: [
                "https://www.youtube.com/*",
                "https://youtube.com/*"
            ]
        });

        // Return the object directly instead of using sendResponse
        return {
            ok: true,

            tabs: tabs.map(tab => ({
                id: tab.id,
                title: tab.title || "YouTube",
                active: tab.active,
                audible: tab.audible,
                windowId: tab.windowId
            }))
        };
    }
    /* --------------------------------------------------------
       GET STATE
    -------------------------------------------------------- */

    if (
        message.type ===
        "GET_STATE"
    ) {

        return {
            ok: true,
            state
        };
    }


    /* --------------------------------------------------------
       REFRESH DECKS
    -------------------------------------------------------- */

    if (
        message.type ===
        "REFRESH_TABS"
    ) {

        await autoChooseDecks(
            message.force === true
        );


        return {
            ok: true,
            state
        };
    }


    /* --------------------------------------------------------
       SET ACTIVE DECK
    -------------------------------------------------------- */

    if (
        message.type ===
        "SET_ACTIVE_DECK"
    ) {

        state.activeDeck =
            message.deck === "B"
                ? "B"
                : "A";


        await saveState();


        return {
            ok: true,
            state
        };
    }


    /* --------------------------------------------------------
       FOCUS DECK
    -------------------------------------------------------- */

    if (
        message.type ===
        "FOCUS_DECK"
    ) {

        await focusDeck(
            message.deck
        );


        state.activeDeck =
            message.deck === "B"
                ? "B"
                : "A";


        await saveState();


        return {
            ok: true,
            state
        };
    }


    /* --------------------------------------------------------
       MANUALLY ASSIGN TAB
    -------------------------------------------------------- */

    if (
        message.type ===
        "SET_DECK_TAB"
    ) {

        const deck =
            message.deck === "B"
                ? "B"
                : "A";


        state.deckTabs[deck] =
            Number(message.tabId) ||
            null;


        await saveState();

        if (state.deckTabs[deck]) {
            await pushStateToDeck(deck);
        }

        return {
            ok: true,
            state
        };
    }


    /* --------------------------------------------------------
       PLAY / CUE / ETC.
    -------------------------------------------------------- */

    if (
        message.type ===
        "DECK_COMMAND"
    ) {

        return await sendToDeck(
            message.deck,
            message.command,
            message.value
        );
    }


    /* --------------------------------------------------------
       POPUP COMPATIBILITY
       (kept under new controller name)
    -------------------------------------------------------- */

    if (
        message.type ===
        "SET_DECK_VOLUME"
    ) {

        await setDeckVolume(
            message.deck,
            message.volume
        );


        return {
            ok: true,
            state
        };
    }


    if (
        message.type ===
        "SET_MASTER_VOLUME"
    ) {

        state.masterVolume =
            clamp(
                Number(message.value),
                0,
                1
            );


        await applyVolumes();

        await saveState();


        return {
            ok: true,
            state
        };
    }


    if (
        message.type ===
        "SET_CROSSFADER"
    ) {

        state.crossfader =
            clamp(
                Number(message.value),
                0,
                1
            );


        await applyVolumes();

        await saveState();


        return {
            ok: true,
            state
        };
    }


    if (message.type === "TOGGLE_EQ_MODE") {
        state.eqMode = state.eqMode === 3 ? 2 : 3;
        await saveState();
        notifyController({ type: "EQ_CHANGED", state });
        return { ok: true, state };
    }

    if (message.type === "TOGGLE_SCRATCH_MODE") {
        state.scratchMode = !state.scratchMode;
        await saveState();
        notifyController({ type: "SCRATCH_MODE_CHANGED", state });
        return { ok: true, state };
    }

    if (message.type === "SET_EQ_UI") {
        if (!state.deckEQ) return { ok: false };
        state.deckEQ[message.deck][message.band] = Number(message.value);
        await saveState();
        notifyController({ type: "EQ_CHANGED", state });
        await sendToDeck(message.deck, "SET_EQ", state.deckEQ[message.deck]);
        return { ok: true, state };
    }

    if (message.type === "SET_EFFECT") {
        state.effects = {
            ...state.effects,
            ...message.effects
        };
        await saveState();
        notifyController({ type: "EFFECTS_CHANGED", state });
        
        // Broadcast the new effect state to the relevant deck(s)
        if (state.effects.deck === "MASTER" || state.effects.deck === "A") {
            await sendToDeck("A", "SET_AUDIO_EFFECT", state.effects);
        }
        if (state.effects.deck === "MASTER" || state.effects.deck === "B") {
            await sendToDeck("B", "SET_AUDIO_EFFECT", state.effects);
        }
        
        return { ok: true, state };
    }

    /* --------------------------------------------------------
       BROWSE MOVE
    -------------------------------------------------------- */

    if (
        message.type ===
        "BROWSE_MOVE"
    ) {

        return await browseMove(
            message.deck,
            Number(message.delta) || 0
        );
    }


    /* --------------------------------------------------------
       BROWSE QUEUE
    -------------------------------------------------------- */

    if (
        message.type ===
        "BROWSE_QUEUE_SELECTED"
    ) {

        return await browseQueue(
            message.deck ||
            state.activeDeck
        );
    }


    /* --------------------------------------------------------
       BROWSE RESULT
    -------------------------------------------------------- */

    if (
        message.type ===
        "BROWSE_RESULT"
    ) {

        state.browseIndex[
            message.deck
        ] = Number(
            message.index
        ) || 0;


        await saveState();


        notifyController({
            type:
                "BROWSE_RESULT",

            deck:
                message.deck,

            result:
                message.result
        });


        return {
            ok: true
        };
    }


    /* --------------------------------------------------------
       VIDEO STATE
    -------------------------------------------------------- */

    /* --------------------------------------------------------
       VIDEO STATE
    -------------------------------------------------------- */

    if (message.type === "VIDEO_STATE") {

        // Determine which deck this video belongs to based on the sender's tab ID
        let deck = null;
        if (state.deckTabs.A === sender.tab?.id) {
            deck = "A";
        } else if (state.deckTabs.B === sender.tab?.id) {
            deck = "B";
        }

        // Save state for handleCue
        if (deck) {
            if (!state.videoState) state.videoState = { A: null, B: null };
            state.videoState[deck] = message.state;

            notifyController({
                type: "VIDEO_STATE",
                deck: deck,
                state: message.state
            });
        }

        return { ok: true };
    }


    /* --------------------------------------------------------
       MIDI FROM CONTROLLER TAB
    -------------------------------------------------------- */

    if (
        message.type ===
        "MIDI_MESSAGE"
    ) {

        await handleMIDI(
            message.data
        );


        return {
            ok: true
        };
    }


    /* --------------------------------------------------------
       MIDI STATUS
    -------------------------------------------------------- */

    if (
        message.type ===
        "MIDI_STATUS"
    ) {
        
        if (message.status === "connected") {
            activeControllerName = message.name || "Unknown Controller";
            updateActiveControllerParser();
        }

        notifyController({
            type:
                "MIDI_STATUS",

            status:
                message.status,

            name:
                message.name || ""
        });


        return {
            ok: true
        };
    }

    /* --------------------------------------------------------
       CONTROLLER PREFERENCE
    -------------------------------------------------------- */
    
    if (message.type === "SET_CONTROLLER_PREFERENCE") {
        state.selectedControllerPreference = message.preference;
        await saveState();
        updateActiveControllerParser();
        return { ok: true };
    }


    /* --------------------------------------------------------
       CUSTOM QUEUE / DRAG-AND-DROP
    -------------------------------------------------------- */

    if (message.type === "LOAD_URL_IN_DECK") {
        const tabId = state.deckTabs[message.deck];
        if (tabId) {
            await chrome.tabs.update(tabId, { url: `https://www.youtube.com/watch?v=${message.videoId}` });
            return { ok: true };
        }
        return { ok: false, error: `No tab found for deck ${message.deck}.` };
    }

    if (message.type === "ADD_TO_CUSTOM_QUEUE") {
        const deck = message.deck;
        if (!state.customQueue) state.customQueue = { A: [], B: [] };
        if (!state.customQueue[deck]) state.customQueue[deck] = [];
        state.customQueue[deck].push(message.video);
        await saveState();
        
        notifyController({ type: "DECKS_CHANGED", state });
        if (state.videoState?.[deck]) {
            notifyController({ type: "VIDEO_STATE", deck, state: state.videoState[deck] });
        }
        return { ok: true };
    }

    if (message.type === "POP_CUSTOM_QUEUE") {
        let deck = message.deck;
        if (!deck && sender.tab?.id) {
            if (state.deckTabs.A === sender.tab.id) deck = "A";
            else if (state.deckTabs.B === sender.tab.id) deck = "B";
        }
        
        if (deck && state.customQueue?.[deck]?.length > 0) {
            const nextVideo = state.customQueue[deck].shift();
            await saveState();
            
            const tabId = state.deckTabs[deck];
            if (tabId) {
                await chrome.tabs.update(tabId, { url: `https://www.youtube.com/watch?v=${nextVideo.id}` });
            }
            
            notifyController({ type: "DECKS_CHANGED", state });
            if (state.videoState?.[deck]) {
                notifyController({ type: "VIDEO_STATE", deck, state: state.videoState[deck] });
            }
            return { ok: true, video: nextVideo };
        }
        return { ok: false };
    }


    return {
        ok: false,
        error:
            "Unknown message type."
    };
}


/* ============================================================
   CONTROLLER NOTIFICATION
============================================================ */

function notifyController(
    message
) {

    chrome.runtime.sendMessage(
        message
    )
        .catch(() => { });
}


/* ============================================================
   DECK COMMAND
============================================================ */

async function sendToDeck(
    deck,
    command,
    value = null
) {

    await loadState();


    const tabId =
        state.deckTabs[deck];


    if (!tabId) {

        return {
            ok: false,
            error:
                `Deck ${deck} has no tab.`
        };
    }


    try {

        const response =
            await chrome.tabs.sendMessage(
                tabId,
                {
                    type:
                        "DECK_COMMAND",

                    command,

                    value
                }
            );


        return response || {
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

async function pushStateToDeck(deck) {
    if (!state.deckTabs[deck]) return;
    
    // Apply crossfader and volume
    const f = clamp(state.crossfader, 0, 1);
    const crossA = f <= 0.5 ? 1 : 1 - ((f - 0.5) * 2);
    const crossB = f >= 0.5 ? 1 : f * 2;
    const finalVol = state.masterVolume * state.deckVolume[deck] * (deck === "A" ? crossA : crossB);
    
    await sendToDeck(deck, "VOLUME", finalVol);
    await sendToDeck(deck, "SET_EQ", state.deckEQ[deck]);
    await sendToDeck(deck, "RATE", state.rate[deck]);
    if (state.effects.deck === "MASTER" || state.effects.deck === deck) {
        await sendToDeck(deck, "SET_AUDIO_EFFECT", state.effects);
    }
}


/* ============================================================
   MIDI ROUTING
============================================================ */

function updateActiveControllerParser() {
    if (!globalThis.ControllerMappings) return;
    
    let targetId = state.selectedControllerPreference;
    let foundParser = null;

    if (targetId === "auto") {
        foundParser = globalThis.ControllerMappings.find(m => m.nameMatch.test(activeControllerName));
    } else {
        foundParser = globalThis.ControllerMappings.find(m => m.id === targetId);
    }

    if (!foundParser) {
        foundParser = globalThis.ControllerMappings[0]; // Fallback to ION
    }

    activeControllerParser = foundParser;
}

async function handleMIDI(data) {
    if (!activeControllerParser) {
        updateActiveControllerParser();
    }

    if (!activeControllerParser) return;

    const actionObj = activeControllerParser.parse(data);
    if (!actionObj) return;

    // Broadcast the physical button state to the UI for visual feedback
    if (actionObj.type === "BUTTON") {
        notifyController({
            type: "MIDI_BUTTON_STATE",
            note: actionObj.note,
            pressed: actionObj.pressed
        });
    }

    await executeDJAction(actionObj);
}

/* ============================================================
   EXECUTE DJ ACTION
============================================================ */

async function executeDJAction(actionObj) {
    if (!actionObj.action) return;

    const action = actionObj.action;
    const deck = actionObj.deck;
    const value = actionObj.value;
    const delta = actionObj.delta;

    switch (action) {
        case "PLAY_PAUSE":
            await sendToDeck(deck, "PLAY_PAUSE");
            break;
            
        case "CUE":
            await handleCue(deck);
            break;
            
        case "RATE_DOWN":
            await changeRate(deck, -0.05);
            break;
            
        case "RATE_UP":
            await changeRate(deck, +0.05);
            break;
            
        case "FOCUS":
            state.activeDeck = deck;
            await focusDeck(deck);
            await saveState();
            notifyController({ type: "ACTIVE_DECK_CHANGED", deck });
            break;
            
        case "SCRATCH_TOGGLE":
            state.scratchMode = !state.scratchMode;
            await saveState();
            notifyController({ type: "SCRATCH_MODE_CHANGED", state });
            break;
            
        case "BROWSE_PUSH":
            await browseQueue(state.activeDeck);
            break;
            
        case "JOG":
            if (state.scratchMode) {
                notifyController({ type: "PLAY_SCRATCH_SOUND", deck: deck, delta });
            }
            await sendToDeck(deck, "SEEK", delta * 0.10);
            break;
            
        case "KNOB_HIGH":
            await handleKnob(deck, "High", value);
            break;
            
        case "KNOB_LOW":
            await handleKnob(deck, "Low", value);
            break;
            
        case "KNOB_VOL":
            await handleKnob(deck, "Vol", value);
            break;
            
        case "MASTER_VOL":
            state.masterVolume = value / 127;
            await applyVolumes();
            await saveState();
            notifyController({ type: "MIXER_CHANGED", state });
            break;
            
        case "CROSSFADER":
            // Invert the physical slider direction
            state.crossfader = 1 - (value / 127);
            await applyVolumes();
            await saveState();
            notifyController({ type: "MIXER_CHANGED", state });
            break;
            
        case "BROWSE_KNOB":
            if (delta !== 0) {
                await browseMove(state.activeDeck, delta);
            }
            break;
    }
}


/* ============================================================
   RATE
============================================================ */

async function changeRate(
    deck,
    delta
) {

    let rate =
        state.rate[deck] +
        delta;


    rate =
        clamp(
            rate,
            0.25,
            2
        );


    rate =
        Math.round(
            rate * 100
        ) / 100;


    state.rate[deck] =
        rate;


    await sendToDeck(
        deck,
        "RATE",
        rate
    );


    await saveState();


    notifyController({
        type:
            "VIDEO_RATE",

        deck,

        rate
    });
}


/* ============================================================
   CUE
============================================================ */

async function handleCue(deck) {
    const vState = state.videoState?.[deck];
    
    // Default CDJ logic:
    // If paused, pressing CUE sets a new cue point.
    // If playing, pressing CUE pauses and returns to the cue point.
    if (!vState || vState.paused) {
        await sendToDeck(deck, "CUE_SET");
    } else {
        // Pause and return
        await sendToDeck(deck, "PLAY_PAUSE", { forcePause: true }); 
        await sendToDeck(deck, "CUE_RETURN");
    }

    await saveState();
}


/* ============================================================
   VOLUME
============================================================ */

async function handleKnob(deck, knob, value) {
    const val01 = value / 127;

    if (state.eqMode === 3) {
        // 3EQ MODE: Top=High, Middle=Mid, Bottom=Low (No physical volume control)
        if (knob === "High") state.deckEQ[deck].high = val01;
        if (knob === "Low") state.deckEQ[deck].mid = val01; // Middle knob is physically 'Low' (0x08) on ION
        if (knob === "Vol") state.deckEQ[deck].low = val01; // Bottom knob is physically 'Vol' (0x14) on ION
    } else {
        // 2EQ MODE: Top=Treble, Middle=Bass, Bottom=Volume
        if (knob === "High") state.deckEQ[deck].high = val01;
        if (knob === "Low") state.deckEQ[deck].low = val01;
        if (knob === "Vol") {
            await setDeckVolume(deck, val01);
            return;
        }
    }

    await saveState();
    
    // Broadcast the new EQ state
    notifyController({ type: "EQ_CHANGED", state });
    
    // Send to specific deck content script to actually filter audio
    await sendToDeck(deck, "SET_EQ", state.deckEQ[deck]);
}

async function setDeckVolume(
    deck,
    volume
) {

    if (
        deck !== "A" &&
        deck !== "B"
    ) {
        return;
    }


    state.deckVolume[deck] =
        clamp(
            Number(volume),
            0,
            1
        );


    await applyVolumes();

    await saveState();


    notifyController({
        type:
            "MIXER_CHANGED",

        state
    });
}


async function applyVolumes() {

    const f =
        clamp(
            state.crossfader,
            0,
            1
        );


    /*
     * Constant-power-ish simple DJ crossfader.
     *
     * Left:
     * A = 1
     * B = 0
     *
     * Center:
     * A = 1
     * B = 1
     *
     * Right:
     * A = 0
     * B = 1
     */

    const crossA =
        f <= 0.5
            ? 1
            : 1 - ((f - 0.5) * 2);


    const crossB =
        f >= 0.5
            ? 1
            : f * 2;


    const finalA =
        state.masterVolume *
        state.deckVolume.A *
        crossA;


    const finalB =
        state.masterVolume *
        state.deckVolume.B *
        crossB;


    await sendToDeck(
        "A",
        "VOLUME",
        finalA
    );


    await sendToDeck(
        "B",
        "VOLUME",
        finalB
    );
}


/* ============================================================
   BROWSE
============================================================ */

async function browseMove(
    deck,
    delta
) {

    if (
        deck !== "A" &&
        deck !== "B"
    ) {
        return {
            ok: false
        };
    }


    const tabId =
        state.deckTabs[deck];


    if (!tabId) {

        return {
            ok: false,
            error:
                `Deck ${deck} has no tab.`
        };
    }


    try {

        const response =
            await chrome.tabs.sendMessage(
                tabId,
                {
                    type:
                        "BROWSE_MOVE",

                    delta
                }
            );


        if (
            response?.index !== undefined
        ) {

            state.browseIndex[deck] =
                response.index;


            await saveState();
        }


        notifyController({
            type:
                "BROWSE_RESULT",

            deck,

            result:
                response
        });

        await showBrowseNotification(deck, response);

        return {
            ok: true,

            result:
                response
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
   BROWSE QUEUE
============================================================ */

async function browseQueue(
    deck
) {

    const tabId =
        state.deckTabs[deck];


    if (!tabId) {

        return {
            ok: false,
            error:
                `Deck ${deck} has no tab.`
        };
    }


    try {

        const response =
            await chrome.tabs.sendMessage(
                tabId,
                {
                    type:
                        "BROWSE_QUEUE_SELECTED"
                }
            );


        notifyController({
            type:
                "BROWSE_QUEUE_RESULT",

            deck,

            result:
                response
        });

        await showQueueNotification(deck, response);

        return {
            ok: true,

            result:
                response
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
   BACKGROUND NOTIFICATIONS
============================================================ */

async function showQueueNotification(deck, response) {
    if (!response || !response.ok) return;

    if (state.controllerTabId) {
        try {
            const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            const isControllerActive = tabs.some(t => t.id === state.controllerTabId);
            if (isControllerActive) {
                return;
            }
        } catch (e) {}
    }

    let queueText = "";
    const currentQueue = state.videoState?.[deck]?.queue;
    if (currentQueue && currentQueue.length > 0) {
        let startIndex = 0;
        const playingIndex = currentQueue.findIndex(item => item.isPlaying);
        if (playingIndex !== -1) {
            startIndex = playingIndex;
        }

        const upcomingQueue = currentQueue.slice(startIndex);
        
        queueText = "Queue:\n" + upcomingQueue.slice(0, 6).map((item, i) => {
            if (item.isPlaying) {
                return `▶ ${item.title}`;
            }
            const trackNum = upcomingQueue[0].isPlaying ? i : i + 1;
            return `${trackNum}. ${item.title}`;
        }).join("\n");
        
        if (upcomingQueue.length > 6) {
            queueText += `\n...and ${upcomingQueue.length - 6} more`;
        }
    } else {
        queueText = "Queue is currently empty.";
    }

    const iconDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

    chrome.notifications.create({
        type: "basic",
        iconUrl: iconDataUrl,
        title: response.message || "Song Queued",
        message: queueText,
        priority: 1
    });
}

async function showBrowseNotification(deck, response) {
    if (!response || !response.ok || !response.selected) return;

    if (state.controllerTabId) {
        try {
            const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            const isControllerActive = tabs.some(t => t.id === state.controllerTabId);
            if (isControllerActive) {
                return;
            }
        } catch (e) {}
    }

    const selected = response.selected;
    const title = selected.title || "Unknown Title";
    const channel = selected.channel || "Unknown Channel";
    const indexStr = `[${response.index + 1}/${response.count}]`;

    const iconDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

    chrome.notifications.create("dj-browse-notification", {
        type: "basic",
        iconUrl: iconDataUrl,
        title: `Browsing: ${title}`,
        message: `${channel} ${indexStr}`,
        priority: 0
    });
}

/* ============================================================
   AUTO DECK SELECTION
============================================================ */

async function autoChooseDecks(
    force = false
) {

    await loadState();


    const tabs =
        await chrome.tabs.query({
            url: [
                "https://www.youtube.com/*",
                "https://youtube.com/*"
            ]
        });


    if (!tabs.length) {

        state.deckTabs.A =
            force
                ? null
                : state.deckTabs.A;


        state.deckTabs.B =
            force
                ? null
                : state.deckTabs.B;


        await saveState();

        return;
    }


    const scored = [];


    for (
        const tab of tabs
    ) {

        let playing = false;


        try {

            const response =
                await chrome.tabs.sendMessage(
                    tab.id,
                    {
                        type:
                            "GET_STATE"
                    }
                );


            playing =
                response?.state?.paused ===
                false;

        } catch {
            /*
             * Content script may still
             * be initializing.
             */
        }


        let score = 0;


        /*
         * Strongest signal:
         * currently playing.
         */

        if (playing) {
            score += 10000;
        }


        /*
         * Audible YouTube tab.
         */

        if (tab.audible) {
            score += 5000;
        }


        /*
         * Current active tab.
         */

        if (tab.active) {
            score += 1000;
        }


        /*
         * Recently accessed.
         */

        score +=
            Math.min(
                500,
                Number(
                    tab.lastAccessed || 0
                ) / 1000000
            );


        scored.push({
            tab,
            score,
            playing
        });
    }


    scored.sort(
        (a, b) =>
            b.score -
            a.score
    );


    /*
     * If not forcing:
     *
     * keep existing valid assignments.
     */

    const existingA =
        await tabExists(
            state.deckTabs.A
        );


    const existingB =
        await tabExists(
            state.deckTabs.B
        );


    if (
        force ||
        !existingA
    ) {

        state.deckTabs.A =
            scored[0]?.tab.id ||
            null;
    }


    if (
        force ||
        !existingB
    ) {

        const second =
            scored.find(
                item =>
                    item.tab.id !==
                    state.deckTabs.A
            );


        state.deckTabs.B =
            second?.tab.id ||
            null;
    }


    /*
     * If force=true and there is only
     * one YouTube tab, don't assign the
     * same tab to both decks.
     */

    if (
        state.deckTabs.A &&
        state.deckTabs.A ===
        state.deckTabs.B
    ) {

        state.deckTabs.B =
            null;
    }


    await saveState();

    if (state.deckTabs.A) await pushStateToDeck("A");
    if (state.deckTabs.B) await pushStateToDeck("B");


    notifyController({
        type:
            "DECKS_CHANGED",

        state
    });
}


/* ============================================================
   TAB UTILITIES
============================================================ */

async function tabExists(
    tabId
) {

    if (!tabId) {
        return false;
    }


    try {

        await chrome.tabs.get(
            tabId
        );

        return true;

    } catch {

        return false;
    }
}


async function focusTab(
    tabId
) {

    try {

        const tab =
            await chrome.tabs.get(
                tabId
            );


        await chrome.windows.update(
            tab.windowId,
            {
                focused: true
            }
        );


        await chrome.tabs.update(
            tabId,
            {
                active: true
            }
        );

    } catch (error) {

        console.warn(
            "Could not focus tab:",
            error
        );
    }
}


async function focusDeck(
    deck
) {

    const tabId =
        state.deckTabs[deck];


    if (!tabId) {
        return;
    }


    await focusTab(
        tabId
    );
}


/* ============================================================
   CLAMP
============================================================ */

function clamp(
    value,
    min,
    max
) {

    if (
        !Number.isFinite(value)
    ) {

        return min;
    }


    return Math.max(
        min,
        Math.min(
            max,
            value
        )
    );
}