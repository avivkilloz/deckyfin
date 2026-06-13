# Transfer Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add config copy and game file transfer between sources, surfaced as contextual actions in GameDetail.

**Architecture:** Two distinct operations sharing a common inline source-picker UI pattern in GameDetail. Config copy is synchronous. Game file transfer is background, tracked via a `_transfer_registry` in `main.py`, with progress surfaced through polling callables.

**Tech Stack:** Python asyncio + threading (backend), React 18 + TypeScript (frontend), existing FUSE subprocess pattern for permission-safe file I/O.

---

## Context

Deckyfin manages Windows games from multiple sources (local drives, network mounts). A `MergedGame` aggregates the same game across sources by name. Each source stores game config in `<source_path>/.deckyfin/config.json`. The plugin runs as root inside Decky Loader; FUSE and NFS mounts require subprocess privilege drops to uid/gid of the mount owner — this pattern already exists in `main.py`.

---

## Operations

### Config Copy

Copies portable game settings from one source's config entry to another source that already has the same game. Both sources must have an entry for the game (i.e. the game folder exists on both).

**Portable fields copied:** `executable`, `start_dir`, `steam_app_id`, `proton_version`, `proton_dependencies`, `proton_sync_paths`, `categories`, `launch_options`, `collections`, `path`.

**Excluded fields** (per-source Steam state, reset on destination): `steam_snapshot`, `deps_snapshot`, `needs_restart_after_add`, `needs_restart`.

Executable and start_dir paths are stored relative to the source root (e.g. `Game Name/bin/game.exe`), so they transfer as-is — no path translation needed.

### Game File Transfer

Copies the entire game folder from a source that has the game to a source that does not. The portable config is written to the destination after files are copied. Runs as a background job; the UI remains usable during transfer.

**Post-transfer steps (on success):**
1. Write portable config fields to destination source's `config.json` — `save_games_config` creates `.deckyfin/` via `mkdir -p` as a side effect, so this is safe even on a freshly added source
2. Call `initialize_source` on destination — picks up any other pre-existing game folders on that source; since the transferred game is already in `config.json`, it is preserved as-is

**On failure:** delete the partial destination game folder, mark transfer as failed.

**Resume:** not supported. On retry, transfer restarts from scratch. LAN transfers (100–500 MB/s) complete fast enough that checksum-based resume would cost as much time as restarting.

---

## UI Design

### Contextual action row in GameDetail

Rendered directly below the existing source selector. Visible only when the relevant condition is met:

- **"Copy config →"** button: shown when `game.sources.length >= 2`
- **"Copy game →"** button: shown when there is at least one configured source that does not have this game and has `can_write_config: true`

Both buttons follow the existing `BTN_STYLE` pattern in GameDetail.

### Inline source picker

Clicking either button expands an inline bordered list below the button (same visual pattern as the Proton version picker). Each item shows the source name and type badge. Selecting an item does NOT trigger the action — it only sets the destination.

After selection, the picker collapses and a confirmation line replaces it:

- Config copy: `"Replace [Dest]'s config with [Source]'s config?"  [Cancel]  [Copy]`
- Game copy: `"Copy [Game Name] to [Dest]?"  [Cancel]  [Copy]`

Confirming triggers the action. Cancelling returns to the action row with buttons.

### Progress banner (game transfer only)

While a transfer is active for the current game, a persistent banner is rendered at the bottom of GameDetail:

```
▸ Copying to [Dest Source]…  45%  ████████░░  12.3 / 27.1 GB   [✕]
```

- Progress bar width driven by `bytes_copied / total_bytes`
- Polls `get_transfer_status(transfer_id)` every 2 seconds
- `[✕]` calls `cancel_transfer(transfer_id)` — cancels running transfer or dismisses a completed/failed result
- On `status === "done"`: banner shows "✓ Copy complete", then reloads game data so destination source appears in source selector
- On `status === "failed"`: banner shows "✗ [error message]  [Retry]  [✕]"

**Reconnect after navigation:** Decky remounts the UI on every sidebar open. On GameDetail mount, call `list_active_transfers()` and check for a transfer matching this game. If found, restore the progress banner and resume polling.

