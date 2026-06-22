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
    slugify,
    GameConfigError,
)
from steam_games import add_nonsteam_game, list_nonsteam_games, remove_nonsteam_game, get_steam_shortcut_info, update_nonsteam_game, purge_nonsteam_game_data, list_steam_collections, create_steam_collection, delete_steam_collection
from deckyfin_proton import (
    list_available_proton, ensure_proton_available, get_proton_version_for_game,
    list_proton_sources, fetch_proton_releases, start_proton_install,
    cancel_proton_install, delete_proton_version, get_proton_install_statuses,
)
from deckyfin_proton_compat import set_proton_version
from deckyfin_prefix import init_proton_prefix
from deckyfin_protontricks import (
    install_protontricks_dependencies,
    detect_protontricks_status as _detect_protontricks_status,
    install_protontricks_flatpak as _install_protontricks_flatpak,
)
from deckyfin_steamgrid import apply_steam_grid as _apply_steam_grid, set_api_key as _set_steamgrid_key, get_configured_api_key as _get_steamgrid_key, fetch_steamgrid_art_urls as _fetch_steamgrid_art_urls, search_steamgrid_games as _search_steamgrid_games, fetch_steamgrid_art_urls_by_id as _fetch_steamgrid_art_urls_by_id, download_file as _download_file, fetch_steamgrid_art_page as _fetch_steamgrid_art_page, search_game as _sgdb_search_game, fetch_steam_art_options_page as _fetch_steam_art_options_page
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
    reorder_source as _reorder_source,
    get_source_by_id as _get_source_by_id,
    detect_capabilities as _detect_capabilities,
    get_disk_usage as _get_disk_usage,
    migrate_games_folder_to_source as _migrate_games_folder_to_source,
    load_source_games as _load_source_games,
)
from steam_utils import get_user_id, list_steam_users
from steam_games import convert_appid_to_unsigned_32bit
from deckyfin_consts import APP_NAME, APP_VERSION

DEBUG_LOG = Path(os.environ.get("DECKY_PLUGIN_RUNTIME_DIR", str(Path(__file__).parent))) / "debug.log"


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
_transfer_run_fns: dict = {}  # transfer_id → _run closure (not serialized to frontend)

_dep_install_registry: dict = {}
# Key: f"{game_name}|{source_id}"
# Value: {game_name, source_id, deps, status: "installing"|"done"|"failed", installed, failed_deps, error}

_config_copy_registry: dict = {}
# Key: copy_id (UUID hex[:8])
# Value: {copy_id, game_name, from_source_id, to_source_id, status: "running"|"done"|"failed", error}

_prefix_init_registry: dict = {}
# Key: prefix_id (UUID hex[:8])
# Value: {prefix_id, game_name, app_id, status: "running"|"done"|"failed", error}

_save_sync_registry: dict = {}
# Key: sync_id (UUID hex[:8])
# Value: {sync_id, game_name, source_id, direction: "backup"|"restore"|"copy",
#         from_source_id?, to_source_id?, status: "running"|"done"|"failed", error, copied}

_batch_add_registry: dict = {}
# Key: job_id (UUID hex[:8])
# Value: {job_id, source_name, status: "running"|"done"|"failed", current_game,
#         total, processed, added, updated, skipped, failed, needs_restart, error}


# Navigation state — in-memory only, intentionally cleared on Python restart (Steam restart).
# Sidebar close/reopen keeps the Python process alive so state is preserved.
# Keys: view, game_name, source_id, draft
_session_nav: dict = {}


def _get_max_parallel_transfers() -> int:
    try:
        from deckyfin_config import get_app_config
        return int(get_app_config().get("max_parallel_transfers", 1))
    except Exception:
        return 1


def _try_start_next_queued() -> None:
    """Start as many queued transfers as the current parallel limit allows."""
    limit = _get_max_parallel_transfers()
    while True:
        running = sum(1 for e in _transfer_registry.values() if e["status"] == "running")
        if running >= limit:
            return
        queued = sorted(
            [(tid, e) for tid, e in _transfer_registry.items() if e["status"] == "queued"],
            key=lambda x: x[1]["started_at"],
        )
        if not queued:
            return
        tid, entry = queued[0]
        run_fn = _transfer_run_fns.pop(tid, None)
        if run_fn:
            entry["status"] = "running"
            _threading.Thread(target=run_fn, daemon=True).start()
        else:
            _transfer_registry.pop(tid, None)

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
    get_app_folder, get_saves_folder, save_games_config, slugify,
)

games_path = Path(sys.argv[2])
mode = sys.argv[3]

if mode == "init":
    games_path.mkdir(parents=True, exist_ok=True)
    get_app_folder(games_path).mkdir(parents=True, exist_ok=True)
    get_saves_folder(games_path).mkdir(parents=True, exist_ok=True)

existing_config = get_games_config(games_path)
raw_games = existing_config.get("games", [])

# Build lookup indexes: by id (preferred) and by path (migration fallback)
existing_by_id = {}
existing_by_path = {}
for g in raw_games:
    if g.get("id"):
        existing_by_id[g["id"]] = g
    if g.get("path"):
        existing_by_path[g["path"]] = g

if mode == "init":
    current_folders = {fi["path"]: fi for fi in detect_game_folders(games_path)}

    matched_games = {}
    new_games = []
    for folder_path, folder_info in current_folders.items():
        game_id = slugify(folder_path)
        existing = existing_by_id.get(game_id) or existing_by_path.get(folder_path)
        if existing:
            g = dict(existing)
            g["id"] = game_id
            g["path"] = folder_path
            matched_games[game_id] = g
        else:
            matched_games[game_id] = {
                "id": game_id, "name": folder_info["name"], "path": folder_path,
                "executable": "", "steam_app_id": None, "proton_version": "",
                "proton_dependencies": [], "proton_sync_paths": [],
                "categories": [], "launch_options": "",
            }
            new_games.append(folder_info["name"])

    save_games_config({"games": list(matched_games.values())}, games_path)
    print(json.dumps({"success": True, "games_count": len(matched_games), "games_initialized": new_games}))
