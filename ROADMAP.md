# Deckyfin Roadmap

## Current state (v0.1)

Deckyfin manages **Windows game sources** — folders of `.exe` files run via Proton. A source has a **location type** (where the files live) and today only one **library type** (games).

### Source location types
| Type | Description | Status |
|------|-------------|--------|
| `local` | Folder on the local filesystem (internal SSD, SD card) | ✅ Supported |
| `mount` | Network or remote folder mounted to the local filesystem (NFS, SMB, etc.) | ✅ Supported |
| `agent` | Remote server running the Deckyfin agent, accessed over the network | 🔜 Planned |

---

## Planned: Library types

The goal is to make Deckyfin a universal launcher manager — not just for Windows games, but for any collection of runnable files. When adding a source, the user will choose both a **location type** (above) and a **library type** (below).

### `games` — Windows games via Proton *(current)*

- Scans source folder for subfolders, each subfolder is a game
- Detects `.exe` files within each game folder
- Adds games to Steam as non-Steam shortcuts
- Configures Proton version per game
- Initializes Wine/Proton prefixes
- Installs dependencies via winetricks/protontricks
- Applies SteamGridDB artwork

### `emulation` — Emulation library *(planned)*

Target: integrate with [EmuDeck](https://www.emudeck.com/) folder structure.

- Detects the standard EmuDeck `Emulation/roms/` directory tree
- Each console subfolder (`ps2/`, `switch/`, `gba/`, etc.) maps to a system
- ROM/ISO files are entries; the appropriate emulator is selected per system
- Adds games to Steam using emulator + ROM path as the launch target
- Artwork fetched from SteamGridDB or TheGamesDB by ROM title

#### Auto-configuration

The emulation library type is **fully automatic** — no manual field entry. Deckyfin:

1. Scans the EmuDeck `Emulation/roms/` folder structure to discover systems and ROMs
2. Detects which emulators are installed (Flatpak, native, or AppImage) for each system
3. Auto-generates the correct launch command per system (e.g. `flatpak run org.ppsspp.PPSSPP %ROM%`, `retroarch -L <core>.so %ROM%`)
4. Sets the start directory and any required environment variables automatically
5. Presents the user with a list of discovered games to review before adding to Steam

The user does not need to configure paths or launch options manually. Future versions may allow per-system emulator overrides for users who have non-standard setups.

### `custom` — Manually curated library *(planned)*

For anything that doesn't fit a scanned folder structure — Linux desktop apps, scripts, web apps, emulators not covered by EmuDeck, etc.

- **No folder scan** — entries are added manually via an "Add New Game" global action in the library menu
- Each entry has a **full path** to the runnable file (anywhere on the system), since files may be scattered across the filesystem
- Launch command is fully configurable (e.g. a shell script, a flatpak ID, an AppImage)
- Optional: custom launch options, working directory, environment variables
- Adds to Steam as a non-Steam shortcut like any other source

#### Entry discovery helpers

Rather than making the user fill every field manually, Deckyfin will offer **discovery modes** that auto-configure fields based on the application type. The user picks a mode (or chooses "Manual" to fill everything themselves):

**`.desktop` file discovery**
- Search box scans `/usr/share/applications/`, `~/.local/share/applications/`, `/var/lib/flatpak/exports/share/applications/`, and `~/.local/share/flatpak/exports/share/applications/` for `.desktop` files
- User searches by name; Deckyfin parses the selected file and auto-fills:
  - `Exec` → executable + launch options (strips `%U`/`%f` placeholders)
  - `Path` → start directory (if set)
  - `Name` → game/app name
  - `Icon` → used for Steam artwork fallback
- User can review and override any field before saving

**Flatpak discovery**
- Runs `flatpak list --app --columns=application,name` to enumerate installed Flatpaks
- User picks from the list; Deckyfin auto-fills:
  - Executable: `flatpak run <app-id>`
  - Name: Flatpak app name
- No start directory needed (Flatpak handles sandboxing)

**AppImage**
- User browses for an `.AppImage` file anywhere on the filesystem
- Deckyfin marks it executable if needed and sets the full path as the executable
- No additional configuration required in most cases

**Manual**
- User fills all fields themselves: full path to executable, start directory, launch options
- No automation; for scripts, unusual runtimes, or anything not covered above

---

## Planned: Agent source type

The `agent` source location type will allow Deckyfin to talk to a **Deckyfin agent** running on a remote server (e.g. a Windows home server or a NAS). The agent exposes the server's game library over the network without requiring a filesystem mount.

- Agent runs as a lightweight service on the remote machine
- Deckyfin connects to it over HTTP/WebSocket
- Supports browsing the remote library, syncing configs, and initiating file transfers to local storage
- Compatible with all library types above (a remote server could serve a games library, a ROMs library, etc.)

---

## Design principles

**Automation where possible, manual where needed.** Every library type aims to auto-configure as much as possible — executable path, launch options, start directory, artwork. The user should only need to fill in what Deckyfin cannot detect. Manual override is always available for non-standard setups.

**Discovery is per entry type, not per library.** The same discovery helpers (`.desktop`, Flatpak, AppImage, manual) will be reusable across library types wherever they make sense — for example, a `games` source could also launch a game via a `.desktop` file if the user prefers.

## Other planned improvements

- **Global "Add New Game" action** — available in the library header for `custom`-type sources; opens a form with discovery mode selection (`.desktop`, Flatpak, AppImage, Manual)
- **EmuDeck system detection** — auto-detect which systems have ROMs and which emulators are installed, with per-system emulator override
- **Per-entry launch overrides** — override Proton version, launch options, or working directory per game regardless of library type
- **Multi-library source view** — filter the library by library type when multiple sources of different types are configured
- **Desktop app library type** — dedicated type for Linux desktop applications, similar to `custom` but with the `.desktop`/Flatpak discovery built in as the primary flow rather than an option
