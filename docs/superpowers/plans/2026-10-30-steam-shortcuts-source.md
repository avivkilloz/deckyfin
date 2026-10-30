# Steam Shortcuts Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a built-in, non-removable "Steam Shortcuts" source that lists non-Steam shortcuts no Deckyfin source owns, and lets the user manage them from the game page.

**Architecture:** The built-in source is a normal record in `config["sources"]` flagged `builtin: true`, ensured on startup. A new module `deckyfin_steam_shortcuts.py` reads `shortcuts.vdf`, filters out shortcuts owned by any user source (name match or exe-under-path), and merges each orphan with Deckyfin-only data kept in `~/.config/deckyfin/steam_shortcuts/.deckyfin/config.json`. `load_source_games` dispatches to it, so `get_games` and the frontend's existing merged-game model need no structural change; the frontend only hides actions that need a source folder.

**Tech Stack:** Python 3 (Decky backend, pytest), React 18 + TypeScript (`@decky/ui`, Rollup).

**Spec:** `docs/superpowers/specs/2026-10-30-steam-shortcuts-source-design.md`

## Global Constraints

- Built-in source id: `steam-shortcuts`; type: `steam_shortcuts`; name: `Steam Shortcuts`; **disabled by default**.
- Orphan game id format: `shortcut-<unsigned appid>`.
- Orphan Deckyfin data store: `get_app_config_path() / "steam_shortcuts"` (config file at `<that>/.deckyfin/config.json`).
- Ownership checks include **disabled** user sources; path rule uses `os.path.normpath`, never `resolve()`.
- Shortcut (VDF) fields win over stored fields; `steam_snapshot` for orphans always comes from the VDF.
- Every focusable picker item keeps `margin: "0 2px"` and `padding: "4px 10px"` (CLAUDE.md gamepad rule).
- Python tests: `pytest tests/ -v`. Frontend check: `npx tsc --noEmit -p .` and `npm run build`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `py_modules/deckyfin_consts.py` (modify) | Built-in source id/type constants |
| `py_modules/deckyfin_sources.py` (modify) | `ensure_builtin_sources`, `source_config_root`, builtin guards in remove/capabilities/disk/load |
| `py_modules/steam_games.py` (modify) | `list_nonsteam_games` returns start dir, launch options, collections, unsigned appid |
| `py_modules/deckyfin_steam_shortcuts.py` (create) | Orphan detection, orphan game building, store upsert |
| `main.py` (modify) | Startup ensure, `get_game`/`update_game_config`/`scan_game_exes` branches, `get_builtin_source_summary`, state overlay rule |
| `tests/test_sources.py` (modify) | Built-in source framework tests |
| `tests/test_steam_shortcuts.py` (create) | Orphan detection + loading tests |
| `src/types.ts` (modify) | `SourceType`, `Source.builtin`, `GameConfig.shortcut_app_id` |
| `src/components/SettingsPage.tsx` (modify) | Built-in source card |
| `src/components/GameDetail.tsx` (modify) | Hide/adapt actions for `steam_shortcuts` |
| `src/components/GameLibrary.tsx` (modify) | Exclude built-in sources from destination pickers |

---

### Task 1: Built-in source framework

**Files:**
- Modify: `py_modules/deckyfin_consts.py` (after `SOURCES_FILE`, line 21)
- Modify: `py_modules/deckyfin_sources.py`
- Test: `tests/test_sources.py` (append)

**Interfaces:**
- Produces:
  - `deckyfin_consts.STEAM_SHORTCUTS_SOURCE_ID = "steam-shortcuts"`, `deckyfin_consts.STEAM_SHORTCUTS_SOURCE_TYPE = "steam_shortcuts"`
  - `deckyfin_sources.ensure_builtin_sources() -> bool` (True if it added a record)
  - `deckyfin_sources.source_config_root(source: dict) -> Optional[Path]`
  - `list_sources()` entries always have `builtin: bool`
  - `remove_source(id)` returns `False` for builtin
  - `detect_capabilities` / `get_disk_usage` handle `steam_shortcuts`

- [ ] **Step 1: Write the failing tests** — append to `tests/test_sources.py`:

