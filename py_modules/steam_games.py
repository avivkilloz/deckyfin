"""Game-related utility functions for Steam shortcuts.

Reads/writes shortcuts.vdf (binary), localconfig.vdf (text), and config.vdf (text).
Calculates Steam app IDs for non-Steam games.
"""

import binascii
import logging
from pathlib import Path
from typing import Optional

from steam_utils import find_steam_root, get_user_id
from deckyfin_consts import (
    LOGGER_GAMES,
    APPID_CRC32_MASK,
    APPID_CONFIG_FORMAT_MASK,
    SHORTCUTS_VDF,
    LOCALCONFIG_VDF,
    CONFIG_VDF,
    STEAM_USERDATA_FOLDER,
    STEAM_CONFIG_FOLDER,
)

logger = logging.getLogger(LOGGER_GAMES)


# ── App ID Calculation ─────────────────────────────────────────────────────

def calc_shortcut_app_id(appname: str, exe: str) -> int:
    """
    Calculate a Steam app ID for a shortcut based on name and executable.

    Based on Steam's algorithm: CRC32 of (exe + appname) | APPID_CRC32_MASK
    exe should be the exact value from shortcuts.vdf (may include quotes).
    """
    key = exe + appname
    return (binascii.crc32(key.encode()) | APPID_CRC32_MASK) - 0x100000000


def convert_appid_to_unsigned_32bit(appid: int) -> int:
    """Convert signed 32-bit appid to unsigned 32-bit."""
    if appid < 0:
        return (appid + 2**32) % 2**32
    return appid


def convert_appid_to_config_format(appid: int) -> str:
    """
    Convert signed 32-bit appid to the 64-bit format used in CompatToolMapping.

    Formula: (unsigned_appid << 32) | APPID_CONFIG_FORMAT_MASK
    Used for user-specific localconfig.vdf files.
    """
    unsigned_appid = convert_appid_to_unsigned_32bit(appid)
    full_id = (unsigned_appid << 32) | APPID_CONFIG_FORMAT_MASK
    return str(full_id)


# ── VDF Parsing Helpers ────────────────────────────────────────────────────

def _load_vdf_text(path: Path):
    """Load a text-format VDF file (localconfig.vdf, config.vdf)."""
    import vdf
    with open(path, "r", encoding="utf-8") as f:
        return vdf.load(f)


def _load_vdf_binary(path: Path):
    """Load a binary-format VDF file (shortcuts.vdf)."""
    import vdf
    with open(path, "rb") as f:
        return vdf.binary_load(f)


def _save_vdf_binary(data, path: Path):
    """Save data to a binary VDF file."""
    import vdf
    with open(path, "wb") as f:
        vdf.binary_dump(data, f)


def get_steam_vdf_compat_tool_mapping(vdf_file: dict) -> dict:
    """Extract CompatToolMapping from localconfig.vdf or config.vdf structure."""
    s = vdf_file.get("UserLocalConfigStore", {}).get("Software", {})
    if not s:
        s = vdf_file.get("InstallConfigStore", {}).get("Software", {})
    c = s.get("Valve") or s.get("valve")
    if not c:
        return {}
    return c.get("Steam", {}).get("CompatToolMapping", {})


# ── List Non-Steam Games ──────────────────────────────────────────────────

def list_nonsteam_games(user_id: Optional[str] = None) -> list[dict]:
    """List all non-Steam games with their calculated app IDs."""
    steam_root = find_steam_root()
    user_id_actual = user_id or get_user_id()
    shortcuts_path = (
        steam_root / STEAM_USERDATA_FOLDER / user_id_actual
        / STEAM_CONFIG_FOLDER / SHORTCUTS_VDF
    )

    config_vdf_file = (
        steam_root / STEAM_USERDATA_FOLDER / user_id_actual
        / STEAM_CONFIG_FOLDER / LOCALCONFIG_VDF
    )
    if not config_vdf_file.exists():
        config_vdf_file = (
            steam_root / STEAM_USERDATA_FOLDER / user_id_actual
            / STEAM_CONFIG_FOLDER / CONFIG_VDF
        )

    if not shortcuts_path.exists():
        return []

    shortcuts = _load_vdf_binary(shortcuts_path)

    compat_mapping = {}
    if config_vdf_file.exists():
        try:
            config_data = _load_vdf_text(config_vdf_file)
            compat_mapping = get_steam_vdf_compat_tool_mapping(config_data)
        except Exception:
            pass

    games = []
    for idx, shortcut in shortcuts.get("shortcuts", {}).items():
        if not idx.isdigit():
            continue

        app_name = shortcut.get("AppName", "Unknown")
        exe = shortcut.get("Exe", "")

        app_id = calc_shortcut_app_id(app_name, exe)
        config_appid = convert_appid_to_config_format(app_id)

        current_proton = None
        if config_appid in compat_mapping:
            current_proton = compat_mapping[config_appid].get("name")

        games.append({
            "index": idx,
            "name": app_name,
            "exe": exe.strip('"'),
            "app_id": app_id,
            "config_appid": config_appid,
            "current_proton": current_proton,
        })

    logger.info("Found %s non-Steam games for user %s", len(games), user_id_actual)
    return games


