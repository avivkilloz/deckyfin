# Deckyfin

A **Decky** plugin to manage local or home server games on Steam Deck / Desktop Linux.

Add your game folders, detect `.exe` files, add them to Steam with metadata and artwork,
install Proton dependencies automatically, and set up Proton prefixes — all from the
Decky quick-access panel.

## Installation

### Install from Decky Store (recommended)

1. Install [Decky Loader](https://decky.xyz) if you haven't already.
2. Open the Decky store (plug icon in the Quick Access menu).
3. Search for **Deckyfin** and click Install.

That's it — no build steps needed.

### Prerequisites (developer / manual install)

| Requirement | Why | Install |
|---|---|---|
| **Decky Loader** | Plugin framework | [decky.xyz](https://decky.xyz) — follow the one-liner |
| **Steam** | Steam shortcuts and Proton | Already installed on Steam Deck/gaming desktops |
| **Python 3** | Backend runs on Python 3 | Pre-installed on SteamOS / most distros |
| **Node.js + npm** | Frontend build | `sudo pacman -S nodejs npm` (Arch) / `sudo apt install nodejs npm` (Debian) |
| **winetricks** (recommended) | Install VC++ redist / DirectX DLLs into Proton prefixes | `sudo pacman -S winetricks` (Arch) / `sudo apt install winetricks` (Debian) / `brew install winetricks` (macOS) |
| **protontricks** (optional) | Alternative dependency installer, used as fallback | `flatpak install com.github.Matoking.protontricks` (preferred) or `pip install protontricks` or `sudo pacman -S protontricks` (Arch AUR) |
| **xvfb-run** (optional) | Virtual display for headless winetricks GUI | `sudo pacman -S xorg-server-xvfb` (Arch) / `sudo apt install xvfb` (Debian) |

> **No extra setup needed for basic usage.** Proton version switching, prefix initialization, and dependency detection work without any of the optional tools. You only need `winetricks` (and optionally `protontricks` / `xvfb-run`) to use the **Install Dependencies** feature.

### How dependency installation works

When you click **Install Dependencies** (e.g. `vcrun2022,d3dx9`), Deckyfin tries these methods in order until one succeeds:

1. **Flatpak protontricks** — auto-installs via flatpak if missing. Best on Steam Deck (SteamOS) where flathub is pre-configured.
2. **Native protontricks** — uses `protontricks` from AUR/pip. Kills stale `wineserver` processes first.
3. **Proton wine + winetricks** — uses Proton's own bundled `wine64` + `wineserver` directly, bypassing system wine. This is the most portable method (works on any distro with Steam + Proton installed).
4. **System winetricks** — last resort fallback with system wine.

Each method has a 120-second timeout — if it hangs or fails, it moves to the next.

### Install steps

```bash
cd ~
git clone git@github.com:avivkilloz/deckyfin.git

# Symlink into the Steam Deck homebrew plugins directory
ln -s ~/deckyfin ~/homebrew/plugins/deckyfin

# Install Python dependencies
pip install -e "~/deckyfin[dev]"

# Build frontend
cd ~/deckyfin && npm install && npm run build

# Restart Decky (or Steam Big Picture / Game Mode)
sudo systemctl restart plugin_loader.service
```

## Usage

1. Open the **Quick Access Menu** (QAM) — the `...` button on Steam Deck, or the Decky overlay on desktop.
2. Select the **Deckyfin** icon in the sidebar.
3. Go to **Settings** → **Add Source** → choose a name and the folder where your games live (e.g. `/mnt/games`, `~/Games`).
4. Back in the library, select a game to open its detail page.
5. Pick the `.exe`, set a Proton version, and optionally list dependencies (e.g. `vcrun2022,d3dx9`).
6. Tap **Save** to write the config, then **Setup** to:
   - Add the game to Steam as a non-Steam shortcut
   - Initialize the Proton prefix
   - Install any listed dependencies via winetricks/protontricks
7. Tap **Apply Art** to fetch and set cover art from SteamGridDB (requires a free API key in Settings).
8. Restart Steam when prompted — the game will appear in your library.

## Development

```bash
# Watch frontend for changes
cd ~/deckyfin && npm run watch

# Run backend tests
pytest tests/ -v

# Tail Decky loader logs
journalctl -u plugin_loader.service -f
```

## License

MIT