```python
# ── Built-in sources ──────────────────────────────────────────────────────────

def test_ensure_builtin_sources_adds_disabled_record(tmp_path, monkeypatch):
    _make_app_config(tmp_path, {"sources": [
        {"id": "a", "name": "Games", "type": "local", "path": "/g", "url": None}
    ]})
    mod = _reload_sources(tmp_path, monkeypatch)
    assert mod.ensure_builtin_sources() is True
    sources = mod.list_sources()
    assert [s["id"] for s in sources] == ["a", "steam-shortcuts"]
    b = sources[1]
    assert b["type"] == "steam_shortcuts"
    assert b["name"] == "Steam Shortcuts"
    assert b["builtin"] is True
    assert b["enabled"] is False
    assert b["path"] is None


def test_ensure_builtin_sources_idempotent_and_preserves_state(tmp_path, monkeypatch):
    _make_app_config(tmp_path, {"sources": [
        {"id": "steam-shortcuts", "name": "Steam Shortcuts", "type": "steam_shortcuts",
         "builtin": True, "enabled": True, "path": None, "url": None},
        {"id": "a", "name": "Games", "type": "local", "path": "/g", "url": None},
    ]})
    mod = _reload_sources(tmp_path, monkeypatch)
    assert mod.ensure_builtin_sources() is False
    sources = mod.list_sources()
    assert [s["id"] for s in sources] == ["steam-shortcuts", "a"]
    assert sources[0]["enabled"] is True


def test_ensure_builtin_sources_with_no_sources_key(tmp_path, monkeypatch):
    _make_app_config(tmp_path, {})
    mod = _reload_sources(tmp_path, monkeypatch)
    assert mod.ensure_builtin_sources() is True
    assert [s["id"] for s in mod.list_sources()] == ["steam-shortcuts"]


def test_list_sources_defaults_builtin_false(tmp_path, monkeypatch):
    _make_app_config(tmp_path, {"sources": [
        {"id": "a", "name": "Games", "type": "local", "path": "/g", "url": None}
    ]})
    mod = _reload_sources(tmp_path, monkeypatch)
    assert mod.list_sources()[0]["builtin"] is False


def test_remove_source_refuses_builtin(tmp_path, monkeypatch):
    _make_app_config(tmp_path, {})
    mod = _reload_sources(tmp_path, monkeypatch)
    mod.ensure_builtin_sources()
    assert mod.remove_source("steam-shortcuts") is False
    assert len(mod.list_sources()) == 1


def test_source_config_root(tmp_path, monkeypatch):
    mod = _reload_sources(tmp_path, monkeypatch)
    builtin = {"id": "steam-shortcuts", "type": "steam_shortcuts", "path": None}
    assert mod.source_config_root(builtin) == tmp_path / ".config" / "deckyfin" / "steam_shortcuts"
    assert mod.source_config_root({"type": "local", "path": "/g"}) == Path("/g")
    assert mod.source_config_root({"type": "agent", "path": None}) is None


def test_builtin_capabilities_and_disk_usage(tmp_path, monkeypatch):
    mod = _reload_sources(tmp_path, monkeypatch)
    builtin = {"id": "steam-shortcuts", "type": "steam_shortcuts", "path": None}
    assert mod.detect_capabilities(builtin) == {
        "can_play": True, "can_write_config": True, "can_download_to": False,
    }
    assert mod.get_disk_usage(builtin) == {"used": None, "total": None, "free": None}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_sources.py -v -k "builtin or config_root"`
Expected: FAIL — `AttributeError: module 'deckyfin_sources' has no attribute 'ensure_builtin_sources'` (and similar).

- [ ] **Step 3: Implement**

In `py_modules/deckyfin_consts.py`, after `SOURCES_FILE = "sources.json"`:

```python
STEAM_SHORTCUTS_SOURCE_ID = "steam-shortcuts"
STEAM_SHORTCUTS_SOURCE_TYPE = "steam_shortcuts"
```

In `py_modules/deckyfin_sources.py`:

Change imports:

```python
from deckyfin_config import get_app_config, set_app_config, get_games_config, get_app_config_path
from deckyfin_consts import SOURCES_FILE, STEAM_SHORTCUTS_SOURCE_ID, STEAM_SHORTCUTS_SOURCE_TYPE
```

Replace `list_sources`:

```python
def list_sources() -> list:
    """Return all configured sources, normalizing missing enabled/builtin fields."""
    sources = get_app_config().get("sources", [])
    return [
        {**s, "enabled": s.get("enabled", True), "builtin": s.get("builtin", False)}
        for s in sources
    ]
```

In `remove_source`, before building `new_sources`:

```python
    sources = list_sources()
    if any(s["id"] == source_id and s.get("builtin") for s in sources):
        return False
```

Add after `set_source_enabled` (new section):

```python
# ── Built-in sources ──────────────────────────────────────────────────────────

_BUILTIN_SOURCES = [
    {
        "id": STEAM_SHORTCUTS_SOURCE_ID,
        "name": "Steam Shortcuts",
        "type": STEAM_SHORTCUTS_SOURCE_TYPE,
        "builtin": True,
        "enabled": False,
        "path": None,
        "url": None,
    },
]


def ensure_builtin_sources() -> bool:
    """Append missing built-in sources. Never touches existing records. Returns True if any added."""
    sources = list_sources()
    existing = {s["id"] for s in sources}
    missing = [dict(b) for b in _BUILTIN_SOURCES if b["id"] not in existing]
    if not missing:
        return False
    set_app_config({"sources": sources + missing})
    return True


def source_config_root(source: dict) -> Optional[Path]:
    """Folder holding a source's .deckyfin/config.json (built-in sources live in the app config dir)."""
    if source.get("type") == STEAM_SHORTCUTS_SOURCE_TYPE:
        return get_app_config_path() / "steam_shortcuts"
    path = source.get("path")
    return Path(path) if path else None
```

At the top of `detect_capabilities`, after `t = source.get("type")`:

```python
    if t == STEAM_SHORTCUTS_SOURCE_TYPE:
        return {"can_play": True, "can_write_config": True, "can_download_to": False}
```

At the top of `get_disk_usage`, after `t = source.get("type")`:

```python
    if t == STEAM_SHORTCUTS_SOURCE_TYPE:
        return null
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/ -v`
Expected: all PASS (existing 68 + 7 new).

- [ ] **Step 5: Commit**

```bash
git add py_modules/deckyfin_consts.py py_modules/deckyfin_sources.py tests/test_sources.py
git commit -m "feat: add built-in source framework with Steam Shortcuts record"
```

---

### Task 2: Orphan shortcut detection

**Files:**
- Modify: `py_modules/steam_games.py` — `list_nonsteam_games`, the `games.append({...})` block (~line 667)
- Create: `py_modules/deckyfin_steam_shortcuts.py`
- Test: `tests/test_steam_shortcuts.py` (create)

**Interfaces:**
- Consumes: `deckyfin_consts.STEAM_SHORTCUTS_SOURCE_TYPE` (Task 1)
- Produces:
  - `list_nonsteam_games()` items gain `start_dir: str`, `launch_options: str`, `collections: list[str]`, `unsigned_appid: int`
  - `deckyfin_steam_shortcuts.build_ownership(sources, load_games) -> tuple[set[str], list[str]]`
  - `deckyfin_steam_shortcuts.find_orphans(shortcuts, owned_names, owned_paths) -> list[dict]`
  - `deckyfin_steam_shortcuts.list_orphan_shortcuts(sources, load_games) -> list[dict]`
  - `load_games` is a callable `(source: dict) -> list[dict]` (may raise)

- [ ] **Step 1: Write the failing tests** — create `tests/test_steam_shortcuts.py`:

```python
"""Tests for deckyfin_steam_shortcuts — orphan detection and loading."""

import sys
from pathlib import Path

_py_modules = str(Path(__file__).resolve().parent.parent / "py_modules")
if _py_modules not in sys.path:
    sys.path.insert(0, _py_modules)


def _reload(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    import importlib, deckyfin_config, deckyfin_sources, deckyfin_steam_shortcuts
    importlib.reload(deckyfin_config)
    importlib.reload(deckyfin_sources)
    importlib.reload(deckyfin_steam_shortcuts)
    return deckyfin_steam_shortcuts


def _sc(name, exe, appid=123, **kw):
    return {
        "name": name, "exe": exe, "app_id": appid, "unsigned_appid": appid,
        "start_dir": kw.get("start_dir", ""), "launch_options": kw.get("launch_options", ""),
        "collections": kw.get("collections", []), "current_proton": kw.get("current_proton"),
    }


SOURCES = [
    {"id": "a", "type": "local", "path": "/games", "enabled": True, "builtin": False},
    {"id": "b", "type": "mount", "path": "/mnt/nas/games", "enabled": False, "builtin": False},
    {"id": "steam-shortcuts", "type": "steam_shortcuts", "path": None, "enabled": True, "builtin": True},
]


def _loader(names_by_source):
    def load(source):
        if names_by_source.get(source["id"]) == "raise":
            raise PermissionError("fuse")
        return [{"name": n} for n in names_by_source.get(source["id"], [])]
    return load


def test_build_ownership_includes_disabled_and_skips_builtin(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    names, paths = mod.build_ownership(SOURCES, _loader({"a": ["Halo"], "b": ["Doom"]}))
    assert names == {"halo", "doom"}
    assert paths == ["/games", "/mnt/nas/games"]


def test_build_ownership_unreadable_source_keeps_path(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    names, paths = mod.build_ownership(SOURCES, _loader({"a": ["Halo"], "b": "raise"}))
    assert names == {"halo"}
    assert "/mnt/nas/games" in paths


def test_find_orphans_name_match_is_case_insensitive(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    shortcuts = [_sc("HALO", "/elsewhere/halo.exe")]
    assert mod.find_orphans(shortcuts, {"halo"}, []) == []


def test_find_orphans_exe_under_source_path(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    shortcuts = [
        _sc("X", "/mnt/nas/games/X/x.exe", 1),
        _sc("Y", "/mnt/nas/games-other/y.exe", 2),  # prefix but not under
    ]
    orphans = mod.find_orphans(shortcuts, set(), ["/mnt/nas/games/"])
    assert [o["name"] for o in orphans] == ["Y"]


def test_find_orphans_unmatched_is_orphan(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    shortcuts = [_sc("Firefox", "/usr/bin/firefox")]
    assert [o["name"] for o in mod.find_orphans(shortcuts, {"halo"}, ["/games"])] == ["Firefox"]


def test_list_orphan_shortcuts_uses_vdf(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    monkeypatch.setattr(mod, "list_nonsteam_games", lambda: [
        _sc("Halo", "/games/Halo/halo.exe", 1),
        _sc("Leftover", "/old/place/l.exe", 2),
    ])
    orphans = mod.list_orphan_shortcuts(SOURCES, _loader({}))
    assert [o["name"] for o in orphans] == ["Leftover"]


def test_list_orphan_shortcuts_no_vdf(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    monkeypatch.setattr(mod, "list_nonsteam_games", lambda: [])
    assert mod.list_orphan_shortcuts(SOURCES, _loader({})) == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_steam_shortcuts.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'deckyfin_steam_shortcuts'`.

