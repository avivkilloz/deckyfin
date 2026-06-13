"""Deckyfin — Decky Plugin Main Backend

Exposes game management methods to the React frontend via Decky IPC.
"""

import logging
import os
import ssl
import subprocess
import sys
import traceback
from pathlib import Path
from typing import Optional

# Bootstrap: ensure py_modules/ directory is on sys.path so vendored
# packages (vdf, etc.) are importable from function-level imports.
_py_modules = str(Path(__file__).resolve().parent / "py_modules")
if _py_modules not in sys.path:
    sys.path.insert(0, _py_modules)

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
    get_app_folder,
    get_saves_folder,
    get_games_config,
    save_games_config,
    GameConfigError,
)
from steam_games import add_nonsteam_game, list_nonsteam_games, remove_nonsteam_game, get_steam_shortcut_info, update_nonsteam_game, purge_nonsteam_game_data, list_steam_collections
from deckyfin_proton import list_available_proton, ensure_proton_available, get_proton_version_for_game
from deckyfin_proton_compat import set_proton_version
from deckyfin_prefix import init_proton_prefix
from deckyfin_protontricks import (
    install_protontricks_dependencies,
    detect_protontricks_status as _detect_protontricks_status,
    install_protontricks_flatpak as _install_protontricks_flatpak,
)
from deckyfin_steamgrid import apply_steam_grid as _apply_steam_grid, set_api_key as _set_steamgrid_key, get_configured_api_key as _get_steamgrid_key, fetch_steamgrid_art_urls as _fetch_steamgrid_art_urls, search_steamgrid_games as _search_steamgrid_games, fetch_steamgrid_art_urls_by_id as _fetch_steamgrid_art_urls_by_id
from deckyfin_steam_ctl import is_steam_running, restart_steam
from deckyfin_game_state import (
    get_game_state,
    update_game_state,
    clear_all_restart_flags,
    STATE_FIELDS,
)
from deckyfin_sources import (
    list_sources as _list_sources,
    add_source as _add_source,
    remove_source as _remove_source,
    get_source_by_id as _get_source_by_id,
    detect_capabilities as _detect_capabilities,
    get_disk_usage as _get_disk_usage,
    migrate_games_folder_to_source as _migrate_games_folder_to_source,
    load_source_games as _load_source_games,
)
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


import time as _time
import threading as _threading
import uuid as _uuid

_transfer_registry: dict = {}

_debug("MODULE LOAD START")

_PY_MODULES = str(Path(__file__).resolve().parent / "py_modules")

# Script run in a subprocess (as the FUSE mount owner) to read/write source games.
# sys.argv: ["-", py_modules, games_path, mode]
# mode="load" → prints JSON list of games
# mode="init" → creates .deckyfin dirs, scans folders, saves config, prints result dict
_SOURCE_GAMES_SCRIPT = """\
import sys, json
sys.path.insert(0, sys.argv[1])
from pathlib import Path
from deckyfin_config import (
    get_games_config, detect_game_folders,
    get_app_folder, get_saves_folder, save_games_config,
)

games_path = Path(sys.argv[2])
mode = sys.argv[3]

if mode == "init":
    games_path.mkdir(parents=True, exist_ok=True)
    get_app_folder(games_path).mkdir(parents=True, exist_ok=True)
    get_saves_folder(games_path).mkdir(parents=True, exist_ok=True)

existing_config = get_games_config(games_path)
existing_games = {g["name"]: g for g in existing_config.get("games", [])}

if mode == "init":
    # Current folders on disk (name → folder_name)
    current_folders = {fi["name"]: fi["path"] for fi in detect_game_folders(games_path)}

    # Update path field for existing entries whose path was stored as a slug
    for name, game in existing_games.items():
        if name in current_folders and game.get("path") != current_folders[name]:
            game["path"] = current_folders[name]

    # Remove entries for folders that no longer exist
    existing_games = {n: g for n, g in existing_games.items() if n in current_folders}

    # Add blank entries for new folders
    new_games = []
    for name, folder_path in current_folders.items():
        if name not in existing_games:
            existing_games[name] = {
                "name": name, "path": folder_path, "executable": "",
                "steam_app_id": None, "proton_version": "",
                "proton_dependencies": [], "proton_sync_paths": [],
                "categories": [], "launch_options": "",
            }
            new_games.append(name)

    save_games_config({"games": list(existing_games.values())}, games_path)
    print(json.dumps({"success": True, "games_count": len(existing_games), "games_initialized": new_games}))
else:
    print(json.dumps(list(existing_games.values())))
"""


