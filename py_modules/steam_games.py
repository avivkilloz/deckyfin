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


# ── VDF Field Helpers ───────────────────────────────────────────────────────


def _remove_case_variants(shortcut: dict, canonical_name: str):
    """Remove case-variant keys from a shortcut dict before setting the canonical one.

    Tools like Heroic create shortcuts with lowercase field names (e.g. 'exe',
    'appname'), while deckyfin uses uppercase ('Exe', 'AppName'). If both
    variants exist, Steam may read the wrong one. This helper deletes the
    opposite-case key (if any) before setting the intended field, so Steam
    always sees the correct value.
    """
    # Generate the opposite-case key: e.g. "Exe" → "exe", "appname" → "AppName"
    if canonical_name[0].isupper():
        variant = canonical_name[0].lower() + canonical_name[1:]
    else:
        variant = canonical_name[0].upper() + canonical_name[1:]
    shortcut.pop(variant, None)


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
    try:
        steam_root = find_steam_root()
        user_id_actual = user_id or get_user_id()
    except Exception as e:
        logger.warning("Failed to determine Steam root or user: %s", e)
        return []

    try:
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
    except Exception as e:
        logger.warning("Failed to load shortcuts.vdf for user %s: %s", user_id_actual, e)
        return []

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

        app_name = shortcut.get("AppName") or shortcut.get("appname") or "Unknown"
        exe = shortcut.get("Exe") or shortcut.get("exe") or ""

        # Prefer the stored appid — recalculating may differ from what
        # Steam uses for shortcuts created by other tools.
        stored_appid = shortcut.get("appid")
        if stored_appid is not None:
            app_id = stored_appid
        else:
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
    """Add a non-Steam game to Steam shortcuts. Returns the calculated app_id.

    If a shortcut with the same AppName already exists, updates it in-place
    instead of creating a duplicate. This is idempotent — the Steam library
    never gets multiple entries with the same game name.
    """
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

    # ── Check for existing shortcut with the same name ────────────────
    shortcuts_dict = shortcuts["shortcuts"]
    for idx, shortcut in list(shortcuts_dict.items()):
        if not idx.isdigit():
            continue
        shortcut_name = shortcut.get("AppName") or shortcut.get("appname")
        if shortcut_name == app_name:
            # Found existing — update in-place
            if start_dir is None:
                start_dir = str(Path(exe_path).parent)
            exe_formatted = f'"{exe_path}"'

            # Preserve the existing appid (see update_nonsteam_game for reasoning)
            existing_app_id = shortcuts_dict[idx].get("appid")
            if existing_app_id is not None:
                app_id = existing_app_id
            else:
                app_id = calc_shortcut_app_id(app_name, exe_formatted)

            # Remove lowercase variants before writing uppercase fields
            # (Heroic creates shortcuts with lowercase field names)
            _remove_case_variants(shortcuts_dict[idx], "Exe")
            _remove_case_variants(shortcuts_dict[idx], "AppName")
            _remove_case_variants(shortcuts_dict[idx], "StartDir")
            _remove_case_variants(shortcuts_dict[idx], "LaunchOptions")

            shortcuts_dict[idx]["AppName"] = app_name
            shortcuts_dict[idx]["Exe"] = exe_formatted
            shortcuts_dict[idx]["StartDir"] = start_dir
            shortcuts_dict[idx]["LaunchOptions"] = launch_options

            shortcuts["shortcuts"] = shortcuts_dict
            _save_vdf_binary(shortcuts, shortcuts_path)

            logger.info(
                "Updated existing non-Steam game '%s' (app_id=%s) exe=%s",
                app_name, app_id, exe_path,
            )
            return app_id

    # ── No existing shortcut — add new ────────────────────────────────
    existing_indices = [int(k) for k in shortcuts_dict.keys() if k.isdigit()]
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


# ── Update Non-Steam Game (in-place) ──────────────────────────────────────

