"""Protontricks dependency installation — installs Windows DLLs into Proton prefixes."""

import subprocess
import shlex
import os
import shutil
import logging
from typing import List

from deckyfin_consts import LOGGER_PROTONTRICKS, PROTONTRICKS_FLATPAK

logger = logging.getLogger(LOGGER_PROTONTRICKS)


def _build_try_cmds(pfxid: str, dep: str) -> list:
    """Build ordered list of (cmd_list, desc) to try for protontricks."""
    cmds = []

    # 1. Try native protontricks CLI (Arch/AUR installs this)
    if shutil.which("protontricks"):
        cmds.append(
            ([
                "protontricks", pfxid,
                "--force", "--no-background-wait", dep,
            ], "native protontricks")
        )

    # 2. Try flatpak with cleaned environment (strip PyInstaller libs)
    cmds.append(
        ([
            "env", "-u", "LD_LIBRARY_PATH",
            "-u", "LD_PRELOAD",
            "flatpak", "run", PROTONTRICKS_FLATPAK,
            pfxid, "--", "--force", "--unattended", dep,
        ], "flatpak protontricks (cleaned env)")
    )

    # 3. Try flatpak with just the env var stripped via shell
    escaped = shlex.quote(dep)
    cmds.append(
        (
            f"env -u LD_LIBRARY_PATH -u LD_PRELOAD "
            f"flatpak run {PROTONTRICKS_FLATPAK} {pfxid} -- "
            f"--force --unattended {escaped}",
            "flatpak protontricks (shell fallback)",
        )
    )

    return cmds


def install_protontricks_dependencies(
    pfxid: str, dependencies: str, timeout: int = 600
) -> dict:
    """
    Install Windows dependencies in a Proton prefix via protontricks.

    Tries: native protontricks → flatpak (cleaned env) → flatpak (shell fallback).

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

        for cmd, desc in _build_try_cmds(pfxid, dep):
            try:
                if isinstance(cmd, list):
                    proc = subprocess.run(
                        cmd,
                        capture_output=True,
                        text=True,
                        timeout=timeout,
                    )
                else:
                    proc = subprocess.run(
                        cmd,
                        shell=True,
                        capture_output=True,
                        text=True,
                        timeout=timeout,
                    )

                if proc.returncode == 0:
                    results["installed"].append(dep)
                    results["output"].append(f"✓ Successfully installed {dep} (via {desc})")
                    logger.info("Protontricks installed %s in prefix %s (%s)", dep, pfxid, desc)
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
