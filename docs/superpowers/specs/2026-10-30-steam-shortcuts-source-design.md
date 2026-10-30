# Steam Shortcuts Source Design

**Date:** 2026-10-30  
**Status:** Approved (pending spec review)

## Overview

Add a built-in, non-removable source called **Steam Shortcuts** that lists
*orphan* non-Steam shortcuts — entries in `shortcuts.vdf` that no Deckyfin
source owns (leftovers from removed sources/games, shortcuts added manually or
by other tools). Orphans appear in the Deckyfin library like any other game and
can be managed with the subset of actions that make sense for a game without a
source folder.

This is sub-project **1 of 3**. Later, separately specced:
2. **Steam Library source — installed Store games** (appmanifest + Store app id).
3. **Steam Library — owned but not installed** (install/uninstall via Steam dialogs).

Sub-project 1 also establishes the built-in-source framework reused by 2 and 3.

## Data Model

### Built-in source record

Persisted alongside user sources in `~/.config/deckyfin/config.json` under
`config["sources"]`:

```json
{"id": "steam-shortcuts", "name": "Steam Shortcuts", "type": "steam_shortcuts",
 "builtin": true, "enabled": false, "path": null, "url": null}
```

- Ensured on plugin startup by `ensure_builtin_sources()` in
  `deckyfin_sources.py`, called next to `migrate_games_folder_to_source()` in
  `main.py::_main`. Appended at the end of the list if missing; idempotent;
  never resets `enabled` or position of an existing record.
- **Disabled by default.**
- `remove_source()` returns `False` for any source with `builtin: true`.
- Enable/disable (`set_source_enabled`) and reorder (`reorder_source`) work
  unchanged.
- `list_sources()` defaults `builtin` to `False` for entries missing it.

**TypeScript** (`src/types.ts`):
- `SourceType` gains `"steam_shortcuts"`.
- `Source` gains `builtin?: boolean`.

### Per-game Deckyfin data store

Orphans have no source folder, so Deckyfin-only config fields
(`proton_dependencies`, `proton_sync_paths`, etc.) are stored in
`~/.config/deckyfin/steam_shortcuts/.deckyfin/config.json`
(`get_app_config_path() / "steam_shortcuts"`) — same schema as a
source's config, so `get_games_config` / `get_game_config` /
`update_game_config` are reused unchanged.

New helper `_source_config_root(source) -> Optional[Path]` in
`deckyfin_sources.py`: returns `get_app_config_path() / "steam_shortcuts"` for
`steam_shortcuts`, otherwise `Path(source["path"])` (or `None`). All call sites
in `main.py` that currently derive the config root from `source.get("path")`
for config reads/writes (`get_game`, `update_game_config`) use
this helper.

Ephemeral state (`steam_snapshot`, `deps_snapshot`, `needs_restart`, …) keeps
using the central state store (`deckyfin_game_state.py`), keyed by
`("steam-shortcuts", name)` — no change needed.

Stored entries for shortcuts no longer present in Steam are ignored, and
pruned from the store when the list is built.

## Orphan Detection

New module `py_modules/deckyfin_steam_shortcuts.py`:

```python
def list_orphan_shortcuts(sources: list[dict]) -> list[dict]
```

1. Read shortcuts via `list_nonsteam_games()` (current Steam user), extended to
   also return `start_dir`, `launch_options` and `tags` per shortcut.
2. Build ownership sets from **all** non-builtin sources, enabled or not:
   - `owned_names`: lower-cased game names from each source's config
     (unreadable sources contribute nothing here).
   - `owned_paths`: each source's `path`, `os.path.normpath`'d (not
     resolved — resolving can hang on an offline network mount).
3. A shortcut is **owned** if its lower-cased name is in `owned_names`, OR its
   exe path is under any path in `owned_paths`. Otherwise it is an orphan.

The path rule keeps games of an offline/unmounted source from appearing as
orphans; including disabled sources keeps disabled sources' games from
reappearing here.

Failure handling: missing/unreadable `shortcuts.vdf` or no Steam user → `[]`.