- [ ] **Step 3: Implement**

In `py_modules/steam_games.py`, `list_nonsteam_games`, replace the `games.append({...})` call with:

```python
        start_dir = shortcut.get("StartDir") or shortcut.get("startdir") or ""
        games.append({
            "index": idx,
            "name": app_name,
            "exe": exe.strip('"'),
            "app_id": app_id,
            "unsigned_appid": convert_appid_to_unsigned_32bit(app_id),
            "config_appid": config_appid,
            "current_proton": current_proton,
            "start_dir": start_dir.strip('"'),
            "launch_options": shortcut.get("LaunchOptions") or shortcut.get("launchoptions") or "",
            "collections": _parse_old_tags(shortcut) or [],
        })
```

(`_parse_old_tags` and `convert_appid_to_unsigned_32bit` are already defined earlier in the same file.)

Create `py_modules/deckyfin_steam_shortcuts.py`:

```python
"""Steam Shortcuts built-in source — non-Steam shortcuts that no Deckyfin source owns."""

import os
from typing import Callable

from steam_games import list_nonsteam_games

LoadGames = Callable[[dict], list]


def _is_under(path: str, root: str) -> bool:
    p = os.path.normpath(path)
    r = os.path.normpath(root)
    return p == r or p.startswith(r.rstrip("/") + "/")


def build_ownership(sources: list, load_games: LoadGames) -> tuple:
    """Return (lower-cased owned names, owned source paths) across all non-builtin sources.

    Disabled sources count as owners. A source whose games can't be read still
    owns everything under its path.
    """
    names: set = set()
    paths: list = []
    for source in sources:
        if source.get("builtin"):
            continue
        if source.get("path"):
            paths.append(os.path.normpath(source["path"]))
        try:
            games = load_games(source) or []
        except Exception:
            games = []
        names.update(g["name"].lower() for g in games if g.get("name"))
    return names, paths


def find_orphans(shortcuts: list, owned_names: set, owned_paths: list) -> list:
    """Shortcuts whose name isn't owned and whose exe isn't under any owned path."""
    orphans = []
    for sc in shortcuts:
        if (sc.get("name") or "").lower() in owned_names:
            continue
        exe = sc.get("exe") or ""
        if exe and any(_is_under(exe, root) for root in owned_paths):
            continue
        orphans.append(sc)
    return orphans


def list_orphan_shortcuts(sources: list, load_games: LoadGames) -> list:
    """Orphan shortcuts for the current Steam user ([] if shortcuts.vdf is unavailable)."""
    shortcuts = list_nonsteam_games()
    if not shortcuts:
        return []
    names, paths = build_ownership(sources, load_games)
    return find_orphans(shortcuts, names, paths)
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/ -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add py_modules/steam_games.py py_modules/deckyfin_steam_shortcuts.py tests/test_steam_shortcuts.py
git commit -m "feat: detect orphan Steam shortcuts not owned by any source"
```

---

### Task 3: Orphan game loading and Deckyfin data store

**Files:**
- Modify: `py_modules/deckyfin_steam_shortcuts.py` (append)
- Modify: `py_modules/deckyfin_sources.py` — `load_source_games`
- Test: `tests/test_steam_shortcuts.py` (append)

**Interfaces:**
- Consumes: `list_orphan_shortcuts` (Task 2), `source_config_root`, `STEAM_SHORTCUTS_SOURCE_TYPE` (Task 1)
- Produces:
  - `deckyfin_steam_shortcuts.load_shortcut_games(sources, load_games) -> list[dict]` — game configs with `id`, `name`, `executable`, `start_dir`, `launch_options`, `collections`, `proton_version`, `shortcut_app_id`, `steam_snapshot` plus stored fields
  - `deckyfin_steam_shortcuts.upsert_store_entry(name: str, updates: dict) -> dict`
  - `deckyfin_steam_shortcuts.store_root() -> Path`
  - `load_source_games({"type": "steam_shortcuts", ...})` returns `load_shortcut_games(list_sources(), load_source_games)`

- [ ] **Step 1: Write the failing tests** — append to `tests/test_steam_shortcuts.py`:

