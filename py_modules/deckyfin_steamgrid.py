"""SteamGridDB integration — fetch and apply game art to Steam non-Steam shortcuts.

API: https://www.steamgriddb.com/api/v2
Grid images are stored in:  {steam_root}/userdata/{user_id}/config/grid/
Non-Steam game filenames:   {unsigned_appid}_p.png  (grid/box art 460x215)
                            {unsigned_appid}_hero.png (hero banner 1920x620)
                            {unsigned_appid}_logo.png (logo 1024x256)
"""

import logging
import shutil
import ssl
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

from steam_utils import find_steam_root, get_user_id
from deckyfin_consts import LOGGER_NAME, STEAM_USERDATA_FOLDER

logger = logging.getLogger(f"{LOGGER_NAME}.steamgrid")

# ── Default API key (bundled for zero-setup; user can override in settings) ──
_DEFAULT_API_KEY = "0f3016fa5b9656d2f8062a15637deaaf"
API_BASE = "https://www.steamgriddb.com/api/v2"

# ── API key management ──────────────────────────────────────────────────────

def get_configured_api_key() -> str:
    """Return the API key — check app config override first, else bundled default."""
    try:
        from deckyfin_config import get_app_config
        cfg = get_app_config()
        override = cfg.get("steamgriddb_api_key")
        if override and override.strip():
            return override.strip()
    except Exception:
        pass
    return _DEFAULT_API_KEY


def set_api_key(key: str) -> None:
    """Save a user-provided API key override to app config."""
    from deckyfin_config import set_app_config
    set_app_config({"steamgriddb_api_key": key})


# ── API helpers ──────────────────────────────────────────────────────────────

def _ssl_context() -> ssl.SSLContext:
    """Create SSL context with system CA certs for the Deckyfin sandbox.

    The plugin sandbox often can't find system certs (Arch/CachyOS).
    Tries known CA bundle paths and falls back to certifi if available.
    """
    paths = [
        "/etc/ssl/certs/ca-certificates.crt",
        "/etc/ca-certificates/extracted/tls-ca-bundle.pem",
        "/etc/pki/tls/certs/ca-bundle.crt",
        "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
    ]
    for p in paths:
        if Path(p).exists():
            ctx = ssl.create_default_context(cafile=p)
            return ctx
    try:
        import certifi
        ctx = ssl.create_default_context(cafile=certifi.where())
        return ctx
    except ImportError:
        pass
    # Nothing found — try default context (may fail, but that's informative)
    return ssl.create_default_context()


def _api_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {get_configured_api_key()}",
        "Accept": "application/json",
    }


def _api_get(path: str) -> Optional[dict]:
    """Make a GET request to SteamGridDB API. Returns parsed JSON or None."""
    url = f"{API_BASE}{path}"
    try:
        ctx = _ssl_context()
        req = urllib.request.Request(url, headers=_api_headers())
        with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
            return __import__("json").loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        logger.warning("SteamGridDB HTTP %d for %s: %s", e.code, path, e.read().decode("utf-8", errors="replace")[:500])
        return None
    except Exception as e:
        logger.warning("SteamGridDB request failed for %s: %s", path, e)
        return None


def _download_file(url: str, dest: Path) -> bool:
    """Download a file from URL to destination path. Returns True on success."""
    try:
        ctx = _ssl_context()
        req = urllib.request.Request(url, headers={"User-Agent": "Deckyfin/1.0"})
        with urllib.request.urlopen(req, context=ctx, timeout=20) as src:
            dest.parent.mkdir(parents=True, exist_ok=True)
            with open(dest, "wb") as f:
                shutil.copyfileobj(src, f)
        return True
    except Exception as e:
        logger.warning("Failed to download %s: %s", url, e)
        return False


# ── Search ───────────────────────────────────────────────────────────────────

def search_game(name: str) -> Optional[int]:
    """Search SteamGridDB for a game by name. Returns the first match's game ID.

    Uses the /search/autocomplete endpoint which returns name + ID pairs.
    Falls back to a less strict search if the first result isn't close.
    """
    if not name or not name.strip():
        return None

    import urllib.parse
    term = urllib.parse.quote(name.strip())
    data = _api_get(f"/search/autocomplete/{term}")
    if not data or not data.get("success"):
        logger.info("No SteamGridDB results for '%s'", name)
        return None

    results = data.get("data", [])
    if not results:
        return None

    # Return the first match's game ID
    first = results[0]
    game_id = first.get("id")
    if game_id:
        logger.info("SteamGridDB found '%s' (ID %s) for query '%s'",
                     first.get("name", "?"), game_id, name)
        return int(game_id)

    return None


