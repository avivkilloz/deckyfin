# Steam Library Source Design (installed Store games)

**Date:** 2026-10-30  
**Status:** Approved (pending spec review)

## Overview

Add a second built-in source, **Steam Library**, that lists the user's
**installed Steam Store games** and lets Deckyfin manage what it can for them:
Proton version, launch options, collections, dependencies, save
backup/restore/copy and artwork.

This is sub-project **2 of 3** of the Steam sources work:
1. Steam Shortcuts (orphan non-Steam shortcuts) — done.
2. **Steam Library — installed Store games** — this spec.
3. Steam Library — owned but not installed: full owned list from Steam's UI,
   install/uninstall/verify via Steam's own dialogs, download progress,
   Installed / Not installed filter.

It reuses the built-in-source framework from sub-project 1
(`docs/superpowers/specs/2026-10-30-steam-shortcuts-source-design.md`).

## Data Model

### Built-in source record

Added to `_BUILTIN_SOURCES` in `deckyfin_sources.py`, so the existing
`ensure_builtin_sources()` appends it on startup:

```json
{"id": "steam-library", "name": "Steam Library", "type": "steam_library",
 "builtin": true, "enabled": false, "path": null, "url": null}
```

- Disabled by default; not removable; enable/disable and reorder as usual.
- Existing users get it appended after their current list (the Steam
  Shortcuts record is untouched).
- Constants: `STEAM_LIBRARY_SOURCE_ID = "steam-library"`,
  `STEAM_LIBRARY_SOURCE_TYPE = "steam_library"`.

**TypeScript:** `SourceType` gains `"steam_library"`. Built-in detection on the
frontend uses a single helper `isBuiltinSourceType(type)` (true for
`steam_shortcuts` and `steam_library`), replacing the `=== "steam_shortcuts"`
derivation in `GameLibrary.tsx`.

**Pills (`src/sourceStyle.ts`):** `steam_shortcuts` → `shortcut`,
`steam_library` → `steam`. Both use the Steam blue colors.

### Per-game Deckyfin data store

`source_config_root()` returns `get_app_config_path() / "steam_library"` for
`steam_library` sources. Deckyfin-only fields (`proton_dependencies`,
`proton_sync_paths`, custom `launch_options` text, `selected_launchers`,
`collections`) live in `<that>/.deckyfin/config.json`, keyed by game name,
using the existing `get_games_config` / `upsert_store_entry`-style helpers.
Ephemeral state (`steam_snapshot`, `deps_snapshot`, `needs_restart`) uses the
central state store keyed by `("steam-library", name)`.

Stored entries for games no longer installed are ignored and pruned when the
list is built (skipped when zero games were found, as with orphans).

## Discovery

New module `py_modules/deckyfin_steam_library.py`.

1. **Library folders:** parse `<steam root>/steamapps/libraryfolders.vdf`
   (text VDF; entries `"0"`, `"1"`, … each with a `path`). Each library is
   `<path>/steamapps`. Missing/unreadable file → `[<steam root>]` only.
   Library paths that don't exist (e.g. SD card removed) are skipped.
2. **Manifests:** parse every `<library>/steamapps/appmanifest_*.acf` (text
   VDF, root key `AppState`). Keep an app when `StateFlags` has the
   fully-installed bit (`4`) — an installed game with a pending update
   (e.g. `6`) is still playable and is kept; skip otherwise.
3. **Tool exclusion:** drop apps whose appid is in a known tools set
   (Steamworks Common Redistributables `228980`, Steam Linux Runtime
   `1070560`, `1391110`, `1628350`, `4183110` (4.0), Proton EasyAntiCheat Runtime
   `1826330`, Proton BattlEye Runtime `1161040`) or whose `name` starts with
   `Proton ` / equals `Proton Experimental` / `Proton Hotfix` or starts with
   `Steam Linux Runtime`.
4. **Proton state:** `proton_version` from the CompatToolMapping entry for
   the appid (existing reader); `prefix_path` =
   `<library>/steamapps/compatdata/<appid>/pfx` if that dir exists.
   `has_prefix = prefix_path is not None or proton_version is not None`
   ("rule A": an action that needs a prefix is shown only when one exists or
   Proton is forced).
5. **Launch options seed:** `LaunchOptions` for the appid from
   `localconfig.vdf` (`UserLocalConfigStore/Software/Valve/Steam/apps/<appid>`),
   used only when the store has no `launch_options` for that game yet.

### Per-game config

| Field | Value |
|---|---|
| `id` | `steam-<appid>` |
| `name` | manifest `name` |
| `steam_app_id` | appid (int) |
| `library_path` | library root (the folder containing `steamapps`) |
| `install_dir` | `<library>/steamapps/common/<installdir>` |
| `prefix_path` | as above, or `null` |
| `has_prefix` | as above |
| `proton_version` | CompatToolMapping entry or `null` |
| `size_on_disk` | manifest `SizeOnDisk` (int) |
| `launch_options`, `selected_launchers`, `collections`, deps, sync paths | from the store (launch options seeded as above) |
| `steam_snapshot` | JSON of `{proton_version, launch_options, collections}` as last applied (state store) |

