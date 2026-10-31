"""Tests for deckyfin_updates — installed build, release parsing, comparison."""

import io
import json
import sys
from pathlib import Path

_py_modules = str(Path(__file__).resolve().parent.parent / "py_modules")
if _py_modules not in sys.path:
    sys.path.insert(0, _py_modules)

import pytest


def _plugin_dir(tmp_path, data):
    d = tmp_path / "plugin"
    d.mkdir()
    (d / "plugin.json").write_text(json.dumps(data))
    return d


@pytest.fixture
def up(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    import importlib, deckyfin_config, deckyfin_updates
    importlib.reload(deckyfin_config)
    importlib.reload(deckyfin_updates)
    return deckyfin_updates


def test_read_installed_build_main(tmp_path, up):
    d = _plugin_dir(tmp_path, {"version": "0.1.8+main.abc1234",
                               "deckyfin_build": {"channel": "main", "commit": "abc1234def", "built_at": "2026-10-31T10:00:00Z"}})
    assert up.read_installed_build(d) == {"version": "0.1.8+main.abc1234", "channel": "main",
                                          "commit": "abc1234def", "built_at": "2026-10-31T10:00:00Z"}


def test_read_installed_build_dev(tmp_path, up):
    d = _plugin_dir(tmp_path, {"version": "0.1.0"})
    assert up.read_installed_build(d) == {"version": "0.1.0", "channel": None, "commit": None, "built_at": None}


def test_read_installed_build_missing_file(tmp_path, up):
    assert up.read_installed_build(tmp_path / "nope")["version"] == "unknown"


REL = {
    "tag_name": "v0.1.9", "published_at": "2026-10-30T12:00:00Z", "html_url": "https://github.com/x/y/releases/tag/v0.1.9",
    "assets": [{"name": "deckyfin.zip", "browser_download_url": "https://github.com/x/y/releases/download/v0.1.9/deckyfin.zip"},
               {"name": "version.json", "browser_download_url": "https://example/version.json"}],
}


def test_parse_release_with_version_info(up):
    info = {"version": "0.1.9", "channel": "stable", "commit": "fff000", "built_at": "t"}
    assert up.parse_release(REL, info) == {
        "version": "0.1.9", "commit": "fff000", "published_at": "2026-10-30T12:00:00Z",
        "zip_url": "https://github.com/x/y/releases/download/v0.1.9/deckyfin.zip",
        "html_url": "https://github.com/x/y/releases/tag/v0.1.9",
    }


def test_parse_release_without_version_info_uses_tag(up):
    assert up.parse_release(REL, None)["version"] == "0.1.9"
    assert up.parse_release(REL, None)["commit"] is None


def test_parse_release_without_zip(up):
    assert up.parse_release({**REL, "assets": []}, None) is None


@pytest.mark.parametrize("installed,latest,channel,expected", [
    ({"version": "0.1.8", "channel": "stable", "commit": "a"}, {"version": "0.1.9", "commit": "b"}, "stable", "update_available"),
    ({"version": "0.1.9", "channel": "stable", "commit": "b"}, {"version": "0.1.9", "commit": "b"}, "stable", "up_to_date"),
    ({"version": "0.1.10", "channel": "stable", "commit": "c"}, {"version": "0.1.9", "commit": "b"}, "stable", "up_to_date"),
    ({"version": "0.1.8+main.abc", "channel": "main", "commit": "abc"}, {"version": "0.1.8", "commit": "x"}, "stable", "update_available"),
    ({"version": "0.1.0", "channel": None, "commit": None}, {"version": "0.1.8", "commit": "x"}, "stable", "update_available"),
    ({"version": "0.1.9", "channel": None, "commit": None}, {"version": "0.1.9", "commit": "x"}, "stable", "up_to_date"),
    ({"version": "0.1.8+main.abc", "channel": "main", "commit": "abc"}, {"version": "0.1.8+main.def", "commit": "def"}, "main", "update_available"),
    ({"version": "0.1.8+main.abc", "channel": "main", "commit": "abc"}, {"version": "0.1.8+main.abc", "commit": "abc"}, "main", "up_to_date"),
    ({"version": "0.1.0", "channel": None, "commit": None}, {"version": "0.1.8+main.def", "commit": "def"}, "main", "update_available"),
    ({"version": "0.1.8", "channel": "stable", "commit": "a"}, None, "stable", "unknown"),
])
def test_compare_builds(up, installed, latest, channel, expected):
    assert up.compare_builds(installed, latest, channel) == expected


REL_MAIN_NO_VERSION_JSON = {
    "tag_name": "latest-main",
    "name": "Latest main (0.1.8+main.9ea1504)",
    "body": "Rolling build of main at 9ea15049c1a2b3c4d5e6f708192a3b4c5d6e7f80. Not a stable release.",
    "published_at": "2026-10-30T12:00:00Z",
    "html_url": "https://github.com/x/y/releases/tag/latest-main",
    "assets": [{"name": "deckyfin.zip", "browser_download_url": "https://x/deckyfin.zip"}],
}


def test_parse_release_recovers_version_and_commit_from_name_and_body(up):
    result = up.parse_release(REL_MAIN_NO_VERSION_JSON, None)
    assert result["version"] == "0.1.8+main.9ea1504"
    # Full 40-hex sha from the body is preferred over the 7-char one in the name.
    assert result["commit"] == "9ea15049c1a2b3c4d5e6f708192a3b4c5d6e7f80"


def test_parse_release_recovers_version_from_name_when_body_has_no_sha(up):
    rel = {**REL_MAIN_NO_VERSION_JSON, "body": "no sha here"}
    result = up.parse_release(rel, None)
    assert result["version"] == "0.1.8+main.9ea1504"
    assert result["commit"] == "9ea1504"


def test_parse_release_commit_unknown_when_name_and_body_dont_match(up):
    rel = {**REL_MAIN_NO_VERSION_JSON, "name": "something else", "body": "no sha here"}
    result = up.parse_release(rel, None)
    assert result["commit"] is None
    assert result["version"] == "latest-main"  # falls back to the tag, not the recovered version


def test_parse_release_version_info_commit_wins_over_recovery(up):
    result = up.parse_release(REL_MAIN_NO_VERSION_JSON, {"version": "0.1.8+main.real", "commit": "realcommit"})
    assert result["version"] == "0.1.8+main.real"
    assert result["commit"] == "realcommit"


def test_compare_builds_main_unknown_when_latest_commit_cant_be_determined(up):
    installed = {"version": "0.1.8+main.abc1234", "channel": "main", "commit": "abc1234def"}
    latest = {"version": "latest-main", "commit": None}
    assert up.compare_builds(installed, latest, "main") == "unknown"


def test_repo_slug(tmp_path, up):
    d = _plugin_dir(tmp_path, {"publish": {"website": "https://github.com/avivkilloz/deckyfin"}})
    assert up.repo_slug(d) == "avivkilloz/deckyfin"
    assert up.repo_slug(tmp_path / "missing") == "avivkilloz/deckyfin"


def test_update_channel_setting(tmp_path, up):
    assert up.get_update_channel() == "stable"
    assert up.set_update_channel("main") is True
    assert up.get_update_channel() == "main"
    assert up.set_update_channel("beta") is False
    assert up.get_update_channel() == "main"


class _Resp(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *a): return False


def test_fetch_latest_main_reads_version_json(up):
    calls = []

    def opener(req, timeout=None):
        url = req.full_url if hasattr(req, "full_url") else req
        calls.append(url)
        if url.endswith("/releases/tags/latest-main"):
            return _Resp(json.dumps({**REL, "tag_name": "latest-main"}).encode())
        if url == "https://example/version.json":
            return _Resp(json.dumps({"version": "0.1.9+main.fff", "commit": "fff"}).encode())
        raise AssertionError(url)

    res = up.fetch_latest("main", "x/y", opener=opener)
    assert res["error"] is None
    assert res["latest"]["version"] == "0.1.9+main.fff"
    assert res["latest"]["commit"] == "fff"
    assert calls[0] == "https://api.github.com/repos/x/y/releases/tags/latest-main"


def test_fetch_latest_network_error(up):
    def opener(req, timeout=None):
        raise OSError("offline")
    res = up.fetch_latest("stable", "x/y", opener=opener)
    assert res["latest"] is None and "offline" in res["error"]


def test_fetch_latest_rate_limited(up):
    import urllib.error

    def opener(req, timeout=None):
        headers = {"X-RateLimit-Remaining": "0"}
        raise urllib.error.HTTPError(getattr(req, "full_url", req), 403, "Forbidden", headers, None)

    res = up.fetch_latest("stable", "x/y", opener=opener)
    assert res["latest"] is None
    assert res["error"] == "GitHub rate limit reached — try again later"


def test_fetch_latest_403_without_rate_limit_header_is_generic(up):
    import urllib.error

    def opener(req, timeout=None):
        raise urllib.error.HTTPError(getattr(req, "full_url", req), 403, "Forbidden", {}, None)

    res = up.fetch_latest("stable", "x/y", opener=opener)
    assert res["latest"] is None
    assert res["error"] == "GitHub returned HTTP 403"


def test_fetch_latest_missing_release(up):
    import urllib.error

    def opener(req, timeout=None):
        raise urllib.error.HTTPError(getattr(req, "full_url", req), 404, "Not Found", {}, None)
    res = up.fetch_latest("main", "x/y", opener=opener)
    assert res["latest"] is None and res["error"] == "No build on this channel yet"


def test_fetch_latest_default_opener_passes_ssl_context(up, monkeypatch):
    """The default opener (used when `fetch_latest` is called without an
    injected `opener`) must pass an SSL context — the Decky sandbox on
    Arch-based systems (SteamOS included) often can't find system CA certs,
    so a plain urlopen() raises SSLCertVerificationError. No real network
    call happens: urlopen itself is monkeypatched."""
    captured = {}

    def fake_urlopen(req, context=None, timeout=None):
        captured["context"] = context
        captured["url"] = req.full_url if hasattr(req, "full_url") else req
        return _Resp(json.dumps({**REL, "assets": []}).encode())

    monkeypatch.setattr(up.urllib.request, "urlopen", fake_urlopen)

    res = up.fetch_latest("stable", "x/y")

    assert captured["url"] == "https://api.github.com/repos/x/y/releases/latest"
    assert captured["context"] is not None
    assert res == {"latest": None, "error": "No build on this channel yet"}
