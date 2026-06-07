"""Deckyfin — Decky Plugin Main Backend

Exposes game management methods to the React frontend via Decky IPC.
"""

import logging
import traceback
from pathlib import Path
from typing import Optional

from deckyfin_config import (
    get_games_folder,
    set_games_folder,
    initialize_app_structure,
    list_game_configs,
    get_game_config,
    add_game_config,
    update_game_config,
    remove_game_config,
    detect_game_folders,
    find_game_executables,
    GameConfigError,
)
from steam_games import add_nonsteam_game, list_nonsteam_games, remove_nonsteam_game, get_steam_shortcut_info, update_nonsteam_game
from deckyfin_proton import list_available_proton, ensure_proton_available, get_proton_version_for_game
from deckyfin_proton_compat import set_proton_version
from deckyfin_prefix import init_proton_prefix
from deckyfin_protontricks import install_protontricks_dependencies
from deckyfin_steamgrid import apply_steam_grid as _apply_steam_grid, set_api_key as _set_steamgrid_key, get_configured_api_key as _get_steamgrid_key
from deckyfin_steam_ctl import is_steam_running, restart_steam
from steam_utils import get_user_id, list_steam_users
from steam_games import convert_appid_to_unsigned_32bit
from deckyfin_consts import APP_NAME, APP_VERSION

DEBUG_LOG = Path(__file__).parent / "debug.log"


def _debug(msg: str):
    try:
        with open(DEBUG_LOG, "a") as f:
            f.write(f"[{__import__('datetime').datetime.now()}] {msg}\n")
    except Exception:
        pass


_debug("MODULE LOAD START")