```python
import json


def _write_store(tmp_path, games):
    d = tmp_path / ".config" / "deckyfin" / "steam_shortcuts" / ".deckyfin"
    d.mkdir(parents=True, exist_ok=True)
    (d / "config.json").write_text(json.dumps({"games": games}))
    return d / "config.json"


def test_load_shortcut_games_builds_config_and_merges_store(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    _write_store(tmp_path, [{"name": "Leftover", "proton_dependencies": ["vcrun2019"],
                             "executable": "/stale.exe"}])
    monkeypatch.setattr(mod, "list_nonsteam_games", lambda: [
        _sc("Leftover", "/old/l.exe", 42, start_dir="/old", launch_options="-x",
            collections=["RPG"], current_proton="GE-Proton9-1"),
    ])
    games = mod.load_shortcut_games(SOURCES, _loader({}))
    assert len(games) == 1
    g = games[0]
    assert g["id"] == "shortcut-42"
    assert g["executable"] == "/old/l.exe"          # VDF wins over stored
    assert g["start_dir"] == "/old"
    assert g["launch_options"] == "-x"
    assert g["collections"] == ["RPG"]
    assert g["proton_version"] == "GE-Proton9-1"
    assert g["shortcut_app_id"] == 42
    assert g["proton_dependencies"] == ["vcrun2019"]  # stored field kept
    assert json.loads(g["steam_snapshot"]) == {
        "name": "Leftover", "executable": "/old/l.exe", "start_dir": "/old",
        "launch_options": "-x", "proton_version": "GE-Proton9-1", "collections": ["RPG"],
    }
    assert list(json.loads(g["steam_snapshot"]).keys()) == [
        "name", "executable", "start_dir", "launch_options", "proton_version", "collections",
    ]


def test_load_shortcut_games_prunes_stale_store_entries(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    cfg = _write_store(tmp_path, [{"name": "Leftover"}, {"name": "Gone"}])
    monkeypatch.setattr(mod, "list_nonsteam_games", lambda: [_sc("Leftover", "/o/l.exe", 1)])
    mod.load_shortcut_games(SOURCES, _loader({}))
    assert [g["name"] for g in json.loads(cfg.read_text())["games"]] == ["Leftover"]


def test_load_shortcut_games_no_prune_when_no_orphans(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    cfg = _write_store(tmp_path, [{"name": "Leftover"}])
    monkeypatch.setattr(mod, "list_nonsteam_games", lambda: [])
    assert mod.load_shortcut_games(SOURCES, _loader({})) == []
    assert [g["name"] for g in json.loads(cfg.read_text())["games"]] == ["Leftover"]


def test_upsert_store_entry_creates_then_updates(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    mod.upsert_store_entry("Leftover", {"proton_dependencies": ["d3dx9"]})
    mod.upsert_store_entry("Leftover", {"proton_sync_paths": ["/x"]})
    cfg = tmp_path / ".config" / "deckyfin" / "steam_shortcuts" / ".deckyfin" / "config.json"
    games = json.loads(cfg.read_text())["games"]
    assert games == [{"name": "Leftover", "proton_dependencies": ["d3dx9"], "proton_sync_paths": ["/x"]}]


def test_load_source_games_dispatches_builtin(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    import deckyfin_sources
    monkeypatch.setattr(deckyfin_sources, "list_sources", lambda: SOURCES)
    monkeypatch.setattr(mod, "list_nonsteam_games", lambda: [_sc("Leftover", "/o/l.exe", 7)])
    games = deckyfin_sources.load_source_games(SOURCES[2])
    assert [g["id"] for g in games] == ["shortcut-7"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_steam_shortcuts.py -v`
Expected: new tests FAIL with `AttributeError: ... has no attribute 'load_shortcut_games'` / `'upsert_store_entry'`.

- [ ] **Step 3: Implement**

Append to `py_modules/deckyfin_steam_shortcuts.py` (and add the imports at the top of the file):

```python
import json
from pathlib import Path

from deckyfin_config import get_app_config_path, get_games_config, save_games_config
```

```python
def store_root() -> Path:
    """Folder whose .deckyfin/config.json holds Deckyfin-only data for orphans."""
    return get_app_config_path() / "steam_shortcuts"


def _snapshot(game: dict) -> str:
    # Key order must match GameDetail's steamNeedsSync comparison object.
    return json.dumps({
        "name": game["name"],
        "executable": game["executable"],
        "start_dir": game["start_dir"],
        "launch_options": game["launch_options"] or None,
        "proton_version": game["proton_version"],
        "collections": game["collections"],
    })


def load_shortcut_games(sources: list, load_games: LoadGames) -> list:
    """Game configs for every orphan shortcut, merged with stored Deckyfin data."""
    orphans = list_orphan_shortcuts(sources, load_games)
    root = store_root()
    config = get_games_config(root)
    stored_list = config.get("games", [])
    stored = {g.get("name"): g for g in stored_list}

    # Prune entries whose shortcut is gone. Skip when there are no orphans at all
    # (shortcuts.vdf may be temporarily unreadable).
    if orphans:
        names = {o["name"] for o in orphans}
        kept = [g for g in stored_list if g.get("name") in names]
        if len(kept) != len(stored_list):
            try:
                save_games_config({**config, "games": kept}, root)
            except Exception:
                pass

    games = []
    for o in orphans:
        game = dict(stored.get(o["name"]) or {})
        game.update({
            "id": f"shortcut-{o['unsigned_appid']}",
            "name": o["name"],
            "executable": o["exe"],
            "start_dir": o["start_dir"],
            "launch_options": o["launch_options"],
            "collections": o["collections"],
            "proton_version": o["current_proton"],
            "shortcut_app_id": o["unsigned_appid"],
        })
        game["steam_snapshot"] = _snapshot(game)
        games.append(game)
    return games


def upsert_store_entry(name: str, updates: dict) -> dict:
    """Merge `updates` into the stored entry for `name`, creating it if missing."""
    root = store_root()
    config = get_games_config(root)
    games = config.get("games", [])
    for g in games:
        if g.get("name") == name:
            g.update(updates)
            entry = g
            break
    else:
        entry = {"name": name, **updates}
        games.append(entry)
    save_games_config({**config, "games": games}, root)
    return entry
```

