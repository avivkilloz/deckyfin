"""Steam control utilities — check running status and restart Steam."""

import subprocess
import logging
from pathlib import Path

from steam_utils import find_steam_root
from deckyfin_consts import LOGGER_STEAM_CONTROL

logger = logging.getLogger(LOGGER_STEAM_CONTROL)


def _find_steam_processes() -> list:
    """Find all running Steam client processes."""
    import psutil

    steam_processes = []
    excluded_keywords = [
        "steamos", "steamos-manager", "steamos_log_submitter",
        "steamgriddb", "steamdeck", "steam.sh", "steamcmd",
    ]

    for proc in psutil.process_iter(["pid", "name", "exe", "cmdline"]):
        try:
            name = proc.info.get("name", "") or ""
            exe = proc.info.get("exe", "") or ""
            cmdline = " ".join(proc.info.get("cmdline", []) or [])

            should_exclude = any(
                kw.lower() in name.lower() or kw.lower() in exe.lower()
                for kw in excluded_keywords
            )
            if should_exclude:
                continue

            is_steam_client = False
            steam_client_names = ["steam", "steamwebhelper", "steamerrorreporter"]
            if any(client_name in name.lower() for client_name in steam_client_names):
                is_steam_client = True

            steam_paths = [
                "/.local/share/Steam", "/.steam/steam",
                "/.steam/debian-installation",
                "/.var/app/com.valvesoftware.Steam",
            ]
            if any(steam_path in exe for steam_path in steam_paths):
                if "steamos" not in exe.lower() and "steamcmd" not in exe.lower():
                    is_steam_client = True

            if is_steam_client:
                steam_processes.append(proc)
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue

    return steam_processes


def is_steam_running() -> bool:
    """Check if Steam client is currently running."""
    processes = _find_steam_processes()
    if processes:
        logger.debug("Steam running (process detection)")
        return True

    try:
        steam_root = find_steam_root()
        lock_file = steam_root / "steam.pid"
        if lock_file.exists():
            try:
                with open(lock_file, "r") as f:
                    pid = int(f.read().strip())
                import psutil
                try:
                    proc = psutil.Process(pid)
                    proc_name = proc.name().lower()
                    if "steam" in proc_name and "steamos" not in proc_name:
                        logger.debug("Steam running (lock file pid=%s)", pid)
                        return True
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
            except (ValueError, IOError):
                pass
    except Exception:
        pass

    logger.debug("Steam not running")
    return False


_MODE_FLAGS = ["-bigpicture", "-gamepadui", "-steamos3", "-tenfoot"]
_DISPLAY_ENV_VARS = {
    "DISPLAY", "WAYLAND_DISPLAY", "DBUS_SESSION_BUS_ADDRESS",
    "XDG_RUNTIME_DIR", "XDG_SESSION_TYPE", "HOME", "USER", "XAUTHORITY",
}


def _is_main_steam(proc) -> bool:
    name = proc.info.get("name", "").lower()
    return "steam" in name and not any(x in name for x in ("webhelper", "errorreporter", "srt"))


def _detect_steam_mode_flags(processes: list) -> list:
    """Determine the correct Steam launch mode flags.

    On Steam Deck / Gamescope setups, Steam runs under gamescope with
    -gamepadui. On a regular desktop with Decky, the user is in Big Picture
    mode. Since this plugin only runs inside Steam's overlay (always in some
    fullscreen mode), default to -bigpicture on desktop and -gamepadui when
    gamescope is detected.
    """
    import psutil

    # Check for gamescope → Steam Deck / Gaming Mode
    # Request pid+name so the psutil internal cache doesn't drop pid from
    # the already-fetched steam processes (process_iter shares cached objects).
    for proc in psutil.process_iter(["pid", "name"]):
        try:
            if "gamescope" in (proc.info.get("name") or "").lower():
                logger.info("Detected gamescope — using -gamepadui")
                return ["-gamepadui"]
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    # Desktop Big Picture mode (Decky only runs in fullscreen Steam)
    logger.info("No gamescope found — using -bigpicture")
    return ["-bigpicture"]


def _capture_display_env(processes: list) -> dict:
    """Capture display/session env vars from the running Steam process.

    The plugin_loader service runs as root with no display env, so we must
    grab DISPLAY, WAYLAND_DISPLAY, DBUS_SESSION_BUS_ADDRESS, etc. from the
    live Steam process before we kill it.
    """
    import psutil
    for proc in processes:
        try:
            if not _is_main_steam(proc):
                continue
            env = proc.environ()
            captured = {k: v for k, v in env.items() if k in _DISPLAY_ENV_VARS}
            if captured.get("DISPLAY") or captured.get("WAYLAND_DISPLAY"):
                logger.debug("Captured display env from pid=%s: %s",
                             proc.info.get("pid"), list(captured.keys()))
                return captured
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    logger.warning("Could not capture display env from Steam process — relaunch may fail")
    return {}


