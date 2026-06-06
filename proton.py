"""Proton version detection, discovery, and download utilities."""

import os
import tarfile
import tempfile
import logging
from pathlib import Path
from typing import Optional

from .steam import find_steam_root
from .consts import (
    LOGGER_PROTON,
    PROTON_SCRIPT_NAME,
    PROTON_GE_REPO,
    PROTON_GE_RELEASES_URL,
    STEAM_STEAMAPPS_FOLDER,
    STEAM_COMMON_FOLDER,
    STEAM_COMPATTOOLS_FOLDER,
)

logger = logging.getLogger(LOGGER_PROTON)


def list_available_proton() -> list[str]:
    """List available Proton versions installed on the system."""
    steam_root = find_steam_root()
    compat_dir = steam_root / STEAM_COMPATTOOLS_FOLDER
    proton_versions = []

    if compat_dir.exists():
        proton_versions.extend([
            d.name for d in compat_dir.iterdir() if d.is_dir()
        ])

    common_dir = steam_root / STEAM_STEAMAPPS_FOLDER / STEAM_COMMON_FOLDER
    if common_dir.exists():
        proton_versions.extend([
            d.name for d in common_dir.iterdir()
            if d.is_dir() and "proton" in d.name.lower()
        ])

    return sorted(proton_versions)


def find_proton_installation(steam_root: Path, proton_name: str) -> Optional[Path]:
    """Find the Proton installation directory and return path to the 'proton' script."""
    compat_dir = steam_root / STEAM_COMPATTOOLS_FOLDER / proton_name
    if compat_dir.exists():
        proton_script = compat_dir / PROTON_SCRIPT_NAME
        if proton_script.exists():
            return proton_script

    common_dir = steam_root / STEAM_STEAMAPPS_FOLDER / STEAM_COMMON_FOLDER
    if common_dir.exists():
        proton_dir = common_dir / proton_name
        if proton_dir.exists():
            proton_script = proton_dir / PROTON_SCRIPT_NAME
            if proton_script.exists():
                return proton_script

        for proton_dir in common_dir.iterdir():
            if proton_dir.is_dir() and proton_name.lower() in proton_dir.name.lower():
                proton_script = proton_dir / PROTON_SCRIPT_NAME
                if proton_script.exists():
                    return proton_script

    logger.warning("Proton version '%s' not found on disk", proton_name)
    return None


def get_proton_version_for_game(app_id: int, steam_root: Path, user_id: str) -> Optional[str]:
    """Get the Proton version configured for a specific game."""
    import vdf
    from .games import convert_appid_to_config_format, convert_appid_to_unsigned_32bit

    config_appid = convert_appid_to_config_format(app_id)

    localconfig_path = steam_root / "userdata" / user_id / "config" / "localconfig.vdf"
    if not localconfig_path.exists():
        localconfig_path = steam_root / "userdata" / user_id / "config" / "config.vdf"

    if localconfig_path.exists():
        try:
            with open(localconfig_path, "r", encoding="utf-8") as f:
                config = vdf.load(f)
            s = config.get("UserLocalConfigStore", {}).get("Software", {})
            if not s:
                s = config.get("InstallConfigStore", {}).get("Software", {})
            c = s.get("Valve") or s.get("valve")
            if c:
                mapping = c.get("Steam", {}).get("CompatToolMapping", {})
                if config_appid in mapping:
                    return mapping[config_appid].get("name")
        except Exception:
            pass

    unsigned_appid = convert_appid_to_unsigned_32bit(app_id)
    global_config_paths = [
        steam_root / "config" / "config.vdf",
        Path.home() / ".steam" / "steam" / "config" / "config.vdf",
    ]
    for config_path in global_config_paths:
        if config_path.exists():
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    config = vdf.load(f)
                mapping = (
                    config.get("InstallConfigStore", {})
                    .get("Software", {})
                    .get("Valve", {})
                    .get("Steam", {})
                    .get("CompatToolMapping", {})
                )
                if str(unsigned_appid) in mapping:
                    return mapping[str(unsigned_appid)].get("name")
            except Exception:
                pass

    return None


