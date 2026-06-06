"""Protontricks dependency installation — installs Windows DLLs into Proton prefixes."""

import subprocess
import os
import shutil
import logging
from typing import List

from deckyfin_consts import LOGGER_PROTONTRICKS, PROTONTRICKS_FLATPAK

logger = logging.getLogger(LOGGER_PROTONTRICKS)

# Minimal environment for flatpak subprocess — strip ALL PyInstaller env vars
_FLATPAK_ENV = {
    "HOME": os.environ.get("HOME", ""),
    "USER": os.environ.get("USER", ""),
    "PATH": "/usr/local/bin:/usr/bin:/bin",
    "XDG_RUNTIME_DIR": os.environ.get("XDG_RUNTIME_DIR", "/run/user/1000"),
    "DBUS_SESSION_BUS_ADDRESS": os.environ.get("DBUS_SESSION_BUS_ADDRESS", ""),
    "DISPLAY": os.environ.get("DISPLAY", ":0"),
    "LANG": os.environ.get("LANG", "en_US.UTF-8"),
    "TZ": os.environ.get("TZ", ""),
}


def _build_try_cmds(pfxid: str, dep: str) -> list:
    """Build ordered list of (cmd_or_args, desc, use_shell) to try for protontricks."""
    cmds = []

    # 1. Try native protontricks CLI (Arch/AUR or pip install)
    native = shutil.which("protontricks")
    if native:
        cmds.append((
            [native, pfxid, "--force", "--no-background-wait", dep],
            "native protontricks",
            False,
        ))
    else:
        logger.debug("Native protontricks not found, skipping")

    # 2. Try flatpak with clean room environment (strip ALL PyInstaller env)
    cmds.append((
        [
            "flatpak", "run",
            "--env=LD_LIBRARY_PATH=",
            "--env=LD_PRELOAD=",
            PROTONTRICKS_FLATPAK,
            pfxid, "--", "--force", "--unattended", dep,
        ],
        "flatpak --env",
        False,
    ))

    return cmds


def install_protontricks_dependencies(
    pfxid: str, dependencies: str, timeout: int = 600
) -> dict:
    """
    Install Windows dependencies in a Proton prefix via protontricks.

    Tries: native protontricks → flatpak with explicit env cleanup.

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
        installed = False
        last_error = None

        for cmd, desc, use_shell in _build_try_cmds(pfxid, dep):
            try:
                if use_shell:
                    proc = subprocess.run(
                        cmd,
                        shell=True,
                        env=_FLATPAK_ENV,
                        capture_output=True,
                        text=True,
                        timeout=timeout,
                    )
                else:
                    proc = subprocess.run(
                        cmd,
                        env=_FLATPAK_ENV,
                        capture_output=True,
                        text=True,
                        timeout=timeout,
                    )

                if proc.returncode == 0:
                    results["installed"].append(dep)
                    results["output"].append(
                        f"✓ Successfully installed {dep} (via {desc})"
                    )
                    logger.info(
                        "Protontricks installed %s in prefix %s (%s)",
                        dep, pfxid, desc,
                    )
                    installed = True
                    break
                else:
                    error_msg = proc.stderr or proc.stdout or "Unknown error"
                    last_error = f"({desc}) {error_msg}"
                    logger.debug(
                        "Protontricks %s failed for %s (will try next): %s",
                        desc, dep, error_msg,
                    )
            except subprocess.TimeoutExpired:
                last_error = f"({desc}) Timeout after {timeout}s"
            except FileNotFoundError:
                last_error = f"({desc}) Command not found"
            except Exception as e:
                last_error = f"({desc}) {str(e)}"

        if not installed:
            results["success"] = False
            results["failed"].append(dep)
            results["errors"].append(f"✗ Failed to install {dep}: {last_error}")
            results["output"].append(f"✗ Failed to install {dep}")
            logger.error(
                "Protontricks failed for %s in prefix %s: %s",
                dep, pfxid, last_error,
            )

    return results
