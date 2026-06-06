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
    remove_game_config,
    detect_game_folders,
    find_game_executables,
    GameConfigError,
)
from steam_games import add_nonsteam_game, list_nonsteam_games
from deckyfin_proton import list_available_proton, ensure_proton_available
from deckyfin_proton_compat import set_proton_version
from deckyfin_prefix import init_proton_prefix
from deckyfin_protontricks import install_protontricks_dependencies
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
        app_id = add_nonsteam_game(exe_path, app_name, start_dir, launch_options)
        return {
            "success": True,
            "app_id": app_id,
            "unsigned_appid": convert_appid_to_unsigned_32bit(app_id),
        }

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
        init_proton_prefix(app_id, uid, proton_name=proton_name, reinitialize=reinitialize)
        return {"success": True, "app_id": app_id}

    async def install_dependencies(self, pfxid: str, dependencies: str) -> dict:
        return install_protontricks_dependencies(pfxid, dependencies)


# ── Global error wrapper ─────────────────────────────────────────────
# Wrap every public async method so ALL exceptions are logged to
# debug.log with full traceback, then RE-RAISED so the sandbox IPC
# layer handles them properly (frontend gets a rejected promise
# with the error message = visible red text in the plugin UI).

import inspect as _inspect

_SAFE_METHODS = frozenset({"_main"})


def _wrap_method(cls, name: str, method):
    """Replace an async method on Plugin with a logged version
    that writes exceptions to debug.log then re-raises them."""

    async def wrapper(self, *args, **kwargs):
        try:
            return await method(self, *args, **kwargs)
        except Exception as e:
            tb = traceback.format_exc()
            _debug(f"ERROR {name}: {e}\n{tb}")
            raise  # re-raise so sandbox IPC handles it

    wrapper.__name__ = method.__name__
    wrapper.__qualname__ = method.__qualname__
    wrapper.__doc__ = method.__doc__
    setattr(cls, name, wrapper)


# Wrap every public async method except _main
for _attr_name in dir(Plugin):
    if _attr_name in _SAFE_METHODS:
        continue
    if _attr_name.startswith("_"):
        continue
    _attr = getattr(Plugin, _attr_name)
    if _inspect.iscoroutinefunction(_attr):
        _wrap_method(Plugin, _attr_name, _attr)

# Clean up
del _attr_name, _attr, _SAFE_METHODS, _inspect, _wrap_method
