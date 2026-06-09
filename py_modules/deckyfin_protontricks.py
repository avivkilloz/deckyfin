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

# Per-method timeout — .NET installers (dotnet40/48) can take 3-5 minutes
_METHOD_TIMEOUT = 600


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


def _find_wine_pair(proton_dir: Path) -> tuple[Optional[Path], Optional[Path]]:
    """Find wine64/wine and wineserver in a Proton directory.

    Modern GE-Proton (10+) uses files/bin/ instead of dist/bin/.
    Checks all known layouts: dist/bin/ first, then files/bin/.
    """
    # Try all known wine binary locations
    for base in ["dist/bin", "files/bin"]:
        wine64 = proton_dir / base / "wine64"
        wine = proton_dir / base / "wine"
        server = proton_dir / base / "wineserver"

        if wine64.exists() and server.exists():
            return (wine64, server)
        if wine.exists() and server.exists():
            return (wine, server)

    return (None, None)


def _get_real_user() -> Optional[str]:
    """Detect the actual desktop user for file ownership fixes.

    When the Decky plugin_loader runs as root (common on Arch/CachyOS),
    subprocesses inherit UID 0 and write root-owned files into the user's
    prefix. Steam runs as the desktop user and can't access root-owned files.

    Returns the username (e.g. 'avivilloz') or None if we're already the user.
    """
    try:
        if os.geteuid() != 0:
            return None  # Already running as non-root, no fix needed

        # Look for Steam installations in /home/* directories
        for home_dir in sorted(Path("/home").iterdir()):
            if home_dir.is_dir():
                steam_path = home_dir / ".steam" / "steam"
                if steam_path.exists() and steam_path.is_dir():
                    return home_dir.name
    except Exception:
        pass
    return None


def _chown_prefix(prefix_dir: str, username: str) -> None:
    """Chown an entire prefix directory to the real user.

    Called after any root-owned subprocess modifies the prefix
    (wineboot init, protontricks install, winetricks install).
    """
    try:
        subprocess.run(
            ["chown", "-R", f"{username}:{username}", prefix_dir],
            capture_output=True, timeout=30,
        )
        logger.info("Fixed prefix ownership to %s for %s", username, prefix_dir)
    except Exception as e:
        logger.warning("Failed to fix prefix ownership: %s", e)


def _resolve_xdg_runtime_dir() -> Optional[str]:
    """Resolve the correct XDG_RUNTIME_DIR for the target user.

    When Decky's plugin_loader runs as root, XDG_RUNTIME_DIR is either
    unset or points to root's runtime dir (/run/user/0). Flatpak needs
    the desktop user's real XDG_RUNTIME_DIR (e.g. /run/user/1000 for
    uid 1000) to set up the sandbox correctly.

    Returns the path string (e.g. '/run/user/1000') or None if unresolvable.
    """
    try:
        uid = os.geteuid()
        if uid == 0:
            # Running as root — find the real user's UID by scanning /home
            for home_dir in sorted(Path("/home").iterdir()):
                if home_dir.is_dir():
                    try:
                        stat_info = home_dir.stat()
                        real_uid = stat_info.st_uid
                        if real_uid > 0:
                            runtime_dir = f"/run/user/{real_uid}"
                            if Path(runtime_dir).exists():
                                return runtime_dir
                    except Exception:
                        continue
        else:
            # Already running as the user — use existing env
            existing = os.environ.get("XDG_RUNTIME_DIR")
            if existing and Path(existing).exists():
                return existing
    except Exception:
        pass
    return None


