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


def _run_with_clean_env(cmd, extra_env=None, **kwargs):
    """Run a subprocess with PyInstaller env vars stripped.

    Removes the vars from os.environ BEFORE fork so the child process
    definitely doesn't inherit them, then restores after.

    If an explicit env= dict is passed (as subprocess.run kwarg), the
    bad vars are stripped from that dict too — this fixes the case where
    a caller copies os.environ and passes it as `env=` to subprocess,
    which would otherwise leak PyInstaller library paths into the child.

    extra_env: optional dict of extra env vars to set for the child (e.g. STEAM_DIR)
    """
    # Strip bad vars from env= dict if present (before fork, no restore needed)
    env_arg = kwargs.get("env")
    if env_arg is not None:
        for var in _BAD_ENV_VARS:
            env_arg.pop(var, None)

    backed_up = {}
    for var in _BAD_ENV_VARS:
        backed_up[var] = os.environ.pop(var, None)

    extra_set = {}
    if extra_env:
        for var, val in extra_env.items():
            extra_set[var] = os.environ.get(var)
            if val is not None:
                os.environ[var] = str(val)

    try:
        return subprocess.run(cmd, **kwargs)
    finally:
        for var, val in backed_up.items():
            if val is not None:
                os.environ[var] = val
        for var, val in extra_set.items():
            if val is not None:
                os.environ[var] = val
            else:
                os.environ.pop(var, None)


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


def _try_winetricks(pfxid: str, prefix_dir: str, dep: str, timeout: int = 600) -> dict | None:
    """Try installing a dep via native winetricks."""
    winetricks = shutil.which("winetricks")
    if not winetricks:
        logger.info("winetricks binary not found in PATH")
        return None

    pfx_path = Path(prefix_dir) / "pfx"
    if not pfx_path.exists():
        logger.info("WINEPREFIX %s does not exist", pfx_path)
        return None

    logger.debug("Trying winetricks for %s in %s", dep, pfx_path)

    try:
        winetricks_env = os.environ.copy()
        winetricks_env["WINEPREFIX"] = str(pfx_path)

        # Use xvfb-run if available to give wine a virtual display
        xvfb_run = shutil.which("xvfb-run")
        if xvfb_run:
            full_cmd = [xvfb_run, "--auto-servernum", winetricks, "-q", dep]
        else:
            logger.info("xvfb-run not found, running winetricks without virtual display")
            full_cmd = [winetricks, "-q", dep]

        logger.info("Running: %s", " ".join(str(c) for c in full_cmd))
        proc = _run_with_clean_env(
            full_cmd,
            env=winetricks_env,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if proc.returncode == 0:
            return {"found": True, "desc": "winetricks", "result": proc}
        else:
            logger.info("winetricks exited %d for %s: stderr=%s", proc.returncode, dep, proc.stderr[:2000] if proc.stderr else "(none)")
            return None
    except Exception as e:
        logger.info("winetricks exception for %s: %s", dep, e)
        return None


def _build_try_cmds(pfxid: str, dep: str, prefix_dir: Optional[str] = None) -> list:
    """Build ordered list of (cmd_or_args, desc, extra_env) to try for protontricks.

    extra_env: optional dict of extra env vars for the call (None = no extras).
    """
    cmds = []

    # Detect steam_root once — used by native protontricks and winetricks
    steam_root = None
    try:
        from steam_utils import find_steam_root
        steam_root = find_steam_root()
    except Exception:
        pass

    # 1. Try native protontricks CLI (Arch/AUR or pip install)
    native = shutil.which("protontricks")
    if native:
        extra_env = {}
        if steam_root:
            extra_env["STEAM_DIR"] = str(steam_root)
        cmds.append((
            [native, "--no-bwrap", pfxid, "--force", dep],
            "native protontricks",
            extra_env or None,
        ))

    # 2. Try native winetricks (Arch community repo)
    if prefix_dir:
        cmds.append((
            ("winetricks", dep, prefix_dir),
            "winetricks",
            None,
        ))

    # 3. Try flatpak protontricks (auto-installs if missing)
    # Skip if we have native Steam — flatpak sandbox can't find it
    if not steam_root:
        flatpak_ok = _ensure_flatpak_protontricks()
        if flatpak_ok:
            cmds.append((
                [
                    "flatpak", "run",
                    PROTONTRICKS_FLATPAK,
                    pfxid, "--", "--force", "--unattended", dep,
                ],
                flatpak_ok,
                None,
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

    # Derive prefix directory from pfxid using our Steam detection
    # (find_steam_root uses _get_real_home() so it works when run as root)
    prefix_dir = None
    try:
        from steam_utils import find_steam_root
        from deckyfin_consts import STEAM_STEAMAPPS_FOLDER, COMPATDATA_FOLDER
        steam_root = find_steam_root()
        compatdata = (
            steam_root / STEAM_STEAMAPPS_FOLDER / COMPATDATA_FOLDER / pfxid
        )
        if compatdata.exists():
            prefix_dir = str(compatdata)
        else:
            logger.warning(
                "Prefix directory not found at %s — will try winetricks with derived path anyway",
                compatdata,
            )
    except Exception as e:
        logger.warning("Could not derive prefix directory: %s", e)

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

        for entry, desc, extra_env in _build_try_cmds(pfxid, dep, prefix_dir):
            try:
                # Handle winetricks specially (uses prefix path + custom env)
                if desc == "winetricks":
                    logger.info("Trying winetricks for %s in prefix %s", dep, pfxid)
                    wr = _try_winetricks(pfxid, str(prefix_dir), dep, timeout=timeout) if prefix_dir else None
                    if wr:
                        proc = wr["result"]
                    else:
                        last_error = "(winetricks) Not found or failed"
                        logger.info("winetricks failed for %s in %s: %s", dep, pfxid, last_error)
                        continue
                else:
                    logger.info("Trying %s for %s in prefix %s", desc, dep, pfxid)
                    proc = _run_with_clean_env(
                        entry,
                        extra_env=extra_env,
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
                    last_error = f"({desc}) {error_msg[:5000]}"
                    logger.info(
                        "Protontricks %s failed for %s: %s",
                        desc, dep, error_msg[:5000],
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
