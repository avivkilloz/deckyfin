# Multi-Source Support — Session 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `games_folder` setting with a multi-source system supporting local folders, network-mounted paths, and Deckyfin agent HTTP endpoints — merging games by name across sources and gating UI actions on per-source capabilities.

**Architecture:** Each source maintains its own `.deckyfin/config.json` (distributed config). A new `deckyfin_sources.py` module handles source CRUD, capability detection, disk usage, and per-source game loading. The existing `deckyfin_config.py` game functions are reused as-is by passing the source path. `get_games()` returns a merged list grouped by game name.

**Tech Stack:** Python 3 (backend), React 18 + TypeScript (frontend), `@decky/api` callables for IPC, `pytest` for backend tests, `shutil`/`urllib.request` (stdlib only — no new Python deps).

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `py_modules/deckyfin_sources.py` | Source CRUD, migration, capabilities, disk usage, game loading |
| Create | `tests/test_sources.py` | Tests for deckyfin_sources |
| Modify | `py_modules/deckyfin_consts.py` | Add `SOURCES_FILE` constant |
| Modify | `main.py` | New source callables, merged `get_games()`, `source_id` on game callables, migration in `_main()` |
| Modify | `src/types.ts` | Add `Source`, `SourceCapabilities`, `SourceDiskUsage`, `GameSource`, `MergedGame` |
| Modify | `src/components/SettingsPage.tsx` | Replace Games Folder section with Sources section |
| Modify | `src/components/GameLibrary.tsx` | Use `MergedGame[]`, pass full merged game to detail |
| Modify | `src/components/GameCard.tsx` | Add `sourceCount` badge |
| Modify | `src/components/GameDetail.tsx` | Source selector, capability gating |

---

## Task 1: Add constants and TypeScript types

**Files:**
- Modify: `py_modules/deckyfin_consts.py`
- Modify: `src/types.ts`

- [ ] **Step 1: Add SOURCES_FILE constant to deckyfin_consts.py**

In `py_modules/deckyfin_consts.py`, add after the `CONFIG_FILE` line:

```python
SOURCES_FILE = "sources.json"
```

- [ ] **Step 2: Add multi-source types to src/types.ts**

Append to the end of `src/types.ts`:

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

export interface MergedGame {
  name: string;
  sources: GameSource[];
}
```

- [ ] **Step 3: Build to verify TypeScript compiles**

```bash
npm run build 2>&1 | tail -5
```

Expected: build succeeds (or only pre-existing errors).

- [ ] **Step 4: Commit**

```bash
git add py_modules/deckyfin_consts.py src/types.ts
git commit -m "feat: add multi-source constants and TypeScript types"
```

---

## Task 2: deckyfin_sources.py — CRUD and migration

**Files:**
- Create: `py_modules/deckyfin_sources.py`
- Create: `tests/test_sources.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_sources.py`:

```python
"""Tests for deckyfin_sources — source CRUD and migration."""

import json
import sys
import tempfile
from pathlib import Path

_py_modules = str(Path(__file__).resolve().parent.parent / "py_modules")
if _py_modules not in sys.path:
    sys.path.insert(0, _py_modules)


def _make_app_config(tmp_path: Path, content: dict) -> Path:
    """Write a fake app config and patch deckyfin_config to use it."""
    config_dir = tmp_path / ".config" / "deckyfin"
    config_dir.mkdir(parents=True)
    config_file = config_dir / "config.json"
    config_file.write_text(json.dumps(content))
    return config_file


def test_list_sources_empty(tmp_path, monkeypatch):
    """list_sources returns [] when no sources key in config."""
    _make_app_config(tmp_path, {})
    monkeypatch.setenv("HOME", str(tmp_path))
    from deckyfin_sources import list_sources
    import importlib, deckyfin_config, deckyfin_sources
    importlib.reload(deckyfin_config)
    importlib.reload(deckyfin_sources)
    from deckyfin_sources import list_sources
    assert list_sources() == []


def test_add_source_local(tmp_path, monkeypatch):
    """add_source creates a local source with a generated id."""
    _make_app_config(tmp_path, {})
    monkeypatch.setenv("HOME", str(tmp_path))
    import importlib, deckyfin_config, deckyfin_sources
    importlib.reload(deckyfin_config)
    importlib.reload(deckyfin_sources)
    from deckyfin_sources import add_source, list_sources
    source = add_source("My Games", "local", "/home/deck/Games", None)
    assert source["name"] == "My Games"
    assert source["type"] == "local"
    assert source["path"] == "/home/deck/Games"
    assert source["url"] is None
    assert len(source["id"]) > 0
    assert len(list_sources()) == 1


def test_add_source_agent(tmp_path, monkeypatch):
    """add_source creates an agent source with a URL."""
    _make_app_config(tmp_path, {})
    monkeypatch.setenv("HOME", str(tmp_path))
    import importlib, deckyfin_config, deckyfin_sources
    importlib.reload(deckyfin_config)
    importlib.reload(deckyfin_sources)
    from deckyfin_sources import add_source, list_sources
    source = add_source("Home Server", "agent", None, "http://10.0.0.1:8080")
    assert source["type"] == "agent"
    assert source["url"] == "http://10.0.0.1:8080"
    assert source["path"] is None


def test_remove_source(tmp_path, monkeypatch):
    """remove_source deletes a source by id."""
    _make_app_config(tmp_path, {})
    monkeypatch.setenv("HOME", str(tmp_path))
    import importlib, deckyfin_config, deckyfin_sources
    importlib.reload(deckyfin_config)
    importlib.reload(deckyfin_sources)
    from deckyfin_sources import add_source, remove_source, list_sources
    source = add_source("My Games", "local", "/home/deck/Games", None)
    assert remove_source(source["id"]) is True
    assert list_sources() == []


def test_remove_source_not_found(tmp_path, monkeypatch):
    """remove_source returns False for unknown id."""
    _make_app_config(tmp_path, {})
    monkeypatch.setenv("HOME", str(tmp_path))
    import importlib, deckyfin_config, deckyfin_sources
    importlib.reload(deckyfin_config)
    importlib.reload(deckyfin_sources)
    from deckyfin_sources import remove_source
    assert remove_source("nonexistent") is False


