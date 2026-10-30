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
    calls = []

    def load(source):
        calls.append(source["id"])
        return [{"name": n} for n in {"a": ["Halo"], "b": ["Doom"]}.get(source["id"], [])]

    names, paths = mod.build_ownership(SOURCES, load)
    # Disabled source b contributes its path (so its games aren't flagged as
    # orphans) but is never loaded, so its name doesn't show up.
    assert names == {"halo"}
    assert paths == ["/games", "/mnt/nas/games"]
    assert calls == ["a"]


def test_build_ownership_skips_agent_source_entirely(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    sources = SOURCES + [
        {"id": "c", "type": "agent", "url": "http://x", "enabled": True, "builtin": False},
    ]
    calls = []

    def load(source):
        calls.append(source["id"])
        if source["id"] == "c":
            return [{"name": "ShouldNotAppear"}]
        return [{"name": n} for n in {"a": ["Halo"]}.get(source["id"], [])]

    names, paths = mod.build_ownership(sources, load)
    assert names == {"halo"}
    assert "shouldnotappear" not in names
    assert paths == ["/games", "/mnt/nas/games"]
    assert "c" not in calls


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


def test_load_shortcut_games_drops_stored_selected_launchers(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    _write_store(tmp_path, [{"name": "Leftover", "selected_launchers": ["MangoHud"]}])
    monkeypatch.setattr(mod, "list_nonsteam_games", lambda: [
        _sc("Leftover", "/old/l.exe", 42, launch_options="mangohud %command%"),
    ])
    games = mod.load_shortcut_games(SOURCES, _loader({}))
    assert len(games) == 1
    # The VDF launch_options string already contains the launcher prefix; a
    # surviving stored selected_launchers would make GameDetail's
    # buildLaunchOptions prepend it a second time on every Update.
    assert games[0]["selected_launchers"] == []


def test_snapshot_normalizes_empty_start_dir_and_launch_options_to_null(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    monkeypatch.setattr(mod, "list_nonsteam_games", lambda: [
        _sc("Leftover", "/old/l.exe", 42, start_dir="", launch_options=""),
    ])
    games = mod.load_shortcut_games(SOURCES, _loader({}))
    snapshot = json.loads(games[0]["steam_snapshot"])
    assert snapshot["start_dir"] is None
    assert snapshot["launch_options"] is None


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
