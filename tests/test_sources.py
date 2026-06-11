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