def _run_source_script(mode: str, path: str, owner_uid: int, owner_gid: int) -> dict | list | None:
    """Run _SOURCE_GAMES_SCRIPT as owner uid/gid.  Returns parsed JSON or None on failure."""
    import functools, json as _json
    try:
        proc = subprocess.run(
            ["python3", "-", _PY_MODULES, path, mode],
            input=_SOURCE_GAMES_SCRIPT,
            capture_output=True, text=True, timeout=30,
            preexec_fn=functools.partial(_drop_privs, owner_uid, owner_gid),
        )
        _debug(f"_run_source_script mode={mode} rc={proc.returncode} err={proc.stderr.strip()[:300]!r}")
        if proc.returncode == 0 and proc.stdout.strip():
            return _json.loads(proc.stdout.strip())
    except Exception as e:
        _debug(f"_run_source_script mode={mode} failed: {e!r}")
    return None


def _owner_creds_for(path: str) -> tuple:
    """Return (uid, gid) of the given path, or of the nearest stat-able ancestor.

    FUSE mounts without -o allow_other block stat() from other users — even
    root.  Walking up to the nearest accessible parent gives us the UID/GID of
    the user who owns (and likely mounted) the filesystem.
    """
    p = Path(path)
    while True:
        try:
            st = os.stat(str(p))
            return st.st_uid, st.st_gid
        except OSError:
            parent = p.parent
            if parent == p:  # reached filesystem root with no luck
                return 0, 0
            p = parent


def _drop_privs(uid: int, gid: int) -> None:
    """Drop to uid/gid. Call as subprocess preexec_fn (must run while still root)."""
    os.setgid(gid)   # change GID first, while still root
    os.setuid(uid)