In `py_modules/deckyfin_sources.py`, `load_source_games`, right after `t = source.get("type")`:

```python
    if t == STEAM_SHORTCUTS_SOURCE_TYPE:
        from deckyfin_steam_shortcuts import load_shortcut_games  # local import: avoids cycle
        return load_shortcut_games(list_sources(), load_source_games)
```

Note: inside `load_shortcut_games`, `build_ownership` calls `load_source_games` for user sources only (built-ins are skipped), so there is no recursion.

- [ ] **Step 4: Run tests**

Run: `pytest tests/ -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add py_modules/deckyfin_steam_shortcuts.py py_modules/deckyfin_sources.py tests/test_steam_shortcuts.py
git commit -m "feat: load orphan shortcuts as games with a Deckyfin data store"
```

---

### Task 4: Backend endpoint wiring (`main.py`)

`main.py` imports `decky` and can't be imported by pytest; verify with `py_compile` plus the full suite.

**Files:**
- Modify: `main.py` — imports (`from deckyfin_sources import (...)` ~line 60), `_main` (~line 387), `remove_source` (~line 424), `get_games` (~line 1021), `get_game` (~line 1067), `update_game_config` (~line 1097), `scan_game_exes` (~line 1267); add `get_builtin_source_summary` after `get_source_disk_usage`.

**Interfaces:**
- Consumes: `ensure_builtin_sources`, `STEAM_SHORTCUTS_SOURCE_TYPE` (Task 1), `upsert_store_entry` (Task 3), `load_source_games` dispatch (Task 3)
- Produces (frontend callables):
  - `get_builtin_source_summary(source_id: str) -> {"count": int}`
  - `remove_source` returns `{"success": False, "error": "Built-in sources can't be removed"}` for builtin
  - `get_game(name, "steam-shortcuts")` / `update_game_config(name, updates, "steam-shortcuts")` work for orphans
  - `scan_game_exes(<absolute dir>, "steam-shortcuts")` scans that absolute dir

- [ ] **Step 1: Imports**

Add to the `from deckyfin_sources import (...)` block:

```python
    ensure_builtin_sources as _ensure_builtin_sources,
```

Add near the other module imports:

```python
from deckyfin_steam_shortcuts import upsert_store_entry as _upsert_shortcut_store_entry
from deckyfin_consts import STEAM_SHORTCUTS_SOURCE_TYPE
```

- [ ] **Step 2: Startup** — in `_main`, after the `_migrate_games_folder_to_source()` try/except block:

```python
        # Ensure built-in sources (Steam Shortcuts) exist
        try:
            if _ensure_builtin_sources():
                _debug("_main: added built-in sources")
        except Exception as e:
            _debug(f"_main: ensure_builtin_sources error: {e}")
```

- [ ] **Step 3: `remove_source`** — replace body:

```python
    async def remove_source(self, source_id: str) -> dict:
        src = _get_source_by_id(source_id)
        if src and src.get("builtin"):
            return {"success": False, "error": "Built-in sources can't be removed"}
        removed = _remove_source(source_id)
        return {"success": removed, "error": None if removed else f"Source '{source_id}' not found"}
```

- [ ] **Step 4: `get_games` state overlay** — in `get_games`, replace

```python
                state = get_game_state(source["id"], name)
```

with

```python
                state = get_game_state(source["id"], name)
                if state and source.get("type") == STEAM_SHORTCUTS_SOURCE_TYPE:
                    # shortcuts.vdf is the source of truth for orphans' Steam fields
                    state = {k: v for k, v in state.items() if k != "steam_snapshot"}
```

- [ ] **Step 5: `get_game`** — insert right after the `if not source: return {...}` check:

```python
        if source.get("type") == STEAM_SHORTCUTS_SOURCE_TYPE:
            game = next((g for g in _load_source_games(source) if g.get("name") == name), None)
            if not game:
                return {"success": False, "error": f"Game '{name}' not found"}
            state = {k: v for k, v in get_game_state(source["id"], name).items() if k != "steam_snapshot"}
            return {"success": True, "game": {**game, **state}}
```

- [ ] **Step 6: `update_game_config`** — insert right after the `config_updates` / `state_updates` split lines:

```python
        if source.get("type") == STEAM_SHORTCUTS_SOURCE_TYPE:
            try:
                if config_updates:
                    _upsert_shortcut_store_entry(name, config_updates)
                if state_updates:
                    update_game_state(source["id"], name, state_updates)
            except Exception as e:
                return {"success": False, "error": str(e)}
            game = next((g for g in _load_source_games(source) if g.get("name") == name), None)
            if game:
                st = {k: v for k, v in get_game_state(source["id"], name).items() if k != "steam_snapshot"}
                game = {**game, **st}
            return {"success": True, "game": game}
```

(`get_game_state` returns `{}` when nothing is stored.)

- [ ] **Step 7: `scan_game_exes`** — replace the `games_path` lookup at the top:

```python
        if source_id:
            src = _get_source_by_id(source_id)
            # Orphan shortcuts have no source folder; frontend passes an absolute dir.
            games_path = "/" if src and src.get("type") == STEAM_SHORTCUTS_SOURCE_TYPE else (src.get("path") if src else None)
        else:
```

(`Path("/") / "/abs/dir"` == `Path("/abs/dir")`, and `_owner_creds_for("/")` is root, so the direct-scan path is used.)

- [ ] **Step 8: `get_builtin_source_summary`** — add after `get_source_disk_usage`:

```python
    async def get_builtin_source_summary(self, source_id: str) -> dict:
        """Game count for a built-in source card in Settings."""
        source = _get_source_by_id(source_id)
        if not source or not source.get("builtin") or not source.get("enabled", True):
            return {"count": 0}
        try:
            return {"count": len(_load_source_games(source))}
        except Exception as e:
            _debug(f"get_builtin_source_summary: {e!r}")
            return {"count": 0}
```

- [ ] **Step 9: Verify**

Run: `python -m py_compile main.py && pytest tests/ -v`
Expected: no output from py_compile; all tests PASS.

- [ ] **Step 10: Commit**

```bash
git add main.py
git commit -m "feat: wire Steam Shortcuts source into backend endpoints"
```

---

### Task 5: Types and Settings card

**Files:**
- Modify: `src/types.ts` — `SourceType` (line 91), `Source`, `GameConfig`
- Modify: `src/components/SettingsPage.tsx` — callables near line 22, source card in `sources.map` (~line 676)

**Interfaces:**
- Consumes: `get_builtin_source_summary` (Task 4), `Source.builtin`
- Produces: `SourceType` includes `"steam_shortcuts"`; `Source.builtin?: boolean`; `GameConfig.shortcut_app_id?: number`

- [ ] **Step 1: Types** — in `src/types.ts`:

```ts
export type SourceType = "local" | "mount" | "agent" | "steam_shortcuts";
```

In `interface Source` add `builtin?: boolean;`. In `interface GameConfig` add:

```ts
  /** Unsigned shortcut app id — set for games from the Steam Shortcuts source. */
  shortcut_app_id?: number;
```

- [ ] **Step 2: Callable and summary state** — in `SettingsPage.tsx` next to `setSourceEnabled`:

```ts
const getBuiltinSourceSummary = callable<[source_id: string], { count: number }>("get_builtin_source_summary");
```

Inside the component, next to the other source state:

```ts
  const [builtinCounts, setBuiltinCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    sources.filter((s) => s.builtin && s.enabled !== false).forEach((s) => {
      getBuiltinSourceSummary(s.id)
        .then((r) => setBuiltinCounts((prev) => ({ ...prev, [s.id]: r.count })))
        .catch(() => {});
    });
  }, [sources]);
```

- [ ] **Step 3: Card rendering** — in the `sources.map` callback:

Change the color and `offline` lines to:

```tsx
        const typeColor = src.builtin ? "#66c0f4" : src.type === "local" ? "#27ae60" : src.type === "mount" ? "#e67e22" : "#0984e3";
        const typeBg = src.builtin ? "#1a2a3a" : src.type === "local" ? "#1a3a1a" : src.type === "mount" ? "#2a2a1a" : "#1a1a3a";
        const offline = !src.builtin && src.enabled !== false && !usage?.total && usage?.total !== undefined;
```

Type pill text: replace `{src.type}` with `{src.builtin ? "steam" : src.type}`.

Wrap the Rescan and Remove `Focusable`s so they render only for non-builtin sources:

```tsx
                  {!src.builtin && (
                    <Focusable onActivate={() => handleRescanSource(src.id)} ...existing Rescan button unchanged... </Focusable>
                  )}
                  ...existing Enable/Disable button unchanged...
                  {!src.builtin && (
                    <Focusable onActivate={() => handleRemoveSource(src.id)} ...existing Remove button unchanged... </Focusable>
                  )}
```

Replace the path line:

```tsx
              <div style={{ fontSize: "0.78em", color: "#666", marginBottom: "6px", wordBreak: "break-all" }}>
                {src.builtin
                  ? (src.enabled === false
                      ? "Disabled"
                      : builtinCounts[src.id] === undefined
                        ? "Counting…"
                        : `${builtinCounts[src.id]} orphan shortcut${builtinCounts[src.id] === 1 ? "" : "s"}`)
                  : (src.path || src.url)}
              </div>
```