class Plugin:
    """Deckyfin plugin backend — methods callable from the React frontend."""

    def __init__(self):
        _debug("Plugin.__init__")
        self.logger = None

    async def _main(self):
        _debug("_main called")
        self.logger = logging.getLogger(APP_NAME)
        try:
            self.logger.info("Deckyfin v%s loaded", APP_VERSION)
            _debug("_main OK")
        except Exception as e:
            _debug(f"_main logger error: {e}")

    async def _unload(self):
        _debug("_unload called")

    # ── App Info ──────────────────────────────────────────────────────────

    async def get_plugin_info(self) -> dict:
        folder = get_games_folder()
        return {
            "name": APP_NAME,
            "version": APP_VERSION,
            "games_folder": str(folder) if folder else None,
        }

    # ── Steam ─────────────────────────────────────────────────────────────

    async def get_steam_running(self) -> dict:
        return {"running": is_steam_running()}

    async def restart_steam(self) -> dict:
        return restart_steam()

    async def list_steam_users(self) -> list:
        return list_steam_users()

    # ── Games Folder ──────────────────────────────────────────────────────

    async def get_games_folder(self) -> Optional[str]:
        folder = get_games_folder()
        return str(folder) if folder else None

    async def set_games_folder(self, path: str) -> dict:
        result = set_games_folder(path)
        return {"success": True, "path": str(result)}

    async def initialize(self, games_folder: Optional[str] = None) -> dict:
        return initialize_app_structure(games_folder)

    # ── Games ─────────────────────────────────────────────────────────────

    async def get_games(self) -> list:
        return list_game_configs()

    async def get_game(self, name: str) -> dict:
        game = get_game_config(name)
        if game:
            return {"success": True, "game": game}
        return {"success": False, "error": f"Game '{name}' not found"}

    async def add_game(self, config: dict) -> dict:
        try:
            result = add_game_config(config)
            return {"success": True, "game": result}
        except GameConfigError as e:
            return {"success": False, "error": str(e)}

    async def update_game_config(self, name: str, updates: dict) -> dict:
        """Update specific fields on an existing game config."""
        try:
            result = update_game_config(name, updates)
            return {"success": True, "game": result}
        except GameConfigError as e:
            return {"success": False, "error": str(e)}

    async def remove_game(self, name: str) -> dict:
        removed = remove_game_config(name)
        return {"success": removed, "error": None if removed else f"Game '{name}' not found"}

    async def list_nonsteam_games(self) -> list:
        return list_nonsteam_games()

    # ── Scanning ──────────────────────────────────────────────────────────

    async def scan_games_folder(self) -> list:
        games_path = get_games_folder()
        if not games_path:
            return [{"error": "Games folder not configured"}]
        return detect_game_folders(Path(games_path))

    async def scan_game_exes(self, subfolder: str) -> list:
        games_path = get_games_folder()
        if not games_path:
            return [{"error": "Games folder not configured"}]
        return find_game_executables(Path(games_path) / subfolder)

    # ── Steam Actions ─────────────────────────────────────────────────────

    async def add_steam_shortcut(
        self,
        exe_path: str,
        app_name: str,
        start_dir: Optional[str] = None,
        launch_options: str = "",
    ) -> dict:
        if not exe_path:
            return {"success": False, "error": "Executable path is required"}
        # Resolve relative paths against the configured games folder
        exe = Path(exe_path)
        if not exe.is_absolute():
            games_folder = get_games_folder()
            if games_folder:
                exe = Path(games_folder) / exe_path
        resolved_start = start_dir
        if resolved_start and not Path(resolved_start).is_absolute():
            games_folder = get_games_folder()
            if games_folder:
                resolved_start = str(Path(games_folder) / resolved_start)
        app_id = add_nonsteam_game(str(exe), app_name, resolved_start, launch_options)
        return {
            "success": True,
            "app_id": app_id,
            "unsigned_appid": convert_appid_to_unsigned_32bit(app_id),
        }

    async def update_steam_shortcut(
        self,
        app_name: str,
        exe_path: str,
        start_dir: Optional[str] = None,
        launch_options: str = "",
    ) -> dict:
        """Update an existing Steam shortcut in-place. Returns error if not found."""
        # Resolve relative paths against the configured games folder
        exe = Path(exe_path)
        if not exe.is_absolute():
            games_folder = get_games_folder()
            if games_folder:
                exe = Path(games_folder) / exe_path
        resolved_start = start_dir
        if resolved_start and not Path(resolved_start).is_absolute():
            games_folder = get_games_folder()
            if games_folder:
                resolved_start = str(Path(games_folder) / resolved_start)
        app_id = update_nonsteam_game(
            app_name, str(exe), resolved_start or "", launch_options
        )
        if app_id is None:
            return {
                "success": False,
                "error": f"'{app_name}' not found in Steam shortcuts — add it first",
            }
        return {
            "success": True,
            "app_id": app_id,
            "unsigned_appid": convert_appid_to_unsigned_32bit(app_id),
        }

    async def remove_steam_shortcut(self, app_name: str, user_id: Optional[str] = None) -> dict:
        removed = remove_nonsteam_game(app_name, user_id)
        return {
            "success": removed,
            "error": None if removed else f"'{app_name}' not found in Steam shortcuts",
        }

    async def get_steam_shortcut(self, app_name: str, user_id: Optional[str] = None) -> dict:
        """Look up a game in Steam shortcuts by name. Returns app_id if found."""
        uid = user_id or get_user_id()
        info = get_steam_shortcut_info(app_name, uid)
        if info:
            return {"success": True, **info}
        return {"success": False, "error": f"'{app_name}' not found in Steam shortcuts"}

    # ── Proton ────────────────────────────────────────────────────────────

    async def list_proton_versions(self) -> list:
        return list_available_proton()

    async def ensure_proton(self, proton_name: str) -> dict:
        ensure_proton_available(proton_name)
        return {"success": True, "proton_name": proton_name}

    async def set_game_proton(self, app_id: int, proton_name: str, user_id: Optional[str] = None) -> dict:
        uid = user_id or get_user_id()
        set_proton_version(app_id, proton_name, uid)
        return {"success": True, "app_id": app_id, "proton_name": proton_name}

    async def init_prefix(
        self,
        app_id: int,
        proton_name: Optional[str] = None,
        reinitialize: bool = False,
        user_id: Optional[str] = None,
    ) -> dict:
        uid = user_id or get_user_id()
        try:
            init_proton_prefix(app_id, uid, proton_name=proton_name, reinitialize=reinitialize)
            return {"success": True, "app_id": app_id}
        except FileExistsError as e:
            return {"success": False, "error": str(e)}
        except ValueError as e:
            return {"success": False, "error": str(e)}
        except RuntimeError as e:
            return {"success": False, "error": str(e)}
        except Exception as e:
            return {"success": False, "error": f"Failed to init prefix: {str(e)}"}

    async def install_dependencies(self, pfxid: str, dependencies: str) -> dict:
        return install_protontricks_dependencies(pfxid, dependencies, timeout=1200)

    async def get_game_proton(self, app_id: int, user_id: Optional[str] = None) -> dict:
        """Get the current Proton version configured for a Steam app."""
        uid = user_id or get_user_id()
        try:
            from steam_utils import find_steam_root
            steam_root = find_steam_root()
            result = get_proton_version_for_game(app_id, steam_root, uid)
            return {"success": True, "proton_name": result} if result else {"success": True, "proton_name": None}
        except Exception as e:
            return {"success": False, "proton_name": None, "error": str(e)}

    # ── SteamGridDB Art ──────────────────────────────────────────────────

    async def apply_steam_grid(self, game_name: str, unsigned_appid: int) -> dict:
        """Search SteamGridDB for game art and apply it to the Steam shortcut."""
        return _apply_steam_grid(game_name, unsigned_appid)

    async def get_steamgrid_key(self) -> dict:
        """Get the current SteamGridDB API key (shows whether a custom one is set)."""
        key = _get_steamgrid_key()
        from deckyfin_config import get_app_config
        cfg = get_app_config()
        has_override = bool(cfg.get("steamgriddb_api_key"))
        return {"key": key, "has_override": has_override}

    async def set_steamgrid_key(self, key: str) -> dict:
        """Set a custom SteamGridDB API key override in app config."""
        _set_steamgrid_key(key)
        return {"success": True}

    async def get_game_card_art(self, game_name: str) -> dict:
        """Get downloaded art for a game as a base64 data URI (for the library card).

        Prefers capsule ({appid}.png) then grid (_p.png) then hero (_hero.png)
        then logo — capsule has the right aspect ratio for the card thumbnail.
        """
        import base64
        try:
            from steam_games import get_steam_shortcut_info
            from steam_utils import get_user_id, find_steam_root
            from deckyfin_consts import STEAM_USERDATA_FOLDER
            uid = get_user_id()
            info = get_steam_shortcut_info(game_name, uid)
            if not info:
                return {"data_uri": None}
            unsigned_appid = info.get("unsigned_appid")
            if not unsigned_appid:
                return {"data_uri": None}

            steam_root = find_steam_root()
            grid_folder = steam_root / STEAM_USERDATA_FOLDER / uid / "config" / "grid"

            appid_str = str(unsigned_appid)
            # Prefer capsule ({appid}.png) then grid then hero then logo
            candidates = [
                grid_folder / f"{appid_str}.png",
                grid_folder / f"{appid_str}.jpg",
                grid_folder / f"{appid_str}_p.png",
                grid_folder / f"{appid_str}_p.jpg",
                grid_folder / f"{appid_str}_hero.png",
                grid_folder / f"{appid_str}_hero.jpg",
                grid_folder / f"{appid_str}_logo.png",
            ]
            for path in candidates:
                if path.exists():
                    with open(path, "rb") as f:
                        raw = f.read()
                    ext = path.suffix.lstrip(".")
                    b64 = base64.b64encode(raw).decode("ascii")
                    return {"data_uri": f"data:image/{ext};base64,{b64}"}
            return {"data_uri": None}
        except Exception as e:
            logger.warning("Failed to get card art for '%s': %s", game_name, e)
            return {"data_uri": None}


