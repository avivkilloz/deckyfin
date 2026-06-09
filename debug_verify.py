"""Read-only check of current shortcuts.vdf state for user's game config."""
import sys
sys.path.insert(0, "/home/deck/git/github/avivkilloz/deckyfin/py_modules")

from pathlib import Path
from steam_games import get_steam_shortcut_info, list_nonsteam_games, \
    convert_appid_to_unsigned_32bit
import vdf

# What does Deckyfin see?
info = get_steam_shortcut_info("Split Fiction")
if info:
    print("=== Deckyfin sees (get_steam_shortcut_info) ===")
    for k, v in info.items():
        print(f"  {k}: {v}")
else:
    print("Not found by get_steam_shortcut_info!")
    sys.exit(1)

# What's in the actual VDF file?
svdf = Path("/home/deck/.local/share/Steam/userdata/892854676/config/shortcuts.vdf")
with open(svdf, "rb") as f:
    data = vdf.binary_load(f)

for k in sorted(data["shortcuts"].keys(), key=int):
    s = data["shortcuts"][k]
    sn = s.get("appname") or s.get("AppName") or s.get("name")
    if sn and "Split" in sn:
        print(f"\n=== Actual VDF entry [{k}] ===")
        for fk in sorted(s.keys()):
            fv = s[fk]
            print(f"  {fk}: {repr(fv)[:100]}")
        break

# Check the game config to see what executable the user configured
print("\n=== Game config ===")
import json
config_path = Path("/home/deck/git/github/avivkilloz/deckyfin/deckyfin-config.json")
if config_path.exists():
    config = json.loads(config_path.read_text())
    for game in config:
        if game.get("name") == "Split Fiction":
            for k, v in game.items():
                print(f"  {k}: {v}")
