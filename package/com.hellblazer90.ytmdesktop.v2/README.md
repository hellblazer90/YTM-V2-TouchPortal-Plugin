# YTM TouchPortal V2 (by HellBlazer90)

This plugin connects TouchPortal to YouTube Music Desktop (ytmdesktop) using the Companion Server API.

Important: The plugin ID is now `com.hellblazer90.ytmdesktop.v2`. If you used the old `com.abuelo.ytmdesktop.v2` build, TouchPortal treats this as a new plugin. You will need to re-import the plugin and re-bind actions/states on your buttons.

## Index

- [Tested With](#tested-with)
- [Requirements](#requirements)
- [Installation (User)](#installation-user)
- [Generate a Token (TouchPortal)](#generate-a-token-touchportal)
- [Generate a Token (PowerShell)](#generate-a-token-powershell)
- [Generate a Token (CMD)](#generate-a-token-cmd)
- [Token File Location](#token-file-location)
- [TouchPortal Settings (Defaults)](#touchportal-settings-defaults)
- [Cover Art Options](#cover-art-options)
- [Cover Art Setup (TouchPortal 4.4 Build 6)](#cover-art-setup-touchportal-44-build-6)
- [Performance Notes (E3081)](#performance-notes-e3081)
- [Actions](#actions)
- [Connectors](#connectors)
- [Events](#events)
- [States](#states)
- [Build the .tpp Package (Advanced)](#build-the-tpp-package-advanced)
- [Troubleshooting](#troubleshooting)
- [Uninstall](#uninstall)

## Tested With

- TouchPortal 4.4 Build 6
- YouTube Music Desktop (ytmdesktop) 2.0.10 with Companion Server enabled

## Requirements

- Windows 10 or newer
- TouchPortal 3.0+
- YouTube Music Desktop with Companion Server enabled
- Node.js 18+ (bundled fetch is used)

## Installation (User)

1. Open YouTube Music Desktop -> Settings -> Companion Server.
2. Enable Companion Server and Companion Authorization.
3. Download `YTMDesktopTP.tpp` from the latest GitHub Release.
   - YouTube Music Desktop App: https://github.com/ytmdesktop/ytmdesktop
4. Import it in TouchPortal:
   - Settings -> Plug-ins -> Import -> select `YTMDesktopTP.tpp`.
5. Restart TouchPortal.
6. Generate a Companion token (see below).

## Generate a Token (TouchPortal)

1. Add the action `Generate Token`.
2. Press it once.
3. Approve the authorization prompt in YouTube Music Desktop.
4. The plugin saves the token to `ytmd_companion_token.txt` and fills the setting automatically.

## Generate a Token (PowerShell)

```powershell
Set-Location "C:\path\to\YTMDesktopTP"
powershell -ExecutionPolicy Bypass -File .\scripts\Get-CompanionToken.ps1
Get-Content .\ytmd_companion_token.txt
```

## Generate a Token (CMD)

If PowerShell policy blocks the script, use the CMD helper:

```cmd
cd /d "C:\path\to\YTMDesktopTP"
.\scripts\Get-CompanionToken.cmd
```

This writes `ytmd_companion_token.txt` and pauses so you can see any errors.

## Token File Location

The token file is stored next to the plugin:

`%APPDATA%\TouchPortal\plugins\com.hellblazer90.ytmdesktop.v2\ytmd_companion_token.txt`

You can paste the token manually into TouchPortal settings if needed.

## TouchPortal Settings (Defaults)

- Companion Server Hostname (Advanced, usually 127.0.0.1): `127.0.0.1`
- Companion Server Port (from YTM Desktop, default 9863): `9863`
- Companion Token (from Generate Token): empty
- Poll Interval (ms) (Advanced, >=6000): `6000`
- Elapsed Update Interval (ms) (0=off, local ticker): `500`
- Send Elapsed/Duration States (True/False, local UI): `True`
- Minimal State Mode (True/False, fewer states): `False`
- Extended States Enabled (True/False, volume/like/repeat/cover): `True`
- Cover Art Mode (Off/Memory/Local, icon source): `Memory`
- Cover Art Max Width (64/128/256/512, smaller=less lag): `512`
- Connection Status (Read-Only): read-only
- Token Status (Read-Only): read-only

If the Companion Token setting is empty, the plugin reads `ytmd_companion_token.txt` automatically.
Note: The Companion Server `/state` endpoint is rate-limited (1 request per 5 seconds). Keep Poll Interval >= 6000 ms to avoid 429 errors.
Commands are rate-limited (about 2 per second). The plugin queues commands to reduce 429 errors from rapid taps.

## Cover Art Options

- `Cover Art Base64 (raw)` is the most reliable way to show artwork on buttons.
- TouchPortal cannot always fetch remote URLs directly for images. Use the base64 state for icons/backgrounds.
- Cover Art Mode:
  - `Off`: no cover art download.
  - `Memory`: download to memory and send base64 only.
  - `Local`: download to a local file and also send base64.

Suggested button setup:
- On Event: `Cover Art Base64 (raw)` changes to
- Action: Change Icon with value from `Cover Art Base64 (raw)`

## Cover Art Setup (TouchPortal 4.4 Build 6)

TouchPortal 4.4 Build 6 button icon actions do not accept URLs. Use a local file path or base64.

Recommended setup:
1. On Event: When `Cover Art URL` changes to
2. Action: Change Icon with value from `Cover Art Path` (local file)

If you prefer base64:
1. On Event: When `Cover Art Base64 (raw)` changes to
2. Action: Change Icon with value from `Cover Art Base64 (raw)` (enable base64 option if the action provides one)

If icons lag, reduce `Cover Art Max Width` or set `Cover Art Max Base64 Length`.

## Performance Notes (E3081)

If TouchPortal reports a performance warning:
- Keep Poll Interval >= 6000 ms (the API is rate-limited).
- Leave State Replay Interval disabled (it is off by default).
- Disable cover art if you do not need it.
- Use `Minimal State Mode` for the smallest possible updates.
- Use `Extended States Enabled` only if you need volume/mute/like/repeat/ID states.

## Actions

- Playback (Play / Pause / Toggle)
- Next / Previous
- Like / Dislike
- Volume Up / Down (Step)
- Set Volume (Percent)
- Mute / Unmute / Toggle
- Seek Forward / Rewind (Seconds)
- Seek To (Seconds)
- Repeat Mode (OFF / ALL / ONE)
- Play Queue Index
- Shuffle (Toggle)
- Generate Token
- Refresh

## Connectors

- Volume Slider (0-100)

## Events

- Playback Is Paused (True/False)
- Like State (INDIFFERENT/LIKE/DISLIKE/UNKNOWN)
- Repeat Mode (NONE/ALL/ONE/UNKNOWN)

## States

Core states:
- Song Title, Artist, Album
- Has Song
- Track State
- Is Paused / Is Playing

Extended states (when enabled):
- Duration (sec + mm:ss)
- Elapsed (sec + mm:ss)
- Volume Percent
- Is Muted
- Ad Playing
- Is Live
- Like State
- Repeat Mode
- URL / Video ID / Playlist ID / Media Type

Cover art states:
- Cover Art Base64 (raw)
- Cover Art URL
- Cover Art URL (small, direct)
- Cover Art Path (local file)
- Cover Art File URL
- Cover Art Debug

## Build the .tpp Package (Advanced)

```powershell
$root = Resolve-Path .
$stage = Join-Path $root "package\\com.hellblazer90.ytmdesktop.v2"
$zipPath = Join-Path $root "YTMDesktopTP.zip"
$tppPath = Join-Path $root "YTMDesktopTP.tpp"
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item -Force (Join-Path $root "plugin\\entry.tp") $stage
Copy-Item -Force (Join-Path $root "start.cmd") $stage
Copy-Item -Recurse -Force (Join-Path $root "src") $stage
Copy-Item -Force (Join-Path $root "package.json") $stage
Copy-Item -Force (Join-Path $root "icon.png") $stage
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
if (Test-Path $tppPath) { Remove-Item $tppPath -Force }
Compress-Archive -Force -Path $stage -DestinationPath $zipPath
Move-Item -Force $zipPath $tppPath
```

## Troubleshooting

- Error 429 on Connection Status: set Poll Interval >= 6000 ms, and make sure only one Companion client is using the token. Remove old plugin versions and generate a new token if needed.
- Action failed (HTTP 429): commands are rate-limited (about 2 per second). Avoid rapid taps and macros that send repeated commands.
- Token generation fails (HTTP 400): verify Companion Authorization is enabled in YouTube Music Desktop.
- Token generation fails (HTTP 429): wait a few seconds and try again.
- Buttons feel inconsistent (Seek/Repeat/Volume Up or Down): confirm the action dropdown values are set, and avoid double triggers (Pressed + Released). Use Set Volume or Seek To as a fallback.
- Cover art missing: in TouchPortal 4.4 Build 6, button icons do not accept URLs. Use `Cover Art Path` or `Cover Art Base64 (raw)`. Check `Cover Art Debug` for errors and reduce cover size if laggy.
- E3081 performance warning: increase Poll Interval, disable cover art or extended states, enable Minimal State Mode, and confirm only one plugin instance is running.
- Not updating: check Connection Status in TouchPortal settings.

## Uninstall

1. TouchPortal -> Settings -> Plug-ins -> Remove `YTM Desktop (V2)`.
2. Delete the folder:
   `%APPDATA%\\TouchPortal\\plugins\\com.hellblazer90.ytmdesktop.v2`