# ── Global error wrapper ─────────────────────────────────────────────
# Wrap every public async method so ALL exceptions are logged to
# debug.log with full traceback, then RE-RAISED so the sandbox IPC
# layer handles them properly (frontend gets a rejected promise
# with the error message = visible red text in the plugin UI).

import inspect as _inspect

_SAFE_METHODS = frozenset({"_main"})

_wrapped_count = 0
_wrapped_names = []

for _attr_name in dir(Plugin):
    if _attr_name in _SAFE_METHODS:
        continue
    if _attr_name.startswith("_"):
        continue
    _attr = getattr(Plugin, _attr_name)
    if _inspect.iscoroutinefunction(_attr):
        _wrapped_names.append(_attr_name)
        # Replaces the method on the class with a wrapped version
        _orig = _attr
        
        def _make_wrapper(name, orig):
            async def wrapper(self, *args, **kwargs):
                _debug(f"CALL {name}(args={args}, kwargs={kwargs})")
                try:
                    result = await orig(self, *args, **kwargs)
                    _debug(f"CALL OK {name}")
                    return result
                except Exception as e:
                    tb = traceback.format_exc()
                    _debug(f"CALL ERROR {name}: {e}\n{tb}")
                    try:
                        log = logging.getLogger(APP_NAME)
                        log.error("ERROR %s: %s\n%s", name, e, tb)
                    except Exception:
                        pass
                    raise
            wrapper.__name__ = orig.__name__
            wrapper.__qualname__ = orig.__qualname__
            wrapper.__doc__ = orig.__doc__
            return wrapper
        
        setattr(Plugin, _attr_name, _make_wrapper(_attr_name, _attr))
        _wrapped_count += 1

_debug(f"WRAPPER: wrapped {_wrapped_count} methods: {_wrapped_names}")
del _wrapped_count, _wrapped_names, _attr_name, _attr, _SAFE_METHODS, _inspect, _orig, _make_wrapper