### Capabilities and disk usage

- `detect_capabilities`: `{can_play: true, can_write_config: true, can_download_to: false}`.
- `get_disk_usage`: all null.
- `get_builtin_source_summary` count = number of installed games.

## Merging with source games

`attach_orphans_by_name` is generalized to `attach_builtin_games(games)`:
a merged game whose sources are all built-in is folded into a non-built-in
game when:

- **steam_library:** the target has a source config with `steam_app_id` equal
  to the Store appid; otherwise the target's name equals the Store game's name
  (case-insensitive).
- **steam_shortcuts:** name match only (unchanged).

Unmatched built-in games stay separate.

## Prefix-aware helpers

- `deckyfin_saves.get_prefix_path(app_id, library_path=None)`: uses
  `<library_path>/steamapps/compatdata/<app_id>/pfx` when given, else the
  Steam root (unchanged for shortcuts).
- `sync_saves` / backup-all: for `steam_library` games, pass the game's
  `library_path`; `game://` resolves against `install_dir`.
- `install_protontricks_dependencies(pfxid, deps, ..., compatdata_path=None)`:
  when `compatdata_path` is given it is used as the prefix location and the
  installer **never creates a prefix** there (returns an error asking the user
  to launch the game once). The Store-game endpoint passes
  `<library>/steamapps/compatdata/<appid>`.

## Settings UI

The Steam Library card mirrors Steam Shortcuts: `steam` pill, ▲▼ and
Enable/Disable only, count line `N installed games` / `Disabled`, no disk
bar, never "offline".

## Game Detail UI (`source_type === "steam_library"`)

- **Read-only:** name. **Hidden:** executable, start dir, exe picker.
  Metadata shows install folder and library.
- **Editable Steam settings:** Proton version, launch options (custom text +
  popular-launcher chips, assembled with the existing `buildLaunchOptions`),
  collections.
- **"Apply to Steam"** (replaces Add/Update Steam game for this source; green
  when Proton/launch options/collections differ from `steam_snapshot`):
  - Proton: `SteamClient.Apps.SpecifyCompatTool(appid, toolName)` (empty
    string clears it) — live, no restart.
  - Launch options: `SteamClient.Apps.SetAppLaunchOptions(appid, text)` — live.
  - Collections: existing backend collections sync → sets needs-restart.
  - On success, store the snapshot; on any failure show the error and keep
    the button green.
- **Gated by `has_prefix`:** Install deps, Save Paths, Backup/Restore, Copy
  Saves. Without a prefix, show: *"No Proton prefix yet — pick a Proton
  version and launch once from Steam."*
- **Always:** Artwork (SteamGridDB → `SetCustomArtworkForApp(appid, …)`).
- **Hidden:** Add/Remove from Steam, Purge, Init prefix, Copy Game, Copy
  Config, delete game folder.
- `steamInfo` for this source is synthesized from `steam_app_id`
  (`{unsigned_appid: appid}`) instead of the shortcut lookup, so existing
  appid-based actions work unchanged.

## Library UI

Store games appear like other games with a `steam` badge. Built-in sources
(both types) are excluded from the "Add Games to Steam" and "Backup All Saves"
pickers and from source counts/onboarding, via `isBuiltinSourceType`.

## Edge Cases

- Missing/unmounted library folder → its games disappear until it's back.
- Unreadable `libraryfolders.vdf` → Steam root library only.
- Apps without the installed bit (downloading, partially installed) are skipped; installed apps with a pending update are kept.
- Live `SteamClient` call unavailable or throws → error shown, state stays dirty.
- Same name in two libraries (rare) → distinct ids by appid; name-keyed store
  entries collide (accepted, as with orphans).

## Testing (pytest, TDD)

- `libraryfolders.vdf` parsing incl. fallback and skipped missing paths.
- Manifest parsing: installed filter (flags 4 and 6 kept, 1026/0 skipped), tool exclusion.
- Prefix detection in a non-root library; forced Proton with no prefix →
  `has_prefix` true.
- Launch-options seed from `localconfig.vdf`; store value wins once present.
- `get_prefix_path` with and without `library_path`.
- Deps installer with `compatdata_path`: uses it, never creates a prefix.
- `attach_builtin_games`: steam_app_id match, name fallback, shortcuts by name.
- `ensure_builtin_sources` appends Steam Library without touching existing
  records; `load_source_games` dispatches `steam_library`.
- Frontend: `tsc --noEmit` + build + manual run.

## Out of Scope (planned)

- Sub-project 3: owned-but-not-installed games, install/uninstall/verify via
  Steam dialogs, download progress, Installed/Not-installed filter.
- Not planned: Steam Cloud save handling (Steam syncs Cloud saves itself).