### Settings source cards

SettingsPage calls `list_active_transfers()` on mount. For each transfer with `status === "running"`, the destination source card shows an extra status line:

```
⟳ Receiving Cyberpunk 2077… 45%
```

No persistent polling in Settings — status refreshes only on next mount/reload.

---

## Backend

### New file: `py_modules/deckyfin_transfer.py`

Responsibilities:
- `calculate_total_size(src_path: Path) -> int` — walk the game folder, sum file sizes
- `copy_game_folder(src: Path, dst: Path, progress_cb, owner_uid: int, owner_gid: int)` — file-by-file copy with progress callback; FUSE-aware: if either src or dst requires privilege drop, runs copy in a subprocess under `_drop_privs(owner_uid, owner_gid)`; on any exception, deletes dst and re-raises
- No public state — all transfer state lives in `main.py`

### `_transfer_registry` in `main.py`

```python
# module-level dict, keyed by transfer_id (8-char uuid)
_transfer_registry: dict[str, dict] = {}
# entry shape:
# { transfer_id, game_name, from_source_id, to_source_id,
#   status,        # "running" | "done" | "failed"
#   bytes_copied, total_bytes,
#   error,         # str or None
#   started_at }   # float timestamp for auto-purge
```

Entries older than 10 minutes with a terminal status (`done` or `failed`) are purged on the next call to `list_active_transfers()`.

### New callables in `main.py`

#### `copy_game_config(game_name, from_source_id, to_source_id) -> dict`

```
Returns: { success: bool, error?: str }
```

1. Load source A's game config via `get_games_config`
2. Load source B's game config
3. Merge portable fields from A into B's entry (preserving B's non-portable fields)
4. Write back to source B's `config.json` — try direct, fall back to subprocess with `_drop_privs` on `PermissionError`

#### `start_game_transfer(game_name, from_source_id, to_source_id) -> dict`

```
Returns: { success: bool, transfer_id?: str, error?: str }
```

1. Validate: source A has the game, source B does not, source B path is known
2. Create registry entry with `status="running"`, `bytes_copied=0`
3. Calculate total size
4. Spawn a background thread that calls `copy_game_folder`, updating `bytes_copied` in the registry entry via a progress callback
5. On thread completion: write config to destination, call `initialize_source(to_source_id)`, set `status="done"`
6. On thread exception: clean up partial folder, set `status="failed"`, store error message
7. Return `transfer_id` immediately (non-blocking)

#### `get_transfer_status(transfer_id) -> dict`

```
Returns: { transfer_id, game_name, from_source_id, to_source_id,
           status, bytes_copied, total_bytes, error }
```

Simple registry lookup. Returns `{ error: "not found" }` if the id is unknown (entry was purged).

#### `cancel_transfer(transfer_id) -> dict`

```
Returns: { success: bool }
```

- If `status === "running"`: sets a cancellation flag checked by the copy thread; thread cleans up partial folder on seeing the flag
- If `status === "done"` or `"failed"`: removes entry from registry (dismiss)

#### `list_active_transfers() -> list`

Returns all registry entries. Purges entries older than 10 minutes with terminal status before returning.

---

## File Layout

```
Modified:
  main.py                          — 5 new callables, _transfer_registry
  src/components/GameDetail.tsx    — action row, source picker, confirmation, progress banner
  src/components/SettingsPage.tsx  — transfer status on source cards

New:
  py_modules/deckyfin_transfer.py  — file copy engine
```

---

## Error handling

| Scenario | Behaviour |
|---|---|
| Source A offline / missing config | `copy_game_config` returns `{ success: false, error: "..." }`, UI shows inline error |
| Destination FUSE write fails | subprocess fallback; if subprocess also fails, callable returns error |
| Disk full on destination | copy thread catches `OSError`, cleans up, sets `status="failed"` with message |
| Network drop mid-transfer | `OSError` caught, partial folder deleted, `status="failed"` |
| User cancels | cancellation flag set, thread exits cleanly, partial folder deleted |
| Registry entry purged before UI reads result | `get_transfer_status` returns `{ error: "not found" }`, frontend treats as dismissed |