def _write_game_config_to_source(
    game_name: str, src_path: str, dst_path: str,
    dst_owner_uid: int, dst_owner_gid: int
) -> None:
    """Copy portable config fields from src to dst. Falls back to subprocess on PermissionError."""
    import functools
    from deckyfin_transfer import copy_game_config_fields
    try:
        copy_game_config_fields(game_name, Path(src_path), Path(dst_path))
    except PermissionError:
        if os.getuid() == 0 and dst_owner_uid != 0:
            script = (
                "import sys; sys.path.insert(0,sys.argv[1]); "
                "from pathlib import Path; "
                "from deckyfin_transfer import copy_game_config_fields; "
                "copy_game_config_fields(sys.argv[2], Path(sys.argv[3]), Path(sys.argv[4]))"
            )
            proc = subprocess.run(
                ["python3", "-c", script, _PY_MODULES, game_name, src_path, dst_path],
                capture_output=True, text=True, timeout=15,
                preexec_fn=functools.partial(_drop_privs, dst_owner_uid, dst_owner_gid),
            )
            if proc.returncode != 0:
                raise PermissionError(
                    f"FUSE config write failed: {proc.stderr.strip()[:200]}"
                )
        else:
            raise



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
        # Clear stale per-game restart flags from state store.
        try:
            clear_all_restart_flags()
        except Exception:
            pass
        # Also clear legacy restart flags written to source configs before state separation.
        try:
            for _src in _list_sources():
                _spath = _src.get("path")
                if _spath:
                    for _g in list_game_configs(Path(_spath)):
                        if _g.get("needs_restart_after_add") or _g.get("needs_restart"):
                            update_game_config(_g["name"], {"needs_restart_after_add": None, "needs_restart": None}, Path(_spath))
        except Exception:
            pass
        # Migrate legacy games_folder to sources list (runs once)
        try:
            migrated = _migrate_games_folder_to_source()
            if migrated:
                _debug("_main: migrated games_folder to sources list")
        except Exception as e:
            _debug(f"_main: migration error: {e}")

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

    # ── Sources ───────────────────────────────────────────────────────────

    async def list_sources(self) -> list:
        return _list_sources()

    async def add_source(
        self,
        name: str,
        type: str,
        path: Optional[str] = None,
        url: Optional[str] = None,
    ) -> dict:
        try:
            source = _add_source(name, type, path, url)
            return {"success": True, "source": source}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def remove_source(self, source_id: str) -> dict:
        removed = _remove_source(source_id)
        return {"success": removed, "error": None if removed else f"Source '{source_id}' not found"}

    async def get_source_capabilities(self, source_id: str) -> dict:
        source = _get_source_by_id(source_id)
        if not source:
            return {"can_play": False, "can_write_config": False, "can_download_to": False}
        caps = _detect_capabilities(source)
        # os.access() from root returns False for FUSE mounts (kernel blocks root) and NFS
        # with root_squash (root → nobody). But our update_game_config subprocess fallback
        # can write as the path owner, so report True whenever we can actually do the write.
        if os.getuid() == 0 and not caps["can_write_config"]:
            path = source.get("path", "")
            owner_uid, _ = _owner_creds_for(path) if path else (0, 0)
            if owner_uid != 0:
                caps = dict(caps)
                caps["can_write_config"] = True
                caps["can_download_to"] = True
        return caps

    async def copy_game_config(
        self, game_name: str, from_source_id: str, to_source_id: str
    ) -> dict:
        """Copy portable config fields for game_name from one source to another."""
        src_source = _get_source_by_id(from_source_id)
        dst_source = _get_source_by_id(to_source_id)
        if not src_source or not dst_source:
            return {"success": False, "error": "Source not found"}
        src_path = src_source.get("path")
        dst_path = dst_source.get("path")
        if not src_path or not dst_path:
            return {"success": False, "error": "Source has no path"}
        try:
            dst_owner_uid, dst_owner_gid = _owner_creds_for(dst_path)
            _write_game_config_to_source(
                game_name, src_path, dst_path, dst_owner_uid, dst_owner_gid
            )
            _debug(f"copy_game_config: {game_name!r} {from_source_id!r} → {to_source_id!r}")
            return {"success": True}
        except Exception as e:
            _debug(f"copy_game_config: error: {e!r}")
            return {"success": False, "error": str(e)}

    async def get_source_disk_usage(self, source_id: str) -> dict:
        import functools, json as _json
        source = _get_source_by_id(source_id)
        if not source:
            return {"used": None, "total": None, "free": None}
        path = source.get("path", "")
        current_uid = os.getuid()
        owner_uid, owner_gid = _owner_creds_for(path) if path else (0, 0)
        # For FUSE mounts owned by another user, statvfs from root is blocked.
        # Run a Python subprocess as the path owner to get disk usage.
        if path and current_uid == 0 and owner_uid != 0:
            try:
                proc = subprocess.run(
                    [
                        "python3", "-c",
                        "import shutil,json,sys;"
                        "u=shutil.disk_usage(sys.argv[1]);"
                        "print(json.dumps({'used':u.used,'total':u.total,'free':u.free}))",
                        path,
                    ],
                    capture_output=True, text=True, timeout=15,
                    preexec_fn=functools.partial(_drop_privs, owner_uid, owner_gid),
                )
                if proc.returncode == 0 and proc.stdout.strip():
                    return _json.loads(proc.stdout.strip())
                _debug(f"get_source_disk_usage: subprocess rc={proc.returncode} err={proc.stderr.strip()[:200]!r}")
            except Exception as e:
                _debug(f"get_source_disk_usage: subprocess failed: {e!r}")
        return _get_disk_usage(source)

    async def initialize_source(self, source_id: str) -> dict:
        """Re-scan a source for new game folders and create config entries."""
        source = _get_source_by_id(source_id)
        if not source:
            return {"success": False, "message": f"Source '{source_id}' not found"}
        if source.get("type") == "agent":
            return {"success": False, "message": "Agent sources are managed remotely"}
        path = source.get("path")
        if not path:
            return {"success": False, "message": "Source has no path"}

        try:
            games_path = Path(path)
            games_path.mkdir(parents=True, exist_ok=True)
            get_app_folder(games_path).mkdir(parents=True, exist_ok=True)
            get_saves_folder(games_path).mkdir(parents=True, exist_ok=True)
            existing_config = get_games_config(games_path)
            existing_games = {g["name"]: g for g in existing_config.get("games", [])}
            current_folders = {fi["name"]: fi["path"] for fi in detect_game_folders(games_path)}
            # Fix slug paths from older entries
            for name, game in existing_games.items():
                if name in current_folders and game.get("path") != current_folders[name]:
                    game["path"] = current_folders[name]
            # Remove entries for folders that no longer exist
            existing_games = {n: g for n, g in existing_games.items() if n in current_folders}
            # Add blank entries for new folders
            new_games = []
            for name, folder_path in current_folders.items():
                if name not in existing_games:
                    existing_games[name] = {
                        "name": name,
                        "path": folder_path,
                        "executable": "",
                        "steam_app_id": None,
                        "proton_version": "",
                        "proton_dependencies": [],
                        "proton_sync_paths": [],
                        "categories": [],
                        "launch_options": "",
                    }
                    new_games.append(name)
            save_games_config({"games": list(existing_games.values())}, games_path)
            return {
                "success": True,
                "message": "Source initialized successfully",
                "games_count": len(existing_games),
                "games_initialized": new_games,
            }
        except PermissionError:
            # FUSE mount (e.g. SSHFS without -o allow_root) — retry as path owner.
            # os.seteuid alone is not enough; subprocess with full setuid/setgid required.
            owner_uid, owner_gid = _owner_creds_for(path)
            if os.getuid() == 0 and owner_uid != 0:
                result = _run_source_script("init", path, owner_uid, owner_gid)
                if result is not None:
                    return result
            return {"success": False, "message": "Permission denied on source path"}
        except Exception as e:
            _debug(f"initialize_source: error for {path!r}: {e!r}")
            return {"success": False, "message": str(e)}

    # ── Steam ─────────────────────────────────────────────────────────────

    async def get_steam_running(self) -> dict:
        return {"running": is_steam_running()}

    async def restart_steam(self) -> dict:
        result = restart_steam()
        # Clear the needs-restart flag after restarting
        try:
            self._set_needs_restart_flag(False)
        except Exception:
            pass
        # Clear per-game restart flags from state store.
        try:
            clear_all_restart_flags()
        except Exception:
            pass
        # Also clear legacy flags from source configs (migration).
        try:
            for _src in _list_sources():
                _spath = _src.get("path")
                if _spath:
                    for _g in list_game_configs(Path(_spath)):
                        if _g.get("needs_restart_after_add") or _g.get("needs_restart"):
                            update_game_config(_g["name"], {"needs_restart_after_add": None, "needs_restart": None}, Path(_spath))
        except Exception:
            pass
        return result

    async def get_needs_restart(self) -> bool:
        try:
            flag_file = self._needs_restart_file()
            return flag_file.exists()
        except Exception:
            return False

    async def set_needs_restart(self, value: bool) -> dict:
        try:
            self._set_needs_restart_flag(value)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _needs_restart_file(self) -> Path:
        from deckyfin_config import get_app_folder
        return get_app_folder() / "needs_restart"

    def _set_needs_restart_flag(self, value: bool):
        flag_file = self._needs_restart_file()
        if value:
            flag_file.touch(exist_ok=True)
        else:
            flag_file.unlink(missing_ok=True)

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
        result = initialize_app_structure(games_folder)
        # Clear needs_restart_after_add for all games — Steam has (re)started
        try:
            clear_all_restart_flags()
        except Exception:
            pass
        return result

    # ── Games ─────────────────────────────────────────────────────────────

    async def get_games(self) -> list:
        """Return all games from all sources, merged by name."""
        sources = _list_sources()
        merged: dict[str, dict] = {}
        current_uid = os.getuid()
        for source in sources:
            games = []
            try:
                games = _load_source_games(source)
            except PermissionError:
                # FUSE mount — retry as path owner via subprocess
                path = source.get("path", "")
                if path and current_uid == 0:
                    owner_uid, owner_gid = _owner_creds_for(path)
                    if owner_uid != 0:
                        result = _run_source_script("load", path, owner_uid, owner_gid)
                        if isinstance(result, list):
                            games = result
            except Exception as e:
                _debug(f"get_games: failed to load source {source['id']}: {e}")
                continue
            for game in games:
                name = game.get("name", "")
                if not name:
                    continue
                # Overlay ephemeral state from central store (state takes precedence over config)
                state = get_game_state(source["id"], name)
                if state:
                    game = {**game, **state}
                if name not in merged:
                    merged[name] = {"name": name, "sources": []}
                merged[name]["sources"].append({
                    "source_id": source["id"],
                    "source_name": source["name"],
                    "source_type": source["type"],
                    "config": game,
                })
        return list(merged.values())

    async def get_game(self, name: str, source_id: Optional[str] = None) -> dict:
        source = _get_source_by_id(source_id) if source_id else (_list_sources() or [None])[0]
        if not source:
            return {"success": False, "error": "No source configured"}
        path = source.get("path")
        game = get_game_config(name, Path(path) if path else None)
        if game:
            state = get_game_state(source["id"], name)
            if state:
                game = {**game, **state}
            return {"success": True, "game": game}
        return {"success": False, "error": f"Game '{name}' not found"}

    async def add_game(self, config: dict) -> dict:
        try:
            result = add_game_config(config)
            return {"success": True, "game": result}
        except GameConfigError as e:
            return {"success": False, "error": str(e)}

    async def update_game_config(self, name: str, updates: dict, source_id: Optional[str] = None) -> dict:
        """Update specific fields on an existing game config."""
        import functools, json as _json
        source = _get_source_by_id(source_id) if source_id else (_list_sources() or [None])[0]
        if not source:
            return {"success": False, "error": "No source configured"}
        path = source.get("path")
        # Split into permanent config and ephemeral state
        config_updates = {k: v for k, v in updates.items() if k not in STATE_FIELDS}
        state_updates = {k: v for k, v in updates.items() if k in STATE_FIELDS}
        try:
            if config_updates:
                try:
                    update_game_config(name, config_updates, Path(path) if path else None)
                except PermissionError:
                    # FUSE mount — write config as path owner via subprocess
                    owner_uid, owner_gid = _owner_creds_for(path or "")
                    if os.getuid() == 0 and owner_uid != 0:
                        script = (
                            "import sys,json; sys.path.insert(0,sys.argv[1]); "
                            "from pathlib import Path; "
                            "from deckyfin_config import update_game_config; "
                            "updates=json.loads(sys.argv[4]); "
                            "update_game_config(sys.argv[3], updates, Path(sys.argv[2])); "
                            "print('ok')"
                        )
                        proc = subprocess.run(
                            ["python3", "-c", script, _PY_MODULES, path, name,
                             _json.dumps(config_updates)],
                            capture_output=True, text=True, timeout=15,
                            preexec_fn=functools.partial(_drop_privs, owner_uid, owner_gid),
                        )
                        if proc.returncode != 0:
                            _debug(f"update_game_config: FUSE write failed: {proc.stderr.strip()[:200]!r}")
                            return {"success": False, "error": "Permission denied on source path"}
                    else:
                        raise
            if state_updates:
                update_game_state(source["id"], name, state_updates)
            game = get_game_config(name, Path(path) if path else None)
            if game is None and path:
                # Read game config via subprocess for FUSE paths
                owner_uid, owner_gid = _owner_creds_for(path)
                if os.getuid() == 0 and owner_uid != 0:
                    result = _run_source_script("load", path, owner_uid, owner_gid)
                    if isinstance(result, list):
                        game = next((g for g in result if g.get("name") == name), None)
            if game:
                st = get_game_state(source["id"], name)
                if st:
                    game = {**game, **st}
            return {"success": True, "game": game}
        except GameConfigError as e:
            return {"success": False, "error": str(e)}

    async def set_game_processing_state(self, name: str, state: dict | None, source_id: Optional[str] = None) -> dict:
        """Persist the current processing state for a game (e.g. installing deps).

        Pass None to clear the state after processing completes.
        """
        source = _get_source_by_id(source_id) if source_id else (_list_sources() or [None])[0]
        if not source:
            return {"success": False, "error": "No source configured"}
        try:
            update_game_state(source["id"], name, {"processing_state": state})
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def get_game_processing_state(self, name: str, source_id: Optional[str] = None) -> dict | None:
        """Check if a game has a persisted processing state.

        Returns the state dict (e.g. {status: "installing", ...}) or None.
        """
        source = _get_source_by_id(source_id) if source_id else (_list_sources() or [None])[0]
        if not source:
            return None
        try:
            state = get_game_state(source["id"], name)
            return state.get("processing_state")
        except Exception:
            return None

    async def remove_game(self, name: str, source_id: Optional[str] = None) -> dict:
        source = _get_source_by_id(source_id) if source_id else (_list_sources() or [None])[0]
        if not source:
            return {"success": False, "error": "No source configured"}
        path = source.get("path")
        removed = remove_game_config(name, Path(path) if path else None)
        return {"success": removed, "error": None if removed else f"Game '{name}' not found"}

    async def list_nonsteam_games(self) -> list:
        return list_nonsteam_games()

    # ── Scanning ──────────────────────────────────────────────────────────

    async def scan_games_folder(self) -> list:
        games_path = get_games_folder()
        if not games_path:
            return [{"error": "Games folder not configured"}]
        return detect_game_folders(Path(games_path))

    async def scan_game_exes(self, subfolder: str, source_id: Optional[str] = None) -> list:
        if source_id:
            src = _get_source_by_id(source_id)
            games_path = src.get("path") if src else None
        else:
            folder = get_games_folder()
            games_path = str(folder) if folder else None
        if not games_path:
            return [{"error": "Games folder not configured"}]
        return find_game_executables(Path(games_path) / subfolder)

    async def list_subfolders(self, path: str) -> list:
        """List subdirectory names under the given path. Used by the folder browser."""
        try:
            _debug(f"list_subfolders: path={path!r}")
            current_uid = os.getuid()
            owner_uid, owner_gid = _owner_creds_for(path)
            _debug(f"list_subfolders: current_uid={current_uid} owner_uid={owner_uid} owner_gid={owner_gid}")

            # When running as root and the path is owned by another user, spawn
            # `find` as that user.  This lets us enter FUSE mounts (e.g. SSHFS
            # without -o allow_other) that block root at the kernel level.
            # The kernel FUSE check requires BOTH uid AND gid to match the mount
            # creator, so we must drop both (gid first, while still root).
            if current_uid == 0 and owner_uid != 0:
                try:
                    import functools
                    proc = subprocess.run(
                        ["find", path, "-maxdepth", "1", "-mindepth", "1", "-type", "d"],
                        capture_output=True, text=True, timeout=10,
                        preexec_fn=functools.partial(_drop_privs, owner_uid, owner_gid),
                    )
                    _debug(f"list_subfolders: find rc={proc.returncode} stderr={proc.stderr.strip()[:200]!r}")
                    if proc.stdout.strip():
                        items = sorted(
                            os.path.basename(p)
                            for p in proc.stdout.strip().split("\n")
                            if p.strip()
                        )
                        _debug(f"list_subfolders: {len(items)} subdirs (find/uid={owner_uid}/gid={owner_gid})")
                        return items
                except Exception as e:
                    _debug(f"list_subfolders: find failed: {e!r}")

            # Direct scandir: works when already running as the path owner,
            # or for ordinary (non-FUSE) directories.
            try:
                with os.scandir(path) as it:
                    entries = sorted(it, key=lambda e: e.name)
            except OSError as e:
                _debug(f"list_subfolders: OSError scanning {path}: {e}")
                return []
            items = []
            for entry in entries:
                try:
                    if entry.is_dir():
                        items.append(entry.name)
                except OSError:
                    continue
            _debug(f"list_subfolders: {len(items)} subdirs (scandir)")
            return items
        except Exception as e:
            _debug(f"list_subfolders: unexpected error for {path!r}: {e}")
            return []

    # ── Steam Actions ─────────────────────────────────────────────────────

    async def add_steam_shortcut(
        self,
        exe_path: str,
        app_name: str,
        start_dir: Optional[str] = None,
        launch_options: str = "",
        proton_version: Optional[str] = None,
        collections: Optional[list[str]] = None,
        source_id: Optional[str] = None,
    ) -> dict:
        if not exe_path:
            return {"success": False, "error": "Executable path is required"}
        # Resolve relative paths against the source's folder (fall back to legacy games_folder)
        source = _get_source_by_id(source_id) if source_id else None
        base_path = source.get("path") if source else None
        if not base_path:
            folder = get_games_folder()
            base_path = str(folder) if folder else None
        exe = Path(exe_path)
        if not exe.is_absolute() and base_path:
            exe = Path(base_path) / exe_path
        resolved_start = start_dir
        if resolved_start and not Path(resolved_start).is_absolute() and base_path:
            resolved_start = str(Path(base_path) / resolved_start)
        app_id = add_nonsteam_game(str(exe), app_name, resolved_start, launch_options, collections=collections)
        _debug(
            f"add_steam_shortcut: app_id={app_id}, proton_version={proton_version!r}, "
            f"app_name={app_name}, exe={exe}"
        )
        # Also apply Proton version if provided
        if proton_version:
            try:
                user_id = get_user_id()
                _debug(
                    f"add_steam_shortcut: calling set_proton_version("
                    f"app_id={app_id}, proton={proton_version!r}, user={user_id})"
                )
                set_proton_version(app_id, proton_version, user_id, app_name)
                _debug("add_steam_shortcut: set_proton_version OK")
            except Exception as e:
                _debug(f"add_steam_shortcut: set_proton_version FAILED: {e}")
                self.logger.warning("Failed to set Proton version: %s", e)
        # Mark game as needing restart in state store
        try:
            sid = source["id"] if source else ""
            update_game_state(sid, app_name, {"needs_restart_after_add": True, "needs_restart": True})
        except Exception:
            pass
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
        proton_version: Optional[str] = None,
        collections: Optional[list[str]] = None,
        source_id: Optional[str] = None,
    ) -> dict:
        """Update an existing Steam shortcut in-place. Returns error if not found."""
        # Resolve relative paths against the source's folder (fall back to legacy games_folder)
        source = _get_source_by_id(source_id) if source_id else None
        base_path = source.get("path") if source else None
        if not base_path:
            folder = get_games_folder()
            base_path = str(folder) if folder else None
        exe = Path(exe_path)
        if not exe.is_absolute() and base_path:
            exe = Path(base_path) / exe_path
        resolved_start = start_dir
        if resolved_start and not Path(resolved_start).is_absolute() and base_path:
            resolved_start = str(Path(base_path) / resolved_start)
        app_id = update_nonsteam_game(
            app_name, str(exe), resolved_start or "", launch_options, collections=collections
        )
        if app_id is None:
            return {
                "success": False,
                "error": f"'{app_name}' not found in Steam shortcuts — add it first",
            }
        # Also update Proton version if provided
        if proton_version:
            try:
                user_id = get_user_id()
                from deckyfin_proton_compat import set_proton_version
                set_proton_version(app_id, proton_version, user_id, app_name)
            except Exception as e:
                self.logger.warning("Failed to set Proton version: %s", e)
        # Mark game as needing restart in state store
        try:
            sid = source["id"] if source else ""
            update_game_state(sid, app_name, {"needs_restart": True})
            self.logger.info("Marked '%s' as needs_restart", app_name)
        except Exception as e:
            self.logger.warning("Failed to mark needs_restart for '%s': %s", app_name, e)
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

    async def purge_steam_game_data(self, app_name: str, user_id: Optional[str] = None) -> dict:
        """Remove a non-Steam game and ALL its data (shortcut, configs, prefix, grid art)."""
        result = purge_nonsteam_game_data(app_name, user_id)
        return {
            "success": bool(result["removed_shortcut"]),
            **result,
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

    async def list_steam_collections(self) -> list[str]:
        """List all existing Steam collection names."""
        return list_steam_collections()

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

    async def get_protontricks_status(self) -> dict:
        """Check protontricks availability — flatpak and native."""
        return _detect_protontricks_status()

    async def install_protontricks(self) -> dict:
        """Install protontricks via flatpak from Flathub."""
        return _install_protontricks_flatpak()

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

    async def download_as_base64(self, url: str) -> str:
        """Download a file from URL and return as base64 string."""
        import base64
        from urllib.request import Request, urlopen
        try:
            from deckyfin_steamgrid import _ssl_context as _sgdb_ssl
            ctx = _sgdb_ssl()
        except Exception:
            ctx = ssl.create_default_context()
        req = Request(url, headers={"User-Agent": "deckyfin backend"})
        content = urlopen(req, context=ctx).read()
        return base64.b64encode(content).decode("utf-8")

    async def read_file_as_base64(self, path: str) -> str:
        """Read a local file and return as base64 string."""
        import base64
        with open(path, "rb") as f:
            return base64.b64encode(f.read()).decode("utf-8")

    async def fetch_steamgrid_art_urls(self, game_name: str) -> dict:
        """Search SteamGridDB and return art URLs for a game name (no download).

        Returns dict with keys: success, error, game_id, game_name,
        grid_p (eAssetType 0), hero (eAssetType 1), logo (eAssetType 2),
        wide (eAssetType 3).
        """
        return _fetch_steamgrid_art_urls(game_name)

    async def search_steamgrid_games(self, game_name: str) -> dict:
        """Search SteamGridDB for games matching a name. Returns all matches.

        Returns list of {id, name} dicts for the user to pick from.
        """
        results = _search_steamgrid_games(game_name)
        return {"success": len(results) > 0, "games": results}

    async def fetch_steamgrid_art_urls_by_id(self, game_id: int, game_name: str | None = None) -> dict:
        """Fetch SteamGridDB art URLs for a specific game by its SGDB ID.

        Returns the same structure as fetch_steamgrid_art_urls.
        """
        return _fetch_steamgrid_art_urls_by_id(game_id, game_name)

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
        """Get art for a game as a base64 data URI (for the library card).

        Reads from the Steam grid folder (only for games already in Steam).
        Games not yet in Steam show the gradient placeholder.
        """
        import base64
        try:
            from steam_games import get_steam_shortcut_info
            from steam_utils import get_user_id, find_steam_root
            from deckyfin_consts import STEAM_USERDATA_FOLDER

            uid = get_user_id()
            info = get_steam_shortcut_info(game_name, uid)
            if info:
                unsigned_appid = info.get("unsigned_appid")
                if unsigned_appid:
                    steam_root = find_steam_root()
                    grid_folder = steam_root / STEAM_USERDATA_FOLDER / uid / "config" / "grid"
                    appid_str = str(unsigned_appid)
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
            logging.getLogger(APP_NAME).warning("Failed to get card art for '%s': %s", game_name, e)
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
