"""Deckyfin — Decky Plugin Main Backend

Exposes game management methods to the React frontend via Decky IPC.
Bundles deckyfin-api utility modules for direct filesystem/Steam access.
"""

import logging
import sys as _sys
from pathlib import Path
from typing import Optional, List, Dict, Any

# Add plugin directory to path (append, not insert, to avoid shadowing)
_plugin_dir = str(Path(__file__).resolve().parent)
if _plugin_dir not in _sys.path:
    _sys.path.append(_plugin_dir)

from backend.app_config import (
    get_app_config,
    set_app_config,
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
from backend.games import add_nonsteam_game, list_nonsteam_games
from backend.proton import list_available_proton, ensure_proton_available
from backend.proton_compat import set_proton_version
from backend.prefix import init_proton_prefix
from backend.protontricks import install_protontricks_dependencies
from backend.steam_control import is_steam_running, restart_steam
from backend.steam import get_user_id, list_steam_users, find_steam_root
from backend.games import convert_appid_to_unsigned_32bit, calc_shortcut_app_id
from backend.consts import APP_NAME, APP_VERSION


class PluginMain:
    """Deckyfin plugin backend — methods callable from the React frontend."""

    async def _main(self):
        """Called when plugin is loaded by Decky."""
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        )
        self.logger = logging.getLogger(APP_NAME)
        self.logger.info("Deckyfin v%s loaded", APP_VERSION)

    async def _unload(self):
        """Called when plugin is unloaded by Decky."""
        self.logger.info("Deckyfin unloaded")

    # ── App Info ──────────────────────────────────────────────────────────

    async def get_plugin_info(self) -> dict:
        """Return plugin metadata."""
        return {
            "name": APP_NAME,
            "version": APP_VERSION,
            "games_folder": str(get_games_folder()) if get_games_folder() else None,
        }

    # ── Steam ─────────────────────────────────────────────────────────────

    async def get_steam_running(self) -> dict:
        """Check if Steam is currently running."""
        return {"running": is_steam_running()}

    async def restart_steam(self) -> dict:
        """Restart Steam."""
        return restart_steam()

    async def list_steam_users(self) -> list:
        """List available Steam user profiles."""
        try:
            return list_steam_users()
        except Exception as e:
            return [{"error": str(e)}]

    # ── Games Folder ──────────────────────────────────────────────────────

    async def get_games_folder(self) -> Optional[str]:
        """Get the configured games folder path."""
        folder = get_games_folder()
        return str(folder) if folder else None

    async def set_games_folder(self, path: str) -> dict:
        """Set the games folder path."""
        try:
            result = set_games_folder(path)
            return {"success": True, "path": str(result)}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def initialize(self, games_folder: Optional[str] = None) -> dict:
        """Initialize the .deckyfin folder structure + auto-detect games."""
        return initialize_app_structure(games_folder)

    # ── Games ─────────────────────────────────────────────────────────────

    async def get_games(self) -> list:
        """List all game configurations."""
        return list_game_configs()

    async def get_game(self, name: str) -> dict:
        """Get a single game configuration by name."""
        game = get_game_config(name)
        if game:
            return {"success": True, "game": game}
        return {"success": False, "error": f"Game '{name}' not found"}

    async def add_game(self, config: dict) -> dict:
        """Add or update a game configuration."""
        try:
            result = add_game_config(config)
            return {"success": True, "game": result}
        except GameConfigError as e:
            return {"success": False, "error": str(e)}

    async def remove_game(self, name: str) -> dict:
        """Remove a game configuration."""
        removed = remove_game_config(name)
        return {"success": removed, "error": None if removed else f"Game '{name}' not found"}

    async def list_nonsteam_games(self) -> list:
        """List games registered as Steam non-Steam shortcuts."""
        try:
            return list_nonsteam_games()
        except Exception as e:
            return [{"error": str(e)}]

    # ── Scanning ──────────────────────────────────────────────────────────

    async def scan_games_folder(self) -> list:
        """Scan games folder for subdirectories (candidate games)."""
        games_path = get_games_folder()
        if not games_path:
            return [{"error": "Games folder not configured"}]
        return detect_game_folders(Path(games_path))

    async def scan_game_exes(self, subfolder: str) -> list:
        """Scan a specific subfolder for .exe files."""
        games_path = get_games_folder()
        if not games_path:
            return [{"error": "Games folder not configured"}]
        game_dir = Path(games_path) / subfolder
        return find_game_executables(game_dir)

    # ── Steam Actions ─────────────────────────────────────────────────────

    async def add_steam_shortcut(
        self,
        exe_path: str,
        app_name: str,
        start_dir: Optional[str] = None,
        launch_options: str = "",
    ) -> dict:
        """Add a game as a non-Steam Steam shortcut."""
        try:
            app_id = add_nonsteam_game(exe_path, app_name, start_dir, launch_options)
            return {
                "success": True,
                "app_id": app_id,
                "unsigned_appid": convert_appid_to_unsigned_32bit(app_id),
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ── Proton ────────────────────────────────────────────────────────────

    async def list_proton_versions(self) -> list:
        """List available Proton versions."""
        try:
            return list_available_proton()
        except Exception as e:
            return []

    async def ensure_proton(self, proton_name: str) -> dict:
        """Ensure a Proton version is available (download GE if needed)."""
        try:
            ensure_proton_available(proton_name)
            return {"success": True, "proton_name": proton_name}
        except (ValueError, RuntimeError) as e:
            return {"success": False, "error": str(e)}

    async def set_game_proton(self, app_id: int, proton_name: str, user_id: Optional[str] = None) -> dict:
        """Set Proton version for a specific game app ID."""
        try:
            uid = user_id or get_user_id()
            set_proton_version(app_id, proton_name, uid)
            return {"success": True, "app_id": app_id, "proton_name": proton_name}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def init_prefix(
        self,
        app_id: int,
        proton_name: Optional[str] = None,
        reinitialize: bool = False,
        user_id: Optional[str] = None,
    ) -> dict:
        """Initialize a Proton prefix for a game."""
        try:
            uid = user_id or get_user_id()
            init_proton_prefix(app_id, uid, proton_name=proton_name, reinitialize=reinitialize)
            return {"success": True, "app_id": app_id}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def install_dependencies(
        self, pfxid: str, dependencies: str
    ) -> dict:
        """Install protontricks dependencies in a prefix."""
        try:
            return install_protontricks_dependencies(pfxid, dependencies)
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ── Full Workflow ─────────────────────────────────────────────────────

    async def setup_game(self, config: dict) -> dict:
        """
        Run the full setup workflow for a game.

        Steps:
        1. Add/update game config
        2. Find exe and add Steam shortcut
        3. Ensure Proton is available
        4. Set Proton version
        5. Init prefix (optional)
        6. Install dependencies (optional)

        config keys:
            name, executable (relative path), start_dir,
            proton_version, proton_dependencies (list),
            launch_options, init_prefix (bool), install_deps (bool)
        """
        steps = []
        try:
            game_name = config["name"]
            exe_rel = config.get("executable", "")
            launch_opts = config.get("launch_options", "")

            # 1. Save config
            add_game_config(config)
            steps.append("Config saved")

            # 2. Build full exe path and add shortcut
            games_folder = get_games_folder()
            if not games_folder:
                return {"success": False, "error": "Games folder not configured", "steps": steps}

            full_exe_path = str(Path(games_folder) / exe_rel)
            start_dir = str(Path(full_exe_path).parent)

            app_id = add_nonsteam_game(full_exe_path, game_name, start_dir, launch_opts)
            steps.append(f"Steam shortcut added (app_id={app_id})")

            # 3. Proton setup
            proton_name = config.get("proton_version")
            if proton_name:
                ensure_proton_available(proton_name)
                steps.append(f"Proton '{proton_name}' ready")

                uid = get_user_id()
                set_proton_version(app_id, proton_name, uid)
                steps.append(f"Proton set to '{proton_name}'")

                # 4. Init prefix
                if config.get("init_prefix", False):
                    init_proton_prefix(app_id, uid, proton_name=proton_name)
                    steps.append("Prefix initialized")

                # 5. Install deps
                deps = config.get("proton_dependencies", [])
                if config.get("install_deps", False) and deps:
                    unsigned_appid = convert_appid_to_unsigned_32bit(app_id)
                    dep_result = install_protontricks_dependencies(
                        str(unsigned_appid), ",".join(deps)
                    )
                    if dep_result.get("success"):
                        steps.append(f"Deps installed: {', '.join(dep_result.get('installed', []))}")
                    else:
                        steps.append(f"Deps had failures: {', '.join(dep_result.get('failed', []))}")

            return {
                "success": True,
                "app_id": app_id,
                "unsigned_appid": convert_appid_to_unsigned_32bit(app_id),
                "steps": steps,
            }

        except Exception as e:
            return {"success": False, "error": str(e), "steps": steps}