def _runuser_cmd(cmd: list[str], username: str,
                 extra_env: Optional[dict[str, str]] = None) -> list[str]:
    """Wrap a command to run as a specific user via runuser.

    When Decky's plugin_loader runs as root, wine refuses to touch a
    prefix owned by a different UID. Running subprocesses as the actual
    desktop user via runuser solves this cleanly.

    runuser -u <user> creates a clean env with correct HOME/USER/LOGNAME.
    Extra env vars (WINEPREFIX, WINELOADER, etc.) are passed via `env`.
    Also sets XDG_RUNTIME_DIR so flatpak sandboxing works correctly.
    """
    if not username:
        return cmd

    env_vars: dict[str, str] = dict(extra_env or {})
    # Flatpak needs the correct XDG_RUNTIME_DIR for the desktop user
    xdg_dir = _resolve_xdg_runtime_dir()
    if xdg_dir:
        env_vars["XDG_RUNTIME_DIR"] = xdg_dir

    wrapper: list[str] = ["runuser", "-u", username, "--"]

    if env_vars:
        env_parts = ["env"]
        for k, v in env_vars.items():
            env_parts.append(f"{k}={v}")
        wrapper.extend(env_parts)

    wrapper.extend(cmd)
    return wrapper


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
        # Note: modern GE-Proton (10+) uses files/bin/ instead of dist/bin/
        compat_dir = steam_root / STEAM_COMPATTOOLS_FOLDER
        if compat_dir.exists():
            for d in compat_dir.iterdir():
                if d.is_dir():
                    wine, server = _find_wine_pair(d)
                    if wine and server:
                        candidates.append((d.name, str(wine), str(server)))

        # Then steamapps/common (official Proton versions)
        common_dir = steam_root / STEAM_STEAMAPPS_FOLDER / STEAM_COMMON_FOLDER
        if common_dir.exists():
            for d in common_dir.iterdir():
                if d.is_dir() and "proton" in d.name.lower():
                    wine, server = _find_wine_pair(d)
                    if wine and server:
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
            # GE-Proton gets next — sort newest first (negative version tuple)
            if "ge-proton" in name:
                # Parse "ge-proton10-33" → (10, 33) for numeric comparison
                rest = name.replace("ge-proton", "").lstrip("-")
                parts = rest.split("-")
                try:
                    major = int(parts[0])
                    patch = int(parts[1]) if len(parts) > 1 else 0
                    return (1, -major, -patch)
                except (ValueError, IndexError):
                    return (1, 0, 0)
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


