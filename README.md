# Deckyfin

A **Decky** plugin to manage local or home server games on Steam Deck / Desktop Linux.

Add your game folders, detect `.exe` files, add them to Steam with metadata and artwork,
install Proton dependencies automatically, and set up Proton prefixes — all from the
Decky quick-access panel.

## Installation

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

1. Open the **Quick Access Menu** (QAM) — the `...` button or `STEAM` button
2. Select the **Deckyfin** icon (![Deckyfin icon](src/assets/icon.svg))
3. Go to **Settings** → set your **Games Folder** (e.g. `~/Games`, `/mnt/games`)
4. Tap **Add Game** → browse subdirectories, pick an `.exe`
5. Configure resolution, Proton version, dependencies to install
6. **Setup** — creates the shortcut, initializes the prefix, installs deps

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
