# Steam Library Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a built-in "Steam Library" source listing installed Steam Store games, with Proton version / launch options applied live via Steam's client API, collections, deps, saves and artwork managed from Deckyfin.

**Architecture:** A new backend module `deckyfin_steam_library.py` discovers installed games from `libraryfolders.vdf` + `appmanifest_*.acf`, reads Proton mapping and launch options from Steam's config files, and merges each game with Deckyfin-only data stored under `~/.config/deckyfin/steam_library/`. `load_source_games` dispatches to it, and the existing built-in-source plumbing (Settings card, merged games, state store) carries it to the frontend. The game page gains an `isLibrarySource` mode: an "Apply to Steam" button that calls `SteamClient.Apps.SpecifyCompatTool` / `SetAppLaunchOptions` live, and prefix-gated deps/saves.

**Tech Stack:** Python 3 (`vdf` package, pytest), React 18 + TypeScript (`@decky/ui`, Rollup).

**Spec:** `docs/superpowers/specs/2026-10-30-steam-library-source-design.md`

## Global Constraints

- Built-in source: id `steam-library`, type `steam_library`, name `Steam Library`, `builtin: true`, **disabled by default**.
- Game id format: `steam-<appid>`. Store root: `get_app_config_path() / "steam_library"`.
- Installed filter: keep an app iff `StateFlags & 4` (e.g. `4`, `6` kept; `0`, `1026` skipped).
- Tool exclusion: appids `{228980, 1070560, 1391110, 1628350, 4183110, 1826330, 1161040}` or names starting `Proton ` / equal `Proton Experimental` / `Proton Hotfix` / starting `Steam Linux Runtime`.
- `has_prefix = prefix_path is not None or proton_version is not None` (rule A).
- Prefix path for Store games: `<library>/steamapps/compatdata/<appid>/pfx`. The deps installer **never creates** a prefix when given `compatdata_path`.
- Pills: `steam_shortcuts` → `shortcut`, `steam_library` → `steam` (Steam blue for both).
- Proton + launch options apply live (`SpecifyCompatTool`, `SetAppLaunchOptions`); collections via backend + needs-restart.
- Store values for `launch_options` / `proton_version` win once present; seeded from Steam files when absent. `selected_launchers` default `[]`.
- `steam_snapshot` for Store games: key order `name, launch_options, proton_version, collections` (matches GameDetail's `steamNeedsSync` object, where `executable`/`start_dir` are undefined and dropped). Unlike Steam Shortcuts, the state-store snapshot is **not** stripped for Store games.
- Every focusable picker item keeps `margin: "0 2px"` and `padding: "4px 10px"`.
- Python tests: `pytest tests/ -v`; `python -m py_compile main.py`. Frontend: `npx tsc --noEmit -p .` and `npm run build`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `py_modules/deckyfin_consts.py` (modify) | `STEAM_LIBRARY_SOURCE_ID/TYPE`, `BUILTIN_SOURCE_TYPES` |
| `py_modules/deckyfin_steam_library.py` (create) | Library folders, manifests, compat mapping, launch options, game loading with store merge |
| `py_modules/deckyfin_sources.py` (modify) | Built-in record, config root, caps/disk/load dispatch |
| `py_modules/deckyfin_steam_shortcuts.py` (modify) | `attach_builtin_games` (generalized merge), `upsert_store_entry(..., root=)` |
| `py_modules/deckyfin_saves.py` (modify) | `get_prefix_path(app_id, library_path=None)` |
| `py_modules/deckyfin_protontricks.py` (modify) | `_resolve_prefix_dir` + `compatdata_path` param |
| `main.py` (modify) | Built-in branches generalized, saves/deps for Store games, `sync_app_collections` |
| `tests/test_steam_library.py` (create) | Discovery + loading tests |
| `tests/test_steam_shortcuts.py`, `tests/test_sources.py` (modify) | Merge + built-in record tests |
| `tests/test_saves_prefix.py` (create) | Prefix path + deps prefix resolution tests |
| `src/types.ts`, `src/sourceStyle.ts` (modify) | Types, labels, `isBuiltinSourceType` |
| `src/components/SettingsPage.tsx`, `GameLibrary.tsx` (modify) | Card text, built-in detection |
| `src/components/GameDetail.tsx` (modify) | Store-game mode |

---

### Task 1: Store-game discovery module

**Files:**
- Create: `py_modules/deckyfin_steam_library.py`
- Create: `tests/test_steam_library.py`

**Interfaces:**
- Produces:
  - `list_library_folders(steam_root: Path) -> list[Path]`
  - `read_compat_mapping(steam_root: Path) -> dict[str, str]` (appid str → tool name)
  - `read_launch_options(steam_root: Path, user_id: str) -> dict[str, str]`
  - `list_installed_games(steam_root: Path, compat: dict, launch: dict) -> list[dict]` — items: `appid:int, name, library_path:str, install_dir:str, prefix_path:str|None, proton_version:str|None, has_prefix:bool, size_on_disk:int, steam_launch_options:str`

- [ ] **Step 1: Write the failing tests** — create `tests/test_steam_library.py`:

```python
"""Tests for deckyfin_steam_library — installed Store game discovery."""

import json
import sys
from pathlib import Path

_py_modules = str(Path(__file__).resolve().parent.parent / "py_modules")
if _py_modules not in sys.path:
    sys.path.insert(0, _py_modules)


def _reload(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    import importlib, deckyfin_config, deckyfin_sources, deckyfin_steam_library
    importlib.reload(deckyfin_config)
    importlib.reload(deckyfin_sources)
    importlib.reload(deckyfin_steam_library)
    return deckyfin_steam_library


def _manifest(lib: Path, appid: int, name: str, flags: int = 4, installdir: str = None, size: int = 100):
    d = lib / "steamapps"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"appmanifest_{appid}.acf").write_text(
        '"AppState"\n{\n'
        f'\t"appid"\t\t"{appid}"\n'
        f'\t"name"\t\t"{name}"\n'
        f'\t"StateFlags"\t\t"{flags}"\n'
        f'\t"installdir"\t\t"{installdir or name}"\n'
        f'\t"SizeOnDisk"\t\t"{size}"\n'
        '}\n'
    )


def _library_folders(steam_root: Path, *paths: Path):
    d = steam_root / "steamapps"
    d.mkdir(parents=True, exist_ok=True)
    body = "".join(f'\t"{i}"\n\t{{\n\t\t"path"\t\t"{p}"\n\t}}\n' for i, p in enumerate(paths))
    (d / "libraryfolders.vdf").write_text('"libraryfolders"\n{\n' + body + '}\n')


def test_list_library_folders_reads_all_existing(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    root = tmp_path / "Steam"
    extra = tmp_path / "SD" / "SteamLibrary"
    (extra / "steamapps").mkdir(parents=True)
    _library_folders(root, root, extra, tmp_path / "gone")
    assert mod.list_library_folders(root) == [root, extra]


def test_list_library_folders_fallback_to_root(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    root = tmp_path / "Steam"
    (root / "steamapps").mkdir(parents=True)
    assert mod.list_library_folders(root) == [root]


def test_list_installed_games_filters_and_detects_prefix(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    root = tmp_path / "Steam"
    extra = tmp_path / "SD" / "SteamLibrary"
    _library_folders(root, root, extra)
    _manifest(root, 292030, "The Witcher 3", flags=4, installdir="The Witcher 3", size=5)
    _manifest(extra, 216150, "MapleStory", flags=6)          # update pending → kept
    _manifest(extra, 111, "Downloading", flags=1026)         # not installed → skipped
    _manifest(root, 1493710, "Proton Experimental")          # tool by name
    _manifest(root, 228980, "Steamworks Common Redistributables")  # tool by appid
    _manifest(root, 4183110, "Steam Linux Runtime 4.0")
    (extra / "steamapps" / "compatdata" / "216150" / "pfx").mkdir(parents=True)

    games = mod.list_installed_games(root, {"292030": "proton_experimental"}, {"216150": "-dx11"})
    by_id = {g["appid"]: g for g in games}
    assert set(by_id) == {292030, 216150}

    w = by_id[292030]
    assert w["name"] == "The Witcher 3"
    assert w["library_path"] == str(root)
    assert w["install_dir"] == str(root / "steamapps" / "common" / "The Witcher 3")
    assert w["prefix_path"] is None
    assert w["proton_version"] == "proton_experimental"
    assert w["has_prefix"] is True          # forced Proton counts (rule A)
    assert w["size_on_disk"] == 5
    assert w["steam_launch_options"] == ""

    m = by_id[216150]
    assert m["library_path"] == str(extra)
    assert m["prefix_path"] == str(extra / "steamapps" / "compatdata" / "216150" / "pfx")
    assert m["has_prefix"] is True
    assert m["proton_version"] is None
    assert m["steam_launch_options"] == "-dx11"


def test_has_prefix_false_without_prefix_or_proton(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    root = tmp_path / "Steam"
    _library_folders(root, root)
    _manifest(root, 3139440, "GunZ")
    [g] = mod.list_installed_games(root, {}, {})
    assert g["has_prefix"] is False


def test_read_compat_mapping(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    root = tmp_path / "Steam"
    (root / "config").mkdir(parents=True)
    (root / "config" / "config.vdf").write_text(
        '"InstallConfigStore"\n{\n"Software"\n{\n"Valve"\n{\n"Steam"\n{\n'
        '"CompatToolMapping"\n{\n"292030"\n{\n"name"\t"proton_experimental"\n"config"\t""\n"priority"\t"250"\n}\n}\n'
        '}\n}\n}\n}\n'
    )
    assert mod.read_compat_mapping(root) == {"292030": "proton_experimental"}
    assert mod.read_compat_mapping(tmp_path / "nope") == {}


def test_read_launch_options(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    root = tmp_path / "Steam"
    cfg = root / "userdata" / "42" / "config"
    cfg.mkdir(parents=True)
    (cfg / "localconfig.vdf").write_text(
        '"UserLocalConfigStore"\n{\n"Software"\n{\n"Valve"\n{\n"Steam"\n{\n'
        '"apps"\n{\n"216150"\n{\n"LaunchOptions"\t"-dx11 %command%"\n}\n"292030"\n{\n"LastPlayed"\t"1"\n}\n}\n'
        '}\n}\n}\n}\n'
    )
    assert mod.read_launch_options(root, "42") == {"216150": "-dx11 %command%"}
    assert mod.read_launch_options(root, "missing") == {}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_steam_library.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'deckyfin_steam_library'`.

- [ ] **Step 3: Implement** — create `py_modules/deckyfin_steam_library.py`:

```python
"""Steam Library built-in source — installed Steam Store games."""

import os
from pathlib import Path

_INSTALLED_FLAG = 4
_TOOL_APPIDS = {228980, 1070560, 1391110, 1628350, 4183110, 1826330, 1161040}


def _load_vdf(path: Path) -> dict:
    import vdf
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return vdf.load(f)


def _ci_get(d: dict, key: str, default=None):
    """Case-insensitive dict lookup (Steam's VDF key casing varies)."""
    if key in d:
        return d[key]
    low = key.lower()
    for k, v in d.items():
        if k.lower() == low:
            return v
    return default


def _is_tool(appid: int, name: str) -> bool:
    return (
        appid in _TOOL_APPIDS
        or name.startswith("Proton ")
        or name in ("Proton Experimental", "Proton Hotfix")
        or name.startswith("Steam Linux Runtime")
    )


def list_library_folders(steam_root: Path) -> list:
    """Existing Steam library roots (folders containing `steamapps`), root first."""
    roots = []
    try:
        data = _load_vdf(steam_root / "steamapps" / "libraryfolders.vdf")
        folders = _ci_get(data, "libraryfolders", {}) or {}
        for key, val in folders.items():
            if not key.isdigit():
                continue
            path = _ci_get(val, "path") if isinstance(val, dict) else val
            if path:
                roots.append(Path(path))
    except Exception:
        pass
    if not roots:
        roots = [Path(steam_root)]
    out, seen = [], set()
    for r in roots:
        key = os.path.normpath(str(r))
        if key in seen or not (r / "steamapps").is_dir():
            continue
        seen.add(key)
        out.append(r)
    return out


def _steam_section(data: dict, root_key: str) -> dict:
    steam = _ci_get(data, root_key, {}) or {}
    for k in ("Software", "Valve", "Steam"):
        steam = _ci_get(steam, k, {}) or {}
    return steam


def read_compat_mapping(steam_root: Path) -> dict:
    """{appid: tool name} from the global config.vdf CompatToolMapping."""
    try:
        data = _load_vdf(Path(steam_root) / "config" / "config.vdf")
    except Exception:
        return {}
    mapping = _ci_get(_steam_section(data, "InstallConfigStore"), "CompatToolMapping", {}) or {}
    return {k: v.get("name") for k, v in mapping.items() if isinstance(v, dict) and v.get("name")}


def read_launch_options(steam_root: Path, user_id: str) -> dict:
    """{appid: LaunchOptions} for apps that have non-empty launch options."""
    try:
        data = _load_vdf(Path(steam_root) / "userdata" / str(user_id) / "config" / "localconfig.vdf")
    except Exception:
        return {}
    apps = _ci_get(_steam_section(data, "UserLocalConfigStore"), "apps", {}) or {}
    out = {}
    for appid, entry in apps.items():
        if isinstance(entry, dict):
            opts = _ci_get(entry, "LaunchOptions", "")
            if opts:
                out[appid] = opts
    return out


def list_installed_games(steam_root: Path, compat: dict, launch: dict) -> list:
    """Installed, non-tool Store games across all library folders."""
    games = []
    for lib in list_library_folders(Path(steam_root)):
        steamapps = lib / "steamapps"
        for manifest in sorted(steamapps.glob("appmanifest_*.acf")):
            try:
                state = _ci_get(_load_vdf(manifest), "AppState", {}) or {}
                appid = int(_ci_get(state, "appid"))
                flags = int(_ci_get(state, "StateFlags", 0) or 0)
            except Exception:
                continue
            name = _ci_get(state, "name", "") or ""
            if not flags & _INSTALLED_FLAG or _is_tool(appid, name):
                continue
            pfx = steamapps / "compatdata" / str(appid) / "pfx"
            prefix_path = str(pfx) if pfx.is_dir() else None
            proton = compat.get(str(appid))
            games.append({
                "appid": appid,
                "name": name,
                "library_path": str(lib),
                "install_dir": str(steamapps / "common" / (_ci_get(state, "installdir", "") or "")),
                "prefix_path": prefix_path,
                "proton_version": proton,
                "has_prefix": prefix_path is not None or proton is not None,
                "size_on_disk": int(_ci_get(state, "SizeOnDisk", 0) or 0),
                "steam_launch_options": launch.get(str(appid), ""),
            })
    return games
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/ -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add py_modules/deckyfin_steam_library.py tests/test_steam_library.py
git commit -m "feat: discover installed Steam Store games across library folders"
```

---

### Task 2: Built-in Steam Library source and game loading

**Files:**
- Modify: `py_modules/deckyfin_consts.py` (after `STEAM_SHORTCUTS_SOURCE_TYPE`)
- Modify: `py_modules/deckyfin_sources.py`
- Modify: `py_modules/deckyfin_steam_library.py` (append)
- Modify: `py_modules/deckyfin_steam_shortcuts.py` — `upsert_store_entry`
- Test: `tests/test_steam_library.py`, `tests/test_sources.py` (append)

**Interfaces:**
- Consumes: Task 1 functions.
- Produces:
  - consts `STEAM_LIBRARY_SOURCE_ID = "steam-library"`, `STEAM_LIBRARY_SOURCE_TYPE = "steam_library"`, `BUILTIN_SOURCE_TYPES = frozenset({STEAM_SHORTCUTS_SOURCE_TYPE, STEAM_LIBRARY_SOURCE_TYPE})`
  - `deckyfin_steam_library.store_root() -> Path`, `load_library_games(steam_root: Path = None, user_id: str = None) -> list[dict]`
  - `deckyfin_steam_shortcuts.upsert_store_entry(name, updates, root: Path = None)` (root defaults to the shortcuts store)
  - `ensure_builtin_sources()` also appends Steam Library; `source_config_root`, `detect_capabilities`, `get_disk_usage`, `load_source_games` handle `steam_library`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_steam_library.py`:

```python
def _store(tmp_path, games):
    d = tmp_path / ".config" / "deckyfin" / "steam_library" / ".deckyfin"
    d.mkdir(parents=True, exist_ok=True)
    (d / "config.json").write_text(json.dumps({"games": games}))
    return d / "config.json"


def _setup_one_game(tmp_path):
    root = tmp_path / "Steam"
    _library_folders(root, root)
    _manifest(root, 216150, "MapleStory")
    (root / "steamapps" / "compatdata" / "216150" / "pfx").mkdir(parents=True)
    return root


def test_load_library_games_seeds_from_steam(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    root = _setup_one_game(tmp_path)
    monkeypatch.setattr(mod, "read_compat_mapping", lambda r: {"216150": "proton_9"})
    monkeypatch.setattr(mod, "read_launch_options", lambda r, u: {"216150": "-dx11"})
    [g] = mod.load_library_games(root, "42")
    assert g["id"] == "steam-216150"
    assert g["steam_app_id"] == 216150
    assert g["launch_options"] == "-dx11"
    assert g["selected_launchers"] == []
    assert g["proton_version"] == "proton_9"
    assert g["collections"] == []
    assert g["has_prefix"] is True
    snap = json.loads(g["steam_snapshot"])
    assert list(snap) == ["name", "launch_options", "proton_version", "collections"]
    assert snap == {"name": "MapleStory", "launch_options": "-dx11", "proton_version": "proton_9", "collections": []}


def test_load_library_games_store_values_win(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    root = _setup_one_game(tmp_path)
    _store(tmp_path, [{"name": "MapleStory", "launch_options": "", "proton_version": None,
                       "selected_launchers": ["MangoHud"], "proton_dependencies": ["vcrun2019"],
                       "collections": ["MMO"]}])
    monkeypatch.setattr(mod, "read_compat_mapping", lambda r: {"216150": "proton_9"})
    monkeypatch.setattr(mod, "read_launch_options", lambda r, u: {"216150": "-dx11"})
    [g] = mod.load_library_games(root, "42")
    assert g["launch_options"] == ""
    assert g["proton_version"] is None
    assert g["selected_launchers"] == ["MangoHud"]
    assert g["proton_dependencies"] == ["vcrun2019"]
    assert g["collections"] == ["MMO"]


def test_load_library_games_prunes_uninstalled(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    root = _setup_one_game(tmp_path)
    cfg = _store(tmp_path, [{"name": "MapleStory"}, {"name": "Uninstalled"}])
    mod.load_library_games(root, "42")
    assert [g["name"] for g in json.loads(cfg.read_text())["games"]] == ["MapleStory"]


def test_load_library_games_no_prune_when_empty(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    root = tmp_path / "Steam"
    (root / "steamapps").mkdir(parents=True)
    cfg = _store(tmp_path, [{"name": "MapleStory"}])
    assert mod.load_library_games(root, "42") == []
    assert [g["name"] for g in json.loads(cfg.read_text())["games"]] == ["MapleStory"]


def test_load_source_games_dispatches_steam_library(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    import deckyfin_sources
    monkeypatch.setattr(mod, "load_library_games", lambda *a, **k: [{"id": "steam-1", "name": "X"}])
    src = {"id": "steam-library", "type": "steam_library", "path": None, "builtin": True}
    assert deckyfin_sources.load_source_games(src) == [{"id": "steam-1", "name": "X"}]
```

Append to `tests/test_sources.py`:

```python
def test_ensure_builtin_sources_adds_steam_library_after_existing(tmp_path, monkeypatch):
    _make_app_config(tmp_path, {"sources": [
        {"id": "steam-shortcuts", "name": "Steam Shortcuts", "type": "steam_shortcuts",
         "builtin": True, "enabled": True, "path": None, "url": None},
    ]})
    mod = _reload_sources(tmp_path, monkeypatch)
    assert mod.ensure_builtin_sources() is True
    sources = mod.list_sources()
    assert [s["id"] for s in sources] == ["steam-shortcuts", "steam-library"]
    assert sources[0]["enabled"] is True
    lib = sources[1]
    assert (lib["type"], lib["name"], lib["builtin"], lib["enabled"]) == ("steam_library", "Steam Library", True, False)
    assert mod.remove_source("steam-library") is False


def test_steam_library_config_root_caps_disk(tmp_path, monkeypatch):
    mod = _reload_sources(tmp_path, monkeypatch)
    lib = {"id": "steam-library", "type": "steam_library", "path": None}
    assert mod.source_config_root(lib) == tmp_path / ".config" / "deckyfin" / "steam_library"
    assert mod.detect_capabilities(lib) == {"can_play": True, "can_write_config": True, "can_download_to": False}
    assert mod.get_disk_usage(lib) == {"used": None, "total": None, "free": None}
```

Also update existing tests in `tests/test_sources.py` that assert the exact built-in list after `ensure_builtin_sources()` — `test_ensure_builtin_sources_adds_disabled_record` must now expect `["a", "steam-shortcuts", "steam-library"]` (check `sources[1]` is still the shortcuts record), `test_ensure_builtin_sources_with_no_sources_key` must expect `["steam-shortcuts", "steam-library"]`, `test_ensure_builtin_sources_idempotent_and_preserves_state` must include a `steam-library` record in its fixture so it still returns `False`, and `test_remove_source_refuses_builtin` must expect `len(...) == 2`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_steam_library.py tests/test_sources.py -v`
Expected: new tests FAIL (`AttributeError: ... 'load_library_games'`, built-in list mismatch).

- [ ] **Step 3: Implement**

`py_modules/deckyfin_consts.py`, after `STEAM_SHORTCUTS_SOURCE_TYPE`:

```python
STEAM_LIBRARY_SOURCE_ID = "steam-library"
STEAM_LIBRARY_SOURCE_TYPE = "steam_library"
BUILTIN_SOURCE_TYPES = frozenset({STEAM_SHORTCUTS_SOURCE_TYPE, STEAM_LIBRARY_SOURCE_TYPE})
```

`py_modules/deckyfin_steam_shortcuts.py` — give `upsert_store_entry` an optional root:

```python
def upsert_store_entry(name: str, updates: dict, root: Path = None) -> dict:
    """Merge `updates` into the stored entry for `name`, creating it if missing.

    `root` is the built-in source's config root (defaults to the Steam Shortcuts store).
    """
    root = root or store_root()
```
(rest of the body unchanged).

Append to `py_modules/deckyfin_steam_library.py` (add `import json` at the top with the other imports):

```python
def store_root() -> Path:
    """Folder whose .deckyfin/config.json holds Deckyfin-only data for Store games."""
    from deckyfin_config import get_app_config_path
    return get_app_config_path() / "steam_library"


def _snapshot(game: dict) -> str:
    # Key order must match GameDetail's steamNeedsSync object (executable/start_dir
    # are undefined for Store games and dropped by JSON.stringify).
    return json.dumps({
        "name": game["name"],
        "launch_options": game["launch_options"] or None,
        "proton_version": game["proton_version"],
        "collections": game["collections"],
    })


def load_library_games(steam_root: Path = None, user_id: str = None) -> list:
    """Game configs for installed Store games, merged with stored Deckyfin data."""
    from deckyfin_config import get_games_config, save_games_config
    try:
        if steam_root is None:
            from steam_utils import find_steam_root
            steam_root = find_steam_root()
        if user_id is None:
            from steam_utils import get_user_id
            user_id = get_user_id()
    except Exception:
        return []
    if not steam_root:
        return []
    installed = list_installed_games(
        Path(steam_root), read_compat_mapping(Path(steam_root)), read_launch_options(Path(steam_root), user_id),
    )
    root = store_root()
    config = get_games_config(root)
    stored_list = config.get("games", [])
    stored = {g.get("name"): g for g in stored_list}

    if installed:  # skip pruning on an empty scan (e.g. library temporarily unavailable)
        names = {g["name"] for g in installed}
        kept = [g for g in stored_list if g.get("name") in names]
        if len(kept) != len(stored_list):
            try:
                save_games_config({**config, "games": kept}, root)
            except Exception:
                pass

    games = []
    for g in installed:
        entry = dict(stored.get(g["name"]) or {})
        game = {
            **entry,
            "id": f"steam-{g['appid']}",
            "name": g["name"],
            "steam_app_id": g["appid"],
            "library_path": g["library_path"],
            "install_dir": g["install_dir"],
            "prefix_path": g["prefix_path"],
            "has_prefix": g["has_prefix"],
            "size_on_disk": g["size_on_disk"],
            "launch_options": entry["launch_options"] if "launch_options" in entry else g["steam_launch_options"],
            "proton_version": entry["proton_version"] if "proton_version" in entry else g["proton_version"],
            "selected_launchers": entry.get("selected_launchers") or [],
            "collections": entry.get("collections") or [],
        }
        game["steam_snapshot"] = _snapshot({**game, "launch_options": g["steam_launch_options"],
                                            "proton_version": g["proton_version"]})
        games.append(game)
    return games
```

Note on the snapshot: it reflects what Steam's files currently say, so a Deckyfin value that differs from Steam (e.g. after editing but before Apply) shows the Apply button green. After Apply, the frontend writes `steam_snapshot` to the state store, which overrides this (Task 4 keeps the state snapshot for Store games).

Test check: in `test_load_library_games_seeds_from_steam`, store is empty so values equal Steam's → snapshot as asserted. In `test_load_library_games_store_values_win`, `has_prefix` stays computed from Steam.

`py_modules/deckyfin_sources.py`:
- Import: `from deckyfin_consts import SOURCES_FILE, STEAM_SHORTCUTS_SOURCE_ID, STEAM_SHORTCUTS_SOURCE_TYPE, STEAM_LIBRARY_SOURCE_ID, STEAM_LIBRARY_SOURCE_TYPE, BUILTIN_SOURCE_TYPES`
- Append to `_BUILTIN_SOURCES`:

```python
    {
        "id": STEAM_LIBRARY_SOURCE_ID,
        "name": "Steam Library",
        "type": STEAM_LIBRARY_SOURCE_TYPE,
        "builtin": True,
        "enabled": False,
        "path": None,
        "url": None,
    },
```

- `source_config_root`: add before the shortcuts check:

```python
    if source.get("type") == STEAM_LIBRARY_SOURCE_TYPE:
        return get_app_config_path() / "steam_library"
```

- `detect_capabilities` and `get_disk_usage`: change `if t == STEAM_SHORTCUTS_SOURCE_TYPE:` to `if t in BUILTIN_SOURCE_TYPES:`.
- `load_source_games`: after the shortcuts branch add:

```python
    if t == STEAM_LIBRARY_SOURCE_TYPE:
        from deckyfin_steam_library import load_library_games  # local import: avoids cycle
        return load_library_games()
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/ -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add py_modules tests
git commit -m "feat: built-in Steam Library source loading installed Store games"
```

---

### Task 3: Merge Store games into matching source games; prefix-aware helpers

**Files:**
- Modify: `py_modules/deckyfin_steam_shortcuts.py` — replace `attach_orphans_by_name`
- Modify: `py_modules/deckyfin_saves.py` — `get_prefix_path`
- Modify: `py_modules/deckyfin_protontricks.py` — `install_protontricks_dependencies`
- Test: `tests/test_steam_shortcuts.py` (modify), `tests/test_saves_prefix.py` (create)

**Interfaces:**
- Produces:
  - `deckyfin_steam_shortcuts.attach_builtin_games(games: list) -> list` (replaces `attach_orphans_by_name`; main.py import updated in Task 4)
  - `deckyfin_saves.get_prefix_path(app_id: int, library_path: str = None) -> Optional[str]`
  - `deckyfin_protontricks._resolve_prefix_dir(pfxid: str, compatdata_path: Optional[str]) -> tuple[Optional[str], Optional[Path], Optional[str]]` (prefix_dir, steam_root, error)
  - `install_protontricks_dependencies(pfxid, dependencies, timeout=..., compatdata_path: Optional[str] = None)`

- [ ] **Step 1: Write the failing tests**

In `tests/test_steam_shortcuts.py`, rename the two `attach_orphans_by_name` tests to use `mod.attach_builtin_games` (same assertions), and append:

```python
def test_attach_builtin_games_store_game_by_steam_app_id(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    target = _merged("cp", "Cyberpunk Repack", "local")
    target["sources"][0]["config"]["steam_app_id"] = "1091500"
    store = _merged("steam-1091500", "Cyberpunk 2077", "steam_library")
    store["sources"][0]["config"]["steam_app_id"] = 1091500
    out = mod.attach_builtin_games([target, store])
    assert [g["id"] for g in out] == ["cp"]
    assert [s["source_type"] for s in out[0]["sources"]] == ["local", "steam_library"]


def test_attach_builtin_games_store_game_name_fallback(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    target = _merged("w3", "The Witcher 3", "mount")
    store = _merged("steam-292030", "the witcher 3", "steam_library")
    store["sources"][0]["config"]["steam_app_id"] = 292030
    out = mod.attach_builtin_games([target, store])
    assert [g["id"] for g in out] == ["w3"]


def test_attach_builtin_games_builtins_never_merge_together(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    a = _merged("shortcut-1", "Halo", "steam_shortcuts")
    b = _merged("steam-2", "Halo", "steam_library")
    assert mod.attach_builtin_games([a, b]) == [a, b]
```

Create `tests/test_saves_prefix.py`:

```python
"""Tests for library-aware prefix resolution (saves + deps)."""

import sys
from pathlib import Path

_py_modules = str(Path(__file__).resolve().parent.parent / "py_modules")
if _py_modules not in sys.path:
    sys.path.insert(0, _py_modules)


def test_get_prefix_path_with_library(tmp_path):
    import deckyfin_saves
    pfx = tmp_path / "SD" / "steamapps" / "compatdata" / "216150" / "pfx"
    pfx.mkdir(parents=True)
    assert deckyfin_saves.get_prefix_path(216150, str(tmp_path / "SD")) == str(pfx)
    assert deckyfin_saves.get_prefix_path(999, str(tmp_path / "SD")) is None


def test_get_prefix_path_defaults_to_steam_root(tmp_path, monkeypatch):
    import deckyfin_saves, steam_utils
    pfx = tmp_path / "steamapps" / "compatdata" / "7" / "pfx"
    pfx.mkdir(parents=True)
    monkeypatch.setattr(steam_utils, "find_steam_root", lambda: tmp_path)
    assert deckyfin_saves.get_prefix_path(7) == str(pfx)


def test_resolve_prefix_dir_uses_given_compatdata(tmp_path, monkeypatch):
    import deckyfin_protontricks as pt
    cd = tmp_path / "compatdata" / "216150"
    cd.mkdir(parents=True)
    prefix_dir, _root, err = pt._resolve_prefix_dir("216150", str(cd))
    assert prefix_dir == str(cd)
    assert err is None


def test_resolve_prefix_dir_never_creates_given_compatdata(tmp_path, monkeypatch):
    import deckyfin_protontricks as pt

    def boom(*a, **k):
        raise AssertionError("must not create a prefix")

    monkeypatch.setattr(pt, "_init_prefix_for_deps", boom)
    missing = tmp_path / "compatdata" / "1"
    prefix_dir, _root, err = pt._resolve_prefix_dir("1", str(missing))
    assert prefix_dir is None
    assert "launch the game once" in err
    assert not missing.exists()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_steam_shortcuts.py tests/test_saves_prefix.py -v`
Expected: FAIL (`attach_builtin_games` / `_resolve_prefix_dir` missing, `get_prefix_path` takes 1 arg).

- [ ] **Step 3: Implement**

`py_modules/deckyfin_steam_shortcuts.py` — replace `attach_orphans_by_name` entirely (import `STEAM_LIBRARY_SOURCE_TYPE, BUILTIN_SOURCE_TYPES` from `deckyfin_consts` alongside the existing import):

```python
def attach_builtin_games(games: list) -> list:
    """Fold each built-in-only merged game into a matching user-source game.

    `games` is get_games' merged list ({id, name, sources: [{source_type, config}]}).
    Steam Library games match a target whose source config has the same
    steam_app_id, else the same name; Steam Shortcuts orphans match by name.
    Built-in games never merge with each other. Unmatched games stay separate.
    """
    def builtin_only(g):
        return bool(g["sources"]) and all(s["source_type"] in BUILTIN_SOURCE_TYPES for s in g["sources"])

    targets = [g for g in games if not builtin_only(g)]
    by_name = {g["name"].lower(): g for g in targets}
    by_appid = {}
    for g in targets:
        for s in g["sources"]:
            try:
                by_appid.setdefault(int((s.get("config") or {}).get("steam_app_id")), g)
            except (TypeError, ValueError):
                pass

    out = []
    for g in games:
        target = None
        if builtin_only(g):
            store_ids = [
                (s.get("config") or {}).get("steam_app_id")
                for s in g["sources"] if s["source_type"] == STEAM_LIBRARY_SOURCE_TYPE
            ]
            for appid in store_ids:
                try:
                    target = by_appid.get(int(appid))
                except (TypeError, ValueError):
                    target = None
                if target is not None:
                    break
            if target is None:
                target = by_name.get(g["name"].lower())
        if target is not None:
            target["sources"].extend(g["sources"])
        else:
            out.append(g)
    return out
```

`py_modules/deckyfin_saves.py` — replace `get_prefix_path`:

```python
def get_prefix_path(shortcut_app_id: int, library_path: Optional[str] = None) -> Optional[str]:
    """Return the Proton prefix root (pfx/) for an app id, or None if absent.

    `library_path` is the Steam library holding the game (Store games may live on
    another drive); defaults to the Steam root (non-Steam shortcuts).
    """
    if library_path:
        base = library_path
    else:
        from steam_utils import find_steam_root
        base = find_steam_root()
        if not base:
            return None
    path = os.path.join(str(base), "steamapps", "compatdata", str(shortcut_app_id), "pfx")
    return path if os.path.isdir(path) else None
```

`py_modules/deckyfin_protontricks.py` — extract the "Derive prefix directory and steam_root" block of `install_protontricks_dependencies` into a helper and add the parameter:

```python
def _resolve_prefix_dir(pfxid: str, compatdata_path: Optional[str] = None) -> tuple:
    """Return (prefix_dir, steam_root, error).

    With `compatdata_path` (Store games): use it as-is and never create it —
    Steam creates Store prefixes on first launch.
    Without it (shortcuts): <steam root>/steamapps/compatdata/<pfxid>, created
    only when neither native nor flatpak protontricks is available.
    """
    steam_root = None
    try:
        from steam_utils import find_steam_root
        steam_root = find_steam_root()
    except Exception as e:
        logger.warning("Could not find Steam root: %s", e)

    if compatdata_path:
        if Path(compatdata_path).exists():
            return str(compatdata_path), steam_root, None
        return None, steam_root, "Proton prefix not found — launch the game once from Steam first"

    prefix_dir = None
    try:
        from deckyfin_consts import STEAM_STEAMAPPS_FOLDER as _SSAF, COMPATDATA_FOLDER as _CDF
        if steam_root:
            compatdata = steam_root / _SSAF / _CDF / pfxid
            if compatdata.exists():
                prefix_dir = str(compatdata)
            else:
                logger.warning("Prefix directory not found at %s", compatdata)
                # Only create here if neither native nor flatpak is available
                # (both can auto-create the prefix on their own).
                if not shutil.which("protontricks") and not shutil.which("flatpak"):
                    try:
                        _init_prefix_for_deps(compatdata, steam_root)
                        prefix_dir = str(compatdata)
                    except Exception as e2:
                        logger.error("Failed to auto-create prefix: %s", e2)
    except Exception as e:
        logger.warning("Could not derive prefix directory: %s", e)
    return prefix_dir, steam_root, None
```

In `install_protontricks_dependencies`: add parameter `compatdata_path: Optional[str] = None` (after `timeout`), document it in the docstring, and replace the whole "Derive prefix directory and steam_root" block (from `prefix_dir = None` through the outer `except` that logs "Could not derive prefix directory") with:

```python
    prefix_dir, steam_root, prefix_error = _resolve_prefix_dir(pfxid, compatdata_path)
    if prefix_error:
        return {"success": False, "installed": [], "failed": dep_list, "output": "", "errors": [prefix_error]}
```

Read the function's existing return statements first and make sure the error dict uses the same keys as its other returns (`success`, `installed`, `failed`, `output`, `errors`); adjust if they differ. Ensure `Optional` is imported from `typing` in this module.

- [ ] **Step 4: Run tests**

Run: `pytest tests/ -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add py_modules tests
git commit -m "feat: merge Store games by steam_app_id and resolve prefixes per library"
```

---

### Task 4: Backend endpoint wiring (`main.py`)

`main.py` imports `decky` and can't be imported by pytest; verify with `py_compile` plus the full suite. Locate each function by name; line numbers are approximate.

**Files:**
- Modify: `main.py`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces (frontend callables):
  - `get_game` / `update_game_config` work for `steam_library` (store under its own config root)
  - `sync_saves` handles Store games (library prefix, `game://` → `install_dir`)
  - `start_dep_install` passes the Store game's compatdata path
  - New `sync_app_collections(app_id: int, collections: list, old_collections: list) -> {success, error?}`

- [ ] **Step 1: Imports**

- `from deckyfin_consts import APP_NAME, APP_VERSION, STEAM_SHORTCUTS_SOURCE_TYPE` → add `STEAM_LIBRARY_SOURCE_TYPE, BUILTIN_SOURCE_TYPES`.
- `from deckyfin_steam_shortcuts import upsert_store_entry as _upsert_shortcut_store_entry, attach_orphans_by_name as _attach_orphans_by_name` → `upsert_store_entry as _upsert_builtin_store_entry, attach_builtin_games as _attach_builtin_games`.
- In `get_games`, replace `_attach_orphans_by_name(` with `_attach_builtin_games(` and update the comment to "Built-in games (orphans, Store games) matching a source game become extra sources of it".

- [ ] **Step 2: Snapshot overlay helper** — add a module-level helper near the other helpers (above the `Plugin` class):

```python
def _builtin_state(source: dict, name: str) -> dict:
    """State-store overlay for a built-in source's game.

    Steam Shortcuts: shortcuts.vdf is the truth for Steam fields, so the stored
    steam_snapshot is dropped. Steam Library: the last Apply's snapshot wins
    (Steam writes its files lazily after live API changes).
    """
    state = get_game_state(source["id"], name)
    if source.get("type") == STEAM_SHORTCUTS_SOURCE_TYPE:
        state = {k: v for k, v in state.items() if k != "steam_snapshot"}
    return state
```

In `get_games`, the existing block

```python
                state = get_game_state(source["id"], name)
                if state and source.get("type") == STEAM_SHORTCUTS_SOURCE_TYPE:
                    # shortcuts.vdf is the source of truth for orphans' Steam fields
                    state = {k: v for k, v in state.items() if k != "steam_snapshot"}
```

becomes

```python
                state = _builtin_state(source, name) if source.get("builtin") else get_game_state(source["id"], name)
```

- [ ] **Step 3: `get_game` / `update_game_config`** — change both `if source.get("type") == STEAM_SHORTCUTS_SOURCE_TYPE:` branches to `if source.get("type") in BUILTIN_SOURCE_TYPES:`; inside them replace each `{k: v for k, v in get_game_state(source["id"], name).items() if k != "steam_snapshot"}` with `_builtin_state(source, name)`; and replace `_upsert_shortcut_store_entry(name, config_updates)` with `_upsert_builtin_store_entry(name, config_updates, _source_config_root(source))`.

- [ ] **Step 4: `sync_saves`** — after `is_shortcut = ...` add `is_store = source.get("type") == STEAM_LIBRARY_SOURCE_TYPE`. Replace the `if is_shortcut: ... else: ...` game-folder block with:

```python
            library_path = None
            if is_shortcut:
                # Orphan shortcuts have no game folder; prefix and userdata:// paths still work
                if any(p.startswith("game://") for p in sync_paths):
                    return {"success": False, "error": "This game has no game folder — game:// save paths aren't supported for Steam Shortcuts"}
                game_folder = None
            elif is_store:
                info = next((g for g in _load_source_games(source) if g.get("name") == game_name), None)
                if not info:
                    return {"success": False, "error": f"'{game_name}' is not installed"}
                game_folder = info.get("install_dir")
                library_path = info.get("library_path")
            else:
                game_rel = cfg.get("path")
                if not game_rel:
                    return {"success": False, "error": "Game folder path not set in config"}
                game_folder = os.path.join(root, game_rel)
```

and change `prefix_path = get_prefix_path(shortcut_app_id) if has_prefix_paths else None` to `prefix_path = get_prefix_path(shortcut_app_id, library_path) if has_prefix_paths else None`. For Store games the "not found" message should read "launch the game once from Steam first": change the following error line to

```python
            if has_prefix_paths and not prefix_path:
                hint = "launch the game once from Steam first" if is_store else "init the prefix first"
                return {"success": False, "error": f"Proton prefix not found for app {shortcut_app_id} — {hint}"}
```

(`cfg` may be `None` for Store games with no stored entry; the existing `if not sync_paths` check already returns before it is dereferenced — verify `if not cfg and not is_shortcut` becomes `if not cfg and not (is_shortcut or is_store)`.)

- [ ] **Step 5: `start_dep_install`** — before the background thread starts, compute:

```python
        compatdata_path = None
        src = _get_source_by_id(source_id)
        if src and src.get("type") == STEAM_LIBRARY_SOURCE_TYPE:
            info = next((g for g in _load_source_games(src) if g.get("name") == game_name), None)
            if not info:
                return {"success": False, "error": f"'{game_name}' is not installed"}
            compatdata_path = os.path.join(info["library_path"], "steamapps", "compatdata", str(info["steam_app_id"]))
```

and change the call to `install_protontricks_dependencies(pfxid, dependencies, timeout=1200, compatdata_path=compatdata_path)`. Read the function first; place the lookup before the registry entry is marked "installing" so an error doesn't leave a stuck entry.

- [ ] **Step 6: `sync_app_collections`** — add near the other Steam actions:

```python
    async def sync_app_collections(self, app_id: int, collections: list, old_collections: Optional[list] = None) -> dict:
        """Write a Store game's Steam collections (takes effect after a Steam restart)."""
        try:
            from steam_games import _sync_user_collections
            _sync_user_collections(get_user_id(), int(app_id), collections or None, old_collections or None)
            self._set_needs_restart_flag(True)
            return {"success": True}
        except Exception as e:
            _debug(f"sync_app_collections: {e!r}")
            return {"success": False, "error": str(e)}
```

Check `_sync_user_collections`'s expectations for `app_id` (read its body): if it converts signed shortcut ids, confirm a positive Store appid passes through unchanged.

- [ ] **Step 7: Verify and commit**

Run: `python -m py_compile main.py && pytest tests/ -v` — no compile output; all PASS.

```bash
git add main.py
git commit -m "feat: wire Steam Library source into backend endpoints"
```

---

### Task 5: Frontend types, labels, Settings card, library detection

**Files:**
- Modify: `src/types.ts`, `src/sourceStyle.ts`, `src/components/SettingsPage.tsx`, `src/components/GameLibrary.tsx`

**Interfaces:**
- Produces: `SourceType` includes `"steam_library"`; `GameConfig` gains `library_path?, install_dir?, prefix_path?, has_prefix?, size_on_disk?`; `SteamClientApps` gains `SpecifyCompatTool`, `SetAppLaunchOptions`; `sourceStyle.isBuiltinSourceType(type)`.

- [ ] **Step 1: Types** — `src/types.ts`:
  - `export type SourceType = "local" | "mount" | "agent" | "steam_shortcuts" | "steam_library";`
  - In `GameConfig` add:

```ts
  /** Steam Library (Store) games only. */
  library_path?: string;
  install_dir?: string;
  prefix_path?: string | null;
  has_prefix?: boolean;
  size_on_disk?: number;
```

  - In the global `SteamClientApps` interface add:

```ts
    SpecifyCompatTool(appId: number, toolName: string): void;
    SetAppLaunchOptions(appId: number, options: string): void;
```

- [ ] **Step 2: `src/sourceStyle.ts`** — labels and helper:

```ts
/** Built-in sources (Steam Shortcuts, Steam Library) — no folder, not removable. */
export function isBuiltinSourceType(type: SourceType): boolean {
  return type === "steam_shortcuts" || type === "steam_library";
}

/** Short label shown in source type pills. */
export function sourceTypeLabel(type: SourceType): string {
  if (type === "steam_shortcuts") return "shortcut";
  if (type === "steam_library") return "steam";
  return type;
}
```

and in `sourceTypeColors` make `case "steam_shortcuts": case "steam_library":` share the Steam blue entry.

- [ ] **Step 3: Settings card** — in `SettingsPage.tsx`, the built-in count line currently renders `` `${n} orphan shortcut${n === 1 ? "" : "s"}` ``. Make the noun depend on type: `steam_library` → `installed game(s)`, otherwise `orphan shortcut(s)`.

- [ ] **Step 4: Library** — `GameLibrary.tsx` line ~178: `builtin: s.source_type === "steam_shortcuts"` → `builtin: isBuiltinSourceType(s.source_type)` (import from `../sourceStyle`).

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit -p . && npm run build` — no errors; `created dist`.

```bash
git add src
git commit -m "feat: Steam Library types, labels and settings card"
```

---

### Task 6: Game page Store-game mode (`GameDetail.tsx`)

GameDetail.tsx is ~3200 lines; search for the quoted code, read the surrounding block before editing, and keep non-built-in behaviour unchanged.

**Files:**
- Modify: `src/components/GameDetail.tsx`

**Interfaces:**
- Consumes: `sync_app_collections` (Task 4), `GameConfig` Store fields and `SteamClientApps` methods (Task 5).

- [ ] **Step 1: Flags** — next to `const isShortcutSource = ...`:

```ts
  const isLibrarySource = selectedSource?.source_type === "steam_library";
  const isBuiltinSource = isShortcutSource || isLibrarySource;
  // Store games: prefix-dependent actions only once a prefix exists or Proton is forced
  const hasPrefix = !isLibrarySource || !!currentConfig.has_prefix;
```

- [ ] **Step 2: steamInfo per selected source** — replace the effect that starts `const cached = getCachedSteamInfo(game.name);` (deps `[game.name]`) with:

```ts
  useEffect(() => {
    if (isLibrarySource) {
      const id = Number(currentConfig.steam_app_id);
      setSteamInfo(id ? { app_id: id, unsigned_appid: id } : null);
      return;
    }
    const cached = getCachedSteamInfo(game.name);
    if (cached !== undefined) { setSteamInfo(cached); return; }
    getSteamShortcut(game.name)
      .then((res) => {
        if (res.success && res.app_id && res.unsigned_appid) {
          const info = { app_id: res.app_id, unsigned_appid: res.unsigned_appid };
          setCachedSteamInfo(game.name, info);
          setSteamInfo(info);
        } else {
          setCachedSteamInfo(game.name, null);
          setSteamInfo(null);
        }
      })
      .catch(() => {});
  }, [game.name, selectedSource?.source_id]);
```

- [ ] **Step 3: Game Settings fields**
  - Name read-only: change `{isShortcutSource ? (` around the name field to `{isBuiltinSource ? (`.
  - Hide the Executable field (with its Browse/exe picker) and the Start Directory field for Store games: wrap each in `{!isLibrarySource && (...)}`.
  - Collections: change the `syncAppCollections` callable declaration (Step 5) — no change to the field itself.

- [ ] **Step 4: Metadata** — in the metadata rows array (contains `["Proton Version", ...]`), when `isLibrarySource` add rows `["Install Folder", currentConfig.install_dir || "—"]` and `["Library", currentConfig.library_path || "—"]` (e.g. spread `...(isLibrarySource ? [[...], [...]] : [])` into the array, matching its tuple type).

- [ ] **Step 5: Apply to Steam** — add the callable with the others:

```ts
const syncAppCollections = callable<[app_id: number, collections: string[], old_collections: string[]], { success: boolean; error?: string }>("sync_app_collections");
```

Add a handler next to `handleUpdateSteam` (read `handleUpdateSteam` first and reuse exactly the same local values it uses for the final launch-options string and merged collections — e.g. `finalLaunchOptions`, `mergedCollections`, `protonVersion`, `storedName`):

```ts
  const handleApplyToSteamLibrary = async () => {
    if (!steamInfo) return;
    setLoading("update");
    setFeedback(null);
    const appid = steamInfo.unsigned_appid;
    const finalLaunchOptions = /* same expression handleUpdateSteam uses */;
    const snapshot = { name, launch_options: finalLaunchOptions || null, proton_version: protonVersion || null, collections: mergedCollections };
    try {
      SteamClient.Apps.SpecifyCompatTool(appid, protonVersion || "");
      SteamClient.Apps.SetAppLaunchOptions(appid, finalLaunchOptions || "");
      const prevCollections: string[] = lastSyncedSnapshot?.collections ?? [];
      if (JSON.stringify(prevCollections) !== JSON.stringify(mergedCollections)) {
        const res = await syncAppCollections(appid, mergedCollections, prevCollections);
        if (!res.success) throw new Error(res.error || "Failed to update collections");
        onNeedsRestart?.();
      }
      setLastSyncedSnapshot(snapshot);
      updateGameConfig(storedName, { steam_snapshot: JSON.stringify(snapshot) }, selectedSource.source_id).catch(() => {});
      setFeedback({ ok: true, msg: "Applied to Steam" });
    } catch (err: any) {
      setFeedback({ ok: false, msg: err?.message || "Failed to apply to Steam" });
    }
    setLoading(null);
  };
```

The snapshot key order (`name, launch_options, proton_version, collections`) must match the `steamNeedsSync` comparison object once `executable`/`start_dir` (undefined for Store games) are dropped; check `steamNeedsSync` and adjust `null`/`undefined` normalisation so an unchanged game compares equal.

In the Steam Actions section:
  - When `isLibrarySource`, render the main button as "Apply to Steam" (`loading === "update" ? "Applying…" : "Apply to Steam"`) with `onActivate`/`onClick` = `handleApplyToSteamLibrary`, keeping the same green-when-`steamNeedsSync` styling; otherwise keep the existing Add/Update button unchanged.
  - When `isLibrarySource`, replace the description paragraph text with: "Apply Proton version and launch options to Steam instantly. Collection changes need a Steam restart."
  - Keep the Restart Steam button.

- [ ] **Step 6: Prefix Actions**
  - Hide the Init Prefix button (and its reinit confirm) when `isLibrarySource`.
  - Hide the "🔒 Add game to Steam first" notice when `isLibrarySource`.
  - When `isLibrarySource && !hasPrefix`, show a notice in the same style: "No Proton prefix yet — pick a Proton version and launch once from Steam."
  - Install Dependencies: treat `!hasPrefix` like the existing disabled conditions (no-op handler, opacity 0.4); also add `if (!hasPrefix) return;` at the top of `handleInstallDeps`.

- [ ] **Step 7: Saves and transfers**
  - Save Paths section, Save Actions section, and the Copy Saves block: add `hasPrefix &&` to their rendering conditions; also add `hasPrefix &&` to the `(copySavesDests.length > 0 && syncPaths.length > 0)` term of the Transfer Actions visibility condition.
  - Replace `isShortcutSource` with `isBuiltinSource` where it hides Copy Game / Copy Config / the Transfer section's non-saves part and the "Remove game from source" block. Keep `isShortcutSource` for shortcut-only behaviour (exe picker root, launcher chips hidden, back-navigation after Remove/Purge, the "Add to Steam" gating).
  - The "Game Folder" save-path chip stays available for Store games (`install_dir` exists) — it is only hidden for `isShortcutSource`.

- [ ] **Step 8: Danger zone** — hide "Remove from Steam" and "Purge All Steam Data" for Store games: their blocks render under `steamInfo && (`; change to `!isLibrarySource && steamInfo && (`.

- [ ] **Step 9: Verify and commit**

Run: `npx tsc --noEmit -p . && npm run build` — no errors; `created dist`.

```bash
git add src/components/GameDetail.tsx
git commit -m "feat: Store-game mode on the game page with live Apply to Steam"
```

---

### Task 7: End-to-end verification

- [ ] **Step 1:** `pytest tests/ -v` — all PASS; `python -m py_compile main.py`.
- [ ] **Step 2:** `npm run build` — `created dist`.
- [ ] **Step 3:** Read-only smoke test on this machine:

```bash
cd py_modules && python3 -c "
from deckyfin_steam_library import load_library_games
for g in load_library_games(): print(g['id'], g['name'], g['library_path'], 'prefix' if g['has_prefix'] else 'no-prefix', g['proton_version'])
"
```

Expected: MapleStory, The Witcher 3, GunZ (no Proton/Runtime/Redistributables).
- [ ] **Step 4 (manual, user):** `./deploy.sh`, enable Steam Library in Settings ("N installed games"), open a Store game: name read-only, no exe fields, Apply to Steam changes Proton/launch options without restart, deps install into the correct prefix, Backup/Copy Saves work, no Remove/Purge.
