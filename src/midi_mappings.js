"use strict";

function decodeRelative(value) {
    if (value >= 0x40) {
        return value - 0x80;
    }
    return value;
}

const ControllerMappings = [
    {
        id: "ion-discover-dj",
        displayName: "ION Discover DJ",
        nameMatch: /Discover DJ|ION/i,
        parse: function (data) {
            if (!data || data.length < 3) return null;
            const status = data[0];
            const command = status & 0xF0;
            const note = data[1];
            const value = data[2];

            // Buttons (Note On/Off)
            if (command === 0x90 || command === 0x80) {
                const pressed = (command === 0x90 && value > 0);

                let actionObj = { type: "BUTTON", note: note, pressed: pressed };

                // The Scratch button (0x48) on the ION is a hardware toggle, sending 127 then 0 on alternate presses.
                // We must treat BOTH states as a trigger to toggle the software state correctly on every physical press.
                if (!pressed && note !== 0x48) {
                    return actionObj;
                }

                switch (note) {
                    case 0x4A: actionObj.action = "PLAY_PAUSE"; actionObj.deck = "A"; break;
                    case 0x4C: actionObj.action = "PLAY_PAUSE"; actionObj.deck = "B"; break;
                    case 0x3B: actionObj.action = "CUE"; actionObj.deck = "A"; break;
                    case 0x42: actionObj.action = "CUE"; actionObj.deck = "B"; break;
                    case 0x43: actionObj.action = "RATE_DOWN"; actionObj.deck = "A"; break;
                    case 0x44: actionObj.action = "RATE_UP"; actionObj.deck = "A"; break;
                    case 0x45: actionObj.action = "RATE_DOWN"; actionObj.deck = "B"; break;
                    case 0x46: actionObj.action = "RATE_UP"; actionObj.deck = "B"; break;
                    case 0x4B: actionObj.action = "FOCUS"; actionObj.deck = "A"; break;
                    case 0x34: actionObj.action = "FOCUS"; actionObj.deck = "B"; break;
                    case 0x48: actionObj.action = "SCRATCH_TOGGLE"; break;
                    case 0x4F: actionObj.action = "BROWSE_PUSH"; break;
                }
                return actionObj;
            }

            // Knobs and Faders (CC)
            if (command === 0xB0) {
                let actionObj = { type: "CC", controller: note, value: value };

                switch (note) {
                    case 0x19:
                        actionObj.action = "JOG";
                        actionObj.deck = "A";
                        actionObj.delta = decodeRelative(value);
                        break;
                    case 0x18:
                        actionObj.action = "JOG";
                        actionObj.deck = "B";
                        actionObj.delta = decodeRelative(value);
                        break;
                    case 0x10: actionObj.action = "KNOB_HIGH"; actionObj.deck = "A"; break;
                    case 0x14: actionObj.action = "KNOB_LOW"; actionObj.deck = "A"; break;
                    case 0x08: actionObj.action = "KNOB_VOL"; actionObj.deck = "A"; break;
                    case 0x11: actionObj.action = "KNOB_HIGH"; actionObj.deck = "B"; break;
                    case 0x15: actionObj.action = "KNOB_LOW"; actionObj.deck = "B"; break;
                    case 0x09: actionObj.action = "KNOB_VOL"; actionObj.deck = "B"; break;
                    case 0x17: actionObj.action = "MASTER_VOL"; break;
                    case 0x0A: actionObj.action = "CROSSFADER"; break;
                    case 0x1A:
                        actionObj.action = "BROWSE_KNOB";
                        actionObj.delta = decodeRelative(value);
                        break;
                }
                return actionObj;
            }
            return null;
        }
    },
    {
        id: "pioneer-ddj-family",
        displayName: "Pioneer DDJ Family (FLX4, 400, SB3, RB, SX, 1000)",
        nameMatch: /DDJ-FLX4|DDJ-400|DDJ-SB2|DDJ-SB3|DDJ-RB|DDJ-SX|DDJ-SX2|DDJ-1000|DDJ-800/i,
        parse: function (data) {
            if (!data || data.length < 3) return null;
            const status = data[0];
            const command = status & 0xF0;
            const channel = status & 0x0F; // 0 = Deck A, 1 = Deck B, etc.
            const note = data[1];
            const value = data[2];

            const deck = (channel === 0) ? "A" : (channel === 1) ? "B" : null;

            // Buttons (Note On/Off)
            if (command === 0x90 || command === 0x80) {
                const pressed = (command === 0x90 && value > 0);
                let actionObj = { type: "BUTTON", note: note, pressed: pressed };

                if (!pressed) return actionObj;

                if (deck) {
                    switch (note) {
                        case 0x0B: actionObj.action = "PLAY_PAUSE"; actionObj.deck = deck; break;
                        case 0x0C: actionObj.action = "CUE"; actionObj.deck = deck; break;
                        // For the DDJ-400, shift+play is 0x47, but we don't have shift state tracked here
                    }
                }

                // Global Buttons (Channel 6 = 0x96)
                if (channel === 6) {
                    switch (note) {
                        case 0x41: // BROWSE PUSH
                            actionObj.action = "BROWSE_PUSH";
                            break;
                        case 0x46: // LOAD DECK 1
                            actionObj.action = "BROWSE_PUSH";
                            // Note: we can't easily force activeDeck A then load here cleanly in a single action
                            // without changing the background architecture, so we just treat it as BROWSE_PUSH for now
                            break;
                        case 0x47: // LOAD DECK 2
                            actionObj.action = "BROWSE_PUSH";
                            break;
                    }
                }

                if (!actionObj.action) {
                    console.log("[Pioneer] Unmapped Button:", { channel, note: note.toString(16), value });
                }

                return actionObj;
            }

            // CC (Knobs/Faders/Jog)
            if (command === 0xB0) {
                let actionObj = { type: "CC", controller: note, value: value };

                if (deck) {
                    switch (note) {
                        case 0x22: // Jog wheel scratch
                        case 0x23: // Jog wheel pitch bend
                            actionObj.action = "JOG";
                            actionObj.deck = deck;
                            actionObj.delta = decodeRelative(value);
                            break;
                        case 0x13: // Channel Fader
                            actionObj.action = "KNOB_VOL";
                            actionObj.deck = deck;
                            break;
                        case 0x07: // EQ HI
                            actionObj.action = "KNOB_HIGH";
                            actionObj.deck = deck;
                            break;
                        case 0x0F: // EQ LOW
                            actionObj.action = "KNOB_LOW";
                            actionObj.deck = deck;
                            break;
                    }
                }

                // Global CCs (Channel 6 = 0xB6)
                if (channel === 6) {
                    switch (note) {
                        case 0x1F: // Crossfader
                            actionObj.action = "CROSSFADER";
                            break;
                        case 0x40: // Browse rotate
                            actionObj.action = "BROWSE_KNOB";
                            actionObj.delta = decodeRelative(value);
                            break;
                    }
                }

                if (!actionObj.action) {
                    console.log("[Pioneer] Unmapped CC:", { channel, note: note.toString(16), value });
                }

                return actionObj;
            }

            return null;
        }
    },
    {
        id: "numark-mixtrack-family",
        displayName: "Numark Mixtrack Family",
        nameMatch: /Mixtrack/i,
        parse: function (data) {
            if (!data || data.length < 3) return null;
            const status = data[0];
            const command = status & 0xF0;
            const channel = status & 0x0F; 
            const note = data[1];
            const value = data[2];

            if (command === 0x90 || command === 0x80) {
                const pressed = (command === 0x90 && value > 0);
                let actionObj = { type: "BUTTON", note: note, pressed: pressed };
                if (!pressed) return actionObj;

                switch (note) {
                    // Deck A
                    case 0x3B: actionObj.action = "PLAY_PAUSE"; actionObj.deck = "A"; break;
                    case 0x33: actionObj.action = "CUE"; actionObj.deck = "A"; break;
                    case 0x4B: actionObj.action = "BROWSE_PUSH"; break; // Load A
                    // Deck B
                    case 0x42: actionObj.action = "PLAY_PAUSE"; actionObj.deck = "B"; break;
                    case 0x3C: actionObj.action = "CUE"; actionObj.deck = "B"; break;
                    case 0x34: actionObj.action = "BROWSE_PUSH"; break; // Load B
                    // Global
                    case 0x4F: actionObj.action = "BROWSE_PUSH"; break; // Generic Load
                }
                
                if (!actionObj.action) {
                    console.log("[Numark] Unmapped Button:", { channel, note: note.toString(16), value });
                }
                return actionObj;
            }

            if (command === 0xB0) {
                let actionObj = { type: "CC", controller: note, value: value };
                
                switch (note) {
                    // Deck A
                    case 0x19: actionObj.action = "JOG"; actionObj.deck = "A"; actionObj.delta = decodeRelative(value); break;
                    case 0x10: actionObj.action = "KNOB_HIGH"; actionObj.deck = "A"; break;
                    case 0x14: actionObj.action = "KNOB_LOW"; actionObj.deck = "A"; break;
                    case 0x08: actionObj.action = "KNOB_VOL"; actionObj.deck = "A"; break;
                    // Deck B
                    case 0x18: actionObj.action = "JOG"; actionObj.deck = "B"; actionObj.delta = decodeRelative(value); break;
                    case 0x11: actionObj.action = "KNOB_HIGH"; actionObj.deck = "B"; break;
                    case 0x15: actionObj.action = "KNOB_LOW"; actionObj.deck = "B"; break;
                    case 0x09: actionObj.action = "KNOB_VOL"; actionObj.deck = "B"; break;
                    // Global
                    case 0x0A: actionObj.action = "CROSSFADER"; break;
                    case 0x17: actionObj.action = "MASTER_VOL"; break;
                    case 0x1A: 
                        actionObj.action = "BROWSE_KNOB"; 
                        actionObj.delta = decodeRelative(value); 
                        break;
                }

                if (!actionObj.action) {
                    console.log("[Numark] Unmapped CC:", { channel, note: note.toString(16), value });
                }
                return actionObj;
            }
            return null;
        }
    },
    {
        id: "hercules-djcontrol",
        displayName: "Hercules DJControl Family",
        nameMatch: /Hercules|DJControl/i,
        parse: function (data) {
            if (!data || data.length < 3) return null;
            const status = data[0];
            const command = status & 0xF0;
            const channel = status & 0x0F; 
            const note = data[1];
            const value = data[2];

            // Inpulse 200: Channel 1 = Deck A, Channel 2 = Deck B, Channel 0 = Global
            // Older mappings: Channel 0/1 = A, Channel 2/3 = B
            let deck = null;
            if (channel === 1) deck = "A";
            else if (channel === 2) deck = "B";
            else if (channel === 0 || channel === 3) {
                // Fallback for older Hercules mappings
                deck = (channel === 0) ? "A" : "B";
            }

            if (command === 0x90 || command === 0x80) {
                const pressed = (command === 0x90 && value > 0);
                let actionObj = { type: "BUTTON", note: note, pressed: pressed };
                if (!pressed) return actionObj;

                if (channel === 0 && note === 0x00) {
                    actionObj.action = "BROWSE_PUSH";
                } else if (deck) {
                    switch (note) {
                        case 0x01: // Legacy Play
                        case 0x07: // Modern Play
                            actionObj.action = "PLAY_PAUSE"; actionObj.deck = deck; break;
                        case 0x02: // Legacy Cue
                        case 0x06: // Modern Cue
                            actionObj.action = "CUE"; actionObj.deck = deck; break;
                        case 0x0D: // Load
                            actionObj.action = "BROWSE_PUSH"; break;
                    }
                }
                
                if (!actionObj.action) {
                    console.log("[Hercules] Unmapped Button:", { channel, note: note.toString(16), value });
                }
                return actionObj;
            }

            if (command === 0xB0) {
                let actionObj = { type: "CC", controller: note, value: value };

                if (channel === 0) {
                    switch (note) {
                        case 0x00: actionObj.action = "CROSSFADER"; break;
                        case 0x01: 
                            actionObj.action = "BROWSE_KNOB";
                            actionObj.delta = decodeRelative(value);
                            break;
                    }
                } else if (deck) {
                    switch (note) {
                        case 0x00: actionObj.action = "KNOB_VOL"; actionObj.deck = deck; break;
                        case 0x02: actionObj.action = "KNOB_LOW"; actionObj.deck = deck; break;
                        case 0x04: actionObj.action = "KNOB_HIGH"; actionObj.deck = deck; break;
                        case 0x09:
                        case 0x0A:
                            actionObj.action = "JOG"; actionObj.deck = deck; actionObj.delta = decodeRelative(value); break;
                    }
                }

                if (!actionObj.action) {
                    console.log("[Hercules] Unmapped CC:", { channel, note: note.toString(16), value });
                }
                return actionObj;
            }
            return null;
        }
    },
    {
        id: "traktor-kontrol",
        displayName: "Traktor Kontrol Family",
        nameMatch: /Traktor Kontrol/i,
        parse: function (data) {
            if (!data || data.length < 3) return null;
            const status = data[0];
            const command = status & 0xF0;
            const channel = status & 0x0F; 
            const note = data[1];
            const value = data[2];

            const deck = (channel === 0) ? "A" : (channel === 1) ? "B" : null;

            if (command === 0x90 || command === 0x80) {
                const pressed = (command === 0x90 && value > 0);
                let actionObj = { type: "BUTTON", note: note, pressed: pressed };
                if (!pressed) return actionObj;

                if (!actionObj.action) {
                    console.log("[Traktor] Unmapped Button:", { channel, note: note.toString(16), value });
                }
                return actionObj;
            }

            if (command === 0xB0) {
                let actionObj = { type: "CC", controller: note, value: value };
                if (!actionObj.action) {
                    console.log("[Traktor] Unmapped CC:", { channel, note: note.toString(16), value });
                }
                return actionObj;
            }
            return null;
        }
    }
];

if (typeof globalThis !== 'undefined') {
    globalThis.ControllerMappings = ControllerMappings;
}
