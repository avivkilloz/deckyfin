"""SteamGridDB integration — fetch and apply game art to Steam non-Steam shortcuts.

API: https://www.steamgriddb.com/api/v2
Grid images are stored in:  {steam_root}/userdata/{user_id}/config/grid/
Non-Steam game filenames:   {unsigned_appid}.png     (library capsule/header)
                            {unsigned_appid}_p.png  (grid/box art 460x215)
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


_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"


def _api_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {get_configured_api_key()}",
        "Accept": "application/json",
        "User-Agent": _UA,
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
        req = urllib.request.Request(url, headers={"User-Agent": _UA})
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
    results = search_steamgrid_games(name)
    if results:
        return results[0]["id"]
    return None


def search_steamgrid_games(name: str) -> list:
    """Search SteamGridDB for games by name. Returns all matching games.

    Returns list of dicts with keys: id (int), name (str).
    """
    if not name or not name.strip():
        return []

    import urllib.parse
    term = urllib.parse.quote(name.strip())
    data = _api_get(f"/search/autocomplete/{term}")
    if not data or not data.get("success"):
        logger.info("No SteamGridDB results for '%s'", name)
        return []

    results = data.get("data", [])
    if not results:
        return []

    out = []
    for item in results:
        gid = item.get("id")
        gname = item.get("name")
        if gid and gname:
            out.append({"id": int(gid), "name": gname})
    logger.info("SteamGridDB found %d games for query '%s'", len(out), name)
    return out


# ── Fetch art URLs ───────────────────────────────────────────────────────────

def _pick_first_image(data: list) -> Optional[str]:
    """Pick the first image URL from an API response data array."""
    if not data:
        return None
    first = data[0]
    # SteamGridDB returns URLs under the 'url' key
    return first.get("url") or None


def _fetch_art_urls_for_game_id(game_id: int, game_name: str | None = None) -> dict:
    """Fetch all art URLs for a specific SteamGridDB game ID.

    Internal helper — used by both search-by-name and search-by-ID entry points.
    """
    result = {
        "success": False,
        "error": None,
        "game_id": game_id,
        "game_name": game_name,
        "grid_p": None,
        "hero": None,
        "logo": None,
        "wide": None,
        "icon": None,
    }

    # Get SGDB game data for the name info
    if not game_name:
        game_data = _api_get(f"/games/id/{game_id}")
        if game_data and game_data.get("success") and game_data.get("data"):
            first = game_data["data"]
            if isinstance(first, list):
                first = first[0]
            result["game_name"] = first.get("name") or None
    else:
        result["game_name"] = game_name

    # Grid (portrait — eAssetType 0 / grid_p)
    for dims in ["600x900", "342x482", "660x930", ""]:
        url = f"/grids/game/{game_id}"
        if dims:
            url += f"?dimensions={dims}"
        data = _api_get(url)
        if data and data.get("success") and data.get("data"):
            result["grid_p"] = _pick_first_image(data["data"])
            if result["grid_p"]:
                break

    # Wide capsule (landscape — eAssetType 3 / grid_l)
    for dims in ["460x215", "920x430", ""]:
        url = f"/grids/game/{game_id}"
        if dims:
            url += f"?dimensions={dims}"
        data = _api_get(url)
        if data and data.get("success") and data.get("data"):
            result["wide"] = _pick_first_image(data["data"])
            if result["wide"]:
                break

    # Hero (eAssetType 1)
    hero_data = _api_get(f"/heroes/game/{game_id}")
    if hero_data and hero_data.get("success"):
        result["hero"] = _pick_first_image(hero_data.get("data", []))

    # Logo (eAssetType 2)
    logo_data = _api_get(f"/logos/game/{game_id}")
    if logo_data and logo_data.get("success"):
        result["logo"] = _pick_first_image(logo_data.get("data", []))

    # Icon (eAssetType 4)
    icon_data = _api_get(f"/icons/game/{game_id}")
    if icon_data and icon_data.get("success"):
        result["icon"] = _pick_first_image(icon_data.get("data", []))

    result["success"] = bool(result["grid_p"] or result["hero"] or result["logo"] or result["wide"] or result["icon"])
    if not result["success"]:
        result["error"] = f"No art found for game ID {game_id} on SteamGridDB"

    return result


def fetch_steamgrid_art_urls_by_id(game_id: int, game_name: str | None = None) -> dict:
    """Fetch SteamGridDB art URLs for a specific game by its SGDB ID.

    Returns the same dict structure as fetch_steamgrid_art_urls().
    """
    return _fetch_art_urls_for_game_id(game_id, game_name)


def fetch_steam_art_options_page(game_id: int, art_type: str, page: int = 0, limit: int = 20) -> dict:
    """Fetch a page of Steam art options for a specific art type.

    art_type: 'wide' (920x430 grids), 'capsule' (600x900 grids), 'hero', 'logo'
    Returns: urls (list[str]), has_more (bool).
    """
    if art_type == "wide":
        data = _api_get(f"/grids/game/{game_id}?dimensions=920x430&limit={limit}&page={page}")
    elif art_type == "capsule":
        data = _api_get(f"/grids/game/{game_id}?dimensions=600x900&limit={limit}&page={page}")
    elif art_type == "hero":
        data = _api_get(f"/heroes/game/{game_id}?limit={limit}&page={page}")
    elif art_type == "logo":
        data = _api_get(f"/logos/game/{game_id}?limit={limit}&page={page}")
    elif art_type == "icon":
        data = _api_get(f"/icons/game/{game_id}?limit={limit}&page={page}")
    else:
        return {"urls": [], "has_more": False}

    if not data or not data.get("success"):
        return {"urls": [], "has_more": False}
    items = data.get("data") or []
    urls = [item["url"] for item in items if item.get("url")]
    return {"urls": urls, "has_more": len(items) >= limit}


def fetch_steamgrid_art_page(game_id: int, page: int = 0, limit: int = 20) -> dict:
    """Fetch one page of wide/landscape capsule art URLs for a game.

    Filters to landscape-only images (aspect ratio > 1.5) so portrait and hero
    art is excluded. Requests a larger raw batch to compensate for filtering.
    Returns: urls (list[str]), has_more (bool).
    """
    data = _api_get(f"/grids/game/{game_id}?dimensions=920x430&limit={limit}&page={page}")
    if not data or not data.get("success"):
        return {"urls": [], "has_more": False}
    items = data.get("data") or []
    urls = [item["url"] for item in items if item.get("url")]
    return {"urls": urls, "has_more": len(items) >= limit}


def fetch_steamgrid_art_urls(game_name: str) -> dict:
    """One-step: search game by name → fetch art URLs.

    Returns dict with keys:
      success (bool), error (str|None),
      game_id (int|None), game_name (str|None),
      grid_p (str|None), hero (str|None), logo (str|None), wide (str|None)

    Art type mapping to Steam eAssetType:
      grid_p = 0 (portrait capsule)
      wide   = 3 (landscape wide capsule)
      hero   = 1 (hero banner)
      logo   = 2 (logo)
    """
    game_id = search_game(game_name)
    if not game_id:
        return {
            "success": False,
            "error": f"No SteamGridDB result for '{game_name}'",
            "game_id": None,
            "game_name": None,
            "grid_p": None,
            "hero": None,
            "logo": None,
            "wide": None,
        }

    return _fetch_art_urls_for_game_id(game_id, game_name)


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
    """Search SteamGridDB for game art and apply it to the Steam shortcut (legacy file-copy).

    This is the OLD approach — downloads files directly to the grid folder.
    It's kept as a fallback for icon art (type 4) which can't use Steam's API.
    For all other asset types, use `SetCustomArtworkForApp` from the frontend.

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

    # Use the new unified fetcher
    urls = fetch_steamgrid_art_urls(game_name)
    if not urls["success"]:
        result["errors"].append(urls.get("error") or f"No art found for '{game_name}'")
        return result

    # 2. Locate grid folder
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

    # Only save the wide capsule ({appid}.png) — this is what the plugin's game cards display.
    type_map = {
        "wide capsule": (urls["wide"], f"{appid_str}.png"),
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


def apply_all_art_file_copy(
    game_name: str,
    sgdb_id: int,
    unsigned_appid: int,
    user_id: Optional[str] = None,
) -> dict:
    """Fetch all art types from SteamGridDB and copy to Steam grid folder.

    Downloads wide, portrait, hero, and logo art directly to the grid folder.
    Steam must be restarted for the art to appear. Used by batch art apply.
    Returns: {success, applied (list of art type names), errors (list)}
    """
    result: dict = {"success": False, "applied": [], "errors": []}

    if not user_id:
        try:
            user_id = get_user_id()
        except Exception as e:
            result["errors"].append(f"Could not determine user: {e}")
            return result

    urls = _fetch_art_urls_for_game_id(sgdb_id, game_name)
    if not urls.get("success"):
        result["errors"].append(urls.get("error") or f"No art found for SGDB ID {sgdb_id}")
        return result

    try:
        steam_root = find_steam_root()
    except Exception as e:
        result["errors"].append(f"Could not find Steam: {e}")
        return result

    grid_folder = _get_grid_folder(steam_root, user_id)
    try:
        grid_folder.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        result["errors"].append(f"Could not create grid folder: {e}")
        return result

    appid_str = str(unsigned_appid)
    type_map = {
        "wide": (urls.get("wide"), f"{appid_str}.png"),
        "capsule": (urls.get("grid_p"), f"{appid_str}p.png"),
        "hero": (urls.get("hero"), f"{appid_str}_hero.png"),
        "logo": (urls.get("logo"), f"{appid_str}_logo.png"),
    }

    any_ok = False
    for art_type, (url, filename) in type_map.items():
        if not url:
            result["errors"].append(f"No {art_type} URL on SteamGridDB")
            continue
        dest = grid_folder / filename
        if _download_file(url, dest):
            _fix_ownership(dest)
            result["applied"].append(art_type)
            any_ok = True
            logger.info("Applied %s art for %s (%s)", art_type, game_name, filename)
        else:
            result["errors"].append(f"Failed to download {art_type}")

    result["success"] = any_ok
    return result


def download_file(url: str, dest: Path) -> bool:
    """Public alias for _download_file."""
    return _download_file(url, dest)
