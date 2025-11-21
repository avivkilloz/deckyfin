# Deckyfin

Deckyfin is a Decky Loader plugin that keeps a curated list of non‑Steam games in sync across local storage, Proton prefixes and an optional remote host.

## Features

- Read a declarative game list from a YAML file (see `sample-games-yaml-file.yaml`).
- Display per-game health (installation status, Proton prefix readiness, last save backup).
- Create/prepare Proton prefixes so dependencies can be installed before running the game.
- Copy user-defined Proton save paths into a structured backup directory and optionally mirror them to a remote server.
- Mirror full game folders and the YAML definition from an SSH/rsync host.

Remote operations rely on `rsync` being available on both the Steam Deck and the remote host. Authentication uses your existing SSH configuration (keys/passwords).

## YAML format

```yaml
games:
  - name: "The Witcher 3"
    path: "/home/deck/Games/The Witcher 3"
    remote_path: "rpg/witcher3"           # optional, defaults to local folder name
    steam_appid: 292030
    proton_version: GE-Proton10-25        # falls back to plugin default if omitted
    proton_dependencies:
      - "VC 2019 Redist"
      - "DirectX Jun 2010 Redist"
    proton_sync_paths:
      - "%USERPROFILE%/My Documents/The Witcher 3/"
      - "%LOCALAPPDATA%/CD Projekt Red/The Witcher 3/"
```

`proton_sync_paths` accept Windows-style placeholders that Deckyfin expands inside the Proton prefix (`%USERPROFILE%`, `%APPDATA%`, `%LOCALAPPDATA%`, `%DOCUMENTS%`, `%DRIVE_C%`). Absolute Linux paths are supported too.

## Configuration workflow

1. Place your YAML definition locally or inside the remote games directory.
2. Open Deckyfin and configure:
   - **Local games folder**: base for any relative `path` values.
   - **YAML path**: used whenever remote sync is disabled.
   - **Proton compatdata path** and **default Proton version**.
   - **Save backup folder**: where Deckyfin mirrors Proton save data.
   - Optional **remote host** (`user@host`), **remote games path**, **YAML filename**, **remote save subfolder** and desired `rsync` flags.
3. Press **Save settings** and then **Refresh** to load the library.
4. Use the per-game actions:
   - **Download / Update**: pull files from the remote host into the local path.
   - **Prepare Proton Prefix**: create the compatdata skeleton and metadata file.
   - **Sync Saves**: copy each `proton_sync_path` into the backup directory (and push upstream when remote sync is enabled).

The **Sync all saves** action runs the backup routine sequentially for every game.

## Local testing

1. Install dependencies (recommended: [`pnpm`](https://pnpm.io/)):
   ```bash
   pnpm install
   ```
2. Build the frontend bundle:
   ```bash
   pnpm run build
   ```
   Output lands in `dist/` and is consumed automatically by Decky Loader.
3. (Optional) keep the watcher running while iterating:
   ```bash
   pnpm run watch
   ```
4. Use the Decky CLI to link/install the plugin or copy the repo into `~/homebrew/plugins/deckyfin`.
5. On the Deck, enable developer mode, reload the plugin list, then open Deckyfin from the sidebar.

### Backend validation tips

- The backend exposes callables such as `load_games`, `download_game`, `setup_proton_prefix`, `sync_game_saves` and `sync_all_saves`. Invoke them via `decky-cli call deckyfin <method> "<arg>"` while debugging.
- Remote features require `rsync` binaries on both ends plus SSH reachability. For offline testing, simply set `remote.enabled = false`.

## Deployment checklist

1. Ensure `pnpm run build` succeeds and `dist/` is up to date.
2. Double‑check `plugin.json` metadata (name, author, flags, publish tags).
3. Package with the Decky CLI (`decky plugin build`) or copy the repository into `~/homebrew/plugins/deckyfin`.
4. Restart Decky Loader (long-press the Decky menu → **Restart Decky**) to load the new version.
5. Run a smoke test:
   - Refresh the library (YAML parses without errors).
   - Prepare a Proton prefix.
   - Sync saves and verify files appear under the backup directory.
   - If remote sync is enabled, download/update a game and confirm the files arrive locally and that backups upload successfully.

Feel free to adapt the YAML schema or extend the Python helpers to fit your workflow. Contributions and bug reports are welcome!