def is_ge_proton(proton_name: str) -> bool:
    """Check if a Proton name is a GE-Proton version."""
    return proton_name.startswith("GE-Proton") or proton_name.startswith("GE_Proton")


def download_proton_ge(proton_name: str) -> dict:
    """
    Download a GE-Proton version from GitHub releases.

    Returns dict with 'success', 'message', and optional 'error' keys.
    """
    steam_root = find_steam_root()
    compat_dir = steam_root / "compatibilitytools.d"

    proton_dir = compat_dir / proton_name
    if proton_dir.exists() and (proton_dir / "proton").exists():
        return {
            "success": True,
            "message": f"Proton version '{proton_name}' already exists locally",
        }

    if not is_ge_proton(proton_name):
        return {
            "success": False,
            "message": (
                f"'{proton_name}' is not a GE-Proton version. "
                "Only GE-Proton versions can be auto-downloaded."
            ),
        }

    compat_dir.mkdir(parents=True, exist_ok=True)
    download_url = f"{PROTON_GE_RELEASES_URL}/{proton_name}/{proton_name}.tar.gz"

    tmp_path = None
    try:
        import requests

        logger.info("Downloading %s from %s", proton_name, download_url)
        response = requests.get(download_url, stream=True, timeout=300)
        response.raise_for_status()

        with tempfile.NamedTemporaryFile(delete=False, suffix=".tar.gz") as tmp_file:
            tmp_path = tmp_file.name
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    tmp_file.write(chunk)

        logger.info("Extracting %s to %s", proton_name, compat_dir)
        with tarfile.open(tmp_path, "r:gz") as tar:
            with tempfile.TemporaryDirectory() as extract_tmp:
                tar.extractall(extract_tmp)

                extracted_dir = None
                extracted_dirs = [
                    d for d in Path(extract_tmp).iterdir()
                    if d.is_dir() and proton_name in d.name
                ]
                if not extracted_dirs:
                    for root, dirs, files in os.walk(extract_tmp):
                        if PROTON_SCRIPT_NAME in files:
                            extracted_dir = Path(root)
                            break
                    if not extracted_dir:
                        raise RuntimeError(
                            "Could not find Proton directory in extracted archive"
                        )
                else:
                    extracted_dir = extracted_dirs[0]

                import shutil
                final_dir = compat_dir / proton_name
                if final_dir.exists():
                    shutil.rmtree(final_dir)
                shutil.move(str(extracted_dir), str(final_dir))

        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)

        proton_script = final_dir / PROTON_SCRIPT_NAME
        if not proton_script.exists():
            return {
                "success": False,
                "message": f"Downloaded but 'proton' script not found in {final_dir}",
            }

        logger.info("Successfully installed %s", proton_name)
        return {
            "success": True,
            "message": f"Successfully downloaded and installed '{proton_name}'",
        }

    except Exception as e:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
        logger.error("Error downloading '%s': %s", proton_name, e)
        return {
            "success": False,
            "message": f"Error downloading '{proton_name}': {str(e)}",
        }


def ensure_proton_available(proton_name: str) -> None:
    """Ensure a Proton version exists locally, downloading GE builds if needed."""
    if not proton_name:
        raise ValueError("proton_name is required")

    available = list_available_proton()
    if proton_name in available:
        logger.debug("Proton %s already available", proton_name)
        return

    if is_ge_proton(proton_name):
        result = download_proton_ge(proton_name)
        if not result.get("success"):
            raise ValueError(
                f"Proton version '{proton_name}' not available: "
                f"{result.get('message', 'Unknown error')}"
            )
        available = list_available_proton()
        if proton_name in available:
            logger.info("Proton %s downloaded and ready", proton_name)
            return
        raise RuntimeError(
            f"Downloaded '{proton_name}' but it is still not available locally"
        )

    raise ValueError(
        f"Proton version '{proton_name}' not found. "
        f"Available: {', '.join(available)}"
    )