# ── Add Non-Steam Game ────────────────────────────────────────────────────

def add_nonsteam_game(
    exe_path: str,
    app_name: str,
    start_dir: Optional[str] = None,
    launch_options: str = "",
    user_id: Optional[str] = None,
) -> int:
    """Add a non-Steam game to Steam shortcuts. Returns the calculated app_id."""
    steam_root = find_steam_root()
    user_id_actual = user_id or get_user_id()
    shortcuts_path = (
        steam_root / STEAM_USERDATA_FOLDER / user_id_actual
        / STEAM_CONFIG_FOLDER / SHORTCUTS_VDF
    )

    shortcuts_path.parent.mkdir(parents=True, exist_ok=True)

    if shortcuts_path.exists():
        try:
            shortcuts = _load_vdf_binary(shortcuts_path)
        except Exception:
            shortcuts = {"shortcuts": {}}
    else:
        shortcuts = {"shortcuts": {}}

    if "shortcuts" not in shortcuts:
        shortcuts["shortcuts"] = {}

    existing_indices = [int(k) for k in shortcuts["shortcuts"].keys() if k.isdigit()]
    next_index = str(max(existing_indices, default=-1) + 1)

    if start_dir is None:
        start_dir = str(Path(exe_path).parent)

    exe_formatted = f'"{exe_path}"'
    app_id = calc_shortcut_app_id(app_name, exe_formatted)

    new_shortcut = {
        "appid": app_id,
        "AppName": app_name,
        "Exe": exe_formatted,
        "StartDir": start_dir,
        "icon": "",
        "ShortcutPath": "",
        "LaunchOptions": launch_options,
        "IsHidden": 0,
        "AllowDesktopConfig": 1,
        "AllowOverlay": 1,
        "OpenVR": 0,
        "Devkit": 0,
        "DevkitGameID": "",
        "DevkitOverrideAppID": 0,
        "LastPlayTime": 0,
        "FlatpakAppID": "",
        "tags": {},
    }

    shortcuts["shortcuts"][next_index] = new_shortcut
    _save_vdf_binary(shortcuts, shortcuts_path)

    logger.info(
        "Added non-Steam game '%s' (app_id=%s) exe=%s",
        app_name, app_id, exe_path,
    )
    return app_id


# ── Remove Non-Steam Game ─────────────────────────────────────────────────

# ── Get Shortcut Info ─────────────────────────────────────────────────────

def get_steam_shortcut_info(app_name: str, user_id: Optional[str] = None) -> Optional[dict]:
    """Look up a non-Steam game shortcut by name and return its info."""
    steam_root = find_steam_root()
    user_id_actual = user_id or get_user_id()
    shortcuts_path = (
        steam_root / STEAM_USERDATA_FOLDER / user_id_actual
        / STEAM_CONFIG_FOLDER / SHORTCUTS_VDF
    )
    if not shortcuts_path.exists():
        return None
    shortcuts = _load_vdf_binary(shortcuts_path)
    for idx, shortcut in shortcuts.get("shortcuts", {}).items():
        if not idx.isdigit():
            continue
        if shortcut.get("AppName") == app_name:
            exe = shortcut.get("Exe", "")
            app_id = calc_shortcut_app_id(app_name, exe)
            unsigned_appid = convert_appid_to_unsigned_32bit(app_id)
            return {
                "index": idx,
                "name": app_name,
                "exe": exe.strip('"'),
                "app_id": app_id,
                "unsigned_appid": unsigned_appid,
            }
    return None


def remove_nonsteam_game(app_name: str, user_id: Optional[str] = None) -> bool:
    """Remove a non-Steam game from Steam shortcuts by name."""
    steam_root = find_steam_root()
    user_id_actual = user_id or get_user_id()
    shortcuts_path = (
        steam_root / STEAM_USERDATA_FOLDER / user_id_actual
        / STEAM_CONFIG_FOLDER / SHORTCUTS_VDF
    )

    if not shortcuts_path.exists():
        return False

    shortcuts = _load_vdf_binary(shortcuts_path)
    shortcuts_dict = shortcuts.get("shortcuts", {})

    to_delete = None
    for idx, shortcut in shortcuts_dict.items():
        if shortcut.get("AppName") == app_name:
            to_delete = idx
            break

    if to_delete is None:
        return False

    del shortcuts_dict[to_delete]
    # Re-index: reassign sequential indices
    reindexed = {}
    for new_idx, (_, shortcut) in enumerate(sorted(shortcuts_dict.items())):
        reindexed[str(new_idx)] = shortcut

    shortcuts["shortcuts"] = reindexed
    _save_vdf_binary(shortcuts, shortcuts_path)

    logger.info("Removed non-Steam game '%s' from shortcuts", app_name)
    return True