def update_nonsteam_game(
    app_name: str,
    exe_path: str,
    start_dir: str = "",
    launch_options: str = "",
    user_id: Optional[str] = None,
) -> Optional[int]:
    """Update an existing non-Steam game shortcut in-place by AppName.
    Returns the app_id of the updated shortcut, or None if not found.
    """
    steam_root = find_steam_root()
    user_id_actual = user_id or get_user_id()
    shortcuts_path = (
        steam_root / STEAM_USERDATA_FOLDER / user_id_actual
        / STEAM_CONFIG_FOLDER / SHORTCUTS_VDF
    )

    if not shortcuts_path.exists():
        return None

    try:
        shortcuts = _load_vdf_binary(shortcuts_path)
    except Exception:
        return None

    shortcuts_dict = shortcuts.get("shortcuts", {})
    target_idx = None
    for idx, shortcut in shortcuts_dict.items():
        if not idx.isdigit():
            continue
        shortcut_name = shortcut.get("AppName") or shortcut.get("appname")
        if shortcut_name == app_name:
            target_idx = idx
            break

    if target_idx is None:
        return None

    if not start_dir:
        start_dir = str(Path(exe_path).parent)

    exe_formatted = f'"{exe_path}"'

    # Preserve the existing appid — Steam calculates it from exe+name
    # and other tools (Heroic, Lutris) use different algorithms. If we
    # recalculate here we'd overwrite it with a potentially different value,
    # breaking Proton config mapping keys that other code uses with this app_id.
    existing_app_id = shortcuts_dict[target_idx].get("appid")
    if existing_app_id is not None:
        app_id = existing_app_id
    else:
        app_id = calc_shortcut_app_id(app_name, exe_formatted)

    # Remove lowercase variants before writing uppercase fields
    # (Heroic creates shortcuts with lowercase field names)
    _remove_case_variants(shortcuts_dict[target_idx], "Exe")
    _remove_case_variants(shortcuts_dict[target_idx], "StartDir")
    _remove_case_variants(shortcuts_dict[target_idx], "LaunchOptions")

    shortcuts_dict[target_idx]["Exe"] = exe_formatted
    shortcuts_dict[target_idx]["StartDir"] = start_dir
    shortcuts_dict[target_idx]["LaunchOptions"] = launch_options

    shortcuts["shortcuts"] = shortcuts_dict
    _save_vdf_binary(shortcuts, shortcuts_path)

    logger.info(
        "Updated non-Steam game '%s' (app_id=%s) exe=%s",
        app_name, app_id, exe_path,
    )
    return app_id


# ── Remove Non-Steam Game ─────────────────────────────────────────────────

# ── Get Shortcut Info ─────────────────────────────────────────────────────

def get_steam_shortcut_info(app_name: str, user_id: Optional[str] = None) -> Optional[dict]:
    """Look up a non-Steam game shortcut by name and return its info."""
    uid = "?"
    try:
        steam_root = find_steam_root()
        uid = user_id or get_user_id()
        shortcuts_path = (
            steam_root / STEAM_USERDATA_FOLDER / uid
            / STEAM_CONFIG_FOLDER / SHORTCUTS_VDF
        )
        if not shortcuts_path.exists():
            return None
        shortcuts = _load_vdf_binary(shortcuts_path)
    except Exception as e:
        logger.warning("Failed to load shortcuts.vdf for user %s: %s", uid, e)
        return None

    for idx, shortcut in shortcuts.get("shortcuts", {}).items():
        if not idx.isdigit():
            continue
        shortcut_name = shortcut.get("AppName") or shortcut.get("appname")
        if shortcut_name == app_name:
            exe = shortcut.get("Exe") or shortcut.get("exe") or ""

            # Prefer the stored appid — recalculating may differ from what
            # Steam uses for shortcuts created by other tools.
            app_id = shortcut.get("appid")
            if app_id is None:
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
        shortcut_name = shortcut.get("AppName") or shortcut.get("appname")
        if shortcut_name == app_name:
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


# ── Purge Non-Steam Game Data ──────────────────────────────────────────────


