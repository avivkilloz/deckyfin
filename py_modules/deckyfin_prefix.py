"""Proton prefix initialization — runs wineboot to create Windows prefixes."""

import subprocess
import os
import logging
from pathlib import Path
from typing import Optional

from steam_utils import find_steam_root
from steam_games import convert_appid_to_unsigned_32bit
from deckyfin_proton import find_proton_installation, get_proton_version_for_game, list_available_proton
from deckyfin_consts import (
    LOGGER_PREFIX,
    STEAM_STEAMAPPS_FOLDER,
    COMPATDATA_FOLDER,
    PREFIX_INIT_TIMEOUT,
)

logger = logging.getLogger(LOGGER_PREFIX)


def create_prefix_structure(compatdata_path: Path) -> None:
    """Create the basic directory structure for a Proton prefix."""
    pfx = compatdata_path / "pfx"
    drive_c = pfx / "drive_c"
    user_profile = drive_c / "users" / "steamuser"

    directories = [
        compatdata_path,
        pfx,
        drive_c,
        user_profile / "Documents",
        user_profile / "AppData" / "Local",
        user_profile / "AppData" / "Roaming",
        user_profile / "Desktop",
        user_profile / "My Documents",
    ]

    for directory in directories:
        directory.mkdir(parents=True, exist_ok=True)
    logger.debug("Created prefix directory structure at %s", compatdata_path)


def init_proton_prefix(
    app_id: int,
    user_id: str,
    proton_name: Optional[str] = None,
    game_name: Optional[str] = None,
    reinitialize: bool = False,
) -> bool:
    """
    Initialize a Proton prefix for a non-Steam game.

    Returns True on success. Raises on error.
    """
    logger.info(
        "Initializing Proton prefix app_id=%s user_id=%s proton=%s reinit=%s",
        app_id, user_id, proton_name, reinitialize,
    )
    steam_root = find_steam_root()
    unsigned_appid = convert_appid_to_unsigned_32bit(app_id)

    if not proton_name:
        proton_name = get_proton_version_for_game(app_id, steam_root, user_id)
        if not proton_name:
            raise ValueError(
                "No Proton version configured for this game. "
                "Please set a Proton version first."
            )

    proton_script = find_proton_installation(steam_root, proton_name)
    if not proton_script:
        available = list_available_proton()
        raise ValueError(
            f"Proton version '{proton_name}' not found. "
            f"Available versions: {', '.join(available)}"
        )

    compatdata_base = steam_root / STEAM_STEAMAPPS_FOLDER / COMPATDATA_FOLDER
    compatdata_path = compatdata_base / str(unsigned_appid)

    if compatdata_path.exists() and not reinitialize:
        raise FileExistsError(
            f"Prefix already exists at {compatdata_path}. "
            "Set reinitialize=true to re-initialize."
        )

    if compatdata_path.exists() and reinitialize:
        import shutil
        try:
            shutil.rmtree(compatdata_path)
            logger.info("Removed existing prefix at %s", compatdata_path)
        except Exception as e:
            raise RuntimeError(f"Failed to remove existing prefix: {str(e)}")

    if not compatdata_path.exists():
        create_prefix_structure(compatdata_path)

    env = os.environ.copy()
    env["STEAM_COMPAT_DATA_PATH"] = str(compatdata_path)
    env["STEAM_COMPAT_CLIENT_INSTALL_PATH"] = str(steam_root)
    env["PROTON_NO_ESYNC"] = "1"
    env["PROTON_NO_FSYNC"] = "1"

    try:
        result = subprocess.run(
            [str(proton_script), "run", "wineboot", "--init"],
            env=env,
            capture_output=True,
            text=True,
            timeout=PREFIX_INIT_TIMEOUT,
        )

        if result.returncode == 0:
            logger.info("Prefix initialized successfully at %s", compatdata_path)
            return True
        else:
            error_msg = result.stderr or "Unknown error"
            raise RuntimeError(
                f"wineboot failed with exit code {result.returncode}: {error_msg}"
            )
    except subprocess.TimeoutExpired:
        raise RuntimeError("Prefix initialization timed out")
    except Exception as e:
        raise RuntimeError(f"Error initializing prefix: {str(e)}")
