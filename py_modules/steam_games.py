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
    variants exist, Steam may read the wrong one. This helper deletes ALL
    case variants of a key (e.g. for 'AppName' it removes 'appname', 'appName',
    'APPNAME', etc.) so the canonical version can be set cleanly.
    """
    key_lower = canonical_name.lower()
    for existing_key in list(shortcut.keys()):
        if existing_key.lower() == key_lower and existing_key != canonical_name:
            shortcut.pop(existing_key, None)


def _collections_to_tags(collections: Optional[list[str]]) -> dict:
    """Convert a list of collection names to the VDF tags field format.

    Steam stores collections as integer-indexed entries in the 'tags' dict:
        {"0": "RPG", "1": "FPS", ...}
    """
    if not collections:
        return {}
    return {str(i): name for i, name in enumerate(collections) if name}


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
    """Save data to a binary VDF file (atomic write to prevent corruption on failure)."""
    import vdf, os
    tmp = path.with_suffix(".vdf.tmp")
    try:
        with open(tmp, "wb") as f:
            vdf.binary_dump(data, f)
        os.replace(tmp, path)
    except Exception:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise


def _save_vdf_text(data, path: Path):
    """Save data to a text-format VDF file (atomic write to prevent corruption on failure)."""
    import vdf, os
    tmp = path.with_suffix(".vdf.tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            vdf.dump(data, f)
        os.replace(tmp, path)
    except Exception:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise


def _get_localconfig_path(user_id: str) -> Path:
    """Get the path to localconfig.vdf for the given user."""
    steam_root = find_steam_root()
    path = (
        steam_root / STEAM_USERDATA_FOLDER / user_id
        / STEAM_CONFIG_FOLDER / LOCALCONFIG_VDF
    )
    if not path.exists():
        path = (
            steam_root / STEAM_USERDATA_FOLDER / user_id
            / STEAM_CONFIG_FOLDER / CONFIG_VDF
        )
    return path if path.exists() else None


def _sync_user_collections(
    user_id: str,
    app_id: int,
    new_collections: Optional[list[str]],
    old_collections: Optional[list[str]] = None,
):
    """Sync collections to Steam's cloud storage JSON (modern authoritative source).

    Modern Steam (2023+) stores user-defined collections in cloud storage JSON
    files under ``userdata/{userId}/config/cloudstorage/``. Each collection is
    a JSON entry with key ``user-collections.``-prefixed entries containing
    ``added`` (app ID array) and ``name`` fields.

    The ``tags`` field in shortcuts.vdf is a legacy mechanism — Steam no longer
    derives the library sidebar from it. Both are written for compatibility.

    Follows the same format as Steam ROM Manager (srm-prefixed collections).
    Deckyfin uses ``dfy-`` prefix.
    """
    import base64
    import json

    steam_root = find_steam_root()
    cloud_dir = steam_root / STEAM_USERDATA_FOLDER / user_id / "config" / "cloudstorage"

    # ── Find active namespace ──────────────────────────────────────────
    namespaces_path = cloud_dir / "cloud-storage-namespaces.json"
    active_namespace = 1  # default
    if namespaces_path.exists():
        try:
            with open(namespaces_path, "r", encoding="utf-8") as f:
                namespaces = json.load(f)
            # Format: [[1, "798"], [3, "0"]] — find the one with highest version
            sorted_ns = sorted(namespaces, key=lambda x: int(x[1]), reverse=True)
            if sorted_ns and sorted_ns[0][1] != "0":
                active_namespace = sorted_ns[0][0]
        except (json.JSONDecodeError, ValueError, IndexError, TypeError):
            pass

    cloud_path = cloud_dir / f"cloud-storage-namespace-{active_namespace}.json"

    # ── Load existing cloud storage data ──────────────────────────────
    cloud_data = []
    if cloud_path.exists():
        try:
            with open(cloud_path, "r", encoding="utf-8") as f:
                cloud_data = json.load(f)
        except (json.JSONDecodeError, ValueError):
            cloud_data = []

    # Parse existing collections: key → {name, added, removed}
    collections: dict[str, dict] = {}
    for item in cloud_data:
        if not isinstance(item, list) or len(item) < 2:
            continue
        key = item[0]
        if not isinstance(key, str) or not key.startswith("user-collections."):
            continue
        entry = item[1]
        if not isinstance(entry, dict):
            continue
        if entry.get("is_deleted"):
            continue
        try:
            value = json.loads(entry.get("value", "{}"))
        except (json.JSONDecodeError, TypeError):
            continue
        collection_id = key.replace("user-collections.", "", 1)
        collections[collection_id] = {
            "id": collection_id,
            "name": value.get("name", ""),
            "added": value.get("added", []),
            "removed": value.get("removed", []),
        }

    timestamp = int(__import__("time").time())

    # ── Helper: encode a name to a base64 key (URL-safe, like SRM) ──
    def _name_to_key(name: str) -> str:
        b64 = base64.b64encode(name.encode("utf-8")).decode("utf-8")
        b64 = b64.replace("+", "-").replace("/", "_").replace("=", "")
        return f"dfy-{b64}"

    changed = False

    # Use unsigned app_id for cloud storage (Steam collections use the positive format)
    unsigned_app_id = convert_appid_to_unsigned_32bit(app_id)

    # ── Add app_id to new collections ──────────────────────────────────
    if new_collections:
        for name in new_collections:
            if not name:
                continue
            name_stripped = name.strip()

            # Case-insensitive match against existing collections
            existing_key = None
            for cid, cdata in collections.items():
                if cdata.get("name", "").lower() == name_stripped.lower():
                    existing_key = cid
                    break

            if existing_key:
                coll = collections[existing_key]
            else:
                existing_key = _name_to_key(name_stripped)
                coll = collections.setdefault(existing_key, {
                    "id": existing_key,
                    "name": name_stripped,
                    "added": [],
                    "removed": [],
                })

            # Update name (in case it was renamed)
            if coll["name"] != name_stripped:
                coll["name"] = name_stripped
                changed = True

            # Ensure added/removed arrays exist
            coll.setdefault("added", [])
            coll.setdefault("removed", [])

            if unsigned_app_id not in coll["added"]:
                coll["added"].append(unsigned_app_id)
                changed = True

    # ── Remove app_id from dropped collections ─────────────────────────
    if old_collections:
        for name in old_collections:
            if not name:
                continue
            if new_collections and name in new_collections:
                continue

            # Case-insensitive match
            for cid, cdata in list(collections.items()):
                if cdata.get("name", "").lower() == name.strip().lower():
                    if unsigned_app_id in cdata.get("added", []):
                        cdata["added"].remove(unsigned_app_id)
                        changed = True
                    break

    if not changed:
        return

    # ── Build new cloud storage data ──────────────────────────────────
    # Preserve all non-dfy collection entries, rebuild dfy entries
    new_cloud = []
    for item in cloud_data:
        if not isinstance(item, list) or len(item) < 2:
            new_cloud.append(item)
            continue
        key = item[0]
        if isinstance(key, str) and key.startswith("user-collections.dfy-"):
            continue  # will be rebuilt
        new_cloud.append(item)

    # Write dfy collections
    for cid, cdata in collections.items():
        if not cid.startswith("dfy-"):
            continue
        if not cdata.get("added"):
            continue  # skip empty collections
        cloud_key = f"user-collections.{cid}"
        value_json = json.dumps(
            {"id": cid, "name": cdata["name"], "added": cdata["added"], "removed": cdata.get("removed", [])},
            ensure_ascii=False,
        )
        new_cloud.append([
            cloud_key,
            {
                "key": cloud_key,
                "timestamp": timestamp,
                "value": value_json,
                "version": str(timestamp),
                "conflictResolutionMethod": "custom",
                "strMethodId": "union-collections",
            },
        ])

    # ── Write back ──────────────────────────────────────────────────────
    cloud_dir.mkdir(parents=True, exist_ok=True)
    with open(cloud_path, "w", encoding="utf-8") as f:
        json.dump(new_cloud, f, ensure_ascii=False)

    logger.info(
        "Synced cloud storage collections for app_id=%s (collections=%s)",
        app_id, new_collections,
    )


def list_steam_collections() -> list[str]:
    """List all existing Steam collection names from cloud storage JSON.

    Returns sorted, deduplicated list of collection names (case-preserved).
    Returns empty list if no collections found or on error.
    """
    try:
        import json
        user_id = get_user_id()
        steam_root = find_steam_root()
        if not steam_root:
            return []
        cloud_dir = steam_root / STEAM_USERDATA_FOLDER / user_id / "config" / "cloudstorage"

        # Find active namespace
        namespaces_path = cloud_dir / "cloud-storage-namespaces.json"
        active_namespace = 1
        if namespaces_path.exists():
            try:
                with open(namespaces_path, "r", encoding="utf-8") as f:
                    namespaces = json.load(f)
                sorted_ns = sorted(namespaces, key=lambda x: int(x[1]), reverse=True)
                if sorted_ns and sorted_ns[0][1] != "0":
                    active_namespace = sorted_ns[0][0]
            except (json.JSONDecodeError, ValueError, IndexError, TypeError):
                pass

        cloud_path = cloud_dir / f"cloud-storage-namespace-{active_namespace}.json"
        if not cloud_path.exists():
            return []

        with open(cloud_path, "r", encoding="utf-8") as f:
            cloud_data = json.load(f)

        # Extract collection names
        names: set[str] = set()
        for item in cloud_data:
            if not isinstance(item, list) or len(item) < 2:
                continue
            key = item[0]
            if not isinstance(key, str) or not key.startswith("user-collections."):
                continue
            entry = item[1]
            if not isinstance(entry, dict):
                continue
            if entry.get("is_deleted"):
                continue
            try:
                value = json.loads(entry.get("value", "{}"))
            except (json.JSONDecodeError, TypeError):
                continue
            name = value.get("name", "")
            if name:
                names.add(name)

        return sorted(names)
    except Exception:
        logger.exception("Failed to list Steam collections")
        return []


def create_steam_collection(name: str) -> dict:
    """Create a new empty Steam collection with the given name.

    Returns ``{"success": bool, "error": str | None}``.
    """
    try:
        import base64
        import json

        name_stripped = name.strip()
        if not name_stripped:
            return {"success": False, "error": "Name cannot be empty"}

        user_id = get_user_id()
        steam_root = find_steam_root()
        if not steam_root:
            return {"success": False, "error": "Steam root not found"}

        cloud_dir = steam_root / STEAM_USERDATA_FOLDER / user_id / "config" / "cloudstorage"
        namespaces_path = cloud_dir / "cloud-storage-namespaces.json"
        active_namespace = 1
        if namespaces_path.exists():
            try:
                with open(namespaces_path, "r", encoding="utf-8") as f:
                    namespaces = json.load(f)
                sorted_ns = sorted(namespaces, key=lambda x: int(x[1]), reverse=True)
                if sorted_ns and sorted_ns[0][1] != "0":
                    active_namespace = sorted_ns[0][0]
            except (json.JSONDecodeError, ValueError, IndexError, TypeError):
                pass

        cloud_path = cloud_dir / f"cloud-storage-namespace-{active_namespace}.json"
        cloud_data = []
        if cloud_path.exists():
            try:
                with open(cloud_path, "r", encoding="utf-8") as f:
                    cloud_data = json.load(f)
            except (json.JSONDecodeError, ValueError):
                cloud_data = []

        # Return early if already exists (case-insensitive)
        for item in cloud_data:
            if not isinstance(item, list) or len(item) < 2:
                continue
            key = item[0]
            if not isinstance(key, str) or not key.startswith("user-collections."):
                continue
            entry = item[1]
            if not isinstance(entry, dict) or entry.get("is_deleted"):
                continue
            try:
                value = json.loads(entry.get("value", "{}"))
                if value.get("name", "").lower() == name_stripped.lower():
                    return {"success": True, "error": None}
            except (json.JSONDecodeError, TypeError):
                pass

        b64 = base64.b64encode(name_stripped.encode("utf-8")).decode("utf-8")
        b64 = b64.replace("+", "-").replace("/", "_").replace("=", "")
        cid = f"dfy-{b64}"
        cloud_key = f"user-collections.{cid}"
        timestamp = int(__import__("time").time())
        value_json = json.dumps(
            {"id": cid, "name": name_stripped, "added": [], "removed": []},
            ensure_ascii=False,
        )
        cloud_data.append([
            cloud_key,
            {
                "key": cloud_key,
                "timestamp": timestamp,
                "value": value_json,
                "version": str(timestamp),
                "conflictResolutionMethod": "custom",
                "strMethodId": "union-collections",
            },
        ])

        cloud_dir.mkdir(parents=True, exist_ok=True)
        with open(cloud_path, "w", encoding="utf-8") as f:
            json.dump(cloud_data, f, ensure_ascii=False)

        logger.info("Created Steam collection: %s", name_stripped)
        return {"success": True, "error": None}
    except Exception as e:
        logger.exception("Failed to create Steam collection: %s", name)
        return {"success": False, "error": str(e)}


def delete_steam_collection(name: str) -> dict:
    """Delete a Steam collection by name.

    Deckyfin-managed (``dfy-``) entries are removed from the file entirely.
    Non-dfy entries are marked ``is_deleted`` so Steam sync propagates the removal.
    Returns ``{"success": bool, "error": str | None}``.
    """
    try:
        import json

        name_stripped = name.strip()
        if not name_stripped:
            return {"success": False, "error": "Name cannot be empty"}

        user_id = get_user_id()
        steam_root = find_steam_root()
        if not steam_root:
            return {"success": False, "error": "Steam root not found"}

        cloud_dir = steam_root / STEAM_USERDATA_FOLDER / user_id / "config" / "cloudstorage"
        namespaces_path = cloud_dir / "cloud-storage-namespaces.json"
        active_namespace = 1
        if namespaces_path.exists():
            try:
                with open(namespaces_path, "r", encoding="utf-8") as f:
                    namespaces = json.load(f)
                sorted_ns = sorted(namespaces, key=lambda x: int(x[1]), reverse=True)
                if sorted_ns and sorted_ns[0][1] != "0":
                    active_namespace = sorted_ns[0][0]
            except (json.JSONDecodeError, ValueError, IndexError, TypeError):
                pass

        cloud_path = cloud_dir / f"cloud-storage-namespace-{active_namespace}.json"
        if not cloud_path.exists():
            return {"success": False, "error": "Cloud storage not found"}

        with open(cloud_path, "r", encoding="utf-8") as f:
            cloud_data = json.load(f)

        found = False
        new_cloud = []
        timestamp = int(__import__("time").time())

        for item in cloud_data:
            if not isinstance(item, list) or len(item) < 2:
                new_cloud.append(item)
                continue
            key = item[0]
            entry = item[1]
            if not isinstance(key, str) or not key.startswith("user-collections."):
                new_cloud.append(item)
                continue
            if not isinstance(entry, dict) or entry.get("is_deleted"):
                new_cloud.append(item)
                continue
            try:
                value = json.loads(entry.get("value", "{}"))
            except (json.JSONDecodeError, TypeError):
                new_cloud.append(item)
                continue

            if value.get("name", "").lower() == name_stripped.lower():
                found = True
                cid = key.replace("user-collections.", "", 1)
                if not cid.startswith("dfy-"):
                    # Non-dfy: mark deleted so Steam sync propagates removal
                    updated = dict(entry)
                    updated["is_deleted"] = True
                    updated["timestamp"] = timestamp
                    updated["version"] = str(timestamp)
                    new_cloud.append([key, updated])
                # dfy-: drop entirely (not appended)
            else:
                new_cloud.append(item)

        if not found:
            return {"success": False, "error": f"Collection '{name_stripped}' not found"}

        with open(cloud_path, "w", encoding="utf-8") as f:
            json.dump(new_cloud, f, ensure_ascii=False)

        logger.info("Deleted Steam collection: %s", name_stripped)
        return {"success": True, "error": None}
    except Exception as e:
        logger.exception("Failed to delete Steam collection: %s", name)
        return {"success": False, "error": str(e)}


def _parse_old_tags(shortcut: dict) -> Optional[list[str]]:
    """Extract collection names from a shortcut's existing `tags` field."""
    tags = shortcut.get("tags", {})
    if not tags:
        return None
    names = [v for _, v in sorted(tags.items()) if v]
    return names if names else None