def _init_prefix_for_deps(compatdata_path: Path, steam_root: Optional[Path]) -> None:
    """Create a minimal Proton prefix using wineboot so protontricks can find it.

    Called when install_protontricks_dependencies finds no existing compatdata
    directory for the given non-Steam game app ID.
    """
    from deckyfin_consts import PREFIX_INIT_TIMEOUT
    logger.info("Creating prefix at %s", compatdata_path)

    pfx = compatdata_path / "pfx"
    (pfx / "drive_c" / "users" / "steamuser" / "Documents").mkdir(parents=True, exist_ok=True)
    (pfx / "drive_c" / "users" / "steamuser" / "AppData" / "Local").mkdir(parents=True, exist_ok=True)
    (pfx / "drive_c" / "users" / "steamuser" / "AppData" / "Roaming").mkdir(parents=True, exist_ok=True)
    (pfx / "drive_c" / "users" / "steamuser" / "Desktop").mkdir(parents=True, exist_ok=True)

    pw = _find_proton_wine()
    if not pw or not steam_root:
        # Only created the dir structure — protontricks will still fail for some tools,
        # but at least native protontricks can see the app ID now
        logger.warning("No Proton wine available; created empty prefix structure only")
        return

    wine_loader_path = Path(pw[0])
    proton_script = wine_loader_path.parent.parent.parent / "proton"
    if not proton_script.exists():
        logger.warning("Proton script not found at %s; created empty prefix only", proton_script)
        return

    _kill_wineservers()
    env = os.environ.copy()
    env["STEAM_COMPAT_DATA_PATH"] = str(compatdata_path)
    env["STEAM_COMPAT_CLIENT_INSTALL_PATH"] = str(steam_root)
    env["PROTON_NO_ESYNC"] = "1"
    env["PROTON_NO_FSYNC"] = "1"

    result = subprocess.run(
        [str(proton_script), "run", "wineboot", "--init"],
        env=env, capture_output=True, text=True, timeout=PREFIX_INIT_TIMEOUT,
    )
    if result.returncode == 0:
        logger.info("Prefix initialized at %s via wineboot", compatdata_path)
        # Fix ownership if we ran as root
        real_user = _get_real_user()
        if real_user:
            _chown_prefix(str(compatdata_path), real_user)
    else:
        raise RuntimeError(
            f"wineboot failed (exit {result.returncode}): "
            f"{result.stderr or result.stdout or 'unknown'}"
        )


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
        from deckyfin_consts import STEAM_STEAMAPPS_FOLDER as _SSAF, COMPATDATA_FOLDER as _CDF
        steam_root = find_steam_root()
        if steam_root:
            compatdata = steam_root / _SSAF / _CDF / pfxid
            if compatdata.exists():
                prefix_dir = str(compatdata)
            else:
                logger.warning("Prefix directory not found at %s", compatdata)
                # ── Try to create prefix so protontricks can find it ──
                try:
                    _init_prefix_for_deps(compatdata, steam_root)
                    prefix_dir = str(compatdata)
                except Exception as e2:
                    logger.error("Failed to auto-create prefix: %s", e2)
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
                    # Fix ownership if we ran as root
                    real_user = _get_real_user()
                    if real_user and prefix_dir:
                        _chown_prefix(prefix_dir, real_user)
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
                cmd = [
                    "flatpak", "run",
                    "--filesystem=host",
                ]
                if steam_root:
                    cmd.append(f"--env=STEAM_DIR={str(steam_root)}")
                cmd.extend([
                    PROTONTRICKS_FLATPAK,
                    pfxid, "--", "--force", "--unattended", dep,
                ])
                real_user = _get_real_user()
                if real_user:
                    full_cmd = _runuser_cmd(cmd, real_user)
                    result = _run_with_clean_env(
                        full_cmd, capture_output=True, text=True, timeout=t,
                    )
                else:
                    result = _run_with_clean_env(
                        cmd, capture_output=True, text=True, timeout=t,
                    )
                # Flatpak emits F:/W: deprecation warnings on stderr even on
                # success — override returncode when no real error is present
                if result.returncode != 0 and not _flatpak_has_real_error(
                    (result.stderr or "") + "\n" + (result.stdout or "")
                ):
                    result.returncode = 0
                return result
            methods.append(("flatpak protontricks", _flatpak))

    # ── Method 2: Native protontricks CLI ───────────────────────────────
    native = shutil.which("protontricks")
    if native:
        def _native(t):
            extra_env = {}
            if steam_root:
                extra_env["STEAM_DIR"] = str(steam_root)

            cmd: list[str] = [native, "--no-bwrap", pfxid, "--unattended", dep]

            real_user = _get_real_user()
            if real_user:
                cmd = _runuser_cmd(cmd, real_user, extra_env)
                return _run_with_clean_env(
                    cmd, capture_output=True, text=True, timeout=t,
                )
            return _run_with_clean_env(
                cmd,
                extra_env=extra_env or None,
                capture_output=True, text=True, timeout=t,
            )
        methods.append(("native protontricks", _native))

    # ── Method 3: Proton wine + winetricks ──────────────────────────────
    # Use Proton's own wine with WINELOADER/WINESERVER set, then run winetricks.
    if proton_wine and pfx_path and shutil.which("winetricks"):
        wine_loader, wine_server = proton_wine

        def _proton_winetricks(t):
            wine_env = {
                "WINEPREFIX": pfx_path,
                "WINELOADER": wine_loader,
                "WINESERVER": wine_server,
                "WINETRICKS_UNATTENDED": "1",
            }
            real_user = _get_real_user()

            # Try without xvfb first (Proton wine often doesn't need display for -q)
            winetricks_bin = shutil.which("winetricks")
            assert winetricks_bin is not None  # checked before adding method
            logger.info(
                "Proton wine approach: %s (WINELOADER=%s, WINESERVER=%s)",
                winetricks_bin, wine_loader, wine_server,
            )

            if real_user:
                cmd = _runuser_cmd([winetricks_bin, "-q", dep], real_user, wine_env)
                no_xvfb = subprocess.run(
                    cmd, capture_output=True, text=True, timeout=t,
                )
            else:
                winetricks_env = os.environ.copy()
                winetricks_env.update(wine_env)
                for var in _BAD_ENV_VARS:
                    winetricks_env.pop(var, None)
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
                if real_user:
                    xvfb_cmd = _runuser_cmd(
                        [xvfb_run, "--auto-servernum", winetricks_bin, "-q", dep],
                        real_user, wine_env,
                    )
                    return subprocess.run(
                        xvfb_cmd, capture_output=True, text=True, timeout=t,
                    )
                else:
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

            wine_env = {"WINEPREFIX": pfx_path}
            real_user = _get_real_user()

            xvfb_run = shutil.which("xvfb-run")

            if xvfb_run:
                cmd: list[str] = [xvfb_run, "--auto-servernum", winetricks_bin, "-q", dep]
            else:
                cmd = [winetricks_bin, "-q", dep]

            if real_user:
                cmd = _runuser_cmd(cmd, real_user, wine_env)
                return subprocess.run(
                    cmd, capture_output=True, text=True, timeout=t,
                )
            else:
                env = os.environ.copy()
                env.update(wine_env)
                for var in _BAD_ENV_VARS:
                    env.pop(var, None)
                return subprocess.run(
                    cmd, capture_output=True, text=True, timeout=t,
                    env=env,
                )
        methods.append(("system winetricks", _sys_winetricks))

    return methods


