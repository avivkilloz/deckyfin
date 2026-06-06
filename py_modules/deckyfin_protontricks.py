"""Protontricks dependency installation — installs Windows DLLs into Proton prefixes."""

import subprocess
import os
import logging
from typing import List

from deckyfin_consts import LOGGER_PROTONTRICKS, PROTONTRICKS_FLATPAK

logger = logging.getLogger(LOGGER_PROTONTRICKS)


def install_protontricks_dependencies(
    pfxid: str, dependencies: str, timeout: int = 600
) -> dict:
    """
    Install Windows dependencies in a Proton prefix via protontricks (Flatpak).

    Args:
        pfxid: Unsigned 32-bit app ID (used as prefix ID)
        dependencies: Comma-separated (e.g. "vcrun2022,d3dx9")
        timeout: Seconds per dependency (default 600)

    Returns:
        dict with 'success', 'installed', 'failed', 'output', 'errors' keys
    """
    if not dependencies or not dependencies.strip():
        raise ValueError("Dependencies parameter is required")

    dep_list = [dep.strip() for dep in dependencies.split(",") if dep.strip()]
    if not dep_list:
        raise ValueError("No valid dependencies specified")

    results = {
        "success": True,
        "installed": [],
        "failed": [],
        "output": [],
        "errors": [],
    }

    for dep in dep_list:
        try:
            # Strip PyInstaller bundled libs that conflict with system flatpak
            clean_env = os.environ.copy()
            clean_env.pop("LD_LIBRARY_PATH", None)
            clean_env.pop("LD_PRELOAD", None)

            result = subprocess.run(
                [
                    "flatpak",
                    "run",
                    PROTONTRICKS_FLATPAK,
                    pfxid,
                    "--",
                    "--force",
                    "--unattended",
                    dep,
                ],
                env=clean_env,
                capture_output=True,
                text=True,
                timeout=timeout,
            )

            if result.returncode == 0:
                results["installed"].append(dep)
                results["output"].append(f"\u2713 Successfully installed {dep}")
                logger.info("Protontricks installed %s in prefix %s", dep, pfxid)
            else:
                results["success"] = False
                results["failed"].append(dep)
                error_msg = result.stderr or result.stdout or "Unknown error"
                results["errors"].append(f"\u2717 Failed to install {dep}: {error_msg}")
                results["output"].append(f"\u2717 Failed to install {dep}")
                logger.error(
                    "Protontricks failed for %s in prefix %s: %s", dep, pfxid, error_msg
                )
        except subprocess.TimeoutExpired:
            results["success"] = False
            results["failed"].append(dep)
            results["errors"].append(f"\u2717 Timeout installing {dep}")
            results["output"].append(f"\u2717 Timeout installing {dep}")
            logger.error("Protontricks timeout for %s in prefix %s", dep, pfxid)
        except Exception as e:
            results["success"] = False
            results["failed"].append(dep)
            results["errors"].append(f"\u2717 Error installing {dep}: {str(e)}")
            results["output"].append(f"\u2717 Error installing {dep}: {str(e)}")
            logger.exception("Protontricks error for %s", dep)

    return results
