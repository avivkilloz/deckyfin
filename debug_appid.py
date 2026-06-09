"""Test app_id calculation vs actual Steam values."""
import sys, os

REPO_DIR = os.path.expanduser("~/git/github/avivkilloz/deckyfin")
sys.path.insert(0, os.path.join(REPO_DIR, "py_modules"))

from pathlib import Path
from steam_games import calc_shortcut_app_id
import vdf

with open("/home/deck/.local/share/Steam/userdata/892854676/config/shortcuts.vdf", "rb") as f:
    data = vdf.binary_load(f)

# Check the first entries
for k in ["0", "1", "2", "3", "4"]:
    short = data["shortcuts"][k]
    stored_appid = short.get("appid")
    appname = short.get("appname")
    exe = short.get("exe")
    
    calculated = calc_shortcut_app_id(appname, exe)
    
    match = "MATCH" if stored_appid == calculated else "MISMATCH"
    
    print(f"[{k}] {appname}")
    print(f"  exe:     {exe[:80]}...")
    print(f"  stored:  {stored_appid}")
    print(f"  calc:    {calculated}")
    print(f"  status:  {match}")
    print()

# Check without quotes
print("=== Without quotes ===")
for k in ["0", "1", "2"]:
    short = data["shortcuts"][k]
    appname = short.get("appname")
    exe_noquotes = short.get("exe").strip('"')
    calc_nq = calc_shortcut_app_id(appname, exe_noquotes)
    stored = short.get("appid")
    status = "MATCH" if calc_nq == stored else "different"
    print(f"[{k}] {appname}: no-quotes={calc_nq} -> {status}")

# Also check if Steam stores quotes differently
print("\n=== Raw exe repr ===")
for k in ["0", "1", "2"]:
    short = data["shortcuts"][k]
    exe = short.get("exe")
    print(f"[{k}] exe repr: {repr(exe)[:100]}")
