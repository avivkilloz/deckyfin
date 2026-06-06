"""Protontricks dependency installation — installs Windows DLLs into Proton prefixes."""

import subprocess
import os
import shutil
import logging

from deckyfin_consts import LOGGER_PROTONTRICKS, PROTONTRICKS_FLATPAK

logger = logging.getLogger(LOGGER_PROTONTRICKS)


# These PyInstaller-bundled env vars conflict with system binaries
_BAD_ENV_VARS = ["LD_LIBRARY_PATH", "LD_PRELOAD", "LD_AUDIT", "LD_DEBUG"]


def _run_with_clean_env(cmd, **kwargs):
    """Run a subprocess with PyInstaller env vars stripped.

    Removes the vars from os.environ BEFORE fork so the child process
    definitely doesn't inherit them, then restores after.
    """
    backed_up = {}
    for var in _BAD_ENV_VARS:
        backed_up[var] = os.environ.pop(var, None)

    try:
        return subprocess.run(cmd, **kwargs)
    finally:
        for var, val in backed_up.items():
            if val is not None:
                os.environ[var] = val


def _build_try_cmds(pfxid: str, dep: str) -> list:
    """Build ordered list of (cmd_or_args, desc) to try for protontricks."""
    cmds = []

    # 1. Try native protontricks CLI (Arch/AUR or pip install)
    native = shutil.which("protontricks")
    if native:
        cmds.append((
            [native, pfxid, "--force", "--no-background-wait", dep],
            "native protontricks",
        ))
    else:
        logger.debug("Native protontricks not found, skipping")

    # 2. Try flatpak run (env vars stripped by _run_with_clean_env)
    cmds.append((
        [
            "flatpak", "run",
            PROTONTRICKS_FLATPAK,
            pfxid, "--", "--force", "--unattended", dep,
        ],
        "flatpak protontricks",
    ))

    return cmds


def install_protontricks_dependencies(
    pfxid: str, dependencies: str, timeout: int = 600
) -> dict:
    """
    Install Windows dependencies in a Proton prefix via protontricks.

    Tries: native protontricks → flatpak with OS-level env cleanup.

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
                proc = _run_with_clean_env(
                    cmd,
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
