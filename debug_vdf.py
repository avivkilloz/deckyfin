"""Dump the parsed shortcuts.vdf structure to understand parsing."""
import sys, os

REPO_DIR = os.path.expanduser("~/git/github/avivkilloz/deckyfin")
sys.path.insert(0, os.path.join(REPO_DIR, "py_modules"))

from pathlib import Path
from steam_utils import find_steam_root, get_user_id

sr = find_steam_root()
uid = get_user_id()
svdf = sr / "userdata" / uid / "config" / "shortcuts.vdf"
print(f"Reading: {svdf}")

import vdf
with open(svdf, "rb") as f:
    raw = f.read(4096)
print(f"First 120 hex bytes:", raw[:120].hex())

with open(svdf, "rb") as f:
    data = vdf.binary_load(f)

shortcuts = data.get("shortcuts", {})
keys = sorted(shortcuts.keys(), key=int)
print(f"\nTotal keys in shortcuts dict: {len(keys)}")
for k in keys[:5]:
    v = shortcuts[k]
    print(f"\nEntry [{k}] type={type(v).__name__}:")
    for fk, fv in v.items():
        print(f"  {fk!r} ({type(fv).__name__}): {str(fv)[:80]}")

# Now try the actual get_steam_shortcut_info function
sys.path.insert(0, ".")
from steam_games import get_steam_shortcut_info
info = get_steam_shortcut_info("It Takes Two", uid)
print(f"\nLookup 'It Takes Two': {info}")

# And list_nonsteam_games
from steam_games import list_nonsteam_games
games = list_nonsteam_games(uid)
print(f"\nlist_nonsteam_games returned {len(games)} games")
for g in games[:5]:
    print(f"  {g.get('name')!r}")
