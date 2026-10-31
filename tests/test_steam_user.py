"""Tests for logged-in Steam account detection (multi-account installs)."""

import sys
from pathlib import Path

_py_modules = str(Path(__file__).resolve().parent.parent / "py_modules")
if _py_modules not in sys.path:
    sys.path.insert(0, _py_modules)

import pytest

BASE = 76561197960265728


def _steam_root(tmp_path, users: dict, folders=("808327172", "892854676", "0")):
    root = tmp_path / "Steam"
    (root / "config").mkdir(parents=True)
    for f in folders:
        (root / "userdata" / f).mkdir(parents=True)
    body = ""
    for sid, fields in users.items():
        body += f'\t"{sid}"\n\t{{\n' + "".join(f'\t\t"{k}"\t\t"{v}"\n' for k, v in fields.items()) + "\t}\n"
    (root / "config" / "loginusers.vdf").write_text('"users"\n{\n' + body + "}\n")
    return root


@pytest.fixture
def su(monkeypatch):
    import importlib, steam_utils
    importlib.reload(steam_utils)
    yield steam_utils
    steam_utils.set_active_steam_user(None)


def test_loginusers_prefers_most_recent_flag(tmp_path, su):
    root = _steam_root(tmp_path, {
        str(BASE + 808327172): {"MostRecent": "1", "timestamp": "100"},
        str(BASE + 892854676): {"timestamp": "200"},
    })
    assert su.find_logged_in_user_from_loginusers(root) == "808327172"


def test_loginusers_without_most_recent_uses_newest_timestamp(tmp_path, su):
    """Current Steam no longer writes MostRecent — newest login wins."""
    root = _steam_root(tmp_path, {
        str(BASE + 892854676): {"AutoLogin": "1", "timestamp": "1793416600"},
        str(BASE + 808327172): {"AutoLogin": "0", "timestamp": "1783179556"},
    })
    assert su.find_logged_in_user_from_loginusers(root) == "892854676"


def test_loginusers_timestamp_tie_prefers_autologin(tmp_path, su):
    root = _steam_root(tmp_path, {
        str(BASE + 808327172): {"AutoLogin": "0", "timestamp": "5"},
        str(BASE + 892854676): {"AutoLogin": "1", "timestamp": "5"},
    })
    assert su.find_logged_in_user_from_loginusers(root) == "892854676"


def test_get_user_id_uses_active_user_reported_by_steam(tmp_path, su, monkeypatch):
    root = _steam_root(tmp_path, {str(BASE + 808327172): {"timestamp": "999"}})
    monkeypatch.setattr(su, "find_steam_root", lambda: root)
    assert su.set_active_steam_user(str(BASE + 892854676)) == "892854676"
    assert su.get_user_id() == "892854676"


def test_active_user_ignored_when_folder_missing(tmp_path, su, monkeypatch):
    root = _steam_root(tmp_path, {str(BASE + 808327172): {"timestamp": "999"}})
    monkeypatch.setattr(su, "find_steam_root", lambda: root)
    su.set_active_steam_user(str(BASE + 123))
    assert su.get_user_id() == "808327172"


def test_set_active_steam_user_rejects_garbage(su):
    assert su.set_active_steam_user("not-a-number") is None
    assert su.set_active_steam_user("") is None
    assert su.set_active_steam_user(None) is None


def test_get_user_id_never_picks_folder_zero(tmp_path, su, monkeypatch):
    root = tmp_path / "Steam"
    (root / "userdata" / "0").mkdir(parents=True)
    (root / "userdata" / "892854676").mkdir(parents=True)
    monkeypatch.setattr(su, "find_steam_root", lambda: root)
    assert su.get_user_id() == "892854676"