## Game Loading

`load_source_games(source)` gets a `steam_shortcuts` branch that, for each
orphan, returns a game config:

| Field | Value |
|---|---|
| `id` | `shortcut-<appid>` (never merges with a source game) |
| `name` | shortcut `AppName` |
| `executable` | shortcut `Exe` (unquoted) |
| `start_dir` | shortcut `StartDir` (unquoted) |
| `launch_options` | shortcut `LaunchOptions` |
| `collections` | from shortcut tags |
| `proton_version` | current CompatToolMapping entry |
| `shortcut_app_id` | stored shortcut `appid` (unsigned) |
| other fields | from the Deckyfin store entry with the same name |

Shortcut-derived fields win over stored values. `get_games` therefore includes
orphans only when the built-in source is enabled (existing `enabled` guard).

### Capabilities and disk usage

- `detect_capabilities`: `{can_play: true, can_write_config: true, can_download_to: false}`.
- `get_disk_usage`: `{used: None, total: None, free: None}`.

## Settings UI (`SettingsPage.tsx`)

For a source with `builtin: true`:
- Type pill shows `steam`.
- No path line; instead a count line, e.g. `3 orphan shortcuts`, or `Disabled`
  when disabled. Count comes from a new callable
  `get_builtin_source_summary(source_id) -> {count: number}`.
- Buttons: ▲ ▼ and Enable/Disable only — no Rescan, no Remove.
- No disk bar; the `offline` computation is skipped for builtin sources.

`GameLibrary.tsx`'s offline badge logic gets the same builtin exception.

## Game Detail UI (`GameDetail.tsx`)

When the selected source's `source_type === "steam_shortcuts"`:

- **Editable:** exe, start dir, launch options, collections, Proton version.
  "Update Steam game" writes to `shortcuts.vdf` via the existing
  `update_nonsteam_game` path, followed by the existing needs-restart flow.
- **Name read-only** (renaming changes the shortcut app id, orphaning the
  prefix and artwork).
- **Exe picker:** browses starting from the current exe's directory using the
  existing folder browser, instead of scanning a game folder.
- **Kept:** Init prefix, Install deps, Artwork (SteamGridDB), Remove from
  Steam, Purge. After Remove/Purge the game is no longer an orphan → navigate
  back to the library.
- **Hidden:** Add to Steam, Copy config, Transfer, delete game folder, Save
  backup/restore (backups are stored inside the game's source folder, which
  orphans don't have).
- Built-in sources are excluded from the library's "Add Games to Steam" and
  "Backup All Saves" source pickers.
- Built-in sources are excluded from all source/transfer pickers.

Relative-path resolution in `add_steam_shortcut` / `update_steam_shortcut`
is a no-op for this source (paths in `shortcuts.vdf` are absolute).

## Edge Cases

- Multiple Steam users: use the current user, as Add to Steam already does.
- Duplicate orphan names: distinct ids; name-keyed endpoints use the first
  match (accepted limitation).
- `shortcuts.vdf` changed by Steam while Deckyfin runs: the list is rebuilt on
  every `get_games` call; no caching.

## Testing (pytest, TDD)

- `ensure_builtin_sources`: creates record disabled, idempotent, preserves
  existing `enabled`/position.
- `remove_source` refuses builtin.
- `list_orphan_shortcuts` with fixture `shortcuts.vdf`:
  - name match (case-insensitive) → owned
  - exe under a source path → owned
  - disabled source still owns
  - unreadable source still owns via path rule
  - unmatched → orphan
  - missing `shortcuts.vdf` → `[]`
- `load_source_games` for `steam_shortcuts`: VDF fields win over stored; stored
  deps/sync paths merged; stale store entries pruned.
- `get_games` includes orphans only when the built-in source is enabled.
- `detect_capabilities` / `get_disk_usage` for the built-in source.
- Frontend: `tsc --noEmit` + manual verification via local deploy.

## Out of Scope

- "Adopt into source…" for orphans.
- Renaming orphan shortcuts.
- Steam Library sources (sub-projects 2 and 3).