else:
    # load mode: migrate id on the fly without writing (read-only)
    result = []
    for g in raw_games:
        if not g.get("id"):
            g = dict(g)
            g["id"] = slugify(g.get("path") or g.get("name", ""))
        result.append(g)
    print(json.dumps(result))
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
    owner_uid: int, owner_gid: int,
    src_is_mount: bool = False,
    dst_is_mount: bool = False,
) -> None:
    """Copy portable config fields from src to dst.

    When src or dst is a FUSE/mount and running as root, uses subprocess as
    the mount owner (root is blocked from FUSE without -o allow_root/allow_other).
    """
    import functools, json as _json
    from deckyfin_transfer import PORTABLE_FIELDS

    needs_unpriv = os.getuid() == 0 and owner_uid != 0

    # Step 1: read portable fields from src
    if src_is_mount and needs_unpriv:
        read_script = (
            "import sys, json; sys.path.insert(0,sys.argv[1]); "
            "from pathlib import Path; "
            "from deckyfin_config import get_games_config; "
            "from deckyfin_transfer import PORTABLE_FIELDS; "
            "cfg = get_games_config(Path(sys.argv[2])); "
            "game = next((g for g in cfg.get('games',[]) if g.get('name')==sys.argv[3]), None); "
            "print(json.dumps({k:v for k,v in game.items() if k in PORTABLE_FIELDS} if game else None))"
        )
        proc = subprocess.run(
            ["python3", "-c", read_script, _PY_MODULES, src_path, game_name],
            capture_output=True, text=True, timeout=10,
            preexec_fn=functools.partial(_drop_privs, owner_uid, owner_gid),
        )
        _debug(f"_write_game_config_to_source read: rc={proc.returncode} stderr={proc.stderr.strip()[:200]!r}")
        if proc.returncode != 0 or not proc.stdout.strip():
            raise PermissionError(f"Failed to read source config: {proc.stderr.strip()[:200]}")
        portable = _json.loads(proc.stdout.strip())
        if portable is None:
            raise ValueError(f"Game '{game_name}' not found in source config at {src_path}")
    else:
        from deckyfin_config import get_games_config as _get_cfg
        src_config = _get_cfg(Path(src_path))
        src_game = next(
            (g for g in src_config.get("games", []) if g.get("name") == game_name),
            None,
        )
        if src_game is None:
            raise ValueError(f"Game '{game_name}' not found in source config at {src_path}")
        portable = {k: v for k, v in src_game.items() if k in PORTABLE_FIELDS}

    # Step 2: write to dst — use subprocess when dst is a FUSE/user mount
    if dst_is_mount and needs_unpriv:
        write_script = (
            "import sys, json; sys.path.insert(0, sys.argv[1]); "
            "from pathlib import Path; "
            "from deckyfin_config import get_games_config, save_games_config; "
            "game_name = sys.argv[3]; portable = json.loads(sys.argv[4]); "
            "dst_config = get_games_config(Path(sys.argv[2])); "
            "games = dst_config.get('games', []); "
            "names = [g.get('name') for g in games]; "
            "updated = [({**g, **portable} if g.get('name') == game_name else g) for g in games]; "
            "final = updated if game_name in names else updated + [{'name': game_name, **portable}]; "
            "dst_config['games'] = final; save_games_config(dst_config, Path(sys.argv[2]))"
        )
        proc = subprocess.run(
            ["python3", "-c", write_script, _PY_MODULES, dst_path, game_name, _json.dumps(portable)],
            capture_output=True, text=True, timeout=10,
            preexec_fn=functools.partial(_drop_privs, owner_uid, owner_gid),
        )
        _debug(f"_write_game_config_to_source write: rc={proc.returncode} stderr={proc.stderr.strip()[:200]!r}")
        if proc.returncode != 0:
            raise PermissionError(f"Failed to write dest config: {proc.stderr.strip()[:200]}")
    else:
        from deckyfin_config import get_games_config as _get_cfg2, save_games_config
        dst_config = _get_cfg2(Path(dst_path))
        dst_games = dst_config.get("games", [])
        found = False
        for i, g in enumerate(dst_games):
            if g.get("name") == game_name:
                dst_games[i] = {**g, **portable}
                found = True
                break
        if not found:
            dst_games.append({"name": game_name, **portable})
        dst_config["games"] = dst_games
        save_games_config(dst_config, Path(dst_path))


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

    async def reorder_source(self, source_id: str, direction: str) -> dict:
        moved = _reorder_source(source_id, direction)
        return {"success": moved}

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
        """Start a background config copy. Poll list_config_copy_statuses for progress."""
        src_source = _get_source_by_id(from_source_id)
        dst_source = _get_source_by_id(to_source_id)
        if not src_source or not dst_source:
            return {"success": False, "error": "Source not found"}
        src_path = src_source.get("path")
        dst_path = dst_source.get("path")
        if not src_path or not dst_path:
            return {"success": False, "error": "Source has no path"}

        copy_id = _uuid.uuid4().hex[:8]
        _config_copy_registry[copy_id] = {
            "copy_id": copy_id,
            "game_name": game_name,
            "from_source_id": from_source_id,
            "to_source_id": to_source_id,
            "status": "running",
            "error": None,
        }

        def _run():
            try:
                src_is_mount = src_source.get("type") == "mount"
                dst_is_mount = dst_source.get("type") == "mount"
                dst_owner_uid, dst_owner_gid = _owner_creds_for(dst_path)
                _write_game_config_to_source(
                    game_name, src_path, dst_path,
                    dst_owner_uid, dst_owner_gid,
                    src_is_mount=src_is_mount,
                    dst_is_mount=dst_is_mount,
                )
                _config_copy_registry[copy_id]["status"] = "done"
                _debug(f"copy_game_config: {game_name!r} {from_source_id!r} → {to_source_id!r} done")
            except Exception as e:
                _debug(f"copy_game_config: error: {e!r}")
                _config_copy_registry[copy_id]["status"] = "failed"
                _config_copy_registry[copy_id]["error"] = str(e)

        _threading.Thread(target=_run, daemon=True).start()
        return {"success": True, "copy_id": copy_id}

    async def list_config_copy_statuses(self) -> dict:
        """Return a snapshot of all tracked config copy operations."""
        return {k: dict(v) for k, v in _config_copy_registry.items()}

    async def clear_config_copy_status(self, copy_id: str) -> dict:
        """Remove a completed config copy entry from the registry."""
        _config_copy_registry.pop(copy_id, None)
        return {"success": True}

    async def start_game_transfer(
        self, game_name: str, from_source_id: str, to_source_id: str
    ) -> dict:
        """Start a background file transfer. Returns {success, transfer_id}."""
        import functools
        src_source = _get_source_by_id(from_source_id)
        dst_source = _get_source_by_id(to_source_id)
        if not src_source or not dst_source:
            return {"success": False, "error": "Source not found"}
        src_path = src_source.get("path")
        dst_path = dst_source.get("path")
        if not src_path or not dst_path:
            return {"success": False, "error": "Source has no path"}

        src_game_dir = Path(src_path) / game_name
        dst_game_dir = Path(dst_path) / game_name

        src_uid, src_gid = _owner_creds_for(src_path)
        dst_uid, dst_gid = _owner_creds_for(dst_path)
        # Pick non-root creds if available (for FUSE mounts)
        owner_uid = src_uid if src_uid != 0 else dst_uid
        owner_gid = src_gid if src_uid != 0 else dst_gid  # track same branch as uid

        # Check source game folder exists — use subprocess for FUSE mounts (root blocked)
        try:
            if os.getuid() == 0 and owner_uid != 0:
                chk = subprocess.run(
                    ["python3", "-c",
                     "import sys, os; sys.exit(0 if os.path.isdir(sys.argv[1]) else 1)",
                     str(src_game_dir)],
                    capture_output=True, timeout=5,
                    preexec_fn=functools.partial(_drop_privs, owner_uid, owner_gid),
                )
                src_game_exists = chk.returncode == 0
            else:
                src_game_exists = src_game_dir.exists()
        except Exception:
            src_game_exists = True  # let the copy attempt fail with a real error
        if not src_game_exists:
            return {"success": False, "error": f"Game folder not found: {src_game_dir}"}

        # Reject if a transfer to the same destination is already running
        already = next(
            (e for e in _transfer_registry.values()
             if e["game_name"] == game_name
             and e["to_source_id"] == to_source_id
             and e["status"] == "running"),
            None,
        )
        if already:
            return {
                "success": False,
                "error": "Transfer already in progress",
                "transfer_id": already["transfer_id"],
            }

        # Calculate total size (via subprocess if FUSE)
        try:
            if os.getuid() == 0 and owner_uid != 0:
                proc = subprocess.run(
                    ["python3", "-c",
                     "import os,sys;from pathlib import Path;"
                     "t=sum((Path(d)/f).stat().st_size "
                     "for d,_,fs in os.walk(sys.argv[1]) for f in fs);"
                     "print(t)",
                     str(src_game_dir)],
                    capture_output=True, text=True, timeout=60,
                    preexec_fn=functools.partial(_drop_privs, owner_uid, owner_gid),
                )
                total_bytes = (
                    int(proc.stdout.strip())
                    if proc.returncode == 0 and proc.stdout.strip()
                    else 0
                )
            else:
                from deckyfin_transfer import calculate_total_size
                total_bytes = calculate_total_size(src_game_dir)
        except Exception:
            total_bytes = 0

        # Count before adding the new entry so it doesn't count itself.
        running_count = sum(1 for e in _transfer_registry.values() if e["status"] == "running")
        limit = _get_max_parallel_transfers()
        initial_status = "running" if running_count < limit else "queued"

        transfer_id = str(_uuid.uuid4())[:8]
        entry = {
            "transfer_id": transfer_id,
            "game_name": game_name,
            "from_source_id": from_source_id,
            "to_source_id": to_source_id,
            "status": initial_status,
            "bytes_copied": 0,
            "total_bytes": total_bytes,
            "error": None,
            "started_at": _time.time(),
            "cancelled": False,
        }
        _transfer_registry[transfer_id] = entry

        def _run():
            from deckyfin_transfer import copy_game_folder
            try:
                copy_game_folder(
                    src=src_game_dir,
                    dst=dst_game_dir,
                    progress_cb=lambda b: entry.__setitem__("bytes_copied", b),
                    owner_uid=owner_uid,
                    owner_gid=owner_gid,
                    cancelled_flag=entry,
                )
                # Init destination source first — creates .deckyfin/ and a blank
                # game entry so the source shows up even if config copy fails.
                try:
                    _run_source_script("init", dst_path, dst_uid, dst_gid)
                except Exception as init_err:
                    _debug(f"start_game_transfer: init warning: {init_err!r}")
                # Copy portable config fields on top of the blank entry.
                try:
                    _write_game_config_to_source(
                        game_name, src_path, dst_path, owner_uid, owner_gid,
                        src_is_mount=src_source.get("type", "local") != "local",
                    )
                except Exception as cfg_err:
                    _debug(f"start_game_transfer: config copy warning: {cfg_err!r}")
                entry["status"] = "done"
                _debug(f"start_game_transfer: {transfer_id} done")
            except RuntimeError as exc:
                entry["status"] = "failed"
                entry["error"] = str(exc)
                _debug(f"start_game_transfer: {transfer_id} failed: {exc!r}")
            except Exception as exc:
                import shutil
                shutil.rmtree(str(dst_game_dir), ignore_errors=True)
                entry["status"] = "failed"
                entry["error"] = str(exc)
                _debug(f"start_game_transfer: {transfer_id} error: {exc!r}")
            finally:
                if entry["status"] == "running":
                    entry["status"] = "failed"
                    entry["error"] = entry.get("error") or "Transfer interrupted"
                _transfer_run_fns.pop(transfer_id, None)
                _try_start_next_queued()

        if initial_status == "running":
            _threading.Thread(target=_run, daemon=True).start()
        else:
            _transfer_run_fns[transfer_id] = _run
        return {"success": True, "transfer_id": transfer_id}

    async def get_transfer_status(self, transfer_id: str) -> dict:
        entry = _transfer_registry.get(transfer_id)
        if not entry:
            return {"error": "not found"}
        return {k: v for k, v in entry.items() if k not in ("cancelled", "started_at")}

    async def cancel_transfer(self, transfer_id: str) -> dict:
        entry = _transfer_registry.get(transfer_id)
        if not entry:
            return {"success": False, "error": "not found"}
        if entry["status"] == "running":
            entry["cancelled"] = True
        else:
            _transfer_registry.pop(transfer_id, None)
            _transfer_run_fns.pop(transfer_id, None)
            if entry["status"] == "queued":
                _try_start_next_queued()
        return {"success": True}

    async def clear_transfer(self, transfer_id: str) -> dict:
        """Remove a completed or failed transfer from the registry."""
        entry = _transfer_registry.pop(transfer_id, None)
        _transfer_run_fns.pop(transfer_id, None)
        return {"success": entry is not None}

    async def list_active_transfers(self) -> list:
        now = _time.time()
        stale = [
            tid for tid, e in list(_transfer_registry.items())
            if e["status"] in ("done", "failed") and (now - e["started_at"]) > 600
        ]
        for tid in stale:
            _transfer_registry.pop(tid, None)
            _transfer_run_fns.pop(tid, None)
        return [
            {k: v for k, v in e.items() if k not in ("cancelled", "started_at")}
            for e in _transfer_registry.values()
        ]

    async def get_popular_deps(self) -> list:
        from deckyfin_config import get_app_config
        return get_app_config().get("popular_deps", [
            "vcrun2022", "vcrun2019", "vcrun2013", "vcrun2010", "vcrun2008",
            "d3dx9", "d3dx10", "d3dx11", "d3dcompiler_47",
            "dotnet48", "dotnet40", "dotnet35sp1", "dotnet20",
            "physx", "mfplat", "xna", "dwrite", "corefonts",
        ])

    async def set_popular_deps(self, deps: list) -> dict:
        from deckyfin_config import set_app_config
        set_app_config({"popular_deps": [str(d) for d in deps]})
        return {"success": True}

    async def get_popular_launchers(self) -> list:
        from deckyfin_config import get_app_config
        return get_app_config().get("popular_launchers", [
            {"label": "MangoHud",  "value": "mangohud"},
            {"label": "GameMode",  "value": "gamemoderun"},
            {"label": "DXVK HUD", "value": "DXVK_HUD=1"},
            {"label": "WineD3D",  "value": "PROTON_USE_WINED3D=1"},
            {"label": "FSR",       "value": "WINE_FULLSCREEN_FSR=1"},
            {"label": "No EAC",   "value": "PROTON_USE_EAC_LINUX=1"},
        ])

    async def set_popular_launchers(self, launchers: list) -> dict:
        from deckyfin_config import set_app_config
        safe = [{"label": str(l["label"]), "value": str(l["value"])} for l in launchers]
        set_app_config({"popular_launchers": safe})
        return {"success": True}

    async def get_popular_save_prefixes(self) -> list:
        from deckyfin_config import get_app_config
        return get_app_config().get("popular_save_prefixes", [])

    async def set_popular_save_prefixes(self, prefixes: list) -> dict:
        from deckyfin_config import set_app_config
        safe = [{"label": str(p["label"]), "path": str(p["path"])} for p in prefixes]
        set_app_config({"popular_save_prefixes": safe})
        return {"success": True}

    async def get_max_parallel_transfers(self) -> int:
        return _get_max_parallel_transfers()

    async def set_max_parallel_transfers(self, value: int) -> dict:
        from deckyfin_config import set_app_config
        clamped = max(1, min(int(value), 8))
        set_app_config({"max_parallel_transfers": clamped})
        _try_start_next_queued()
        return {"success": True, "value": clamped}

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

        games_path = Path(path)
        for attempt in range(2):
            try:
                games_path.mkdir(parents=True, exist_ok=True)
                get_app_folder(games_path).mkdir(parents=True, exist_ok=True)
                get_saves_folder(games_path).mkdir(parents=True, exist_ok=True)
                existing_config = get_games_config(games_path)
                raw_games = existing_config.get("games", [])
                # Build lookup indexes: by id (preferred) and by path (migration fallback)
                existing_by_id: dict = {}
                existing_by_path: dict = {}
                for g in raw_games:
                    if g.get("id"):
                        existing_by_id[g["id"]] = g
                    if g.get("path"):
                        existing_by_path[g["path"]] = g
                current_folders = {fi["path"]: fi for fi in detect_game_folders(games_path)}
                matched_games: dict = {}
                new_games = []
                for folder_path, folder_info in current_folders.items():
                    game_id = slugify(folder_path)
                    existing = existing_by_id.get(game_id) or existing_by_path.get(folder_path)
                    if existing:
                        g = dict(existing)
                        g["id"] = game_id
                        g["path"] = folder_path
                        matched_games[game_id] = g
                    else:
                        matched_games[game_id] = {
                            "id": game_id,
                            "name": folder_info["name"],
                            "path": folder_path,
                            "executable": "",
                            "steam_app_id": None,
                            "proton_version": "",
                            "proton_dependencies": [],
                            "proton_sync_paths": [],
                            "categories": [],
                            "launch_options": "",
                        }
                        new_games.append(folder_info["name"])
                save_games_config({"games": list(matched_games.values())}, games_path)
                return {
                    "success": True,
                    "message": "Source initialized successfully",
                    "games_count": len(matched_games),
                    "games_initialized": new_games,
                }
            except PermissionError:
                if attempt == 0 and source.get("type") == "local":
                    # .deckyfin owned by nobody (old plugin ran as nobody; now runs as deck).
                    # deck owns the parent games dir, so it can rename .deckyfin away even
                    # though it doesn't own .deckyfin itself, then recreate it as deck.
                    app_folder = get_app_folder(games_path)
                    old_folder = app_folder.parent / ".deckyfin.nobody"
                    try:
                        import json as _json
                        saved_config = None
                        cfg_file = app_folder / "config.json"
                        if cfg_file.exists():
                            saved_config = _json.loads(cfg_file.read_text(encoding="utf-8"))
                        if app_folder.exists():
                            os.rename(str(app_folder), str(old_folder))
                        app_folder.mkdir(parents=True, exist_ok=True)
                        get_saves_folder(games_path).mkdir(parents=True, exist_ok=True)
                        if saved_config:
                            save_games_config(saved_config, games_path)
                        _debug(f"initialize_source: repaired {str(app_folder)!r} (old dir renamed to {old_folder.name!r})")
                        continue
                    except Exception as repair_err:
                        _debug(f"initialize_source: repair failed: {repair_err!r}")
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

    # ── UI State ──────────────────────────────────────────────────────────

    async def get_ui_state(self) -> dict:
        """Return UI state. Nav keys are session-scoped: if Steam's PID changed
        since they were saved, the nav state is stale (Steam restarted) and is
        discarded. Sidebar close/reopen within the same Steam session preserves it."""
        _NAV_KEYS = {"view", "game_name", "source_id", "draft"}
        nav: dict = {}
        if _session_nav:
            saved_pid = _session_nav.get("_steam_pid")
            pid_valid = False
            if saved_pid:
                try:
                    import psutil as _ps
                    proc = _ps.Process(saved_pid)
                    pid_valid = proc.is_running() and "steam" in proc.name().lower()
                except Exception:
                    pass
            if pid_valid:
                nav = {k: v for k, v in _session_nav.items() if k in _NAV_KEYS}
            else:
                _session_nav.clear()
        return nav

    async def save_ui_state(self, state: dict) -> dict:
        """Save UI state. Nav keys go to memory tagged with Steam's current PID."""
        _NAV_KEYS = {"view", "game_name", "source_id", "draft"}
        nav = {k: v for k, v in state.items() if k in _NAV_KEYS}
        if nav:
            try:
                from deckyfin_steam_ctl import _find_steam_processes
                procs = _find_steam_processes()
                steam_pid = next(
                    (p.info["pid"] for p in procs if "steam" in (p.info.get("name") or "").lower()
                     and "webhelper" not in (p.info.get("name") or "").lower()),
                    None,
                )
            except Exception:
                steam_pid = None
            _session_nav.clear()
            _session_nav.update(nav)
            if steam_pid:
                _session_nav["_steam_pid"] = steam_pid
        else:
            _session_nav.clear()
        return {"success": True}

    async def get_view_mode(self) -> str:
        """Return persisted library view mode ('card' or 'list')."""
        from deckyfin_config import get_app_config
        return get_app_config().get("view_mode", "card")

    async def set_view_mode(self, mode: str) -> dict:
        """Persist library view mode across sidebar closes and Steam restarts."""
        from deckyfin_config import set_app_config
        set_app_config({"view_mode": mode if mode in ("card", "list", "art") else "card"})
        return {"success": True}

    async def get_art_enabled(self) -> dict:
        """Return whether Deckyfin artwork loading is enabled."""
        from deckyfin_config import get_app_config
        return {"art_enabled": get_app_config().get("art_enabled", True)}

    async def set_art_enabled(self, enabled: bool) -> dict:
        """Persist artwork enabled/disabled setting to app config."""
        from deckyfin_config import set_app_config
        set_app_config({"art_enabled": bool(enabled)})
        return {"success": True}

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
        """Return all games from all sources, merged by id."""
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
                # Derive stable id (migrate on-the-fly for entries written before v0.2)
                game_id = game.get("id")
                if not game_id:
                    game_id = slugify(game.get("path") or game.get("name", ""))
                    game = {**game, "id": game_id}
                if not game_id:
                    continue
                name = game.get("name", game_id)
                # Overlay ephemeral state from central store (state takes precedence over config)
                state = get_game_state(source["id"], name)
                if state:
                    game = {**game, **state}
                if game_id not in merged:
                    merged[game_id] = {"id": game_id, "name": name, "sources": []}
                merged[game_id]["sources"].append({
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
        try:
            game = get_game_config(name, Path(path) if path else None)
        except PermissionError:
            game = None
        if game is None and path:
            # FUSE/NFS fallback: read via subprocess as the mount owner
            owner_uid, owner_gid = _owner_creds_for(path)
            if owner_uid != 0:
                games = _run_source_script("load", path, owner_uid, owner_gid)
                if isinstance(games, list):
                    game = next((g for g in games if g.get("name") == name), None)
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
        owner_uid, owner_gid = _owner_creds_for(path or "") if path else (0, 0)
        # Only use subprocess for mounted sources (FUSE/network). Root can read
        # and write local sources directly; using subprocess there is unnecessary
        # and breaks when the local path owner differs from what we expect.
        use_subprocess = (
            os.getuid() == 0
            and owner_uid != 0
            and source.get("type", "local") != "local"
        )
        try:
            if config_updates:
                if use_subprocess:
                    # Mounted source — get_games_config silently returns {} as root,
                    # so the direct call would raise GameConfigError("not found").
                    # Go straight to subprocess as the mount owner.
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
                    # Write succeeded — handle state and read back, then return.
                    # Keep read-back errors from masking a successful write.
                    if state_updates:
                        update_game_state(source["id"], name, state_updates)
                    game = None
                    try:
                        result = _run_source_script("load", path, owner_uid, owner_gid)
                        if isinstance(result, list):
                            game = next((g for g in result if g.get("name") == name), None)
                        if game:
                            st = get_game_state(source["id"], name)
                            if st:
                                game = {**game, **st}
                    except Exception as rb_err:
                        _debug(f"update_game_config: read-back warning: {rb_err!r}")
                    return {"success": True, "game": game}
                else:
                    update_game_config(name, config_updates, Path(path) if path else None)
            if state_updates:
                update_game_state(source["id"], name, state_updates)
            game = get_game_config(name, Path(path) if path else None)
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
        import functools, shutil
        source = _get_source_by_id(source_id) if source_id else (_list_sources() or [None])[0]
        if not source:
            return {"success": False, "error": "No source configured"}
        path = source.get("path")
        if not path:
            return {"success": False, "error": "Source has no path"}

        game_dir = Path(path) / name
        owner_uid, owner_gid = _owner_creds_for(path)
        use_subprocess = (
            os.getuid() == 0
            and owner_uid != 0
            and source.get("type", "local") != "local"
        )

        # Delete game folder from disk
        try:
            if use_subprocess:
                subprocess.run(
                    ["python3", "-c",
                     "import sys, shutil; shutil.rmtree(sys.argv[1], ignore_errors=True)",
                     str(game_dir)],
                    capture_output=True, timeout=60,
                    preexec_fn=functools.partial(_drop_privs, owner_uid, owner_gid),
                )
            else:
                shutil.rmtree(str(game_dir), ignore_errors=True)
        except Exception as e:
            _debug(f"remove_game: folder deletion warning: {e!r}")

        # Remove config entry
        if use_subprocess:
            script = (
                "import sys; sys.path.insert(0,sys.argv[1]); "
                "from pathlib import Path; "
                "from deckyfin_config import remove_game_config; "
                "remove_game_config(sys.argv[3], Path(sys.argv[2]))"
            )
            proc = subprocess.run(
                ["python3", "-c", script, _PY_MODULES, path, name],
                capture_output=True, text=True, timeout=15,
                preexec_fn=functools.partial(_drop_privs, owner_uid, owner_gid),
            )
            removed = proc.returncode == 0
        else:
            removed = remove_game_config(name, Path(path))

        # Clean up ephemeral game state
        try:
            update_game_state(source["id"], name, {k: None for k in (
                "needs_restart", "needs_restart_after_add", "processing_state",
                "steam_snapshot", "deps_snapshot",
            )})
        except Exception:
            pass

        return {"success": True, "error": None if removed else f"Config for '{name}' not found"}

    async def list_nonsteam_games(self) -> list:
        return list_nonsteam_games()

    # ── Scanning ──────────────────────────────────────────────────────────

    async def scan_games_folder(self) -> list:
        games_path = get_games_folder()
        if not games_path:
            return [{"error": "Games folder not configured"}]
        return detect_game_folders(Path(games_path))

    async def scan_game_exes(self, subfolder: str, source_id: Optional[str] = None) -> list:
        import functools
        if source_id:
            src = _get_source_by_id(source_id)
            games_path = src.get("path") if src else None
        else:
            folder = get_games_folder()
            games_path = str(folder) if folder else None
        if not games_path:
            return [{"error": "Games folder not configured"}]
        game_dir = Path(games_path) / subfolder
        # Fuzzy fallback for case-sensitive filesystems: stored path may be a slug
        # (lowercase with hyphens) while actual folder uses spaces/different casing.
        if not game_dir.exists() and game_dir.parent.is_dir():
            def _normalize(s: str) -> str:
                return s.lower().replace("-", " ").replace("_", " ")
            target_norm = _normalize(subfolder)
            for entry in game_dir.parent.iterdir():
                if entry.is_dir() and _normalize(entry.name) == target_norm:
                    game_dir = entry
                    _debug(f"scan_game_exes: slug-corrected {subfolder!r} → {entry.name!r}")
                    break
        if os.getuid() == 0:
            owner_uid, owner_gid = _owner_creds_for(games_path)
            if owner_uid != 0:
                proc = subprocess.run(
                    ["python3", "-c",
                     "import sys; from pathlib import Path; "
                     "d=Path(sys.argv[1]); "
                     "exes=sorted(str(p.relative_to(d)) for p in d.rglob('*.exe') if p.is_file()) "
                     "if d.is_dir() else []; "
                     "print('\\n'.join(exes))",
                     str(game_dir)],
                    capture_output=True, text=True, timeout=30,
                    preexec_fn=functools.partial(_drop_privs, owner_uid, owner_gid),
                )
                if proc.returncode == 0:
                    return [l for l in proc.stdout.splitlines() if l.strip()]
        return find_game_executables(game_dir)

    async def get_game_size(self, game_name: str, source_id: Optional[str] = None) -> dict:
        """Return total disk usage in bytes for a game folder on a given source."""
        import functools
        source = _get_source_by_id(source_id) if source_id else (_list_sources() or [None])[0]
        if not source:
            return {"success": False, "size": 0, "error": "Source not found"}
        path = source.get("path")
        if not path:
            return {"success": False, "size": 0, "error": "Source has no path"}
        game_dir = Path(path) / game_name
        owner_uid, owner_gid = _owner_creds_for(path)
        try:
            if os.getuid() == 0 and owner_uid != 0:
                proc = subprocess.run(
                    ["python3", "-c",
                     "import os,sys;from pathlib import Path;"
                     "p=Path(sys.argv[1]);"
                     "t=sum((Path(d)/f).stat().st_size "
                     "for d,_,fs in os.walk(p) for f in fs) if p.is_dir() else 0;"
                     "print(t)",
                     str(game_dir)],
                    capture_output=True, text=True, timeout=60,
                    preexec_fn=functools.partial(_drop_privs, owner_uid, owner_gid),
                )
                size = int(proc.stdout.strip()) if proc.returncode == 0 and proc.stdout.strip() else 0
            else:
                from deckyfin_transfer import calculate_total_size
                size = calculate_total_size(game_dir)
            return {"success": True, "size": size}
        except Exception as e:
            return {"success": False, "size": 0, "error": str(e)}

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

    async def get_game_prefix_path(self, shortcut_app_id: int) -> Optional[str]:
        """Return the Proton prefix path for a non-Steam shortcut, or None if not initialised."""
        from deckyfin_saves import get_prefix_path
        return get_prefix_path(shortcut_app_id)

    async def list_dir_contents(self, path: str) -> dict:
        """List files and subdirectories at path. Returns {dirs, files}."""
        try:
            with os.scandir(path) as it:
                entries = sorted(it, key=lambda e: e.name.lower())
            dirs, files = [], []
            for entry in entries:
                try:
                    if entry.is_dir(follow_symlinks=False):
                        dirs.append(entry.name)
                    else:
                        files.append(entry.name)
                except OSError:
                    continue
            return {"dirs": dirs, "files": files}
        except Exception as e:
            _debug(f"list_dir_contents: error for {path!r}: {e}")
            return {"dirs": [], "files": []}

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

    async def batch_add_to_steam(self, source_id: str) -> dict:
        """Start a background job to add/update all configured games in a source to Steam.

        Returns immediately with {success, job_id}. Track progress via list_batch_add_statuses.
        """
        source = _get_source_by_id(source_id)
        if not source:
            return {"success": False, "error": "Source not found"}
        job_id = _uuid.uuid4().hex[:8]
        source_name = source.get("name", source_id)
        games = _load_source_games(source)
        _batch_add_registry[job_id] = {
            "job_id": job_id,
            "source_name": source_name,
            "status": "running",
            "current_game": "",
            "total": len(games),
            "processed": 0,
            "added": [],
            "updated": [],
            "skipped": [],
            "failed": [],
            "needs_restart": False,
            "error": None,
        }

        def _run():
            try:
                uid = get_user_id()
            except Exception:
                uid = None
            source_path = source.get("path", "")
            for cfg in games:
                name = cfg.get("name", "")
                _batch_add_registry[job_id]["current_game"] = name
                exe = (cfg.get("executable") or "").strip()
                if not exe:
                    _batch_add_registry[job_id]["skipped"].append(name)
                    _batch_add_registry[job_id]["processed"] += 1
                    continue
                # Resolve relative paths against the source root (same as add_steam_shortcut does).
                if exe and not Path(exe).is_absolute() and source_path:
                    exe = str(Path(source_path) / exe)
                try:
                    start_dir = cfg.get("start_dir") or None
                    if start_dir and not Path(start_dir).is_absolute() and source_path:
                        start_dir = str(Path(source_path) / start_dir)
                    launch_options = cfg.get("launch_options") or ""
                    proton_version = cfg.get("proton_version") or None
                    collections = cfg.get("collections") or None
                    steam_info = get_steam_shortcut_info(name, uid) if uid else None
                    if steam_info and steam_info.get("unsigned_appid"):
                        app_id = update_nonsteam_game(name, exe, start_dir or "", launch_options, collections=collections)
                        if app_id is not None:
                            _batch_add_registry[job_id]["updated"].append(name)
                            _batch_add_registry[job_id]["needs_restart"] = True
                            try:
                                update_game_state(source_id, name, {"needs_restart": True})
                            except Exception:
                                pass
                        else:
                            _batch_add_registry[job_id]["failed"].append({"name": name, "reason": "update_nonsteam_game returned None"})
                    else:
                        app_id = add_nonsteam_game(exe, name, start_dir, launch_options, collections=collections)
                        if app_id is not None:
                            _batch_add_registry[job_id]["added"].append(name)
                            _batch_add_registry[job_id]["needs_restart"] = True
                            try:
                                update_game_state(source_id, name, {"needs_restart_after_add": True, "needs_restart": True})
                            except Exception:
                                pass
                            if proton_version and uid:
                                try:
                                    set_proton_version(app_id, proton_version, uid, name)
                                except Exception:
                                    pass
                        else:
                            _batch_add_registry[job_id]["failed"].append({"name": name, "reason": "add_nonsteam_game returned None"})
                except Exception as e:
                    _debug(f"batch_add_to_steam: error for {name!r}: {e}")
                    _batch_add_registry[job_id]["failed"].append({"name": name, "reason": str(e)})
                _batch_add_registry[job_id]["processed"] += 1
            _batch_add_registry[job_id]["current_game"] = ""
            _batch_add_registry[job_id]["status"] = "done"

        _threading.Thread(target=_run, daemon=True).start()
        return {"success": True, "job_id": job_id}

    async def list_batch_add_statuses(self) -> dict:
        """Return a snapshot of all batch-add-to-steam job statuses."""
        return {k: dict(v) for k, v in _batch_add_registry.items()}

    async def clear_batch_add_status(self, job_id: str) -> dict:
        """Remove a completed batch-add-to-steam job from the registry."""
        _batch_add_registry.pop(job_id, None)
        return {"success": True}

    async def get_art_eligible_games(self) -> list:
        """Return all games that have a SteamGridDB ID configured, deduplicated by id.

        Each entry: {id, name, sgdb_id, unsigned_appid}.
        unsigned_appid is None for games not yet added to Steam.
        """
        try:
            uid = get_user_id()
        except Exception:
            uid = None
        seen_ids: set = set()
        eligible = []
        for source in _list_sources():
            try:
                games = _load_source_games(source)
            except Exception:
                continue
            for cfg in games:
                sgdb_id = cfg.get("steamgriddb_game_id")
                if not sgdb_id:
                    continue
                game_id = cfg.get("id") or slugify(cfg.get("path") or cfg.get("name", ""))
                if game_id in seen_ids:
                    continue
                seen_ids.add(game_id)
                name = cfg.get("name", game_id)
                steam_info = None
                try:
                    steam_info = get_steam_shortcut_info(name, uid) if uid else None
                except Exception:
                    pass
                eligible.append({
                    "id": game_id,
                    "name": name,
                    "sgdb_id": int(sgdb_id),
                    "unsigned_appid": (steam_info or {}).get("unsigned_appid"),
                })
        return eligible

    async def apply_deckyfin_card_art(self, game_name: str, sgdb_id: int, game_id: Optional[str] = None) -> dict:
        """Download and save the wide art for a game to the Deckyfin card art cache.

        This updates the plugin thumbnail shown in the GameCard list.
        Returns {success, error}.
        """
        import re as _re, os as _os
        try:
            art_dir = Path(_os.environ.get("DECKY_PLUGIN_RUNTIME_DIR", _os.path.expanduser("~/.local/share/deckyfin")))
            art_dir.mkdir(parents=True, exist_ok=True)
            wide_data = _fetch_steamgrid_art_page(int(sgdb_id), page=0, limit=1)
            wide_url = (wide_data.get("urls") or [None])[0]
            if not wide_url:
                return {"success": False, "error": "No wide art found on SteamGridDB"}
            file_key = game_id if game_id else _re.sub(r'[^\w\-. ]', '_', game_name).strip()
            dest = art_dir / f"art_{file_key}.png"
            if _download_file(wide_url, dest):
                return {"success": True}
            return {"success": False, "error": "Download failed"}
        except Exception as e:
            return {"success": False, "error": str(e)}

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

    async def calc_shortcut_app_id(self, app_name: str, exe_path: str) -> dict:
        """Calculate the unsigned shortcut app_id from app name and exe path (same formula Steam uses)."""
        from steam_games import calc_shortcut_app_id, convert_appid_to_unsigned_32bit
        exe_formatted = f'"{exe_path}"'
        signed = calc_shortcut_app_id(app_name, exe_formatted)
        unsigned = convert_appid_to_unsigned_32bit(signed)
        return {"success": True, "unsigned_appid": unsigned}

    # ── Proton ────────────────────────────────────────────────────────────

    async def list_proton_versions(self) -> list:
        return list_available_proton()

    async def list_proton_sources(self) -> list:
        """Return all supported Proton source types (GE-Proton, CachyOS, etc.)."""
        return list_proton_sources()

    async def fetch_proton_releases(self, source_id: str, page: int = 1, per_page: int = 10) -> dict:
        """Fetch one page of releases for a Proton source, annotated with installed status."""
        return fetch_proton_releases(source_id, page, per_page)

    async def start_proton_install(self, install_name: str, download_url: str) -> dict:
        """Start background download + install of any Proton release."""
        return start_proton_install(install_name, download_url)

    async def cancel_proton_install(self, install_name: str) -> dict:
        """Cancel an in-progress Proton download."""
        return cancel_proton_install(install_name)

    async def delete_proton_version(self, install_name: str) -> dict:
        """Delete an installed Proton version from compatibilitytools.d."""
        return delete_proton_version(install_name)

    async def get_proton_install_statuses(self) -> dict:
        """Return progress snapshots for all tracked Proton installs."""
        return get_proton_install_statuses()

    async def clear_proton_install_status(self, install_name: str) -> dict:
        """Remove a done or failed Proton install entry from the registry."""
        from deckyfin_proton import _proton_install_registry
        _proton_install_registry.pop(install_name, None)
        return {"success": True}

    async def list_steam_collections(self) -> list[str]:
        """List all existing Steam collection names."""
        return list_steam_collections()

    async def create_steam_collection(self, name: str) -> dict:
        """Create a new empty Steam collection."""
        return create_steam_collection(name)

    async def delete_steam_collection(self, name: str) -> dict:
        """Delete a Steam collection by name."""
        return delete_steam_collection(name)

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
        game_name: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> dict:
        """Start a background prefix initialization. Poll list_prefix_init_statuses for progress."""
        prefix_id = _uuid.uuid4().hex[:8]
        _prefix_init_registry[prefix_id] = {
            "prefix_id": prefix_id,
            "game_name": game_name or str(app_id),
            "app_id": app_id,
            "status": "running",
            "error": None,
        }
        uid = user_id or get_user_id()

        def _run():
            try:
                init_proton_prefix(app_id, uid, proton_name=proton_name, reinitialize=reinitialize)
                _prefix_init_registry[prefix_id]["status"] = "done"
            except FileExistsError as e:
                _prefix_init_registry[prefix_id]["status"] = "failed"
                _prefix_init_registry[prefix_id]["error"] = str(e)
            except (ValueError, RuntimeError) as e:
                _prefix_init_registry[prefix_id]["status"] = "failed"
                _prefix_init_registry[prefix_id]["error"] = str(e)
            except Exception as e:
                _prefix_init_registry[prefix_id]["status"] = "failed"
                _prefix_init_registry[prefix_id]["error"] = f"Failed to init prefix: {str(e)}"

        _threading.Thread(target=_run, daemon=True).start()
        return {"success": True, "prefix_id": prefix_id, "app_id": app_id}

    async def list_prefix_init_statuses(self) -> dict:
        """Return a snapshot of all tracked prefix init operations."""
        return {k: dict(v) for k, v in _prefix_init_registry.items()}

    async def clear_prefix_init_status(self, prefix_id: str) -> dict:
        """Remove a completed prefix init entry from the registry."""
        _prefix_init_registry.pop(prefix_id, None)
        return {"success": True}

    # ── Save Sync ─────────────────────────────────────────────────────────────

    async def sync_saves(
        self,
        game_name: str,
        source_id: str,
        direction: str,
        shortcut_app_id: int,
    ) -> dict:
        """Background task: backup (prefix→source) or restore (source→prefix) save files."""
        try:
            from deckyfin_saves import get_prefix_path, get_saves_dir, backup_saves, restore_saves
            from deckyfin_config import get_game_config

            source = _get_source_by_id(source_id)
            if not source or not source.get("path"):
                return {"success": False, "error": "Source not found or has no path"}

            cfg = get_game_config(game_name, source.get("path"))
            if not cfg:
                return {"success": False, "error": "Game config not found"}

            sync_paths = cfg.get("proton_sync_paths", [])
            if not sync_paths:
                return {"success": False, "error": "No save paths configured — add paths in the Save Paths section"}

            game_rel = cfg.get("path")
            if not game_rel:
                return {"success": False, "error": "Game folder path not set in config"}
            game_folder = os.path.join(source.get("path"), game_rel)

            has_prefix_paths = any(
                not p.startswith("game://") and not p.startswith("userdata://")
                for p in sync_paths
            )
            prefix_path = get_prefix_path(shortcut_app_id) if has_prefix_paths else None
            if has_prefix_paths and not prefix_path:
                return {"success": False, "error": f"Proton prefix not found for app {shortcut_app_id} — init the prefix first"}

            saves_dir = get_saves_dir(source.get("path"), game_name)
            sync_id = _uuid.uuid4().hex[:8]
            _save_sync_registry[sync_id] = {
                "sync_id": sync_id, "game_name": game_name, "source_id": source_id,
                "direction": direction, "status": "running", "error": None, "copied": [],
                "saves_dir": saves_dir,
            }
            _debug(f"sync_saves: {game_name!r} {direction} saves_dir={saves_dir!r} paths={sync_paths!r}")

            def _run():
                try:
                    if direction == "backup":
                        result = backup_saves(prefix_path, sync_paths, saves_dir, game_folder)
                    elif direction == "restore":
                        result = restore_saves(saves_dir, sync_paths, prefix_path, game_folder)
                    else:
                        result = {"copied": [], "errors": [f"Unknown direction: {direction}"]}
                    if result.get("errors"):
                        _save_sync_registry[sync_id]["status"] = "failed"
                        _save_sync_registry[sync_id]["error"] = "; ".join(result["errors"])
                    else:
                        _save_sync_registry[sync_id]["status"] = "done"
                    _save_sync_registry[sync_id]["copied"] = result.get("copied", [])
                    _debug(f"sync_saves: done {game_name!r} {direction} copied={result.get('copied')} errors={result.get('errors')}")
                except Exception as e:
                    _debug(f"sync_saves thread error: {e!r}")
                    _save_sync_registry[sync_id]["status"] = "failed"
                    _save_sync_registry[sync_id]["error"] = str(e)

            _threading.Thread(target=_run, daemon=True).start()
            return {"success": True, "sync_id": sync_id}
        except Exception as e:
            _debug(f"sync_saves callable error: {e!r}")
            return {"success": False, "error": str(e)}

    async def copy_saves_between_sources(
        self, game_name: str, from_source_id: str, to_source_id: str
    ) -> dict:
        """Background task: copy the saves directory from one source to another."""
        try:
            from deckyfin_saves import get_saves_dir, copy_saves_between

            from_source = _get_source_by_id(from_source_id)
            to_source = _get_source_by_id(to_source_id)
            if not from_source or not to_source:
                return {"success": False, "error": "Source not found"}

            from_saves = get_saves_dir(from_source.get("path"), game_name)
            to_saves = get_saves_dir(to_source.get("path"), game_name)
            _debug(f"copy_saves_between_sources: {game_name!r} {from_saves!r} → {to_saves!r}")

            sync_id = _uuid.uuid4().hex[:8]
            _save_sync_registry[sync_id] = {
                "sync_id": sync_id, "game_name": game_name, "source_id": from_source_id,
                "direction": "copy",
                "from_source_id": from_source_id, "to_source_id": to_source_id,
                "status": "running", "error": None, "copied": [],
                "saves_dir": to_saves,
            }

            def _run():
                try:
                    result = copy_saves_between(from_saves, to_saves)
                    if result["success"]:
                        _save_sync_registry[sync_id]["status"] = "done"
                        _debug(f"copy_saves_between_sources: {game_name!r} done")
                    else:
                        _save_sync_registry[sync_id]["status"] = "failed"
                        _save_sync_registry[sync_id]["error"] = result.get("error", "Unknown error")
                        _debug(f"copy_saves_between_sources: error: {result.get('error')!r}")
                except Exception as e:
                    _debug(f"copy_saves_between_sources thread error: {e!r}")
                    _save_sync_registry[sync_id]["status"] = "failed"
                    _save_sync_registry[sync_id]["error"] = str(e)

            _threading.Thread(target=_run, daemon=True).start()
            return {"success": True, "sync_id": sync_id}
        except Exception as e:
            _debug(f"copy_saves_between_sources callable error: {e!r}")
            return {"success": False, "error": str(e)}

    async def backup_all_saves(self, source_id: str) -> dict:
        """Start a backup for every game in a source that has save paths configured."""
        try:
            from deckyfin_saves import get_prefix_path, get_saves_dir, backup_saves

            source = _get_source_by_id(source_id)
            if not source or not source.get("path"):
                return {"success": False, "error": "Source not found or has no path"}

            uid = str(get_user_id())
            source_name = source.get("name", source_id)
            games = _load_source_games(source)

            # First pass: categorize without starting any threads
            to_backup = []
            skipped = []
            pre_failed = []

            for cfg in games:
                game_name = cfg.get("name", "")
                sync_paths = cfg.get("proton_sync_paths") or []
                if not sync_paths:
                    skipped.append(game_name)
                    continue
                info = get_steam_shortcut_info(game_name, uid)
                if not info or not info.get("unsigned_appid"):
                    pre_failed.append(f"{game_name} (not in Steam)")
                    continue
                game_rel = cfg.get("path")
                if not game_rel:
                    pre_failed.append(f"{game_name} (no game path)")
                    continue
                has_prefix_paths = any(
                    not p.startswith("game://") and not p.startswith("userdata://")
                    for p in sync_paths
                )
                prefix_path = get_prefix_path(info["unsigned_appid"]) if has_prefix_paths else None
                if has_prefix_paths and not prefix_path:
                    pre_failed.append(f"{game_name} (prefix not found)")
                    continue
                to_backup.append({
                    "name": game_name,
                    "sync_paths": sync_paths,
                    "prefix_path": prefix_path,
                    "game_folder": os.path.join(source["path"], game_rel),
                    "saves_dir": get_saves_dir(source["path"], game_name),
                })

            total_with_paths = len(to_backup) + len(pre_failed)

            # Create batch tracking entry immediately so it shows in the tasks view right away
            batch_id = _uuid.uuid4().hex[:8]
            _save_sync_registry[batch_id] = {
                "sync_id": batch_id,
                "game_name": f"Backup All — {source_name}",
                "source_id": source_id,
                "direction": "batch_backup",
                "status": "running" if to_backup else "done",
                "error": None,
                "copied": [],
                "saves_dir": None,
                "total_games": total_with_paths,
                "completed_games": 0,
                "failed_games": len(pre_failed),
                "skipped_games": len(skipped),
            }
            _debug(f"backup_all_saves: batch_id={batch_id} to_backup={len(to_backup)} skipped={len(skipped)} pre_failed={len(pre_failed)}")

            if not to_backup:
                return {"success": True, "batch_id": batch_id, "started": [], "skipped": skipped, "failed": pre_failed}

            lock = _threading.Lock()
            counters = {"done": 0, "failed": len(pre_failed)}
            total_to_complete = len(to_backup)

            for g in to_backup:
                sync_id = _uuid.uuid4().hex[:8]
                _save_sync_registry[sync_id] = {
                    "sync_id": sync_id, "game_name": g["name"], "source_id": source_id,
                    "direction": "backup", "status": "running", "error": None, "copied": [],
                    "saves_dir": g["saves_dir"],
                }

                def _run(item=g, sid=sync_id, bid=batch_id):
                    try:
                        result = backup_saves(item["prefix_path"], item["sync_paths"], item["saves_dir"], item["game_folder"])
                        ok = not result.get("errors")
                        if ok:
                            _save_sync_registry[sid]["status"] = "done"
                        else:
                            _save_sync_registry[sid]["status"] = "failed"
                            _save_sync_registry[sid]["error"] = "; ".join(result["errors"])
                        _save_sync_registry[sid]["copied"] = result.get("copied", [])
                        _debug(f"backup_all_saves: {item['name']!r} {'done' if ok else 'failed'}")
                    except Exception as e:
                        _debug(f"backup_all_saves thread error {item['name']!r}: {e!r}")
                        _save_sync_registry[sid]["status"] = "failed"
                        _save_sync_registry[sid]["error"] = str(e)
                        ok = False

                    with lock:
                        if ok:
                            counters["done"] += 1
                        else:
                            counters["failed"] += 1
                        _save_sync_registry[bid]["completed_games"] = counters["done"]
                        _save_sync_registry[bid]["failed_games"] = counters["failed"]
                        if counters["done"] + counters["failed"] - len(pre_failed) >= total_to_complete:
                            _save_sync_registry[bid]["status"] = "done"

                _threading.Thread(target=_run, daemon=True).start()

            return {"success": True, "batch_id": batch_id, "started": [g["name"] for g in to_backup], "skipped": skipped, "failed": pre_failed}
        except Exception as e:
            _debug(f"backup_all_saves callable error: {e!r}")
            return {"success": False, "error": str(e)}

    async def list_save_sync_statuses(self) -> dict:
        """Return a snapshot of all tracked save sync operations."""
        return {k: dict(v) for k, v in _save_sync_registry.items()}

    async def clear_save_sync_status(self, sync_id: str) -> dict:
        """Remove a completed save sync entry from the registry."""
        _save_sync_registry.pop(sync_id, None)
        return {"success": True}

    async def install_dependencies(self, pfxid: str, dependencies: str) -> dict:
        return install_protontricks_dependencies(pfxid, dependencies, timeout=1200)

    async def start_dep_install(self, game_name: str, source_id: str, pfxid: str, dependencies: str) -> dict:
        """Start a background dependency install. Poll get_dep_install_statuses for progress."""
        key = f"{game_name}|{source_id}"
        if _dep_install_registry.get(key, {}).get("status") == "installing":
            return {"success": False, "error": "Already installing"}
        _dep_install_registry[key] = {
            "game_name": game_name, "source_id": source_id,
            "deps": dependencies, "status": "installing",
            "installed": [], "failed_deps": [], "error": None,
        }
        def _run():
            try:
                res = install_protontricks_dependencies(pfxid, dependencies, timeout=1200)
                _dep_install_registry[key]["installed"] = res.get("installed") or []
                _dep_install_registry[key]["failed_deps"] = res.get("failed") or []
                if res.get("success"):
                    _dep_install_registry[key]["status"] = "done"
                else:
                    _dep_install_registry[key]["status"] = "failed"
                    _dep_install_registry[key]["error"] = res.get("error", "Installation failed")
            except Exception as exc:
                _dep_install_registry[key]["status"] = "failed"
                _dep_install_registry[key]["error"] = str(exc)
        _threading.Thread(target=_run, daemon=True).start()
        return {"success": True, "error": None}

    async def get_dep_install_statuses(self) -> dict:
        """Return a snapshot of all tracked dep install operations."""
        return {k: dict(v) for k, v in _dep_install_registry.items()}

    async def clear_dep_install_status(self, game_name: str, source_id: str) -> dict:
        """Remove a completed dep install entry from the registry."""
        key = f"{game_name}|{source_id}"
        _dep_install_registry.pop(key, None)
        return {"success": True}

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

    async def search_steam_app(self, game_name: str) -> dict:
        """Search Steam for games matching a name.

        Uses the Steam Community SearchApps endpoint (more reliable than storesearch).
        Tries several candidate terms in order, catching per-query exceptions so a
        single bad request does not abort the whole search.
        """
        import urllib.request
        import urllib.parse
        import json
        import re
        from deckyfin_steamgrid import _ssl_context

        def _query(term: str) -> list:
            url = f"https://steamcommunity.com/actions/SearchApps/{urllib.parse.quote(term)}"
            ctx = _ssl_context()
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, context=ctx, timeout=10) as resp:
                items = json.loads(resp.read().decode())
                return [{"id": int(item["appid"]), "name": item["name"]} for item in items if item.get("appid")]

        def _candidates(full_name: str) -> list:
            """Return search terms to try, ordered from most to least specific."""
            terms = []
            # 1. Strip subtitle separators to get main title first
            main = re.split(r"\s*[-–:]\s+", full_name)[0].strip()
            if main and main != full_name:
                terms.append(main)
            # 2. Full name
            terms.append(full_name)
            # 3. Progressive word-dropping (skip punctuation-only tokens)
            words = [w for w in full_name.split() if re.search(r"\w", w)]
            for end in range(len(words) - 1, 0, -1):
                t = " ".join(words[:end])
                if t not in terms:
                    terms.append(t)
            return terms

        try:
            results = []
            for term in _candidates(game_name.strip()):
                try:
                    _debug(f"search_steam_app: querying '{term}'")
                    results = _query(term)
                    if results:
                        break
                except Exception as qe:
                    _debug(f"search_steam_app: query '{term}' failed: {qe!r}")
            _debug(f"search_steam_app: got {len(results)} results")
            return {"success": True, "results": results[:15]}
        except Exception as e:
            _debug(f"search_steam_app: error {e!r}")
            return {"success": False, "results": [], "error": str(e)}

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

    async def fetch_deckyfin_art_options(self, game_name: str, page: int = 0, game_id: Optional[int] = None) -> dict:
        """Fetch a page of art options for the Deckyfin art picker.

        On first call (page=0, game_id=None) searches SGDB by name to get the game_id,
        then returns the first page. Subsequent calls pass game_id directly to skip search.
        Returns: game_id (int|None), urls (list[str]), has_more (bool), error (str|None).
        """
        try:
            if game_id is None:
                game_id = _sgdb_search_game(game_name)
                if not game_id:
                    return {"game_id": None, "urls": [], "has_more": False, "error": f"No SteamGridDB result for '{game_name}'"}
            result = _fetch_steamgrid_art_page(game_id, page)
            result["game_id"] = game_id
            result["error"] = None
            return result
        except Exception as e:
            return {"game_id": game_id, "urls": [], "has_more": False, "error": str(e)}

    async def fetch_steam_art_options(self, game_id: int, art_type: str, page: int = 0) -> dict:
        """Fetch a page of Steam art options for a specific art type.

        art_type: 'wide' (920x430), 'capsule' (600x900), 'hero', 'logo'
        Returns: urls (list[str]), has_more (bool), error (str|None).
        """
        try:
            result = _fetch_steam_art_options_page(game_id, art_type, page)
            result["error"] = None
            return result
        except Exception as e:
            return {"urls": [], "has_more": False, "error": str(e)}

    async def apply_deckyfin_art(self, game_name: str, art_url: str, game_id: Optional[str] = None) -> dict:
        """Download the chosen art URL and save it as Deckyfin Art for the game."""
        import re, os
        try:
            art_dir = Path(os.environ.get("DECKY_PLUGIN_RUNTIME_DIR", os.path.expanduser("~/.local/share/deckyfin")))
            art_dir.mkdir(parents=True, exist_ok=True)

            file_key = game_id if game_id else re.sub(r'[^\w\-. ]', '_', game_name).strip()
            dest = art_dir / f"art_{file_key}.png"

            if not _download_file(art_url, dest):
                return {"success": False, "error": "Failed to download art"}

            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def get_game_card_art(self, game_name: str, game_id: Optional[str] = None) -> dict:
        """Get art for a game as a base64 data URI (for the library card).

        Checks the plugin's own art folder first (written by apply_deckyfin_art),
        then falls back to the Steam grid folder for games already in Steam.
        """
        import base64, re
        try:
            # 1. Plugin-managed art (Deckyfin Art) — stored in runtime data dir
            import os
            art_dir = Path(os.environ.get("DECKY_PLUGIN_RUNTIME_DIR", os.path.expanduser("~/.local/share/deckyfin")))
            # Check id-based filename first (new), then name-based (migration fallback)
            candidates_deckyfin = []
            if game_id:
                candidates_deckyfin.append(art_dir / f"art_{game_id}.png")
            safe_name = re.sub(r'[^\w\-. ]', '_', game_name).strip()
            candidates_deckyfin.append(art_dir / f"art_{safe_name}.png")
            plugin_art = next((p for p in candidates_deckyfin if p.exists()), None)
            if plugin_art is not None:
                raw = plugin_art.read_bytes()
                b64 = base64.b64encode(raw).decode("ascii")
                return {"data_uri": f"data:image/png;base64,{b64}"}

            # 2. Steam grid folder (Steam Art / games already in Steam)
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
