"""Save file sync utilities for Deckyfin — backup/restore Proton prefix paths."""

import os
import shutil
import logging
from typing import Optional

logger = logging.getLogger(__name__)

def get_saves_dir(source_path: str, game_name: str) -> str:
    """Return the save-backup directory: <source_path>/.deckyfin/saves/<game_name>/"""
    return os.path.join(source_path, ".deckyfin", "saves", game_name)


def get_prefix_path(shortcut_app_id: int) -> Optional[str]:
    """Return the Proton prefix root (pfx/) for a shortcut app id, or None if absent."""
    from steam_utils import find_steam_root
    steam_root = find_steam_root()
    if not steam_root:
        return None
    path = os.path.join(steam_root, "steamapps", "compatdata", str(shortcut_app_id), "pfx")
    return path if os.path.isdir(path) else None


def get_userdata_path(steam_app_id: str) -> Optional[str]:
    """Return <steam_root>/userdata/<user_id>/<steam_app_id>, or None if not found."""
    try:
        from steam_utils import find_steam_root, get_user_id
        steam_root = find_steam_root()
        user_id = get_user_id()
        path = os.path.join(str(steam_root), "userdata", user_id, str(steam_app_id))
        return path if os.path.isdir(path) else path  # return even if not yet created
    except Exception as e:
        logger.warning("get_userdata_path failed: %s", e)
        return None


def _resolve_src(path_entry: str, prefix_path: Optional[str], game_folder: Optional[str]) -> tuple:
    """Return (rel_key, absolute_src) for a sync path entry, or (None, error_msg) on error."""
    if path_entry.startswith("game://"):
        rel = path_entry[len("game://"):]
        if not game_folder:
            return None, "game_folder not available"
        return rel, os.path.join(game_folder, rel)

    if path_entry.startswith("userdata://"):
        # Format: userdata://<steam_app_id>[/subpath]
        rest = path_entry[len("userdata://"):]
        parts = rest.split("/", 1)
        app_id = parts[0]
        subpath = parts[1] if len(parts) > 1 else ""
        base = get_userdata_path(app_id)
        if not base:
            return None, "Steam userdata not found"
        rel = os.path.join(app_id, subpath) if subpath else app_id
        return rel, os.path.join(base, subpath) if subpath else base

    rel = path_entry.strip("/\\")
    if not rel:
        return None, None
    if not prefix_path:
        return None, "prefix_path not available"
    return rel, os.path.join(prefix_path, rel)


def backup_saves(prefix_path: Optional[str], sync_paths: list, saves_dir: str, game_folder: Optional[str] = None) -> dict:
    """Copy paths from the Proton prefix (or game folder for game:// paths) into saves_dir."""
    os.makedirs(saves_dir, exist_ok=True)
    copied, errors = [], []
    for entry in sync_paths:
        rel, src = _resolve_src(entry, prefix_path, game_folder)
        if rel is None and src is None:
            continue
        if rel is None:
            errors.append(f"{entry}: {src}")
            continue
        dst = os.path.join(saves_dir, rel)
        try:
            if os.path.isdir(src):
                if os.path.exists(dst):
                    shutil.rmtree(dst)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copytree(src, dst)
                copied.append(entry)
            elif os.path.isfile(src):
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copy2(src, dst)
                copied.append(entry)
            else:
                errors.append(f"Not found: {entry}")
        except Exception as e:
            errors.append(f"{entry}: {e}")
    return {"copied": copied, "errors": errors}


def restore_saves(saves_dir: str, sync_paths: list, prefix_path: Optional[str], game_folder: Optional[str] = None) -> dict:
    """Copy paths from saves_dir back into the Proton prefix (or game folder for game:// paths)."""
    copied, errors = [], []
    for entry in sync_paths:
        rel, dst = _resolve_src(entry, prefix_path, game_folder)
        if rel is None and dst is None:
            continue
        if rel is None:
            errors.append(f"{entry}: {dst}")
            continue
        src = os.path.join(saves_dir, rel)
        try:
            if os.path.isdir(src):
                if os.path.exists(dst):
                    shutil.rmtree(dst)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copytree(src, dst)
                copied.append(entry)
            elif os.path.isfile(src):
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copy2(src, dst)
                copied.append(entry)
            else:
                errors.append(f"Not found in saves: {entry}")
        except Exception as e:
            errors.append(f"{entry}: {e}")
    return {"copied": copied, "errors": errors}


def copy_saves_between(from_saves_dir: str, to_saves_dir: str) -> dict:
    """Copy the entire saves directory from one source game folder to another."""
    if not os.path.isdir(from_saves_dir):
        return {"success": False, "error": "No saves found in source"}
    try:
        os.makedirs(to_saves_dir, exist_ok=True)
        shutil.copytree(from_saves_dir, to_saves_dir, dirs_exist_ok=True)
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}
