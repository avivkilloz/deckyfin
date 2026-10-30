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
