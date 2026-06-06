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

# Per-method timeout — 120s per method, then move to next
_METHOD_TIMEOUT = 120


def _run_with_clean_env(cmd, extra_env=None, **kwargs):
    """Run a subprocess with PyInstaller env vars stripped."""
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


def _kill_wineservers():
    """Kill any stale wineserver processes to avoid version mismatch errors.

    Protontricks fails with 'wine client error:0: version mismatch' when
    a wineserver from a different wine version is still running. Nuking
    them before each attempt prevents this.
    """
    try:
        subprocess.run(
            ["pkill", "-9", "wineserver"],
            capture_output=True,
            timeout=5,
        )
    except Exception:
        pass


def _kill_xvfb():
    """Kill any orphan Xvfb processes left behind by timed-out xvfb-run."""
    try:
        subprocess.run(
            ["pkill", "-9", "Xvfb"],
            capture_output=True,
            timeout=5,
        )
    except Exception:
        pass


def _find_proton_wine() -> Optional[tuple[str, str]]:
    """Find the best available Proton installation's wine+wineserver paths.

    Preference order: Proton Experimental > GE-Proton > latest numbered Proton.
    Returns (wineloader_path, wineserver_path) or None.
    """
    try:
        from steam_utils import find_steam_root
        from deckyfin_consts import (
            STEAM_STEAMAPPS_FOLDER,
            STEAM_COMMON_FOLDER,
            STEAM_COMPATTOOLS_FOLDER,
        )
        steam_root = find_steam_root()
        if not steam_root:
            return None

        candidates = []

        # Search compatibilitytools.d first (GE-Proton etc.)
        compat_dir = steam_root / STEAM_COMPATTOOLS_FOLDER
        if compat_dir.exists():
            for d in compat_dir.iterdir():
                if d.is_dir():
                    wine = d / "dist" / "bin" / "wine64"
                    server = d / "dist" / "bin" / "wineserver"
                    if wine.exists() and server.exists():
                        candidates.append((d.name, str(wine), str(server)))

        # Then steamapps/common (official Proton versions)
        common_dir = steam_root / STEAM_STEAMAPPS_FOLDER / STEAM_COMMON_FOLDER
        if common_dir.exists():
            for d in common_dir.iterdir():
                if d.is_dir() and "proton" in d.name.lower():
                    wine = d / "dist" / "bin" / "wine64"
                    if not wine.exists():
                        wine = d / "dist" / "bin" / "wine"
                    server = d / "dist" / "bin" / "wineserver"
                    if wine.exists() and server.exists():
                        candidates.append((d.name, str(wine), str(server)))

        if not candidates:
            logger.warning("No Proton installation found with dist/bin/wine64")
            return None

        # Sort: Proton Experimental first, then GE-Proton (newest first),
        # then numbered Proton (newest first; e.g. 9.0 > 8.0 > 7.0)
        def _sort_key(c):
            name = c[0].lower()
            # Experimental gets highest priority
            if name == "proton experimental":
                return (0, "")
            # GE-Proton gets next
            if "ge-proton" in name:
                return (1, name)
            # Numbered Proton versions — extract version for numeric sort
            return (2, name)

        candidates.sort(key=_sort_key)
        best = candidates[0]
        logger.info("Selected Proton: %s (%s, %s)", best[0], best[1], best[2])
        return (best[1], best[2])

    except Exception as e:
        logger.warning("Could not locate Proton wine: %s", e)

    return None


def _ensure_flatpak_protontricks() -> Optional[str]:
    """Ensure protontricks is available via flatpak. Returns method desc or None."""
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

    _run_with_clean_env(
        ["flatpak", "remote-add", "--if-not-exists",
         "flathub", "https://flathub.org/repo/flathub.flatpakrepo"],
        capture_output=True, text=True, timeout=30,
    )

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


def install_protontricks_dependencies(
    pfxid: str, dependencies: str, timeout: int = _METHOD_TIMEOUT
) -> dict:
    """
    Install Windows dependencies in a Proton prefix via protontricks.

    Strategy (each method has a 120s timeout):
      1. Kill stale wineserver
      2. Flatpak protontricks (auto-installs if missing) — preferred because it
         correctly uses Proton's bundled wine, not system wine
      3. Native protontricks CLI (Arch/AUR) — kill wineserver first
      4. Proton-bundled wine + winetricks — set WINELOADER/WINESERVER directly

    Args:
        pfxid: Unsigned 32-bit app ID (used as prefix ID)
        dependencies: Comma-separated (e.g. "vcrun2022,d3dx9")
        timeout: Seconds per method attempt (default 120)

    Returns:
        dict with 'success', 'installed', 'failed', 'output', 'errors' keys
    """
    if not dependencies or not dependencies.strip():
        raise ValueError("Dependencies parameter is required")

    dep_list = [dep.strip() for dep in dependencies.split(",") if dep.strip()]
    if not dep_list:
        raise ValueError("No valid dependencies specified")

    # Derive prefix directory and steam_root
    prefix_dir = None
    steam_root = None
    try:
        from steam_utils import find_steam_root
        from deckyfin_consts import STEAM_STEAMAPPS_FOLDER, COMPATDATA_FOLDER
        steam_root = find_steam_root()
        if steam_root:
            compatdata = (
                steam_root / STEAM_STEAMAPPS_FOLDER / COMPATDATA_FOLDER / pfxid
            )
            if compatdata.exists():
                prefix_dir = str(compatdata)
            else:
                logger.warning("Prefix directory not found at %s", compatdata)
    except Exception as e:
        logger.warning("Could not derive prefix directory: %s", e)

    pfx_path = str(Path(prefix_dir) / "pfx") if prefix_dir else None

    # Find Proton wine for the manual approach
    proton_wine = _find_proton_wine()

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

        for method_name, attempt_fn in _build_methods(
            pfxid, dep, pfx_path, proton_wine, steam_root,
        ):
            logger.info("Trying %s for %s in prefix %s", method_name, dep, pfxid)

            try:
                # Kill stale wineserver before each method
                _kill_wineservers()

                result = attempt_fn(timeout or _METHOD_TIMEOUT)

                if result and result.returncode == 0:
                    results["installed"].append(dep)
                    results["output"].append(
                        f"✓ Successfully installed {dep} (via {method_name})"
                    )
                    logger.info(
                        "Installed %s in prefix %s (%s)",
                        dep, pfxid, method_name,
                    )
                    installed = True
                    break
                else:
                    err = (result.stderr or result.stdout
                           or "Unknown error")[:5000] if result else "failed"
                    last_error = f"({method_name}) {err}"
                    logger.info(
                        "%s failed for %s: %s", method_name, dep, err,
                    )
            except subprocess.TimeoutExpired:
                last_error = f"({method_name}) Timeout after {timeout}s"
                logger.info("%s timed out after %ds", method_name, timeout)
                _kill_xvfb()
            except FileNotFoundError:
                last_error = f"({method_name}) Command not found"
            except Exception as e:
                last_error = f"({method_name}) {str(e)}"

        if not installed:
            errors_detail = "; ".join(
                e for e in [last_error] if e
            )
            results["errors"].append(
                f"✗ Failed to install {dep}: {errors_detail}"
            )
            results["output"].append(f"✗ Failed to install {dep}")
            results["success"] = False
            results["failed"].append(dep)
            logger.error(
                "All methods failed for %s in prefix %s: %s",
                dep, pfxid, errors_detail,
            )

    return results


