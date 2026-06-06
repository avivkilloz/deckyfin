# Phase 1: Plugin Skeleton + Game Library View

> **Goal:** Initialize the Deckyfin Decky plugin with a working Python backend that reads game configs from disk and a React frontend that displays the game library.

**Architecture:** Bundle the deckyfin-api Python utility modules directly into the plugin repo under `backend/`. The `main.py` PluginMain class imports from these modules to expose backend methods. The React frontend talks to the Python backend via Decky's `callPluginMethod` IPC.

**Tech Stack:** Python 3, React/TypeScript, Decky Frontend Lib, Rollup, pytest

---

## Task 1: Initialize the Plugin Repo Structure

**Objective:** Create all scaffolding files for a Decky plugin — metadata, build config, Python skeleton, React skeleton, gitignore.

**Files to create:**
- `plugin.json`
- `main.py`
- `package.json`
- `tsconfig.json`
- `rollup.config.js`
- `.gitignore`
- `Makefile`
- `README.md`
- `pyproject.toml`

## Task 2: Bundle deckyfin-api Utility Modules

**Objective:** Copy the relevant Python modules from deckyfin-api into `backend/`, stripping HTTP/API-specific code (peers, transfer, routers) and keeping only the Steam/Proton/game-config logic.

**Files to create (copied + adapted from deckyfin-api/src/utils/):**
- `backend/__init__.py`
- `backend/consts.py` — shared constants
- `backend/steam.py` — find Steam root, find users
- `backend/games.py` — shortcuts.vdf read/write, app ID calc
- `backend/proton.py` — list protons, find installation, download GE-Proton
- `backend/proton_compat.py` — set Proton version in VDF files
- `backend/prefix.py` — init Proton prefix via wineboot
- `backend/protontricks.py` — install deps via protontricks flatpak
- `backend/steam_control.py` — check Steam running, restart
- `backend/app_config.py` — read/write games config JSON

**Key adaptation:** Remove peer/transfer code, remove HTTP/router dependencies, add `__all__` exports for clean imports.

## Task 3: Write PluginBackend Class (main.py)

**Objective:** Create the PluginMain class that wraps utility functions into Decky-callable methods.

**Methods to expose:**
- `get_games_folder()` → returns currently configured games folder path
- `set_games_folder(path)` → saves games folder to config
- `get_games()` → reads `.deckyfin/config.json` and returns game list
- `scan_games_folder()` → scans for `.exe` files in all subdirs, returns candidates
- `get_game_config(name)` → returns single game config
- `add_game(config_dict)` → saves/updates a game config
- `remove_game(name)` → deletes a game config
- `detect_game_exes(folder)` → given a game folder path, finds all .exe files
- `get_config()` → returns full control panel config (games_folder, mode, peers)

## Task 4: Write React Frontend — Game Library View

**Objective:** Build the main library view showing installed games with their metadata.

**Components:**
- `GameLibrary.tsx` — main page: list of game cards with search/filter
- `GameCard.tsx` — single game card showing name, categories, Proton version
- `GameDetail.tsx` — expanded info for a game (proton, deps, saves, launch options)
- `SettingsPage.tsx` — games folder config, peers list
- `types.ts` — TypeScript interfaces matching Python models

**Frontend calls backend via:**
```tsx
const games = await serverAPI.callPluginMethod<{}, GameConfig[]>('get_games', {});
```

## Task 5: Write Unit Tests (pytest, no Steam required)

**Objective:** Test all backend functions that don't need a running Steam instance.

**Test areas:**
- `test_games.py` — calc_shortcut_app_id(), convert_appid_to_unsigned_32bit(), convert_appid_to_config_format()
- `test_app_config.py` — read/write config files, detect_game_folders()
- `test_steam.py` — steam_id64_to_account_id()
- `test_consts.py` — constants are correct

**Use test fixtures:**
- Fake VDF files in `tests/fixtures/`
- Temporary directories for config file I/O tests
- No actual Steam installation needed — mock `find_steam_root()` for VDF parsing tests

---

## How You Test on Deck

After each task push:

```bash
# On your Deck:
git clone git@github.com:avivkilloz/deckyfin.git
# Or pull if already cloned:
cd ~/deckyfin && git pull

# Copy plugin to Decky's plugin folder:
mkdir -p ~/.config/decky-loader/plugins/deckyfin
cp -r deckyfin/* ~/.config/decky-loader/plugins/deckyfin/
# Or symlink for faster iteration:
ln -s ~/deckyfin ~/.config/decky-loader/plugins/deckyfin

# Restart Decky (switch to desktop, kill decky, or reboot)
# Check logs:
journalctl -u plugin_loader.service -f
```

Run backend tests without Decky:
```bash
cd deckyfin && python -m pytest tests/ -v
```
