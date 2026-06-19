# Deckyfin Multi-Source Design

**Date:** 2026-06-12  
**Status:** Draft — awaiting user review  
**Scope:** Plugin-side implementation (local + mount sources, agent stub). Agent service itself is a separate repo/session.

---

## 1. Overview

Replace the single `games_folder` setting with a list of **sources**. Each source is a root path (local, SSHFS mount) or HTTP endpoint (Deckyfin agent) that contains a `.deckyfin/config.json` with game configs.

Games from all sources are merged by name in the library. One card per unique game name; the game detail page has a source selector to switch between that game's per-source configs. Actions are gated on per-source capabilities.

---

## 2. Source Types & Capability Model

### Source types

| Type | Description |
|------|-------------|
| `local` | Local filesystem path (SSD, HDD, SD card) |
| `mount` | Network-mounted path (SSHFS, NFS, etc.) — already mounted by systemd |
| `agent` | Deckyfin agent HTTP service (separate repo) |

### Capabilities (evaluated at runtime per source)

| Capability | `local` | `mount` | `agent` |
|---|---|---|---|
| `can_play` | ✅ always | ❌ too slow for Steam | ❌ |
| `can_write_config` | check write access on `.deckyfin/` | check write access on `.deckyfin/` | from `GET /capabilities` |
| `can_download_to` | check write access on source root | check write access on source root | from `GET /capabilities` |

`can_play=False` → Steam/prefix/dep action buttons are locked in the game detail.  
`can_write_config=False` → "Apply Config" and "Copy Config to this source" are locked.  
`can_download_to=False` → this source cannot be the *destination* of a download.

---

## 3. Data Model

### 3.1 Config architecture: distributed

Each source root contains its own `.deckyfin/config.json` with that source's game configs. The plugin reads from each source's file on load. This matches the existing single-source design — no structural change to the per-game JSON format.

```
/home/deck/Games/              ← local source root
  .deckyfin/
    config.json                ← {"games": [...]}
    needs_restart              ← flag file (unchanged)
  DarkSouls/
  HollowKnight/

/home/deck/.mnt/drive/games/   ← mount source root
  .deckyfin/
    config.json                ← same structure
  DarkSouls/
  EldenRing/
```

### 3.2 App-level config migration

Current: `~/.config/deckyfin/config.json` stores `games_folder` (single string).  
New: same file gains a `sources` array. `games_folder` is kept during a migration pass, then removed.

```json
{
  "sources": [
    {
      "id": "abc123",
      "name": "Local SSD",
      "type": "local",
      "path": "/home/deck/Games",
      "url": null
    },
    {
      "id": "def456",
      "name": "NAS Drive",
      "type": "mount",
      "path": "/home/deck/.mnt/drive/games",
      "url": null
    },
    {
      "id": "ghi789",
      "name": "Home Server Agent",
      "type": "agent",
      "path": null,
      "url": "http://10.100.102.98:8080"
    }
  ],
  "steamgriddb_api_key": "..."
}
```

**Migration:** During `Plugin._main()` startup, if `games_folder` exists in the app config and `sources` is absent, auto-create a `local` source entry from it and write it back. Runs once; subsequent startups see `sources` already present and skip. No manual migration needed.

### 3.3 Game identity

