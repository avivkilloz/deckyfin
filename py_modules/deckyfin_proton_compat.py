"""Proton compatibility configuration — writes Proton version into Steam's VDF configs."""

import logging
from pathlib import Path
from typing import Any, Optional

from steam_utils import find_steam_root
from steam_games import convert_appid_to_unsigned_32bit, convert_appid_to_config_format
from deckyfin_consts import (
    LOGGER_PROTON_COMPAT,
    STEAM_USERDATA_FOLDER,
    STEAM_CONFIG_FOLDER,
    LOCALCONFIG_VDF,
    CONFIG_VDF,
    COMPAT_VDF,
    VDF_USER_LOCAL_CONFIG_STORE,
    VDF_INSTALL_CONFIG_STORE,
    VDF_SOFTWARE,
    VDF_VALVE,
    VDF_STEAM,
    VDF_COMPAT_TOOL_MAPPING,
    VDF_PLATFORM_OVERRIDES,
)

logger = logging.getLogger(LOGGER_PROTON_COMPAT)


def _load_or_create_vdf(path: Path, default: Optional[dict] = None) -> dict:
    """Load a text VDF file or create a default structure."""
    import vdf
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                return vdf.load(f)
        except Exception:
            pass
    return default or {}


def _save_vdf(path: Path, data: dict) -> None:
    """Save a dict to a text VDF file."""
    import vdf
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        vdf.dump(data, f, pretty=True)


def update_compat_vdf(steam_root: Path, user_id: str, app_id: str) -> None:
    """Update compat.vdf to enable Linux compatibility for non-Steam games."""
    compat_path = (
        steam_root / STEAM_USERDATA_FOLDER / user_id
        / STEAM_CONFIG_FOLDER / COMPAT_VDF
    )
    compat_path.parent.mkdir(parents=True, exist_ok=True)

    config = _load_or_create_vdf(compat_path, {VDF_PLATFORM_OVERRIDES: {}})
    if VDF_PLATFORM_OVERRIDES not in config:
        config[VDF_PLATFORM_OVERRIDES] = {}

    config[VDF_PLATFORM_OVERRIDES][app_id] = {"dest": "linux", "src": "windows"}
    _save_vdf(compat_path, config)
    logger.info("Updated compat.vdf for app_id=%s user_id=%s", app_id, user_id)


def _ensure_steam_config_path(config: dict) -> dict:
    """Navigate to and ensure Steam config path exists."""
    if VDF_USER_LOCAL_CONFIG_STORE not in config:
        config[VDF_USER_LOCAL_CONFIG_STORE] = {}
    if VDF_SOFTWARE not in config[VDF_USER_LOCAL_CONFIG_STORE]:
        config[VDF_USER_LOCAL_CONFIG_STORE][VDF_SOFTWARE] = {}
    if VDF_VALVE not in config[VDF_USER_LOCAL_CONFIG_STORE][VDF_SOFTWARE]:
        config[VDF_USER_LOCAL_CONFIG_STORE][VDF_SOFTWARE][VDF_VALVE] = {}
    if VDF_STEAM not in config[VDF_USER_LOCAL_CONFIG_STORE][VDF_SOFTWARE][VDF_VALVE]:
        config[VDF_USER_LOCAL_CONFIG_STORE][VDF_SOFTWARE][VDF_VALVE][VDF_STEAM] = {}
    sc = config[VDF_USER_LOCAL_CONFIG_STORE][VDF_SOFTWARE][VDF_VALVE][VDF_STEAM]
    if VDF_COMPAT_TOOL_MAPPING not in sc:
        sc[VDF_COMPAT_TOOL_MAPPING] = {}
    return sc