def _collections_equal(a: Optional[list[str]], b: Optional[list[str]]) -> bool:
    """Check if two collection lists are equal (order-independent)."""
    return sorted(a or []) == sorted(b or [])


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
    collections: Optional[list[str]] = None,
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

            old_tags = _parse_old_tags(shortcuts_dict[idx])

            shortcuts_dict[idx]["AppName"] = app_name
            shortcuts_dict[idx]["Exe"] = exe_formatted
            shortcuts_dict[idx]["StartDir"] = start_dir
            shortcuts_dict[idx]["LaunchOptions"] = launch_options
            shortcuts_dict[idx]["tags"] = _collections_to_tags(collections)

            shortcuts["shortcuts"] = shortcuts_dict
            _save_vdf_binary(shortcuts, shortcuts_path)

            # Sync collections to localconfig.vdf if they changed
            if not _collections_equal(old_tags, collections):
                _sync_user_collections(
                    user_id_actual, app_id, collections, old_tags,
                )

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
        "tags": _collections_to_tags(collections),
    }

    shortcuts["shortcuts"][next_index] = new_shortcut
    _save_vdf_binary(shortcuts, shortcuts_path)

    # Sync collections to localconfig.vdf
    if collections:
        _sync_user_collections(user_id_actual, app_id, collections)

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
    collections: Optional[list[str]] = None,
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

    old_tags = _parse_old_tags(shortcuts_dict[target_idx])

    shortcuts_dict[target_idx]["Exe"] = exe_formatted
    shortcuts_dict[target_idx]["StartDir"] = start_dir
    shortcuts_dict[target_idx]["LaunchOptions"] = launch_options
    shortcuts_dict[target_idx]["tags"] = _collections_to_tags(collections)

    shortcuts["shortcuts"] = shortcuts_dict
    _save_vdf_binary(shortcuts, shortcuts_path)

    # Sync collections to localconfig.vdf if they changed
    if not _collections_equal(old_tags, collections):
        _sync_user_collections(
            user_id_actual, app_id, collections, old_tags,
        )

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
