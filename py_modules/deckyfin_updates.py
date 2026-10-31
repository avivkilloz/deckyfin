"""Self-update: installed build info, GitHub release lookup, build comparison."""

import json
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable, Optional

from deckyfin_config import get_app_config, set_app_config
from deckyfin_steamgrid import _ssl_context

CHANNELS = ("stable", "main")
DEFAULT_SLUG = "avivkilloz/deckyfin"
_TIMEOUT = 10
_HEADERS = {"User-Agent": "deckyfin", "Accept": "application/vnd.github+json"}


def _read_plugin_json(plugin_dir: Path) -> dict:
    try:
        return json.loads((Path(plugin_dir) / "plugin.json").read_text(encoding="utf-8"))
    except Exception:
        return {}


def read_installed_build(plugin_dir: Path) -> dict:
    data = _read_plugin_json(plugin_dir)
    build = data.get("deckyfin_build") if isinstance(data.get("deckyfin_build"), dict) else {}
    channel = build.get("channel") if build.get("channel") in CHANNELS else None
    return {
        "version": str(data.get("version") or "unknown"),
        "channel": channel,
        "commit": build.get("commit") or None,
        "built_at": build.get("built_at") or None,
    }


def repo_slug(plugin_dir: Path) -> str:
    site = ((_read_plugin_json(plugin_dir).get("publish") or {}).get("website") or "")
    m = re.match(r"https?://github\.com/([^/\s]+/[^/\s]+?)/?$", site)
    return m.group(1) if m else DEFAULT_SLUG


def parse_release(release: dict, version_info: Optional[dict]) -> Optional[dict]:
    assets = release.get("assets") or []
    zip_asset = next((a for a in assets if a.get("name") == "deckyfin.zip"), None)
    if not zip_asset:
        return None
    info = version_info or {}
    tag = str(release.get("tag_name") or "")
    return {
        "version": info.get("version") or (tag[1:] if tag.startswith("v") else tag),
        "commit": info.get("commit") or None,
        "published_at": release.get("published_at"),
        "zip_url": zip_asset.get("browser_download_url"),
        "html_url": release.get("html_url"),
    }


def _semver(v: str) -> Optional[tuple]:
    m = re.match(r"^v?(\d+)\.(\d+)\.(\d+)", v or "")
    return tuple(int(x) for x in m.groups()) if m else None


def compare_builds(installed: dict, latest: Optional[dict], channel: str) -> str:
    if not latest:
        return "unknown"
    if channel == "main":
        if installed.get("channel") != "main" or not installed.get("commit"):
            return "update_available"
        same = latest.get("commit") and installed["commit"].startswith(latest["commit"][:7]) \
            and latest["commit"].startswith(installed["commit"][:7])
        return "up_to_date" if same else "update_available"
    # stable
    if installed.get("channel") != "stable":
        return "update_available"
    a, b = _semver(installed.get("version", "")), _semver(latest.get("version", ""))
    if a is None or b is None:
        return "unknown"
    return "update_available" if b > a else "up_to_date"


def _default_opener(req, timeout=None):
    """Default opener — reuses deckyfin_steamgrid's SSL context, since the
    Decky sandbox often can't find system CA certs on Arch-based systems
    (SteamOS included) and a plain urlopen() raises SSLCertVerificationError.

    Looked up lazily (via `urllib.request.urlopen`, not bound at import
    time) so tests can monkeypatch `urllib.request.urlopen` directly.
    """
    return urllib.request.urlopen(req, context=_ssl_context(), timeout=timeout)


def _get_json(url: str, opener: Callable) -> dict:
    req = urllib.request.Request(url, headers=_HEADERS)
    with opener(req, timeout=_TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_latest(channel: str, slug: str, opener: Callable = _default_opener) -> dict:
    base = f"https://api.github.com/repos/{slug}"
    url = f"{base}/releases/tags/latest-main" if channel == "main" else f"{base}/releases/latest"
    try:
        release = _get_json(url, opener)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {"latest": None, "error": "No build on this channel yet"}
        return {"latest": None, "error": f"GitHub returned HTTP {e.code}"}
    except Exception as e:
        return {"latest": None, "error": f"Couldn't reach GitHub: {e}"}
    info = None
    vj = next((a for a in release.get("assets") or [] if a.get("name") == "version.json"), None)
    if vj and vj.get("browser_download_url"):
        try:
            info = _get_json(vj["browser_download_url"], opener)
        except Exception:
            info = None
    latest = parse_release(release, info)
    return {"latest": latest, "error": None if latest else "No build on this channel yet"}


def get_update_channel() -> str:
    ch = get_app_config().get("update_channel")
    return ch if ch in CHANNELS else "stable"


def set_update_channel(channel: str) -> bool:
    if channel not in CHANNELS:
        return False
    set_app_config({"update_channel": channel})
    return True