def test_migrate_games_folder(tmp_path, monkeypatch):
    """migrate_games_folder_to_source converts legacy config to sources list."""
    _make_app_config(tmp_path, {"games_folder": "/home/deck/Games"})
    monkeypatch.setenv("HOME", str(tmp_path))
    import importlib, deckyfin_config, deckyfin_sources
    importlib.reload(deckyfin_config)
    importlib.reload(deckyfin_sources)
    from deckyfin_sources import migrate_games_folder_to_source, list_sources
    ran = migrate_games_folder_to_source()
    assert ran is True
    sources = list_sources()
    assert len(sources) == 1
    assert sources[0]["type"] == "local"
    assert sources[0]["path"] == "/home/deck/Games"


def test_migrate_skips_if_sources_present(tmp_path, monkeypatch):
    """migrate_games_folder_to_source is a no-op when sources already exists."""
    _make_app_config(tmp_path, {
        "sources": [{"id": "x", "name": "a", "type": "local", "path": "/p", "url": None}],
        "games_folder": "/old",
    })
    monkeypatch.setenv("HOME", str(tmp_path))
    import importlib, deckyfin_config, deckyfin_sources
    importlib.reload(deckyfin_config)
    importlib.reload(deckyfin_sources)
    from deckyfin_sources import migrate_games_folder_to_source, list_sources
    ran = migrate_games_folder_to_source()
    assert ran is False
    assert len(list_sources()) == 1  # unchanged
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pytest tests/test_sources.py -v 2>&1 | head -20
```

Expected: `ModuleNotFoundError: No module named 'deckyfin_sources'`

- [ ] **Step 3: Implement deckyfin_sources.py — CRUD and migration**

Create `py_modules/deckyfin_sources.py`:

```python
"""Source management for Deckyfin — CRUD, migration, capabilities, game loading."""

import uuid
from pathlib import Path
from typing import Optional

from deckyfin_config import get_app_config, set_app_config
from deckyfin_consts import SOURCES_FILE


# ── Source CRUD ───────────────────────────────────────────────────────────────

def list_sources() -> list[dict]:
    """Return all configured sources."""
    return get_app_config().get("sources", [])


def get_source_by_id(source_id: str) -> Optional[dict]:
    """Return a source dict by id, or None."""
    return next((s for s in list_sources() if s["id"] == source_id), None)


def add_source(name: str, type_: str, path: Optional[str], url: Optional[str]) -> dict:
    """Add a new source and return it."""
    source = {
        "id": str(uuid.uuid4())[:8],
        "name": name,
        "type": type_,
        "path": path,
        "url": url,
    }
    sources = list_sources()
    sources.append(source)
    set_app_config({"sources": sources})
    return source


def remove_source(source_id: str) -> bool:
    """Remove source by id. Returns True if found and removed."""
    sources = list_sources()
    new_sources = [s for s in sources if s["id"] != source_id]
    if len(new_sources) == len(sources):
        return False
    set_app_config({"sources": new_sources})
    return True


# ── Migration ─────────────────────────────────────────────────────────────────

def migrate_games_folder_to_source() -> bool:
    """Convert legacy games_folder to sources list. Returns True if migration ran."""
    config = get_app_config()
    if "sources" in config or "games_folder" not in config:
        return False
    source = {
        "id": str(uuid.uuid4())[:8],
        "name": "Games",
        "type": "local",
        "path": config["games_folder"],
        "url": None,
    }
    set_app_config({"sources": [source]})
    return True
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pytest tests/test_sources.py -v
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add py_modules/deckyfin_sources.py tests/test_sources.py
git commit -m "feat: add deckyfin_sources CRUD and games_folder migration"
```

---

## Task 3: Source capabilities and disk usage

**Files:**
- Modify: `py_modules/deckyfin_sources.py`
- Modify: `tests/test_sources.py`

- [ ] **Step 1: Add failing tests**

Append to `tests/test_sources.py`:

```python
def test_detect_capabilities_local_writable(tmp_path, monkeypatch):
    """Local source at a writable path has all capabilities."""
    monkeypatch.setenv("HOME", str(tmp_path))
    import importlib, deckyfin_config, deckyfin_sources
    importlib.reload(deckyfin_config)
    importlib.reload(deckyfin_sources)
    from deckyfin_sources import detect_capabilities
    source = {"id": "x", "type": "local", "path": str(tmp_path), "url": None}
    caps = detect_capabilities(source)
    assert caps["can_play"] is True
    assert caps["can_write_config"] is True
    assert caps["can_download_to"] is True


def test_detect_capabilities_mount_read_only(tmp_path, monkeypatch):
    """Mount source returns can_play=False."""
    monkeypatch.setenv("HOME", str(tmp_path))
    import importlib, deckyfin_config, deckyfin_sources
    importlib.reload(deckyfin_config)
    importlib.reload(deckyfin_sources)
    from deckyfin_sources import detect_capabilities
    source = {"id": "x", "type": "mount", "path": str(tmp_path), "url": None}
    caps = detect_capabilities(source)
    assert caps["can_play"] is False


def test_get_disk_usage_local(tmp_path, monkeypatch):
    """get_disk_usage returns used/total/free for a local path."""
    monkeypatch.setenv("HOME", str(tmp_path))
    import importlib, deckyfin_config, deckyfin_sources
    importlib.reload(deckyfin_config)
    importlib.reload(deckyfin_sources)
    from deckyfin_sources import get_disk_usage
    source = {"id": "x", "type": "local", "path": str(tmp_path), "url": None}
    usage = get_disk_usage(source)
    assert "used" in usage
    assert "total" in usage
    assert "free" in usage
    assert usage["total"] > 0


def test_get_disk_usage_offline(tmp_path, monkeypatch):
    """get_disk_usage returns None values when path doesn't exist."""
    monkeypatch.setenv("HOME", str(tmp_path))
    import importlib, deckyfin_config, deckyfin_sources
    importlib.reload(deckyfin_config)
    importlib.reload(deckyfin_sources)
    from deckyfin_sources import get_disk_usage
    source = {"id": "x", "type": "local", "path": "/nonexistent/path/xyz", "url": None}
    usage = get_disk_usage(source)
    assert usage["total"] is None
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pytest tests/test_sources.py::test_detect_capabilities_local_writable -v
```

Expected: `ImportError` or `AttributeError: module has no attribute 'detect_capabilities'`

- [ ] **Step 3: Implement capabilities and disk usage in deckyfin_sources.py**

Append to `py_modules/deckyfin_sources.py`:

```python
import os
import shutil
import urllib.request
import json as _json


# ── Capabilities ──────────────────────────────────────────────────────────────

def _is_path_writable(path: str) -> bool:
    try:
        return os.access(path, os.W_OK)
    except Exception:
        return False