def _build_methods(pfxid, dep, pfx_path, proton_wine, steam_root):
    """Build ordered list of (method_name, attempt_fn) tuples."""
    methods = []

    # ── Method 1: Flatpak protontricks ──────────────────────────────────
    # Preferred: handles Proton wine detection correctly.
    # Auto-installs the flatpak if missing.
    if shutil.which("flatpak"):
        fp = _ensure_flatpak_protontricks()
        if fp:
            def _flatpak(t):
                return _run_with_clean_env(
                    [
                        "flatpak", "run",
                        PROTONTRICKS_FLATPAK,
                        pfxid, "--", "--force", "--unattended", dep,
                    ],
                    capture_output=True, text=True, timeout=t,
                )
            methods.append(("flatpak protontricks", _flatpak))

    # ── Method 2: Native protontricks CLI ───────────────────────────────
    native = shutil.which("protontricks")
    if native:
        def _native(t):
            extra_env = {}
            if steam_root:
                extra_env["STEAM_DIR"] = str(steam_root)
            return _run_with_clean_env(
                [native, "--no-bwrap", pfxid, "--force", dep],
                extra_env=extra_env or None,
                capture_output=True, text=True, timeout=t,
            )
        methods.append(("native protontricks", _native))

    # ── Method 3: Proton wine + winetricks ──────────────────────────────
    # Use Proton's own wine with WINELOADER/WINESERVER set, then run winetricks.
    if proton_wine and pfx_path and shutil.which("winetricks"):
        wine_loader, wine_server = proton_wine

        def _proton_winetricks(t):
            env = os.environ.copy()
            env["WINEPREFIX"] = pfx_path
            env["WINELOADER"] = wine_loader
            env["WINESERVER"] = wine_server
            # Clean bad vars
            for var in _BAD_ENV_VARS:
                env.pop(var, None)

            # Try without xvfb first (Proton wine often doesn't need display for -q)
            winetricks_bin = shutil.which("winetricks")
            assert winetricks_bin is not None  # checked before adding method
            logger.info(
                "Proton wine approach: %s (WINELOADER=%s, WINESERVER=%s)",
                winetricks_bin, wine_loader, wine_server,
            )

            winetricks_env = {k: v for k, v in env.items()}

            # Try without xvfb first
            no_xvfb = subprocess.run(
                [winetricks_bin, "-q", dep],
                capture_output=True, text=True, timeout=t,
                env=winetricks_env,
            )
            if no_xvfb.returncode == 0:
                return no_xvfb

            # If that failed, try with xvfb-run (but with a shorter timeout)
            logger.info("Proton wine + winetricks (no xvfb) failed, trying with xvfb-run")
            xvfb_run = shutil.which("xvfb-run")
            if xvfb_run:
                return subprocess.run(
                    [xvfb_run, "--auto-servernum", winetricks_bin, "-q", dep],
                    capture_output=True, text=True, timeout=t,
                    env=winetricks_env,
                )
            return no_xvfb

        methods.append(("proton wine + winetricks", _proton_winetricks))

    # ── Method 4: System winetricks (last resort) ───────────────────────
    if pfx_path and shutil.which("winetricks"):
        def _sys_winetricks(t):
            winetricks_bin = shutil.which("winetricks")
            assert winetricks_bin is not None  # checked before adding method
            env = os.environ.copy()
            env["WINEPREFIX"] = pfx_path
            for var in _BAD_ENV_VARS:
                env.pop(var, None)

            xvfb_run = shutil.which("xvfb-run")

            if xvfb_run:
                full_cmd: list[str] = [xvfb_run, "--auto-servernum", winetricks_bin, "-q", dep]
            else:
                full_cmd = [winetricks_bin, "-q", dep]
            return subprocess.run(
                full_cmd, capture_output=True, text=True, timeout=t,
                env=env,
            )
        methods.append(("system winetricks", _sys_winetricks))

    return methods
