"""Steam control utilities — check running status and restart Steam."""

import subprocess
import logging
from pathlib import Path

from steam import find_steam_root
from consts import LOGGER_STEAM_CONTROL

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


def restart_steam() -> dict:
    """Kill Steam processes and launch Steam again."""
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
            result["errors"].append(
                f"Could not kill process {proc.info.get('pid')}: {str(e)}"
            )

    import time
    time.sleep(2)

    steam_commands = [
        "steam",
        "/usr/bin/steam",
        "flatpak run com.valvesoftware.Steam",
    ]

    launched = False
    for cmd in steam_commands:
        try:
            check = subprocess.run(
                ["which", cmd.split()[0]],
                capture_output=True, text=True, timeout=2,
            )
            if check.returncode == 0:
                subprocess.Popen(
                    cmd.split(),
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                launched = True
                result["message"] = f"Steam restarted using: {cmd}"
                break
        except Exception:
            continue

    if not launched:
        result["errors"].append(
            "Could not automatically launch Steam. Please start it manually."
        )
        result["message"] = (
            "Steam processes killed, but could not auto-launch. "
            "Please start Steam manually."
        )
        logger.warning("Steam restart could not relaunch client automatically")
    else:
        result["success"] = True
        logger.info("Steam restarted successfully")

    return result