def _agent_get(url: str, path: str) -> dict:
    req = urllib.request.Request(
        f"{url.rstrip('/')}{path}",
        headers={"Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return _json.loads(resp.read().decode())


def detect_capabilities(source: dict) -> dict:
    """Return {can_play, can_write_config, can_download_to} for a source."""
    t = source.get("type")
    if t == "agent":
        try:
            data = _agent_get(source["url"], "/capabilities")
            return {
                "can_play": False,
                "can_write_config": bool(data.get("can_write_config", False)),
                "can_download_to": bool(data.get("can_download_to", False)),
            }
        except Exception:
            return {"can_play": False, "can_write_config": False, "can_download_to": False}
    writable = _is_path_writable(source.get("path", ""))
    return {
        "can_play": t == "local",
        "can_write_config": writable,
        "can_download_to": writable,
    }


# ── Disk Usage ────────────────────────────────────────────────────────────────

def get_disk_usage(source: dict) -> dict:
    """Return {used, total, free} in bytes. Returns None values on failure."""
    null = {"used": None, "total": None, "free": None}
    t = source.get("type")
    if t == "agent":
        try:
            return _agent_get(source["url"], "/disk")
        except Exception:
            return null
    path = source.get("path")
    if not path:
        return null
    try:
        usage = shutil.disk_usage(path)
        return {"used": usage.used, "total": usage.total, "free": usage.free}
    except Exception:
        return null
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/test_sources.py -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add py_modules/deckyfin_sources.py tests/test_sources.py
git commit -m "feat: add source capability detection and disk usage"
```

---

## Task 4: Per-source game loading

**Files:**
- Modify: `py_modules/deckyfin_sources.py`
- Modify: `tests/test_sources.py`

- [ ] **Step 1: Add failing tests**

Append to `tests/test_sources.py`:

```python
def test_load_source_games_local(tmp_path, monkeypatch):
    """load_source_games reads games from a local source's .deckyfin/config.json."""
    import json as _j
    monkeypatch.setenv("HOME", str(tmp_path))
    # Create a fake .deckyfin/config.json inside the source path
    source_path = tmp_path / "games"
    source_path.mkdir()
    deckyfin_dir = source_path / ".deckyfin"
    deckyfin_dir.mkdir()
    config_data = {"games": [{"name": "Dark Souls", "executable": "DarkSouls.exe"}]}
    (deckyfin_dir / "config.json").write_text(_j.dumps(config_data))

    import importlib, deckyfin_config, deckyfin_sources
    importlib.reload(deckyfin_config)
    importlib.reload(deckyfin_sources)
    from deckyfin_sources import load_source_games
    source = {"id": "x", "type": "local", "path": str(source_path), "url": None}
    games = load_source_games(source)
    assert len(games) == 1
    assert games[0]["name"] == "Dark Souls"


def test_load_source_games_empty(tmp_path, monkeypatch):
    """load_source_games returns [] when no config exists."""
    monkeypatch.setenv("HOME", str(tmp_path))
    source_path = tmp_path / "games"
    source_path.mkdir()
    import importlib, deckyfin_config, deckyfin_sources
    importlib.reload(deckyfin_config)
    importlib.reload(deckyfin_sources)
    from deckyfin_sources import load_source_games
    source = {"id": "x", "type": "local", "path": str(source_path), "url": None}
    assert load_source_games(source) == []


def test_load_source_games_offline(tmp_path, monkeypatch):
    """load_source_games returns [] for a path that doesn't exist."""
    monkeypatch.setenv("HOME", str(tmp_path))
    import importlib, deckyfin_config, deckyfin_sources
    importlib.reload(deckyfin_config)
    importlib.reload(deckyfin_sources)
    from deckyfin_sources import load_source_games
    source = {"id": "x", "type": "local", "path": "/nonexistent/xyz", "url": None}
    assert load_source_games(source) == []
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pytest tests/test_sources.py::test_load_source_games_local -v
```

Expected: `AttributeError: module has no attribute 'load_source_games'`

- [ ] **Step 3: Implement load_source_games in deckyfin_sources.py**

Append to `py_modules/deckyfin_sources.py`:

```python
from deckyfin_config import get_games_config


# ── Per-source game loading ───────────────────────────────────────────────────

def load_source_games(source: dict) -> list[dict]:
    """Load all game configs from a source. Returns [] on any failure."""
    t = source.get("type")
    if t == "agent":
        try:
            return _agent_get(source["url"], "/games")
        except Exception:
            return []
    # local or mount — read from <source_path>/.deckyfin/config.json
    path = source.get("path")
    if not path:
        return []
    try:
        config = get_games_config(Path(path))
        return config.get("games", [])
    except Exception:
        return []
```

- [ ] **Step 4: Run all source tests**

```bash
pytest tests/test_sources.py -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add py_modules/deckyfin_sources.py tests/test_sources.py
git commit -m "feat: add per-source game loading (local, mount, agent)"
```

---

## Task 5: main.py — source management callables and startup migration

**Files:**
- Modify: `main.py`

- [ ] **Step 1: Add imports at the top of main.py**

In `main.py`, add to the import block (after the `from deckyfin_steam_ctl import ...` line):

```python
from deckyfin_sources import (
    list_sources as _list_sources,
    add_source as _add_source,
    remove_source as _remove_source,
    get_source_by_id as _get_source_by_id,
    detect_capabilities as _detect_capabilities,
    get_disk_usage as _get_disk_usage,
    migrate_games_folder_to_source as _migrate_games_folder_to_source,
    load_source_games as _load_source_games,
)
```

- [ ] **Step 2: Call migration in Plugin._main()**

In `main.py`, inside `async def _main(self)`, add after the `_debug("_main OK")` line:

```python
        # Migrate legacy games_folder to sources list (runs once)
        try:
            migrated = _migrate_games_folder_to_source()
            if migrated:
                _debug("_main: migrated games_folder to sources list")
        except Exception as e:
            _debug(f"_main: migration error: {e}")
```

- [ ] **Step 3: Add source management callables to the Plugin class**

In `main.py`, add these methods to the `Plugin` class (after the `get_plugin_info` method):

```python
    # ── Sources ───────────────────────────────────────────────────────────

    async def list_sources(self) -> list:
        return _list_sources()

    async def add_source(
        self,
        name: str,
        type: str,
        path: Optional[str] = None,
        url: Optional[str] = None,
    ) -> dict:
        try:
            source = _add_source(name, type, path, url)
            return {"success": True, "source": source}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def remove_source(self, source_id: str) -> dict:
        removed = _remove_source(source_id)
        return {"success": removed, "error": None if removed else f"Source '{source_id}' not found"}

    async def get_source_capabilities(self, source_id: str) -> dict:
        source = _get_source_by_id(source_id)
        if not source:
            return {"can_play": False, "can_write_config": False, "can_download_to": False}
        return _detect_capabilities(source)

    async def get_source_disk_usage(self, source_id: str) -> dict:
        source = _get_source_by_id(source_id)
        if not source:
            return {"used": None, "total": None, "free": None}
        return _get_disk_usage(source)

    async def initialize_source(self, source_id: str) -> dict:
        """Re-scan a source for new game folders and create config entries."""
        source = _get_source_by_id(source_id)
        if not source:
            return {"success": False, "error": f"Source '{source_id}' not found"}
        if source.get("type") == "agent":
            return {"success": False, "error": "Agent sources are managed remotely"}
        path = source.get("path")
        if not path:
            return {"success": False, "error": "Source has no path"}
        result = initialize_app_structure(path)
        return result
```

- [ ] **Step 4: Run existing tests to confirm nothing is broken**

```bash
pytest tests/ -v
```

Expected: all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add main.py
git commit -m "feat: add source management callables and startup migration"
```

---

## Task 6: main.py — merged get_games() and source_id on game callables

**Files:**
- Modify: `main.py`

- [ ] **Step 1: Replace get_games() with merged implementation**

In `main.py`, replace the existing `get_games` method:

```python
    async def get_games(self) -> list:
        """Return all games from all sources, merged by name."""
        sources = _list_sources()
        merged: dict[str, dict] = {}
        for source in sources:
            try:
                games = _load_source_games(source)
            except Exception as e:
                _debug(f"get_games: failed to load source {source['id']}: {e}")
                continue
            for game in games:
                name = game.get("name", "")
                if not name:
                    continue
                if name not in merged:
                    merged[name] = {"name": name, "sources": []}
                merged[name]["sources"].append({
                    "source_id": source["id"],
                    "source_name": source["name"],
                    "source_type": source["type"],
                    "config": game,
                })
        return list(merged.values())
```

- [ ] **Step 2: Add source_id parameter to get_game**

Replace the existing `get_game` method:

```python
    async def get_game(self, name: str, source_id: Optional[str] = None) -> dict:
        source = _get_source_by_id(source_id) if source_id else (_list_sources() or [None])[0]
        if not source:
            return {"success": False, "error": "No source configured"}
        path = source.get("path")
        game = get_game_config(name, Path(path) if path else None)
        if game:
            return {"success": True, "game": game}
        return {"success": False, "error": f"Game '{name}' not found"}
```

- [ ] **Step 3: Add source_id parameter to update_game_config**

Replace the existing `update_game_config` method:

```python
    async def update_game_config(self, name: str, updates: dict, source_id: Optional[str] = None) -> dict:
        """Update specific fields on an existing game config."""
        source = _get_source_by_id(source_id) if source_id else (_list_sources() or [None])[0]
        if not source:
            return {"success": False, "error": "No source configured"}
        path = source.get("path")
        try:
            result = update_game_config(name, updates, Path(path) if path else None)
            return {"success": True, "game": result}
        except GameConfigError as e:
            return {"success": False, "error": str(e)}
```

- [ ] **Step 4: Add source_id parameter to remove_game**

Replace the existing `remove_game` method:

```python
    async def remove_game(self, name: str, source_id: Optional[str] = None) -> dict:
        source = _get_source_by_id(source_id) if source_id else (_list_sources() or [None])[0]
        if not source:
            return {"success": False, "error": "No source configured"}
        path = source.get("path")
        removed = remove_game_config(name, Path(path) if path else None)
        return {"success": removed, "error": None if removed else f"Game '{name}' not found"}
```

- [ ] **Step 5: Add source_id to set_game_processing_state and get_game_processing_state**

Replace both methods:

```python
    async def set_game_processing_state(self, name: str, state: dict | None, source_id: Optional[str] = None) -> dict:
        source = _get_source_by_id(source_id) if source_id else (_list_sources() or [None])[0]
        if not source:
            return {"success": False, "error": "No source configured"}
        path = source.get("path")
        try:
            update_game_config(name, {"processing_state": state}, Path(path) if path else None)
            return {"success": True}
        except GameConfigError as e:
            return {"success": False, "error": str(e)}

    async def get_game_processing_state(self, name: str, source_id: Optional[str] = None) -> dict | None:
        source = _get_source_by_id(source_id) if source_id else (_list_sources() or [None])[0]
        if not source:
            return None
        path = source.get("path")
        try:
            game = get_game_config(name, Path(path) if path else None)
            return game.get("processing_state") if game else None
        except Exception:
            return None
```

- [ ] **Step 6: Run all tests**

```bash
pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add main.py
git commit -m "feat: merged get_games() and source_id on game callables"
```

---

## Task 7: SettingsPage — replace Games Folder with Sources section

**Files:**
- Modify: `src/components/SettingsPage.tsx`

- [ ] **Step 1: Add source callables at the top of SettingsPage.tsx**

Replace the callable declarations at the top of `src/components/SettingsPage.tsx`. Remove:

```typescript
const setGamesFolder = callable<
  [path: string],
  { success: boolean; path?: string; error?: string }
>("set_games_folder");
const initialize = callable<
  [games_folder?: string],
  { success: boolean; error?: string; message?: string }
>("initialize");
```

Add in their place:

```typescript
const listSources = callable<[], Source[]>("list_sources");
const addSource = callable<
  [name: string, type: string, path: string | null, url: string | null],
  { success: boolean; source?: Source; error?: string }
>("add_source");
const removeSource = callable<[source_id: string], { success: boolean }>("remove_source");
const getSourceDiskUsage = callable<[source_id: string], { used: number | null; total: number | null; free: number | null }>("get_source_disk_usage");
const initializeSource = callable<[source_id: string], { success: boolean; message?: string }>("initialize_source");
```

Add the import for `Source` to the existing types import:

```typescript
import { Source } from "../types";
```

- [ ] **Step 2: Update the Props interface**

Replace:

```typescript
interface Props {
  gamesFolder: string | null;
  onBack: () => void;
}
```

With:

```typescript
interface Props {
  onBack: () => void;
}
```

- [ ] **Step 3: Replace the component state and Games Folder section**

Remove all state and handlers related to `gamesFolder`, `folderPath`, `showFolderPicker`, `browsePath`, `subfolders`, `browseLoading`, `message`, `rescanned`, and all their handlers (`handleSave`, `handleRescan`, `handleOpenFolderPicker`, `handleFolderClick`, `handleGoUp`, `handleSelectFolder`).

Add in their place:

```typescript
  // ── Sources state ─────────────────────────────────────────────────────────
  const [sources, setSources] = useState<Source[]>([]);
  const [diskUsages, setDiskUsages] = useState<Record<string, { used: number | null; total: number | null; free: number | null }>>({});
  const [sourceMessage, setSourceMessage] = useState<{ id: string; msg: string } | null>(null);

  // Add source form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceType, setNewSourceType] = useState<"local" | "mount" | "agent">("local");
  const [newSourcePath, setNewSourcePath] = useState("");
  const [newSourceUrl, setNewSourceUrl] = useState("");
  const [addSourceMsg, setAddSourceMsg] = useState<string | null>(null);

  const loadSources = useCallback(async () => {
    try {
      const s = await listSources();
      setSources(s || []);
      // Load disk usage for each source
      for (const src of s || []) {
        getSourceDiskUsage(src.id)
          .then((usage) => setDiskUsages((prev) => ({ ...prev, [src.id]: usage })))
          .catch(() => {});
      }
    } catch {
      setSources([]);
    }
  }, []);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  const handleAddSource = async () => {
    setAddSourceMsg(null);
    const path = newSourceType !== "agent" ? newSourcePath || null : null;
    const url = newSourceType === "agent" ? newSourceUrl || null : null;
    if (!newSourceName.trim()) { setAddSourceMsg("❌ Name is required"); return; }
    if (newSourceType !== "agent" && !path) { setAddSourceMsg("❌ Path is required"); return; }
    if (newSourceType === "agent" && !url) { setAddSourceMsg("❌ URL is required"); return; }
    try {
      const res = await addSource(newSourceName, newSourceType, path, url);
      if (res.success) {
        setShowAddForm(false);
        setNewSourceName(""); setNewSourcePath(""); setNewSourceUrl("");
        await loadSources();
      } else {
        setAddSourceMsg(`❌ ${res.error || "Failed"}`);
      }
    } catch (err: any) {
      setAddSourceMsg(`❌ ${err?.message || "Failed"}`);
    }
  };

  const handleRemoveSource = async (source_id: string) => {
    try {
      await removeSource(source_id);
      await loadSources();
    } catch {}
  };

  const handleRescanSource = async (source_id: string) => {
    try {
      const res = await initializeSource(source_id);
      setSourceMessage({ id: source_id, msg: res.success ? "✅ Rescanned" : "❌ Failed" });
      setTimeout(() => setSourceMessage(null), 3000);
    } catch {}
  };
```

- [ ] **Step 4: Replace the Games Folder JSX with the Sources section**

Remove the entire `{/* ── Games Folder ─ */}` block (from `<h4>Games Folder</h4>` through the Save button and `<hr>`).

Replace with:

```tsx
      {/* ── Sources ──────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
        <h4 style={{ margin: 0 }}>Sources</h4>
        <Focusable
          onActivate={() => setShowAddForm((v) => !v)}
          onClick={() => setShowAddForm((v) => !v)}
          focusClassName="is-focused"
          style={{ ...BTN_STYLE, fontSize: "0.82em", padding: "4px 10px", borderColor: "#0078d4", color: "#0078d4" }}
        >
          {showAddForm ? "✕ Cancel" : "+ Add Source"}
        </Focusable>
      </div>

      {/* Add source form */}
      {showAddForm && (
        <div style={{ border: "1px solid #444", borderRadius: "6px", padding: "10px", marginBottom: "10px" }}>
          <div style={{ fontSize: "0.78em", color: "#888", marginBottom: "4px" }}>Name</div>
          <CompactTextField value={newSourceName} onChange={(e) => setNewSourceName(e.target.value)} style={{ width: "100%", marginBottom: "8px" }} />
          <div style={{ fontSize: "0.78em", color: "#888", marginBottom: "4px" }}>Type</div>
          <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
            {(["local", "mount", "agent"] as const).map((t) => (
              <Focusable key={t} onActivate={() => setNewSourceType(t)} onClick={() => setNewSourceType(t)} focusClassName="is-focused"
                style={{ padding: "3px 10px", fontSize: "0.82em", borderRadius: "12px", cursor: "pointer",
                  border: newSourceType === t ? "1px solid #0078d4" : "1px solid #555",
                  background: newSourceType === t ? "#0078d4" : "transparent",
                  color: newSourceType === t ? "white" : "#ccc" }}>
                {t}
              </Focusable>
            ))}
          </div>
          {newSourceType !== "agent" ? (
            <>
              <div style={{ fontSize: "0.78em", color: "#888", marginBottom: "4px" }}>Path</div>
              <CompactTextField value={newSourcePath} onChange={(e) => setNewSourcePath(e.target.value)} placeholder="/home/deck/Games" style={{ width: "100%", marginBottom: "8px" }} />
            </>
          ) : (
            <>
              <div style={{ fontSize: "0.78em", color: "#888", marginBottom: "4px" }}>URL</div>
              <CompactTextField value={newSourceUrl} onChange={(e) => setNewSourceUrl(e.target.value)} placeholder="http://10.0.0.1:8080" style={{ width: "100%", marginBottom: "8px" }} />
            </>
          )}
          <Focusable onActivate={handleAddSource} onClick={handleAddSource} focusClassName="is-focused"
            style={{ ...BTN_STYLE, borderColor: "#27ae60", color: "#2ecc71", display: "inline-block" }}>
            Add
          </Focusable>
          {addSourceMsg && <span style={{ marginLeft: "8px", fontSize: "0.82em", color: "tomato" }}>{addSourceMsg}</span>}
        </div>
      )}

      {/* Source list */}
      {sources.length === 0 && !showAddForm && (
        <p style={{ fontSize: "0.85em", color: "#888" }}>No sources configured. Add one above.</p>
      )}
      {sources.map((src) => {
        const usage = diskUsages[src.id];
        const usedPct = usage?.total ? Math.round((usage.used! / usage.total) * 100) : null;
        const typeColor = src.type === "local" ? "#27ae60" : src.type === "mount" ? "#e67e22" : "#0984e3";
        const typeBg = src.type === "local" ? "#1a3a1a" : src.type === "mount" ? "#2a2a1a" : "#1a1a3a";
        const offline = !usage?.total && usage?.total !== undefined;
        return (
          <div key={src.id} style={{ border: "1px solid #444", borderRadius: "6px", padding: "10px", marginBottom: "8px", opacity: offline ? 0.7 : 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
              <div>
                <span style={{ fontWeight: 600, color: "#e0e0e0" }}>{src.name}</span>
                <span style={{ marginLeft: "8px", padding: "2px 7px", fontSize: "0.75em", borderRadius: "10px", background: typeBg, color: typeColor, border: `1px solid ${typeColor}` }}>{src.type}</span>
                {offline && <span style={{ marginLeft: "6px", fontSize: "0.75em", color: "#e74c3c" }}>⚠ offline</span>}
              </div>
              <div style={{ display: "flex", gap: "4px" }}>
                <Focusable onActivate={() => handleRescanSource(src.id)} onClick={() => handleRescanSource(src.id)} focusClassName="is-focused"
                  style={{ ...BTN_STYLE, fontSize: "0.75em", padding: "2px 8px" }}>
                  {sourceMessage?.id === src.id ? sourceMessage.msg : "Rescan"}
                </Focusable>
                <Focusable onActivate={() => handleRemoveSource(src.id)} onClick={() => handleRemoveSource(src.id)} focusClassName="is-focused"
                  style={{ ...BTN_STYLE, fontSize: "0.75em", padding: "2px 8px", borderColor: "#c0392b", color: "#e74c3c" }}>
                  Remove
                </Focusable>
              </div>
            </div>
            <div style={{ fontSize: "0.78em", color: "#666", marginBottom: "6px" }}>{src.path || src.url}</div>
            {usedPct !== null && (
              <>
                <div style={{ fontSize: "0.75em", color: "#888", marginBottom: "3px", display: "flex", justifyContent: "space-between" }}>
                  <span>Disk</span>
                  <span>{Math.round(usage!.used! / 1e9)} GB / {Math.round(usage!.total! / 1e9)} GB</span>
                </div>
                <div style={{ height: "5px", background: "#333", borderRadius: "3px", overflow: "hidden" }}>
                  <div style={{ width: `${usedPct}%`, height: "100%", background: typeColor, borderRadius: "3px" }} />
                </div>
              </>
            )}
            {offline && <div style={{ fontSize: "0.75em", color: "#555" }}>Disk info unavailable</div>}
          </div>
        );
      })}

      <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.12)", margin: "20px 0" }} />
```

- [ ] **Step 5: Update the component signature**

Change the component declaration from:

```typescript
export const SettingsPage: VFC<Props> = ({ gamesFolder, onBack }) => {
```

To:

```typescript
export const SettingsPage: VFC<Props> = ({ onBack }) => {
```

- [ ] **Step 6: Build to verify TypeScript compiles**

```bash
npm run build 2>&1 | grep -E "error TS|warning"
```

Expected: no new TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/SettingsPage.tsx
git commit -m "feat: replace Games Folder with multi-source Sources section in settings"
```

---

## Task 8: GameLibrary and GameCard — multi-source merge

**Files:**
- Modify: `src/components/GameLibrary.tsx`
- Modify: `src/components/GameCard.tsx`

- [ ] **Step 1: Update GameCard to accept sourceCount**

In `src/components/GameCard.tsx`, update the Props interface:

```typescript
interface Props {
  game: GameConfig;
  isInSteam?: boolean;
  sourceCount?: number;
  onClick: () => void;
}
```

Update the component signature:

```typescript
export const GameCard: VFC<Props> = ({ game, isInSteam, sourceCount, onClick }) => {
```

Add a source count badge inside the card, after the `{isInSteam && ...}` block:

```tsx
        {sourceCount !== undefined && sourceCount > 1 && (
          <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "4px", background: "rgba(0,120,212,0.25)", color: "#74b9ff" }}>
            {sourceCount} sources
          </span>
        )}
```

- [ ] **Step 2: Update GameLibrary to use MergedGame**

In `src/components/GameLibrary.tsx`, update imports:

```typescript
import { GameConfig, MergedGame } from "../types";
```

Remove the `getGamesFolder` callable and its usage. Replace the `getGames` callable declaration:

```typescript
const getGames = callable<[], MergedGame[]>("get_games");
```

Update state types:

```typescript
  const [games, setGames] = useState<MergedGame[]>([]);
  const [selectedGame, setSelectedGame] = useState<MergedGame | null>(null);
```

Remove `gamesFolder` state and the `getGamesFolder()` call from `loadData`:

```typescript
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const gamesRes = await getGames();
      setGames(gamesRes || []);
    } catch (err: any) {
      setError(String(err));
    }
    try {
      const steamGames = await listNonSteamGames();
      setSteamNames(new Set((steamGames || []).map((g) => g.name)));
    } catch (_) {
      setSteamNames(new Set());
    }
    setLoading(false);
  }, []);
