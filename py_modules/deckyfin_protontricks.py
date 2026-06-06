"""Protontricks dependency installation — installs Windows DLLs into Proton prefixes."""

import subprocess
import os
import shutil
import logging
from pathlib import Path
from typing import Optional

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


def _ensure_flatpak_protontricks() -> Optional[str]:
    """Ensure protontricks is available via flatpak. Returns method desc or None."""
    # Check if flatpak is available
    if not shutil.which("flatpak"):
        return None

    # Check if already installed
    check = _run_with_clean_env(
        ["flatpak", "info", PROTONTRICKS_FLATPAK],
        capture_output=True, text=True, timeout=30,
    )
    if check.returncode == 0:
        return "flatpak protontricks"

    # Not installed — try auto-install
    logger.info("Protontricks flatpak not found, attempting to install...")

    # Ensure flathub remote is configured
    _run_with_clean_env(
        ["flatpak", "remote-add", "--if-not-exists",
         "flathub", "https://flathub.org/repo/flathub.flatpakrepo"],
        capture_output=True, text=True, timeout=30,
    )

    # Install protontricks
    install = _run_with_clean_env(
        ["flatpak", "install", "-y", "--noninteractive",
         PROTONTRICKS_FLATPAK],
        capture_output=True, text=True, timeout=120,
    )
    if install.returncode == 0:
        logger.info("Protontricks flatpak installed successfully")
        return "flatpak protontricks"
    else:
        logger.error(
            "Failed to install protontricks flatpak: %s",
            install.stderr or install.stdout or "unknown error",
        )
        return None


def _try_winetricks(pfxid: str, prefix_dir: str, dep: str) -> dict | None:
    """Try installing a dep via native winetricks."""
    winetricks = shutil.which("winetricks")
    if not winetricks:
        return None

    pfx_path = Path(prefix_dir) / "pfx"
    env = {"WINEPREFIX": str(pfx_path)}
    logger.debug("Trying winetricks for %s in %s", dep, pfx_path)

    try:
        proc = _run_with_clean_env(
            [winetricks, "-q", dep],
            env=env,
            capture_output=True,
            text=True,
            timeout=300,
        )
        if proc.returncode == 0:
            return {"found": True, "desc": "winetricks", "result": proc}
        else:
            logger.debug("winetricks failed for %s: %s", dep, proc.stderr)
            return None
    except Exception as e:
        logger.debug("winetricks error for %s: %s", dep, e)
        return None


def _build_try_cmds(pfxid: str, dep: str, prefix_dir: Optional[str] = None) -> list:
    """Build ordered list of (cmd_or_args, desc) to try for protontricks."""
    cmds = []

    # 1. Try native protontricks CLI (Arch/AUR or pip install)
    native = shutil.which("protontricks")
    if native:
        cmds.append((
            [native, pfxid, "--force", "--no-background-wait", dep],
            "native protontricks",
        ))

    # 2. Try native winetricks (Arch community repo)
    if prefix_dir:
        cmds.append((
            ("winetricks", dep, prefix_dir),
            "winetricks",
        ))

    # 3. Try flatpak protontricks (auto-installs if missing)
    flatpak_ok = _ensure_flatpak_protontricks()
    if flatpak_ok:
        cmds.append((
            [
                "flatpak", "run",
                PROTONTRICKS_FLATPAK,
                pfxid, "--", "--force", "--unattended", dep,
            ],
            flatpak_ok,
        ))

    return cmds


def install_protontricks_dependencies(
    pfxid: str, dependencies: str, timeout: int = 600
) -> dict:
    """
    Install Windows dependencies in a Proton prefix via protontricks.

    Tries: native protontricks → winetricks → flatpak protontricks (auto-install).

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

    # Derive prefix directory from pfxid (Steam compatdata path)
    prefix_dir = None
    try:
        from pathlib import Path
        home = Path.home()
        compatdata = (
            home / ".local/share/Steam/steamapps/compatdata" / pfxid
        )
        if compatdata.exists():
            prefix_dir = str(compatdata)
    except Exception:
        pass

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
        proc = None

        for entry, desc in _build_try_cmds(pfxid, dep, prefix_dir):
            try:
                # Handle winetricks specially (uses prefix path + custom env)
                if desc == "winetricks":
                    wr = _try_winetricks(pfxid, str(prefix_dir), dep) if prefix_dir else None
                    if wr:
                        proc = wr["result"]
                    else:
                        last_error = "(winetricks) Not found or failed"
                        continue
                else:
                    proc = _run_with_clean_env(
                        entry,
                        capture_output=True,
                        text=True,
                        timeout=timeout,
                    )

                if proc and proc.returncode == 0:
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
                        "Protontricks %s failed for %s: %s",
                        desc, dep, error_msg,
                    )
            except subprocess.TimeoutExpired:
                last_error = f"({desc}) Timeout after {timeout}s"
            except FileNotFoundError:
                last_error = f"({desc}) Command not found"
            except Exception as e:
                last_error = f"({desc}) {str(e)}"

        if not installed:
            # Give a helpful message about installing protontricks
            if "not installed" in (last_error or ""):
                help_msg = (
                    "Protontricks is not installed. "
                    "Run 'flatpak install com.github.Matoking.protontricks' "
                    "or 'sudo pacman -S protontricks' to install it."
                )
                results["errors"].append(f"✗ Failed to install {dep}: {help_msg}")
                results["output"].append(f"✗ Failed to install {dep}: {help_msg}")
            else:
                results["errors"].append(f"✗ Failed to install {dep}: {last_error}")
                results["output"].append(f"✗ Failed to install {dep}")

            results["success"] = False
            results["failed"].append(dep)
            logger.error(
                "Protontricks failed for %s in prefix %s: %s",
                dep, pfxid, last_error,
            )

    return results