def update_global_config_vdf(steam_root: Path, unsigned_appid: int, proton_name: str) -> None:
    """Update global config.vdf (InstallConfigStore, unsigned 32-bit app IDs)."""
    import vdf

    global_config_paths = [
        steam_root / STEAM_CONFIG_FOLDER / CONFIG_VDF,
        Path.home() / ".steam" / "steam" / STEAM_CONFIG_FOLDER / CONFIG_VDF,
        Path.home() / ".steam" / "debian-installation" / STEAM_CONFIG_FOLDER / CONFIG_VDF,
    ]

    global_config_path = None
    for path in global_config_paths:
        if path.exists():
            global_config_path = path
            break

    if not global_config_path:
        global_config_path = steam_root / STEAM_CONFIG_FOLDER / CONFIG_VDF
        global_config_path.parent.mkdir(parents=True, exist_ok=True)
        config = {
            VDF_INSTALL_CONFIG_STORE: {
                VDF_SOFTWARE: {VDF_VALVE: {VDF_STEAM: {}}}
            }
        }
    else:
        with open(global_config_path, "r", encoding="utf-8") as f:
            config = vdf.load(f)

    # Navigate/nest InstallConfigStore
    if VDF_INSTALL_CONFIG_STORE not in config:
        config[VDF_INSTALL_CONFIG_STORE] = {}
    ics = config[VDF_INSTALL_CONFIG_STORE]
    if VDF_SOFTWARE not in ics:
        ics[VDF_SOFTWARE] = {}
    if VDF_VALVE not in ics[VDF_SOFTWARE]:
        ics[VDF_SOFTWARE][VDF_VALVE] = {}
    if VDF_STEAM not in ics[VDF_SOFTWARE][VDF_VALVE]:
        ics[VDF_SOFTWARE][VDF_VALVE][VDF_STEAM] = {}

    sc = ics[VDF_SOFTWARE][VDF_VALVE][VDF_STEAM]
    if VDF_COMPAT_TOOL_MAPPING not in sc:
        sc[VDF_COMPAT_TOOL_MAPPING] = {}

    sc[VDF_COMPAT_TOOL_MAPPING][str(unsigned_appid)] = {
        "name": str(proton_name),
        "config": "",
        "priority": "250",
    }

    with open(global_config_path, "w", encoding="utf-8") as f:
        vdf.dump(config, f, pretty=True)

    logger.info("Updated global config for app %s proton=%s", unsigned_appid, proton_name)


def update_localconfig_vdf(
    steam_root: Path, user_id: str, app_id: str, config_appid: str, proton_name: str
) -> None:
    """Update user-specific localconfig.vdf (64-bit format app IDs)."""
    localconfig_path = (
        steam_root / STEAM_USERDATA_FOLDER / user_id
        / STEAM_CONFIG_FOLDER / LOCALCONFIG_VDF
    )
    if not localconfig_path.exists():
        localconfig_path = (
            steam_root / STEAM_USERDATA_FOLDER / user_id
            / STEAM_CONFIG_FOLDER / CONFIG_VDF
        )

    if not localconfig_path.exists():
        localconfig_path.parent.mkdir(parents=True, exist_ok=True)
        config = {
            VDF_USER_LOCAL_CONFIG_STORE: {
                VDF_SOFTWARE: {VDF_VALVE: {VDF_STEAM: {}}}
            }
        }
    else:
        config = _load_or_create_vdf(localconfig_path)

    sc = _ensure_steam_config_path(config)
    sc[VDF_COMPAT_TOOL_MAPPING][config_appid] = {
        "name": str(proton_name),
        "config": "",
    }

    _save_vdf(localconfig_path, config)
    logger.info("Updated local config for user=%s app=%s", user_id, app_id)


def set_proton_version(
    app_id: int, proton_name: str, user_id: str, app_name: Optional[str] = None
) -> bool:
    """
    Set the Proton version for a specific app ID.

    Writes to:
    1. compat.vdf (Linux compatibility)
    2. localconfig.vdf/config.vdf (user-specific, 64-bit format)
    3. global config.vdf (unsigned 32-bit format)
    """
    steam_root = find_steam_root()

    unsigned_appid = convert_appid_to_unsigned_32bit(app_id)
    config_appid = convert_appid_to_config_format(app_id)

    update_compat_vdf(steam_root, user_id, str(app_id))
    update_localconfig_vdf(steam_root, user_id, str(app_id), config_appid, proton_name)
    update_global_config_vdf(steam_root, unsigned_appid, proton_name)

    logger.info(
        "Set Proton version for app_id=%s unsigned=%s to %s (user=%s)",
        app_id, unsigned_appid, proton_name, user_id,
    )
    return True