def restart_steam() -> dict:
    """Kill Steam processes and relaunch with the same mode (bigpicture / gamepadui / etc.)."""
    result = {
        "success": False,
        "message": "",
        "killed_processes": [],
        "errors": [],
    }

    processes = _find_steam_processes()

    if not processes:
        result["message"] = "Steam is not currently running"
        result["success"] = True
        logger.info("Requested Steam restart but no processes found")
        return result

    mode_flags = _detect_steam_mode_flags(processes)
    display_env = _capture_display_env(processes)
    logger.info("Detected Steam mode flags: %s  display_env keys: %s",
                mode_flags, list(display_env.keys()))

    import psutil
    for proc in processes:
        try:
            proc_info = proc.info
            proc.kill()
            result["killed_processes"].append({
                "pid": proc_info["pid"],
                "name": proc_info["name"],
            })
            logger.info("Killed Steam process pid=%s name=%s", proc_info["pid"], proc_info["name"])
        except (psutil.NoSuchProcess, psutil.AccessDenied) as e:
            result["errors"].append(f"Could not kill process {proc.info.get('pid')}: {str(e)}")

    import time
    time.sleep(2)

    import os, pwd, shlex, shutil
    from steam_utils import _get_real_home

    real_username = _get_real_home().name if os.geteuid() == 0 else None
    steam_cmd = ["steam"] + mode_flags  # resolved below per-attempt

    launch_log = open("/tmp/deckyfin_steam_launch.log", "w")

    launched = False

    # ── Attempt 1: machinectl shell (runs inside the user's login session) ──
    # Use a clean env so machinectl uses system libs, not the PyInstaller bundle's LD_LIBRARY_PATH.
    _clean_env = {"PATH": "/usr/bin:/usr/sbin:/bin:/sbin:/usr/local/bin"}
    if not launched and real_username and shutil.which("machinectl"):
        try:
            setenv_flags = [f"--setenv={k}={v}" for k, v in display_env.items()]
            subprocess.Popen(
                ["machinectl", "shell"] + setenv_flags + [f"{real_username}@", "/usr/bin/steam"] + mode_flags,
                env=_clean_env,
                stdout=launch_log,
                stderr=launch_log,
                start_new_session=True,
            )
            launched = True
            result["message"] = "Steam restarted via machinectl shell"
            logger.info("Steam relaunch: machinectl shell")
        except Exception as e:
            logger.warning("machinectl shell attempt failed: %s", e)

    # ── Attempt 2: su -c with env vars embedded in shell command ────────────
    if not launched and real_username:
        try:
            env_prefix = " ".join(
                f"{k}={shlex.quote(v)}" for k, v in display_env.items()
            )
            steam_str = " ".join(shlex.quote(c) for c in steam_cmd)
            shell_cmd = f"{env_prefix} {steam_str}"
            subprocess.Popen(
                ["su", real_username, "-c", shell_cmd],
                env=_clean_env,
                stdout=launch_log,
                stderr=launch_log,
                start_new_session=True,
            )
            launched = True
            result["message"] = "Steam restarted via su"
            logger.info("Steam relaunch: su -c")
        except Exception as e:
            logger.warning("su attempt failed: %s", e)

    # ── Attempt 3: preexec_fn setuid (last resort) ───────────────────────────
    if not launched:
        launch_env = os.environ.copy()
        launch_env.update(display_env)
        preexec_fn = None
        if real_username and real_username != "root":
            try:
                pw = pwd.getpwnam(real_username)
                uid, gid = pw.pw_uid, pw.pw_gid
                launch_env.update({"HOME": pw.pw_dir, "USER": real_username, "LOGNAME": real_username})
                def preexec_fn():
                    try:
                        os.initgroups(real_username, gid)
                    except Exception:
                        pass
                    os.setgid(gid)
                    os.setuid(uid)
            except KeyError as e:
                logger.warning("preexec_fn setup failed: %s", e)
        try:
            subprocess.Popen(
                steam_cmd,
                env=launch_env,
                preexec_fn=preexec_fn,
                stdout=launch_log,
                stderr=launch_log,
                start_new_session=True,
            )
            launched = True
            result["message"] = "Steam restarted via setuid"
            logger.info("Steam relaunch: preexec setuid")
        except Exception as e:
            logger.warning("preexec_fn attempt failed: %s", e)

    import time
    time.sleep(1)
    logger.info("Steam relaunch output (if any): check /tmp/deckyfin_steam_launch.log")

    if not launched:
        result["errors"].append("Could not automatically launch Steam. Please start it manually.")
        result["message"] = "Steam processes killed, but could not auto-launch. Please start Steam manually."
        logger.warning("Steam restart could not relaunch client automatically")
    else:
        result["success"] = True
        logger.info("Steam restarted successfully with flags: %s", mode_flags)

    return result
