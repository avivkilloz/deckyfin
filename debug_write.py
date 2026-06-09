"""Test writing to shortcuts.vdf and verify it persists."""
import sys
sys.path.insert(0, "/home/deck/git/github/avivkilloz/deckyfin/py_modules")

from pathlib import Path
from steam_games import update_nonsteam_game, get_steam_shortcut_info, list_nonsteam_games
import vdf

# 1. Read current state of Split Fiction
svdf = Path("/home/deck/.local/share/Steam/userdata/892854676/config/shortcuts.vdf")
with open(svdf, "rb") as f:
    data = vdf.binary_load(f)

entry = None
for k in data["shortcuts"]:
    s = data["shortcuts"][k]
    sn = s.get("appname") or s.get("AppName")
    if sn == "Split Fiction":
        entry = s
        break

if entry:
    print("=== BEFORE update ===")
    print(f"  appid:  {entry.get('appid')}")
    print(f"  exe:    {entry.get('exe')}")
    print(f"  start:  {entry.get('StartDir')}")
    print(f"  opts:   {entry.get('LaunchOptions')}")
else:
    print("Split Fiction not found!")
    sys.exit(1)

# 2. Simulate what "Update Steam" does (without actually changing the exe)
exe_path = "/home/deck/Games/Split Fiction/Split/Binaries/Win64/SplitFiction.exe"
start_dir = "/home/deck/Games/Split Fiction/Split/Binaries/Win64/"
launch_opts = ""

result = update_nonsteam_game("Split Fiction", exe_path, start_dir, launch_opts)
print(f"\n=== update_nonsteam_game returned: {result} ===")

# 3. Read back
with open(svdf, "rb") as f:
    data2 = vdf.binary_load(f)

for k in data2["shortcuts"]:
    s = data2["shortcuts"][k]
    sn = s.get("appname") or s.get("AppName")
    if sn == "Split Fiction":
        print("\n=== AFTER update ===")
        print(f"  appid:  {s.get('appid')}")
        print(f"  exe:    {s.get('exe')}")
        print(f"  start:  {s.get('StartDir')}")
        print(f"  opts:   {s.get('LaunchOptions')}")
        print(f"\n  appid preserved: {s.get('appid') == entry.get('appid')}")
        break
