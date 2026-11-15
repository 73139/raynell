# Tarkov Field Guide - Manual Map Overlay (Windows)

This is a **separate, manual-only map viewer** for single-monitor players.

## Run
1. Extract the complete ZIP folder (keep the `assets` directory).
2. Double-click `START_MANUAL_MAP.cmd`.
3. Select the map and floor **yourself** using the drop-down controls.
4. Use the opacity slider and "Always on top" check box. Move/resize the window freely.
5. Set Escape from Tarkov to *Borderless Windowed* if the overlay is not visible over the game.

## Deliberately NOT included
- No automatic map detection, location tracking, coordinate or screen OCR
- No EFT process access, memory reading, DLL injection, direct game input or screen hooks
- No Logs or Screenshots folder access; no automation, no network requests
- No global hotkeys or macros

This is a normal Windows Forms topmost window, not an injected in-game overlay.
Some fullscreen configurations hide topmost windows; use Borderless Windowed.
This design minimizes game interaction but **does not constitute BSG approval or guarantee against enforcement**.

The viewer reads only PNG files in its extracted `assets` folder and `maps.json`.
Windows PowerShell 5.1 and .NET Framework are built into supported Windows installations.
The launcher uses process-local ExecutionPolicy Bypass to run the bundled unsigned script and does not alter your persistent PowerShell settings.
Review the plain-text source in `ManualMapOverlay.ps1` before running.

## Map credits and license
Map assets derived from the-hideout/tarkov-dev SVG maps (Shebuka).
Source: https://github.com/the-hideout/tarkov-dev-svg-maps
License: CC BY-NC-SA 4.0 (Attribution-NonCommercial-ShareAlike).
https://creativecommons.org/licenses/by-nc-sa/4.0/
This distribution is noncommercial and carries these attribution and sharing terms.

## Testing
CI validates the PNG map bundle, PowerShell syntax/static exclusions, map counts, and ZIP integrity.
A real Windows foreground overlay / actual EFT test requires a Windows desktop session and remains unverified until performed.