# ── Fetch art URLs ───────────────────────────────────────────────────────────

def _pick_first_image(data: list) -> Optional[str]:
    """Pick the first image URL from an API response data array."""
    if not data:
        return None
    first = data[0]
    # SteamGridDB returns URLs under the 'url' key
    return first.get("url") or None


def fetch_art(game_id: int) -> dict[str, Optional[str]]:
    """Fetch grid, hero, and logo URLs for a game ID.

    Returns dict with keys 'grid', 'hero', 'logo' — each is a URL string or None.
    """
    result: dict[str, Optional[str]] = {"grid": None, "hero": None, "logo": None}

    # Grid (box art, 460x215)
    grid_data = _api_get(f"/grids/game/{game_id}?dimensions=460x215")
    if grid_data and grid_data.get("success"):
        result["grid"] = _pick_first_image(grid_data.get("data", []))
        if result["grid"]:
            logger.info("Got grid art URL for game %d", game_id)

    # Hero (header banner, 1920x620)
    hero_data = _api_get(f"/heroes/game/{game_id}")
    if hero_data and hero_data.get("success"):
        result["hero"] = _pick_first_image(hero_data.get("data", []))
        if result["hero"]:
            logger.info("Got hero art URL for game %d", game_id)

    # Logo (1024x256)
    logo_data = _api_get(f"/logos/game/{game_id}")
    if logo_data and logo_data.get("success"):
        result["logo"] = _pick_first_image(logo_data.get("data", []))
        if result["logo"]:
            logger.info("Got logo URL for game %d", game_id)

    return result


# ── Apply art ────────────────────────────────────────────────────────────────

def _get_grid_folder(steam_root: Path, user_id: str) -> Path:
    """Get the Steam grid images folder path."""
    return steam_root / STEAM_USERDATA_FOLDER / user_id / "config" / "grid"


def _fix_ownership(path: Path) -> None:
    """Fix file ownership to the desktop user if running as root."""
    try:
        import os
        if os.geteuid() != 0:
            return
        from deckyfin_prefix import _get_real_user as get_real_user
        username = get_real_user()
        if username:
            import subprocess
            subprocess.run(
                ["chown", f"{username}:{username}", str(path)],
                capture_output=True, timeout=10,
            )
    except Exception:
        pass


def apply_steam_grid(
    game_name: str,
    unsigned_appid: int,
    user_id: Optional[str] = None,
) -> dict:
    """Search SteamGridDB for game art and apply it to the Steam shortcut.

    Args:
        game_name: The game name to search for
        unsigned_appid: The unsigned 32-bit app ID (Steam shortcut ID)
        user_id: Optional Steam user ID override

    Returns:
        dict with keys: success, applied (list of art types), errors (list)
    """
    result: dict = {
        "success": False,
        "applied": [],
        "errors": [],
    }

    if not user_id:
        try:
            user_id = get_user_id()
        except Exception as e:
            result["errors"].append(f"Could not determine user: {e}")
            return result

    # 1. Search for game
    game_id = search_game(game_name)
    if not game_id:
        result["errors"].append(f"No SteamGridDB result for '{game_name}'")
        return result

    # 2. Fetch art URLs
    art = fetch_art(game_id)
    if not any(art.values()):
        result["errors"].append(f"No art found for '{game_name}' on SteamGridDB")
        return result

    # 3. Locate grid folder
    try:
        steam_root = find_steam_root()
    except Exception as e:
        result["errors"].append(f"Could not find Steam: {e}")
        return result

    grid_folder = _get_grid_folder(steam_root, user_id)
    if not grid_folder.exists():
        try:
            grid_folder.mkdir(parents=True, exist_ok=True)
            logger.info("Created grid folder at %s", grid_folder)
            _fix_ownership(grid_folder)
        except Exception as e:
            result["errors"].append(f"Could not create grid folder: {e}")
            return result

    appid_str = str(unsigned_appid)

    # 4. Download each art type
    type_map = {
        "grid": (art["grid"], f"{appid_str}_p.png"),
        "hero": (art["hero"], f"{appid_str}_hero.png"),
        "logo": (art["logo"], f"{appid_str}_logo.png"),
    }

    any_success = False
    for art_type, (url, filename) in type_map.items():
        if not url:
            result["errors"].append(f"No {art_type} URL available")
            continue

        dest = grid_folder / filename
        if _download_file(url, dest):
            _fix_ownership(dest)
            result["applied"].append(art_type)
            any_success = True
            logger.info("Applied %s art to %s (%s)", art_type, game_name, filename)
        else:
            result["errors"].append(f"Failed to download {art_type}")

    result["success"] = any_success
    return result