def _flatpak_has_real_error(output: str) -> bool:
    """Check if flatpak output contains a real error.

    Flatpak emits F:/W: info messages on stderr even on success,
    and wine outputs harmless fixme/err messages. This function
    uses error-keyword detection to tell real failures from noise.

    Returns True only if a genuine error keyword is found.
    """
    error_keywords = [
        "Traceback", "error:", "Error:", "ERROR:",
        "failed:", "Failed:", "FAILED:",
        "not found", "No such file",
        "Permission denied", "Access is denied",
        "ModuleNotFoundError", "cannot find",
        "wine client error", "version mismatch",
        "err:module:", "err:ole:",
        "err:mscoree:", "err:msi:",
    ]
    for keyword in error_keywords:
        if keyword in output:
            return True
    return False


def detect_protontricks_status() -> dict:
    """Check availability of Flatpak and Native protontricks.

    Returns:
        dict with keys:
            flatpak_available (bool): flatpak CLI on PATH
            flatpak_installed (bool): flatpak protontricks installed
            native_available (bool): native protontricks on PATH
            status (str): summary string
    """
    result = {
        "flatpak_available": False,
        "flatpak_installed": False,
        "native_available": False,
    }

    # Check flatpak CLI
    if shutil.which("flatpak"):
        result["flatpak_available"] = True
        # Check if flatpak protontricks is installed
        check = _run_with_clean_env(
            ["flatpak", "info", PROTONTRICKS_FLATPAK],
            capture_output=True, text=True, timeout=15,
        )
        if check.returncode == 0:
            result["flatpak_installed"] = True
        else:
            # Fallback: check wrapper binary on disk
            for export_dir in [
                Path.home() / ".local/share/flatpak/exports/bin",
                Path("/var/lib/flatpak/exports/bin"),
            ]:
                if (export_dir / PROTONTRICKS_FLATPAK).exists():
                    result["flatpak_installed"] = True
                    break

    # Check native protontricks
    if shutil.which("protontricks"):
        result["native_available"] = True

    # Build summary
    parts = []
    if result["flatpak_installed"]:
        parts.append("Flatpak protontricks available")
    elif result["flatpak_available"]:
        parts.append("Flatpak available, protontricks not installed")
    else:
        parts.append("Flatpak not available")
    if result["native_available"]:
        parts.append("Native protontricks available")

    result["status"] = " — ".join(parts) if parts else "No protontricks available"
    return result


def install_protontricks_flatpak() -> dict:
    """Install protontricks via flatpak from Flathub.

    Returns:
        dict with keys: success (bool), message (str)
    """
    if not shutil.which("flatpak"):
        return {"success": False, "message": "Flatpak is not installed on this system"}

    try:
        # Add flathub remote if needed
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
            return {"success": True, "message": "Protontricks installed successfully"}
        else:
            return {
                "success": False,
                "message": f"Install failed: {install.stderr or install.stdout or 'unknown error'}",
            }
    except Exception as e:
        return {"success": False, "message": f"Install error: {str(e)}"}
