# Local Source

A **local source** is a folder on a drive physically connected to your Steam Deck — the internal SSD, an SD card, or a USB drive. This is the simplest source type: no network, no credentials, no extra software.

---

## What you need before adding this source

A folder containing your Windows game directories. Each direct subdirectory becomes a game entry in Deckyfin.

Recommended structure:
```
/path/to/games/
├── Cyberpunk 2077/
│   └── bin/
│       └── x64/
│           └── Cyberpunk2077.exe
├── The Witcher 3/
│   └── bin/
│       └── x64/
│           └── witcher3.exe
└── Hades/
    └── Hades.exe
```

No other software or configuration is needed — just the folder.

---

## Adding it in Deckyfin

1. Open Deckyfin → **Settings → Sources → Add Source**
2. Give it a name (e.g. "SD Card Games")
3. Select type **local**
4. Browse to or type the folder path
5. Tap **Save**

After saving, tap **Rescan** next to the source to detect your games.

---

## What Deckyfin does to the source folder

When you rescan a local source, Deckyfin:

1. Creates a `.deckyfin/` folder inside your source path (if it doesn't already exist)
2. Creates a `config.json` file inside `.deckyfin/` to store per-game settings
3. Scans subdirectories and adds a blank config entry for each new game found
4. Preserves existing config entries — rescan only adds entries for new folders and removes entries for folders that no longer exist

**Your source folder after the first rescan:**
```
/path/to/games/
├── .deckyfin/
│   └── config.json   ← Deckyfin writes only this file
├── Cyberpunk 2077/
├── The Witcher 3/
└── Hades/
```

Your game files are never modified. The only thing Deckyfin writes is `.deckyfin/config.json`.

---

## Per-game configuration

Once games are detected, open a game in Deckyfin to configure:

- **Executable** — the `.exe` file to launch (browseable from the game folder)
- **Proton version** — which Proton/Wine build to use
- **Dependencies** — winetricks/protontricks packages to install into the prefix
- **Steam App ID** — the Steam Store ID, used only for ProtonDB/WineDB dependency lookups
- **Launch options** — extra command-line arguments

Changes are saved back to `.deckyfin/config.json` in the source folder.

---

## Notes

- Deckyfin runs inside Decky Loader as root. For local sources, root has unrestricted access — no special setup needed.
- If you move or rename the source folder, update the path in **Settings → Sources**.
- Multiple sources can point to different folders (e.g. one per SD card, one for the internal SSD).
