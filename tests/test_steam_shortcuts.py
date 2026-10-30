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