(The disk bar already renders only when `usedPct !== null`, which is the case for built-ins since `total` is null.)

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit -p . && npm run build`
Expected: no type errors; `created dist`.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/components/SettingsPage.tsx
git commit -m "feat: show built-in Steam Shortcuts source card in settings"
```

---

### Task 6: Game page and library adaptations

**Files:**
- Modify: `src/components/GameDetail.tsx`
- Modify: `src/components/GameLibrary.tsx` — "Backup All Saves" picker (~line 984–988) and "Add Games to Steam" picker (~line 1088–1092)

**Interfaces:**
- Consumes: `GameSource.source_type === "steam_shortcuts"`, `Source.builtin`, `scan_game_exes(absDir, "steam-shortcuts")` (Task 4)

- [ ] **Step 1: Flag** — in `GameDetail.tsx`, right after `const currentConfig: GameConfig = ...` (line ~288):

```ts
  const isShortcutSource = selectedSource?.source_type === "steam_shortcuts";
```

- [ ] **Step 2: Read-only name** — replace the name field (line ~1749):

```tsx
            {isShortcutSource ? (
              <div style={{ fontSize: "0.9em", color: "#ccc", padding: "6px 0", marginBottom: "8px" }}>{name}</div>
            ) : (
              <CompactTextField value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", marginBottom: "8px" }} />
            )}
```

- [ ] **Step 3: Exe picker root** — in `handleOpenExePicker`, replace `const root = currentConfig.path || game.name;` with:

```ts
    const exePath = currentConfig.executable || "";
    const root = isShortcutSource
      ? exePath.substring(0, Math.max(exePath.lastIndexOf("/"), 1))
      : currentConfig.path || game.name;
```

- [ ] **Step 4: Leave page after Remove/Purge** — in `handleRemoveSteam` and `handlePurgeSteam`, inside `if (res.success) { ... }`, after `onNeedsRestart?.();` add:

```ts
        if (isShortcutSource) onBack();
```

- [ ] **Step 5: Hide source-folder sections** — wrap these existing JSX conditions with `!isShortcutSource && (...)`:
  - `{/* Save Paths */}` section (line ~2012): prefix its rendering condition with `!isShortcutSource &&`.
  - `{/* ── Transfer Actions ── */}` (line ~2533): change the opening `{(game.sources.length >= 2 ||` to `{!isShortcutSource && (game.sources.length >= 2 ||` (keep the rest of the condition).
  - `{/* ── Save Actions ── */}` (line ~2869): change to `{!isShortcutSource && syncPaths.length > 0 && (capabilities.can_write_config || !!steamInfo) && (`.
  - The "Remove game from source" block (`confirming === "deckyfin" ? (...) : (<Focusable onActivate={() => setConfirming("deckyfin")} ...>)`, line ~3068): wrap the whole ternary in `{!isShortcutSource && (...)}`.
  - "Add to Steam" button (line ~2169): handler becomes `capabilities.can_play && !(isShortcutSource && !steamInfo) ? (steamInfo ? handleUpdateSteam : handleAddToSteam) : undefined` for both `onActivate` and `onClick`.

Read each block before editing to keep its exact surrounding structure; if a section has no wrapping condition, wrap it as `{!isShortcutSource && (<div>…</div>)}`.

- [ ] **Step 6: Library pickers** — in `GameLibrary.tsx`:
  - Backup All picker: replace `allSources.length === 0` and `allSources.map(` with `allSources.filter((s) => !s.builtin).length === 0` and `allSources.filter((s) => !s.builtin).map(`.
  - Add Games to Steam picker: change both `allSources.filter((s) => s.type !== "mount")` to `allSources.filter((s) => s.type !== "mount" && !s.builtin)`.

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit -p . && npm run build`
Expected: no type errors; `created dist`.

- [ ] **Step 8: Commit**

```bash
git add src/components/GameDetail.tsx src/components/GameLibrary.tsx
git commit -m "feat: adapt game page and library pickers for Steam Shortcuts games"
```

---

### Task 7: End-to-end verification

- [ ] **Step 1:** `pytest tests/ -v` — all PASS.
- [ ] **Step 2:** `npm run build` — `created dist`.
- [ ] **Step 3:** Deploy locally with `./deploy.sh`, open Deckyfin → Settings:
  - "Steam Shortcuts" card exists at the bottom, `steam` badge, "Disabled", only ▲▼ and Enable.
  - Enable it → count line shows `N orphan shortcuts`; no "⚠ offline".
- [ ] **Step 4:** Library shows orphan games with the Steam Shortcuts badge; games from user sources (including a disabled source) do not appear twice.
- [ ] **Step 5:** Open an orphan: name is read-only; exe picker lists `.exe`s next to the current exe; no Transfer / Save / Remove-from-source sections; "Update Steam game" isn't green on first open; change launch options → green → Update → restart flag set.
- [ ] **Step 6:** Remove from Steam on a throwaway orphan → returns to library; after restart it's gone.
- [ ] **Step 7:** Check `~/homebrew/plugins/deckyfin/debug.log` (or the Decky log dir) for exceptions from `get_games` / `get_builtin_source_summary`.
