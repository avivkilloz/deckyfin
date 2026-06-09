"""Investigate alternative app_id algorithms. Maybe it's not CRC32 at all."""
import sys, os, binascii, struct, zlib

REPO_DIR = os.path.expanduser("~/git/github/avivkilloz/deckyfin")
sys.path.insert(0, os.path.join(REPO_DIR, "py_modules"))

import vdf

with open("/home/deck/.local/share/Steam/userdata/892854676/config/shortcuts.vdf", "rb") as f:
    data = vdf.binary_load(f)

def signed32(val):
    val = val & 0xFFFFFFFF
    return val - 0x100000000 if val >= 0x80000000 else val

# Check all entries - what algorithms do their appids suggest?
for k in ["0", "1", "2", "3", "4", "5", "6", "7"]:
    short = data["shortcuts"][k]
    stored = short.get("appid")
    appname = short.get("appname")
    exe = short.get("exe")
    
    # Try different things
    a1 = signed32(binascii.crc32((exe + appname).encode()) | 0x80000000)
    a2 = signed32(zlib.crc32((exe + appname).encode()) | 0x80000000)
    a3 = signed32(binascii.crc32((exe.encode() + b"\x00" + appname.encode()).encode()) | 0x80000000)
    
    # Try the appid without the 0x80000000 mask
    test = binascii.crc32((exe + appname).encode()) & 0xFFFFFFFF
    # Maybe Steam XORs with something?
    
    matches = []
    if stored == a1: matches.append("exe+appname|mask")
    
    # Check: maybe the exe in VDF includes a \x00 that gets stripped?
    # Or maybe the name has trailing spaces that aren't visible?
    
    print(f"[{k}] \"{appname}\" -> stored={stored}")
    
    # Show lower 31 bits of stored vs CRC32
    stored_unsigned = stored & 0xFFFFFFFF
    crc = binascii.crc32((exe + appname).encode()) & 0x7FFFFFFF
    
    # Maybe the masked CRC was XOR'd with something?
    diff = (stored_unsigned ^ 0x80000000) ^ crc
    if diff:
        print(f"     XOR difference: {diff:#010x}")
    
    # Maybe it's CRC32 of just the appname (without mask)?
    crc_name = binascii.crc32(appname.encode())
    crc_exe = binascii.crc32(exe.encode())
    crc_both = binascii.crc32((appname + exe).encode())
    for val, label in [(crc_name, "name only"), (crc_exe, "exe only"), (crc_both, "name+exe")]:
        if signed32(val | 0x80000000) == stored:
            print(f"     MATCH via {label}!")

# Let me also look at the actual raw binary around each entry
print("\n=== Raw VDF entry lookup ===")
with open("/home/deck/.local/share/Steam/userdata/892854676/config/shortcuts.vdf", "rb") as f:
    raw = f.read()

# Find each entry's appid in the binary
for k in ["0", "1"]:
    short = data["shortcuts"][k]
    appname = short.get("appname")
    stored = short.get("appid")
    
    # Search for the appname in the binary
    idx = raw.find(appname.encode())
    if idx >= 0:
        # Show 50 bytes before the appname
        ctx_start = max(0, idx - 50)
        ctx = raw[ctx_start:idx + len(appname) + 20]
        # Make it printable
        ascii_repr = "".join(chr(b) if 32 <= b < 127 else "." for b in ctx)
        print(f"\nEntry [{k}] context around appname:")
        print(f"  Offset: {idx}")
        print(f"  Raw: {ascii_repr}")
    
    # Also search for appid binary value
    # appid is stored as \x02appid\x00<4-byte-int>
    appid_marker = b"\x02appid\x00"
    idx2 = raw.find(appid_marker)
    if idx2 >= 0:
        val = struct.unpack("<i", raw[idx2+8:idx2+12])[0]
        print(f"\n  First appid at offset {idx2}: {val}")
