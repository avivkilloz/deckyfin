"""Tests for deckyfin_hidden — hidden games list and bulk-action skip filter."""

import importlib
import json
import sys
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


def _reload(tmp_path, monkeypatch):
    """Point HOME at tmp_path and (re)import deckyfin_config/deckyfin_hidden fresh."""
    monkeypatch.setenv("HOME", str(tmp_path))
    import deckyfin_config
    import deckyfin_hidden
    importlib.reload(deckyfin_config)
    importlib.reload(deckyfin_hidden)
    return deckyfin_hidden


def test_get_hidden_games_empty(tmp_path, monkeypatch):
    """get_hidden_games returns [] when no hidden_games key in config."""
    _make_app_config(tmp_path, {})
    deckyfin_hidden = _reload(tmp_path, monkeypatch)
    assert deckyfin_hidden.get_hidden_games() == []


def test_set_game_hidden_true_adds(tmp_path, monkeypatch):
    """set_game_hidden(id, True) adds the id to the hidden list."""
    _make_app_config(tmp_path, {})
    deckyfin_hidden = _reload(tmp_path, monkeypatch)
    result = deckyfin_hidden.set_game_hidden("my-game", True)
    assert result == ["my-game"]
    assert deckyfin_hidden.get_hidden_games() == ["my-game"]


def test_set_game_hidden_idempotent(tmp_path, monkeypatch):
    """Hiding the same id twice doesn't duplicate it."""
    _make_app_config(tmp_path, {})
    deckyfin_hidden = _reload(tmp_path, monkeypatch)
    deckyfin_hidden.set_game_hidden("my-game", True)
    result = deckyfin_hidden.set_game_hidden("my-game", True)
    assert result == ["my-game"]


def test_set_game_hidden_false_unhides(tmp_path, monkeypatch):
    """set_game_hidden(id, False) removes the id from the hidden list."""
    _make_app_config(tmp_path, {})
    deckyfin_hidden = _reload(tmp_path, monkeypatch)
    deckyfin_hidden.set_game_hidden("my-game", True)
    result = deckyfin_hidden.set_game_hidden("my-game", False)
    assert result == []
    assert deckyfin_hidden.get_hidden_games() == []


def test_set_game_hidden_unhide_unknown_is_noop(tmp_path, monkeypatch):
    """Unhiding an id that was never hidden is a no-op, not an error."""
    _make_app_config(tmp_path, {})
    deckyfin_hidden = _reload(tmp_path, monkeypatch)
    result = deckyfin_hidden.set_game_hidden("never-hidden", False)
    assert result == []


def test_set_game_hidden_dedups_existing_corrupt_list(tmp_path, monkeypatch):
    """Dedup applies even if the stored list already had a duplicate."""
    _make_app_config(tmp_path, {"hidden_games": ["a", "a", "b"]})
    deckyfin_hidden = _reload(tmp_path, monkeypatch)
    result = deckyfin_hidden.set_game_hidden("c", True)
    assert sorted(result) == ["a", "b", "c"]


def test_hidden_games_persist_across_reload(tmp_path, monkeypatch):
    """Hidden list is read back correctly after a fresh module import (simulated restart)."""
    _make_app_config(tmp_path, {})
    deckyfin_hidden = _reload(tmp_path, monkeypatch)
    deckyfin_hidden.set_game_hidden("persisted-game", True)

    deckyfin_hidden_reloaded = _reload(tmp_path, monkeypatch)
    assert deckyfin_hidden_reloaded.get_hidden_games() == ["persisted-game"]


def test_set_game_hidden_rejects_invalid_game_id(tmp_path, monkeypatch):
    """Non-string or empty game_id is rejected (no-op, current list returned unchanged)."""
    _make_app_config(tmp_path, {"hidden_games": ["existing"]})
    deckyfin_hidden = _reload(tmp_path, monkeypatch)
    assert deckyfin_hidden.set_game_hidden("", True) == ["existing"]
    assert deckyfin_hidden.set_game_hidden(None, True) == ["existing"]
    assert deckyfin_hidden.get_hidden_games() == ["existing"]


# ── filter_hidden (pure helper used by batch_add_to_steam / backup_all_saves) ──

def test_filter_hidden_skips_hidden_by_id(tmp_path, monkeypatch):
    deckyfin_hidden = _reload(tmp_path, monkeypatch)
    games = [
        {"id": "game-a", "name": "Game A"},
        {"id": "game-b", "name": "Game B"},
    ]
    visible, skipped = deckyfin_hidden.filter_hidden(games, {"game-b"})
    assert visible == [{"id": "game-a", "name": "Game A"}]
    assert skipped == ["Game B"]


def test_filter_hidden_no_hidden_ids_returns_all(tmp_path, monkeypatch):
    deckyfin_hidden = _reload(tmp_path, monkeypatch)
    games = [{"id": "game-a", "name": "Game A"}]
    visible, skipped = deckyfin_hidden.filter_hidden(games, set())
    assert visible == games
    assert skipped == []


def test_filter_hidden_derives_id_like_get_games(tmp_path, monkeypatch):
    """Games without a precomputed id fall back to slugify(path or name), matching get_games."""
    deckyfin_hidden = _reload(tmp_path, monkeypatch)
    games = [{"name": "My Game", "path": "My Game Folder"}]
    visible, skipped = deckyfin_hidden.filter_hidden(games, {"my-game-folder"})
    assert visible == []
    assert skipped == ["My Game"]
