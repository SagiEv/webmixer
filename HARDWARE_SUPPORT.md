# Hardware Controller Support

This document outlines the supported MIDI hardware controllers and the specific actions mapped to them in the codebase. 

The extension uses the Web MIDI API to detect connected hardware. If your hardware is not fully mapped or supported below, the extension features a built-in "MIDI Learn" logger in the background service worker console. Pressing an unmapped button will log its hex code, allowing for easy addition to `src/midi_mappings.js`.

---

## 1. ION Discover DJ (Primary Default)
This controller has the most comprehensive default mapping in the extension.

**Playback & Decks:**
- **Play/Pause:** Supported (Deck A & B)
- **Cue:** Supported (Deck A & B)
- **Pitch/Tempo (Rate Down/Up):** Supported (Deck A & B)
- **Deck Focus:** Supported (Switch active focus to Deck A or B)
- **Scratch Toggle:** Supported (Hardware toggle button)

**Mixer & EQ:**
- **Volume Faders:** Supported (Deck A & B)
- **Master Volume:** Supported
- **Crossfader:** Supported 
- **High EQ:** Supported (Deck A & B)
- **Low EQ:** Supported (Deck A & B)

**Jog Wheels & Navigation:**
- **Jog Wheels:** Supported (Deck A & B - acts as Scratch or Pitch Bend depending on Scratch Toggle state)
- **Browse Knob (Rotate):** Supported (Scrolls through track library/queue)
- **Browse Push:** Supported (Loads track or adds to queue)

---

## 2. Pioneer DDJ Family 
*(Includes: DDJ-FLX4, DDJ-400, DDJ-SB2, DDJ-SB3, DDJ-RB, DDJ-SX, DDJ-SX2, DDJ-1000, DDJ-800)*

**Playback & Decks:**
- **Play/Pause:** Supported (Deck A & B)
- **Cue:** Supported (Deck A & B)

**Mixer & EQ:**
- **Volume Faders (Channel Fader):** Supported (Deck A & B)
- **Crossfader:** Supported
- **High EQ:** Supported (Deck A & B)
- **Low EQ:** Supported (Deck A & B)

**Jog Wheels & Navigation:**
- **Jog Wheels:** Supported (Deck A & B - responds to both scratch and pitch bend CC messages)
- **Browse Knob (Rotate):** Supported
- **Browse Push / Load Buttons:** Supported (The main push button, as well as "Load Deck 1" and "Load Deck 2" buttons, are all currently mapped to the general Browse Push action).

---

## 3. Numark Mixtrack Family
*(Includes controllers containing "Mixtrack" in the name)*

This controller has full basic mapping.

**Playback & Decks:**
- **Play/Pause:** Supported (Deck A & B)
- **Cue:** Supported (Deck A & B)

**Mixer & EQ:**
- **Volume Faders:** Supported (Deck A & B)
- **Master Volume:** Supported
- **Crossfader:** Supported 
- **High EQ:** Supported (Deck A & B)
- **Low EQ:** Supported (Deck A & B)

**Jog Wheels & Navigation:**
- **Jog Wheels:** Supported (Deck A & B)
- **Browse Knob (Rotate):** Supported
- **Browse Push / Load Buttons:** Supported (Deck A load, Deck B load, and generic load are mapped to Browse Push)

---

## 4. Hercules DJControl Family
*(Includes controllers containing "Hercules" or "DJControl" in the name)*

This controller has full basic mapping, supporting both modern (e.g. Inpulse series) and legacy hardware.

**Playback & Decks:**
- **Play/Pause:** Supported (Deck A & B)
- **Cue:** Supported (Deck A & B)

**Mixer & EQ:**
- **Volume Faders:** Supported (Deck A & B)
- **Crossfader:** Supported 
- **High EQ:** Supported (Deck A & B)
- **Low EQ:** Supported (Deck A & B)

**Jog Wheels & Navigation:**
- **Jog Wheels:** Supported (Deck A & B - pitch bend and scratch dynamically parsed)
- **Browse Knob (Rotate):** Supported
- **Browse Push:** Supported

---

## 5. Traktor Kontrol Family
*(Includes controllers containing "Traktor Kontrol" in the name, e.g. Kontrol S2, Kontrol S4)*

**Requires Manual Mapping (MIDI Learn)**
Native Instruments Traktor Kontrol devices use a proprietary, high-resolution HID protocol (NHL) by default, rather than standard MIDI. The open-source Mixxx mappings for these devices are also strictly HID-based and do not contain standard MIDI hex codes.

To map these controllers to this web extension:
1. Put the controller into **MIDI Mode** (consult your hardware manual).
2. Connect it and use the built-in "MIDI Learn" logger in the background service worker console to manually discover the Note/CC values.
3. Add the values to `src/midi_mappings.js` manually.