def purge_nonsteam_game_data(app_name: str, user_id: Optional[str] = None) -> dict:
    """Remove a non-Steam game and ALL its associated data from Steam.

    Removes:
    - Shortcut entry from shortcuts.vdf
    - platform_overrides from compat.vdf
    - CompatToolMapping from localconfig.vdf / config.vdf
    - CompatToolMapping from global config.vdf
    - Proton prefix directory (compatdata/<unsigned_appid>/)
    - Grid art files (config/grid/<unsigned_appid>.*)

    Returns a dict with keys removed_shortcut, removed_compat_vdf,
    removed_local_config, removed_global_config, removed_prefix,
    removed_grid, unsigned_appid, errors.
    """
    import shutil

    from deckyfin_proton_compat import (
        _load_or_create_vdf,
        _save_vdf,
    )
    from deckyfin_consts import (
        COMPATDATA_FOLDER,
        COMPAT_VDF,
        CONFIG_VDF,
        LOCALCONFIG_VDF,
        STEAM_CONFIG_FOLDER,
        STEAM_STEAMAPPS_FOLDER,
        STEAM_USERDATA_FOLDER,
        VDF_COMPAT_TOOL_MAPPING,
        VDF_INSTALL_CONFIG_STORE,
        VDF_PLATFORM_OVERRIDES,
        VDF_SOFTWARE,
        VDF_STEAM,
        VDF_USER_LOCAL_CONFIG_STORE,
        VDF_VALVE,
    )

    result = {
        "removed_shortcut": False,
        "removed_compat_vdf": False,
        "removed_local_config": False,
        "removed_global_config": False,
        "removed_prefix": False,
        "removed_grid": False,
        "unsigned_appid": None,
        "errors": [],
    }

    steam_root = find_steam_root()
    user_id_actual = user_id or get_user_id()

    # 1. Get shortcut info BEFORE removal (need app_ids)
    info = get_steam_shortcut_info(app_name, user_id_actual)
    if info is None:
        result["errors"].append(f"'{app_name}' not found in Steam shortcuts")
        return result

    app_id = info["app_id"]
    unsigned_appid = info["unsigned_appid"]
    config_appid = convert_appid_to_config_format(app_id)
    result["unsigned_appid"] = unsigned_appid

    # 2. Remove shortcut from shortcuts.vdf
    try:
        result["removed_shortcut"] = remove_nonsteam_game(app_name, user_id_actual)
    except Exception as e:
        result["errors"].append(f"remove shortcut: {e}")

    # 3. Remove from compat.vdf (platform_overrides)
    try:
        compat_path = (
            steam_root / STEAM_USERDATA_FOLDER / user_id_actual
            / STEAM_CONFIG_FOLDER / COMPAT_VDF
        )
        if compat_path.exists():
            config = _load_or_create_vdf(compat_path, {})
            if VDF_PLATFORM_OVERRIDES in config:
                entry_key = str(app_id)
                if entry_key in config[VDF_PLATFORM_OVERRIDES]:
                    del config[VDF_PLATFORM_OVERRIDES][entry_key]
                    _save_vdf(compat_path, config)
                    result["removed_compat_vdf"] = True
                    logger.info("Purged compat.vdf entry for app_id=%s", entry_key)
    except Exception as e:
        result["errors"].append(f"compat.vdf: {e}")

    # 4. Remove from user-specific localconfig.vdf (CompatToolMapping)
    try:
        # Try localconfig.vdf first, fall back to config.vdf
        localconfig_path = (
            steam_root / STEAM_USERDATA_FOLDER / user_id_actual
            / STEAM_CONFIG_FOLDER / LOCALCONFIG_VDF
        )
        user_cfg_path = localconfig_path if localconfig_path.exists() else (
            steam_root / STEAM_USERDATA_FOLDER / user_id_actual
            / STEAM_CONFIG_FOLDER / CONFIG_VDF
        )
        if user_cfg_path.exists():
            config = _load_or_create_vdf(user_cfg_path, {})
            ctm = config.get(VDF_USER_LOCAL_CONFIG_STORE, {})
            ctm = ctm.get(VDF_SOFTWARE, {})
            ctm = ctm.get(VDF_VALVE, {})
            ctm = ctm.get(VDF_STEAM, {})
            ctm = ctm.get(VDF_COMPAT_TOOL_MAPPING, {})
            if config_appid in ctm:
                del ctm[config_appid]
                _save_vdf(user_cfg_path, config)
                result["removed_local_config"] = True
                logger.info("Purged user config CompatToolMapping for app=%s", config_appid)
    except Exception as e:
        result["errors"].append(f"local config: {e}")

    # 5. Remove from global config.vdf (CompatToolMapping, unsigned_appid)
    try:
        global_config_paths = [
            steam_root / STEAM_CONFIG_FOLDER / CONFIG_VDF,
            Path.home() / ".steam" / "steam" / STEAM_CONFIG_FOLDER / CONFIG_VDF,
            Path.home() / ".steam" / "debian-installation" / STEAM_CONFIG_FOLDER / CONFIG_VDF,
        ]
        for gcp in global_config_paths:
            if gcp.exists():
                config = _load_or_create_vdf(gcp, {})
                ics = config.get(VDF_INSTALL_CONFIG_STORE, {})
                sw = ics.get(VDF_SOFTWARE, {})
                vv = sw.get(VDF_VALVE, {})
                st = vv.get(VDF_STEAM, {})
                ctm = st.get(VDF_COMPAT_TOOL_MAPPING, {})
                key = str(unsigned_appid)
                if key in ctm:
                    del ctm[key]
                    _save_vdf(gcp, config)
                    result["removed_global_config"] = True
                    logger.info("Purged global config CompatToolMapping for app=%s", key)
                break
    except Exception as e:
        result["errors"].append(f"global config: {e}")

    # 6. Remove prefix directory
    try:
        prefix_path = (
            steam_root / STEAM_STEAMAPPS_FOLDER / COMPATDATA_FOLDER / str(unsigned_appid)
        )
        if prefix_path.exists():
            shutil.rmtree(prefix_path)
            result["removed_prefix"] = True
            logger.info("Removed prefix at %s", prefix_path)
    except Exception as e:
        result["errors"].append(f"prefix dir: {e}")

    # 7. Remove grid art files
    try:
        grid_dir = (
            steam_root / STEAM_USERDATA_FOLDER / user_id_actual
            / STEAM_CONFIG_FOLDER / "grid"
        )
        if grid_dir.exists():
            pattern = f"{unsigned_appid}.*"
            removed_any = False
            for f in grid_dir.iterdir():
                if f.name.startswith(str(unsigned_appid)):
                    f.unlink()
                    removed_any = True
            result["removed_grid"] = removed_any
            if removed_any:
                logger.info("Removed grid art for app=%s", unsigned_appid)
    except Exception as e:
        result["errors"].append(f"grid art: {e}")

    logger.info(
        "Purged all Steam data for '%s' (unsigned_appid=%s): "
        "shortcut=%s compat=%s local=%s global=%s prefix=%s grid=%s",
        app_name, unsigned_appid,
        result["removed_shortcut"], result["removed_compat_vdf"],
        result["removed_local_config"], result["removed_global_config"],
        result["removed_prefix"], result["removed_grid"],
    )
    return result
