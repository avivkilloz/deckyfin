"""Test if Steam preserves or recalculates the appid after restart."""
import sys, os
REPO_DIR = os.path.expanduser("~/git/github/avivkilloz/deckyfin")
sys.path.insert(0, os.path.join(REPO_DIR, "py_modules"))
from pathlib import Path
import vdf

svdf = Path("/home/deck/.local/share/Steam/userdata/892854676/config/shortcuts.vdf")

with open(svdf, "rb") as f:
    data = vdf.binary_load(f)

print("=== Current appids in shortcuts.vdf ===")
for k in sorted(data["shortcuts"].keys(), key=int)[:10]:
    s = data["shortcuts"][k]
    name = s.get("appname", "?")
    stored = s.get("appid", "N/A")
    print(f"  [{k}] {name:45s} stored appid={stored:12d}")