Games are merged by **name** (case-sensitive, matching the `name` field in each source's config). If `"Dark Souls"` appears in two sources, the library shows one card. The game detail shows a source selector to switch between the two configs.

---

## 4. Backend Changes

### 4.1 New module: `py_modules/deckyfin_sources.py`

Responsibilities:
- CRUD for the sources list in `~/.config/deckyfin/config.json`
- `detect_capabilities(source) → SourceCapabilities` — write-access check for local/mount, HTTP call for agent
- `get_source_disk_usage(source) → DiskUsage` — `shutil.disk_usage(path)` for local/mount, `GET /disk` for agent
- `load_source_games(source) → list[GameConfig]` — reads `.deckyfin/config.json` for local/mount, `GET /games` for agent

### 4.2 New module: `py_modules/deckyfin_transfer.py`

Responsibilities:
- `copy_game_config(game_name, from_source, to_source)` — copies the game's JSON entry from one source's config to another
- `download_game(game_name, from_source, to_source, progress_callback)` — transfers game files:
  - local/mount → local/mount: `rsync -a --progress` (handles partial transfers, large files)
  - agent → local/mount: HTTP streaming `GET /games/{name}/download` (tar stream), extract at destination
  - local/mount → agent: HTTP `POST /games/{name}/upload` (if agent supports it per capabilities)
- Progress updates are written to the game's `processing_state` in the destination source's config, following the existing dep-installation polling pattern

### 4.3 Changes to `py_modules/deckyfin_config.py`

- `get_games_folder()` → kept but deprecated; callers migrate to `get_source_by_id()`
- `list_game_configs(source_id)` → reads from that source's `.deckyfin/config.json`
- `update_game_config(name, updates, source_id)` → writes to that source's config
- All config functions accept optional `source_id`; fall back to first local source for backwards compat during transition

### 4.4 New `main.py` callables

```python
# Sources management
async def list_sources() -> list[dict]
async def add_source(name: str, type: str, path: str | None, url: str | None) -> dict
async def remove_source(source_id: str) -> dict
async def get_source_capabilities(source_id: str) -> dict  # {can_play, can_write_config, can_download_to}
async def get_source_disk_usage(source_id: str) -> dict    # {used, total, free}

# Games (updated)
async def get_games() -> list[dict]
# Now returns merged list: [{name, sources: [{source_id, source_name, source_type, config}]}]

async def get_game(name: str, source_id: str) -> dict
async def update_game_config(name: str, updates: dict, source_id: str) -> dict
async def remove_game(name: str, source_id: str) -> dict
# Session 1: removes game entry from source config only
# Session 2: also deletes game folder from source path

# Transfer
async def copy_game_config(game_name: str, from_source_id: str, to_source_id: str) -> dict
async def download_game(game_name: str, from_source_id: str, to_source_id: str) -> dict
# Starts transfer in a background thread (same pattern as install_dependencies).
# Returns immediately with {success: True, started: True}.
# Progress written to processing_state on the destination source's game config.
# Frontend polls get_game_processing_state(name, to_source_id) every ~2s.
```

All existing callables that take `name` get an optional `source_id` parameter defaulting to the first local source, so callers that haven't migrated yet continue to work.

---

## 5. Frontend Changes

### 5.1 New TypeScript types (`src/types.ts`)

```typescript
export type SourceType = "local" | "mount" | "agent";

export interface Source {
  id: string;
  name: string;
  type: SourceType;
  path: string | null;
  url: string | null;
}

export interface SourceCapabilities {
  can_play: boolean;
  can_write_config: boolean;
  can_download_to: boolean;
}

export interface SourceDiskUsage {
  used: number;   // bytes
  total: number;
  free: number;
}

export interface GameSource {
  source_id: string;
  source_name: string;
  source_type: SourceType;
  config: GameConfig;
}

// Updated: get_games() now returns this shape
export interface MergedGame {
  name: string;
  sources: GameSource[];
}
```

### 5.2 Settings page (`src/components/SettingsPage.tsx`)

Replace the "Games Folder" text field with a Sources section:

- **Sources list** — each source shows: name, type badge (colored by type), path/url, disk usage bar, Remove button
- **Offline source** — path unreachable → show "⚠ offline" badge, no disk bar
- **Add Source button** → opens an inline type picker, then a path/url input for that type
- **Disk bar** — `shutil.disk_usage` for local/mount; `GET /disk` for agent; polled once on settings open

### 5.3 Library (`src/components/GameLibrary.tsx`)

- `get_games()` returns merged games. Frontend iterates `MergedGame[]` and renders one `GameCard` per entry.
- `GameCard` receives `isInSteam` (unchanged) and a `sourceCount` to show a small badge if the game is in multiple sources.
- `openGame` passes the full `MergedGame` to `GameDetail` (including all sources).

### 5.4 Game detail (`src/components/GameDetail.tsx`)

**Source selector** — inserted between Back button and "Game Settings" heading:
- Button showing current source name + type badge
- Clicking opens an inline picker (same focusable-list pattern as Proton picker)
- Source badge color: green for `local`, orange for `mount`, blue for `agent`
- Switching source reloads all config fields from that source's `GameConfig`

**Capability gating:**
- `can_play=false` → show lock notice + disable Add/Update Steam, Init Prefix, Install Deps, Restart Steam
- `can_write_config=false` → disable Apply Config

All other fields (name, executable, deps, collections, SteamGridDB art, Danger Zone) remain exactly as today.

**Transfer section** — new block after Steam Actions, before SteamGridDB Art:

```
Transfer
  Copy config to  [ destination picker ▾ ]  [ Copy Config ]
  Download game to [ destination picker ▾ ]  [ Download ]
```

- Destination pickers list only sources where `can_write_config=true` (for Copy Config) or `can_download_to=true` (for Download)
- Download progress reuses the `processing_state` polling pattern from dep installation
- Progress shown as "Downloading… X%" (rsync parses `--progress` output; HTTP uses Content-Length)

**Remove from Deckyfin** (Danger Zone) — label changes to "Remove from [Source Name]":
- Removes the game's JSON entry from that source's config
- Also deletes the game's folder from the source path (local/mount: `shutil.rmtree`; agent: `DELETE /games/{name}`)
- Card stays in library if other sources still have this game

---

## 6. Agent Interface Stub Spec

The Deckyfin agent is a separate service (separate repo, likely FastAPI + Docker). The plugin treats it as a source and calls these endpoints:

```
GET  /capabilities
     → { can_write_config: bool, can_download_to: bool }

GET  /disk
     → { used: int, total: int, free: int }   # bytes

GET  /games
     → [ { name, executable, proton_version, proton_dependencies, ... } ]
     # Same fields as GameConfig

GET  /games/{name}/config
     → GameConfig

PUT  /games/{name}/config          (requires can_write_config=true)
     body: GameConfig
     → { success: bool }

GET  /games/{name}/download        (streaming)
     → tar.gz stream of the game folder

POST /games/{name}/upload          (requires can_download_to=true)
     body: tar.gz stream
     → { success: bool }

DELETE /games/{name}               (requires can_write_config=true)
     → { success: bool }
```

The agent reads its capabilities from environment variables:
- `DECKYFIN_ALLOW_WRITE=true/false` — controls `can_write_config` and `can_download_to`

The plugin adds an `agent` source type in this session with the full HTTP integration. The agent service itself (Docker image, FastAPI app, deployment) is a separate session.

---

## 7. Session Scoping

### Session 1 — Core infrastructure (this repo)

- Data model migration: `sources` array in app config, auto-migrate `games_folder`
- `deckyfin_sources.py`: CRUD, capability detection, disk usage, per-source game loading
- `get_games()` merged response
- Settings page: Sources section (list, add, remove, disk bar)
- Library: render from merged game list, source count badge
- Game detail: source selector, capability gating on existing Steam actions
- `get_game`, `update_game_config`, `remove_game` all gain `source_id` parameter
- **Agent source type included** (HTTP calls to the stub endpoints above)

### Session 2 — Transfer operations (this repo)

- `deckyfin_transfer.py`: rsync for local/mount, HTTP streaming for agent
- `copy_game_config` callable
- `download_game` callable with progress
- Transfer section UI in game detail
- "Remove from [Source]" replaces "Remove from Deckyfin" + deletes game folder

### Session 3 — Deckyfin agent (new repo)

- FastAPI service implementing the stub spec above
- Docker/Podman container with games folder mounted
- `DECKYFIN_ALLOW_WRITE` env var
- Deployment docs