```

Update the SettingsPage render (remove the `gamesFolder` prop):

```tsx
  if (view === "settings") {
    return <SettingsPage onBack={() => { loadData(); setView("library"); }} />;
  }
```

Update the filteredGames filter (MergedGame has `name` directly):

```typescript
  const filteredGames = games.filter((g) =>
    g.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
```

Update the empty state message (no longer check `gamesFolder`):

```tsx
      {!loading && !error && games.length === 0 && (
        <p>No games found. Add sources in Settings, then Rescan.</p>
      )}
```

Update the game list render to pass `sourceCount` and use `game.name` for `isInSteam`:

```tsx
        {filteredGames.map((game) => (
          <GameCard
            key={game.name}
            game={game.sources[0]?.config ?? { name: game.name, executable: "" }}
            isInSteam={steamNames.has(game.name)}
            sourceCount={game.sources.length}
            onClick={() => openGame(game)}
          />
        ))}
```

Update `onNeedsRestart` in the GameDetail render:

```typescript
        onNeedsRestart={() => {
          setNeedsRestartState(true);
          setNeedsRestart(true).catch(() => {});
          loadData();
        }}
```

- [ ] **Step 3: Build to verify TypeScript compiles**

```bash
npm run build 2>&1 | grep -E "error TS"
```

Expected: no new TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/GameLibrary.tsx src/components/GameCard.tsx
git commit -m "feat: GameLibrary and GameCard updated for multi-source merged games"
```

---

## Task 9: GameDetail — source selector and capability gating

**Files:**
- Modify: `src/components/GameDetail.tsx`

- [ ] **Step 1: Update Props and imports**

In `src/components/GameDetail.tsx`, update the import line:

```typescript
import { GameConfig, MergedGame, GameSource, SourceCapabilities } from "../types";
```

Update the callables that need `source_id`. Replace the declarations for `updateGameConfig`, `getGame`, `removeGame`, `setGameProcessingState`, `getGameProcessingState`:

```typescript
const updateGameConfig = callable<
  [name: string, updates: Record<string, any>, source_id: string],
  { success: boolean }
>("update_game_config");
const getGame = callable<
  [name: string, source_id: string],
  { success: boolean; game?: GameConfig }
>("get_game");
const removeGame = callable<[name: string, source_id: string], { success: boolean }>(
  "remove_game"
);
const setGameProcessingState = callable<
  [name: string, state: Record<string, any> | null, source_id: string],
  { success: boolean }
>("set_game_processing_state");
const getGameProcessingState = callable<
  [name: string, source_id: string],
  Record<string, any> | null
>("get_game_processing_state");
const getSourceCapabilities = callable<[source_id: string], SourceCapabilities>(
  "get_source_capabilities"
);
```

Update the Props interface:

```typescript
interface Props {
  game: MergedGame;
  onBack: () => void;
  onNeedsRestart?: () => void;
}
```

- [ ] **Step 2: Add source selector state**

Inside the `GameDetail` component, add these state declarations at the top (before `const [name, setName]`):

```typescript
  // ── Source selector ────────────────────────────────────────────────────────
  const [selectedSourceIdx, setSelectedSourceIdx] = useState(0);
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [capabilities, setCapabilities] = useState<SourceCapabilities>({
    can_play: true,
    can_write_config: true,
    can_download_to: true,
  });

  const selectedSource: GameSource = game.sources[selectedSourceIdx] ?? game.sources[0];
  const currentConfig: GameConfig = selectedSource?.config ?? game.sources[0]?.config ?? { name: game.name, executable: "" };
```

- [ ] **Step 3: Initialize all config state from currentConfig**

Replace every `game.X` initialization in the `useState` declarations with `currentConfig.X`. For example:

```typescript
  const [name, setName] = useState(currentConfig.name);
  const [storedName, setStoredName] = useState(currentConfig.name);
  const [executable, setExecutable] = useState(currentConfig.executable);
  const [startDir, setStartDir] = useState(currentConfig.start_dir || "");
  // ... and so on for all config fields
```

Also update the snapshot initializations:

```typescript
  const [lastSyncedSnapshot, setLastSyncedSnapshot] = useState(() => {
    if (currentConfig.steam_snapshot) {
      try { return JSON.parse(currentConfig.steam_snapshot); } catch {}
    }
    return null;
  });
  const [lastInstalledDeps, setLastInstalledDeps] = useState<string[]>(
    () => currentConfig.deps_snapshot ?? []
  );
  const [configSnapshot, setConfigSnapshot] = useState(() => ({
    name: currentConfig.name,
    executable: currentConfig.executable,
    start_dir: currentConfig.start_dir || null,
    steam_app_id: currentConfig.steam_app_id ?? null,
    proton_version: currentConfig.proton_version || null,
    proton_dependencies: currentConfig.proton_dependencies || [],
    launch_options: currentConfig.launch_options || null,
    collections: currentConfig.collections || [],
  }));
  const [needsRestartAfterAdd, setNeedsRestartAfterAdd] = useState(
    currentConfig.needs_restart_after_add ?? false
  );
  const [needsRestart, setNeedsRestart] = useState(
    currentConfig.needs_restart ?? false
  );
```

- [ ] **Step 4: Load capabilities when source changes**

Add a `useEffect` for capabilities after the existing init effects:

```typescript
  useEffect(() => {
    if (!selectedSource) return;
    getSourceCapabilities(selectedSource.source_id)
      .then(setCapabilities)
      .catch(() => setCapabilities({ can_play: true, can_write_config: true, can_download_to: true }));
  }, [selectedSource?.source_id]);
```

- [ ] **Step 5: Reload config state when source changes**

Add a `useEffect` that reinitializes config state when the selected source changes:

```typescript
  useEffect(() => {
    if (!currentConfig) return;
    setName(currentConfig.name);
    setStoredName(currentConfig.name);
    setExecutable(currentConfig.executable);
    setStartDir(currentConfig.start_dir || "");
    setSteamAppId(currentConfig.steam_app_id);
    setSteamAppIdInput(currentConfig.steam_app_id !== undefined ? String(currentConfig.steam_app_id) : "");
    setProtonVersion(currentConfig.proton_version || "");
    setLaunchOptions(currentConfig.launch_options || "");
    if (currentConfig.steam_snapshot) {
      try { setLastSyncedSnapshot(JSON.parse(currentConfig.steam_snapshot)); } catch { setLastSyncedSnapshot(null); }
    } else {
      setLastSyncedSnapshot(null);
    }
    setLastInstalledDeps(currentConfig.deps_snapshot ?? []);
    setConfigSnapshot({
      name: currentConfig.name,
      executable: currentConfig.executable,
      start_dir: currentConfig.start_dir || null,
      steam_app_id: currentConfig.steam_app_id ?? null,
      proton_version: currentConfig.proton_version || null,
      proton_dependencies: currentConfig.proton_dependencies || [],
      launch_options: currentConfig.launch_options || null,
      collections: currentConfig.collections || [],
    });
    setNeedsRestartAfterAdd(currentConfig.needs_restart_after_add ?? false);
    setNeedsRestart(currentConfig.needs_restart ?? false);
    setSteamInfo(null); // will reload via getSteamShortcut effect
  }, [selectedSourceIdx]);
```

- [ ] **Step 6: Pass source_id to all game callables**

Find every callable invocation that writes or reads game config and add `selectedSource.source_id` as the last argument. Specifically:

In `handleApplyConfig`:
```typescript
      const res = await updateGameConfig(storedName, payload, selectedSource.source_id);
```

In the `getGame` useEffect:
```typescript
    getGame(game.name, selectedSource.source_id).then((res) => {
```

In `handleRemove`:
```typescript
      await removeGame(storedName, selectedSource.source_id);
```

In `handleInstallDeps` (setGameProcessingState calls):
```typescript
    setGameProcessingState(game.name, { status: "installing", ... }, selectedSource.source_id).catch(() => {});
    // ...
    setGameProcessingState(game.name, null, selectedSource.source_id).catch(() => {});
    // ...
    updateGameConfig(storedName, { deps_snapshot: mergedDeps }, selectedSource.source_id).catch(() => {});
```

In the `getGameProcessingState` useEffect:
```typescript
    getGameProcessingState(game.name, selectedSource.source_id)
```

In `handleAddToSteam` and `handleUpdateSteam` (the `updateGameConfig` calls):
```typescript
    updateGameConfig(storedName, { steam_snapshot: ..., ... }, selectedSource.source_id).catch(() => {});
```

- [ ] **Step 7: Add source selector JSX**

Replace the current Back button block:

```tsx
      {/* Back */}
      <Focusable
        ref={backRef}
        onActivate={onBack}
        onClick={onBack}
        focusClassName="is-focused"
        style={{ ...BTN_STYLE, marginBottom: "12px", display: "inline-block" }}
      >
        Back
      </Focusable>
```

With:

```tsx
      {/* Back + source selector row */}
      <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "12px", flexWrap: "wrap" }}>
        <Focusable
          ref={backRef}
          onActivate={onBack}
          onClick={onBack}
          focusClassName="is-focused"
          style={{ ...BTN_STYLE, padding: "4px 10px" }}
        >
          Back
        </Focusable>

        {game.sources.length > 0 && (() => {
          const typeColor = selectedSource.source_type === "local" ? "#27ae60"
            : selectedSource.source_type === "mount" ? "#e67e22" : "#0984e3";
          const typeBg = selectedSource.source_type === "local" ? "#1a3a1a"
            : selectedSource.source_type === "mount" ? "#2a2a1a" : "#1a1a3a";
          return (
            <Focusable
              onActivate={() => setShowSourcePicker((p) => !p)}
              onClick={() => setShowSourcePicker((p) => !p)}
              focusClassName="is-focused"
              style={{ ...BTN_STYLE, padding: "4px 12px", borderColor: typeColor, color: typeColor, display: "flex", alignItems: "center", gap: "6px" }}
            >
              <span style={{ padding: "1px 5px", fontSize: "0.75em", borderRadius: "8px", background: typeBg, border: `1px solid ${typeColor}` }}>
                {selectedSource.source_type}
              </span>
              {selectedSource.source_name} {game.sources.length > 1 ? "▾" : ""}
            </Focusable>
          );
        })()}
      </div>

      {/* Source picker dropdown */}
      {showSourcePicker && game.sources.length > 1 && (
        <Focusable style={{ marginBottom: "10px", border: "1px solid #555", borderRadius: "4px", padding: "2px 0" }}>
          {game.sources.map((src, idx) => (
            <Focusable
              key={src.source_id}
              onActivate={() => { setSelectedSourceIdx(idx); setShowSourcePicker(false); }}
              onClick={() => { setSelectedSourceIdx(idx); setShowSourcePicker(false); }}
              focusClassName="is-focused"
              style={{ margin: "0 2px", padding: "4px 10px", cursor: "pointer", fontSize: "0.85em", borderBottom: "1px solid #333",
                color: idx === selectedSourceIdx ? "#0078d4" : "#ccc" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {src.source_name}
              <span style={{ marginLeft: "6px", fontSize: "0.78em", color: "#666" }}>({src.source_type})</span>
            </Focusable>
          ))}
        </Focusable>
      )}
```

- [ ] **Step 8: Add capability lock notice and gate Steam actions**

Add the lock notice just before the `{/* ── Steam Actions ─ */}` label:

```tsx
      {/* Capability lock notice */}
      {!capabilities.can_play && (
        <div style={{ padding: "8px 10px", borderRadius: "4px", background: "rgba(52,73,94,0.3)",
          border: "1px solid #2c3e50", fontSize: "0.78em", color: "#7f8c8d", marginBottom: "8px" }}>
          🔒 Steam & prefix actions unavailable — games on {selectedSource.source_type} sources can't be launched by Steam
        </div>
      )}
```

Gate the Apply Config button on `can_write_config`:

```tsx
      <Focusable
        onActivate={capabilities.can_write_config ? handleApplyConfig : undefined}
        onClick={capabilities.can_write_config ? handleApplyConfig : undefined}
        focusClassName="is-focused"
        style={{
          ...BTN_STYLE,
          display: "inline-block",
          marginBottom: "8px",
          border: configDirty && capabilities.can_write_config ? "1px solid #27ae60" : "1px solid #555",
          color: configDirty && capabilities.can_write_config ? "#2ecc71" : "#e0e0e0",
          opacity: capabilities.can_write_config ? 1 : 0.4,
        }}
      >
        {configDirty && capabilities.can_write_config ? "Apply Config *" : "Apply Config"}
      </Focusable>
```

Gate the Add/Update Steam, Init Prefix, Install Deps, and Restart Steam buttons with `opacity` and disabled handlers when `!capabilities.can_play`:

```tsx
        <Focusable
          onActivate={capabilities.can_play ? (steamInfo ? handleUpdateSteam : handleAddToSteam) : undefined}
          onClick={capabilities.can_play ? (steamInfo ? handleUpdateSteam : handleAddToSteam) : undefined}
          focusClassName="is-focused"
          style={{
            ...BTN_STYLE,
            opacity: !capabilities.can_play || loading === "add" || loading === "update" ? 0.4 : 1,
            border: capabilities.can_play && steamNeedsSync ? "1px solid #27ae60" : "1px solid #555",
            color: capabilities.can_play && steamNeedsSync ? "#2ecc71" : "#e0e0e0",
          }}
        >
          {loading === "add" ? "Adding…" : loading === "update" ? "Updating…"
            : steamInfo ? "Update Steam" : "Add to Steam"}
        </Focusable>
```

Apply the same `opacity: !capabilities.can_play ? 0.4 : ...` to Init Prefix, Install Deps, and Restart Steam buttons (add `!capabilities.can_play ||` to each existing opacity condition).

- [ ] **Step 9: Build to verify TypeScript compiles**

```bash
npm run build 2>&1 | grep -E "error TS"
```

Expected: no TypeScript errors.

- [ ] **Step 10: Run all backend tests**

```bash
pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Step 11: Commit**

```bash
git add src/components/GameDetail.tsx
git commit -m "feat: source selector and capability gating in GameDetail"
```

---

## Self-Review Notes

- All spec section requirements from Section 3 (data model), 4 (backend), 5 (frontend) are covered.
- Session 2 items (transfer operations, folder deletion on remove) are explicitly excluded.
- Agent source type is included in Task 4 (`load_source_games` handles `type == "agent"`) and Task 3 (`detect_capabilities` calls `/capabilities`, `get_disk_usage` calls `/disk`).
- The `add_game` callable is not updated with `source_id` — it is not used in the current main flow (AddGameWizard is legacy). If needed, it can default to the first local source the same way `remove_game` does.
- `scan_games_folder` and `scan_game_exes` callables in `main.py` still use the old single `games_folder`. These are used by AddGameWizard (legacy) and the exe picker in GameDetail. The exe picker uses `game.path` which comes from the game config and is source-relative; it doesn't need updating in Session 1.
