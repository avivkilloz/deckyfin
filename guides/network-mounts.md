# Network Mount Setup for Deckyfin

This guide covers mounting a remote games folder (from a home server or NAS) on your Steam Deck so Deckyfin can manage it as a source. Three methods are covered: SSHFS, Samba (CIFS), and NFS.

---

## Choosing a Method

| | SSHFS | Samba (CIFS) | NFS |
|---|---|---|---|
| Best for | Linux servers, no extra server setup beyond SSH | Windows servers, NAS appliances (Synology, TrueNAS, QNAP) | Linux servers, best LAN performance |
| Authentication | SSH key or password | Username + password | IP-based, no login |
| LAN performance | Slowest (SSH encryption overhead) | Good | Best |
| Server config needed | None (SSH already running) | Install + configure Samba | Install + configure NFS |
| Root access from client | Blocked by FUSE (handled by Deckyfin) | Full root access | Configurable via `root_squash` |

**Accessing from outside your home network?** Set up [Tailscale](#tailscale) first, then use any of these methods with the Tailscale IP instead of the LAN IP. SSHFS is the best choice over the internet — it's already encrypted and has no extra firewall requirements.

---

## Prerequisites (Steam Deck client — all methods)

SteamOS has a read-only root filesystem. Disable it temporarily to install packages, then re-enable:

```bash
sudo steamos-readonly disable
sudo pacman -S sshfs          # for SSHFS
sudo pacman -S cifs-utils     # for Samba
sudo pacman -S nfs-utils      # for NFS
sudo steamos-readonly enable
```

Install only what you need. Packages survive until the next SteamOS system update, after which you re-run the same command.

Create the local mount point (same path for all methods):

```bash
mkdir -p /home/deck/homeserver/drive
```

---

## Method 1: SSHFS

SSHFS tunnels the filesystem over SSH. No server-side config beyond a running SSH daemon.

### Server side

Ensure SSH is running and your Steam Deck can log in (preferably with an SSH key):

```bash
# On the server — verify SSH is active
sudo systemctl status sshd

# On the Steam Deck — generate a key if you don't have one
ssh-keygen -t ed25519 -f ~/.ssh/deckyfin-key -N ""

# Copy it to the server
ssh-copy-id -i ~/.ssh/deckyfin-key.pub youruser@192.168.1.x
```

### Client side (Steam Deck)

**Systemd user service** — runs as your user (deck), so no root needed for mounting.

Create `~/.config/systemd/user/home-deck-homeserver-drive.service`:

```ini
[Unit]
Description=SSHFS mount: home server games drive
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStartPre=/bin/mkdir -p /home/deck/homeserver/drive
ExecStart=/usr/bin/sshfs youruser@192.168.1.x:/path/to/games \
    /home/deck/homeserver/drive \
    -f \
    -o IdentityFile=/home/deck/.ssh/deckyfin-key \
    -o reconnect \
    -o ServerAliveInterval=15 \
    -o ServerAliveCountMax=3 \
    -o _netdev \
    -o uid=1000 \
    -o gid=1000
ExecStop=/usr/bin/fusermount -u /home/deck/homeserver/drive
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
```

Enable and start:

```bash
systemctl --user daemon-reload
systemctl --user enable --now home-deck-homeserver-drive.service
```

**Note:** Do **not** add `-o allow_other` or `-o allow_root`. Deckyfin handles root access restrictions via subprocess internally.

---

## Method 2: Samba (CIFS)

Samba exposes Windows-compatible SMB shares. Most NAS appliances expose shares this way by default.

### Server side (Linux)

Install Samba and configure a share:

```bash
sudo pacman -S samba        # Arch/SteamOS-based
# or
sudo apt install samba      # Debian/Ubuntu
```

Add to `/etc/samba/smb.conf`:

```ini
[games]
   path = /path/to/your/games
   browseable = yes
   read only = no
   valid users = youruser
   create mask = 0664
   directory mask = 0775
```

Set a Samba password and start the service:

```bash
sudo smbpasswd -a youruser
sudo systemctl enable --now smb nmb
```

**NAS appliances (Synology, TrueNAS, QNAP):** Enable SMB/CIFS sharing in the NAS web UI and create a shared folder. No manual config file editing needed.

### Client side (Steam Deck)

CIFS requires root to mount, so use a **system-level** `.mount` unit. The unit filename must exactly match the mount path with `/` replaced by `-` and the leading `-` dropped.

For mount path `/home/deck/homeserver/drive` → filename `home-deck-homeserver-drive.mount`

Create `/etc/systemd/system/home-deck-homeserver-drive.mount`:

```ini
[Unit]
Description=Samba mount: home server games drive
After=network-online.target
Wants=network-online.target

[Mount]
What=//192.168.1.x/games
Where=/home/deck/homeserver/drive
Type=cifs
Options=credentials=/home/deck/.smb-credentials,uid=1000,gid=1000,iocharset=utf8,vers=3.0,_netdev,x-systemd.automount

[Install]
WantedBy=multi-user.target
```

Create the credentials file at `/home/deck/.smb-credentials`:

```
username=youruser
password=yoursambapassword
domain=WORKGROUP
```

Lock it down:

```bash
chmod 600 /home/deck/.smb-credentials
```

Enable:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now home-deck-homeserver-drive.mount
```

**Verify:**

```bash
systemctl status home-deck-homeserver-drive.mount
ls /home/deck/homeserver/drive
```

---

## Method 3: NFS

NFS is the simplest and fastest option for Linux-to-Linux sharing on a LAN.

### Server side (Linux)

Install and configure:

```bash
sudo pacman -S nfs-utils    # Arch/SteamOS-based
# or
sudo apt install nfs-kernel-server   # Debian/Ubuntu
```

Add your export to `/etc/exports`:

```
/path/to/your/games  192.168.1.0/24(rw,sync,no_subtree_check,no_root_squash)
```

- `no_root_squash` — allows root on the Steam Deck to access files directly, which is the simplest setup and avoids any access-control friction. Only use this on a trusted private LAN.
- If you prefer the safer default `root_squash` (root is mapped to `nobody`), Deckyfin handles it automatically via its subprocess fallback — but leave off `no_root_squash` and the plugin will still work.

Apply and start:

```bash
sudo systemctl enable --now nfs-server
sudo exportfs -arv
```

Verify the export is visible from the Steam Deck:

```bash
showmount -e 192.168.1.x
```

**NAS appliances:** Enable NFS sharing in the web UI. Look for an "NFS permissions" or "NFS rules" option and add your Steam Deck's IP with `rw` access. The `no_root_squash` option is usually available per-share.

### Client side (Steam Deck)

Create `/etc/systemd/system/home-deck-homeserver-drive.mount`:

```ini
[Unit]
Description=NFS mount: home server games drive
After=network-online.target
Wants=network-online.target

[Mount]
What=192.168.1.x:/path/to/your/games
Where=/home/deck/homeserver/drive
Type=nfs
Options=rw,hard,intr,_netdev,x-systemd.automount

[Install]
WantedBy=multi-user.target
```

Enable:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now home-deck-homeserver-drive.mount
```

**Verify:**

```bash
systemctl status home-deck-homeserver-drive.mount
ls /home/deck/homeserver/drive
```

---

## Tailscale

Tailscale is a zero-config VPN built on WireGuard. Once installed on your server and Steam Deck, both devices get stable private IP addresses (`100.x.x.x`) and can reach each other over the internet as if they were on the same LAN. You then use SSHFS, Samba, or NFS over the Tailscale IP — no router port forwarding required.

**Prefer self-hosting?** [Headscale](https://headscale.net) is an open-source, self-hosted reimplementation of Tailscale's coordination server. You run it on your own machine; the standard Tailscale client on each device is pointed at your Headscale instance instead of Tailscale's cloud. The WireGuard tunnels work identically — Headscale just replaces the cloud control plane. Use it if you don't want a dependency on Tailscale Inc.'s infrastructure.

**When to use Tailscale:**
- You want to browse your home game library while traveling or away from home
- Your Steam Deck is on a different network than your server (hotel, mobile hotspot, etc.)
- You want a stable IP for your server that doesn't change when your ISP reassigns it

**Recommended mount method over Tailscale:** SSHFS. It's already encrypted end-to-end (no double-encryption overhead like Samba+Tailscale), works through any firewall, and needs no server-side config beyond a running SSH daemon.

---

### Step 1: Install Tailscale on your server

> **Running MicroK8s or another container cluster on your server?** Install `tailscaled` as a **host OS service**, not inside the cluster. SSHFS connects to the host's SSH daemon and your game library lives on the host filesystem — routing that through a pod adds unnecessary complexity. The commands below install Tailscale at the OS level regardless of what's running in the cluster.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo systemctl enable --now tailscaled
sudo tailscale up
```

Follow the auth link printed in the terminal to connect the server to your Tailscale account. Note the server's Tailscale IP:

```bash
tailscale ip -4
# → 100.x.x.x
```

### Step 2: Install Tailscale on your Steam Deck

SteamOS uses a read-only root filesystem, so packages installed via `pacman` are wiped on system updates. You need to reinstall Tailscale after each SteamOS update (takes about 30 seconds).

```bash
sudo steamos-readonly disable
sudo pacman -Sy tailscale
sudo systemctl enable --now tailscaled
sudo steamos-readonly enable
```

Authenticate:

```bash
sudo tailscale up
```

Open the auth link on any device to approve the Steam Deck in your Tailscale admin panel.

Verify connectivity:

```bash
tailscale ping 100.x.x.x   # your server's Tailscale IP
```

### Step 3: Mount over Tailscale

Use the **Tailscale IP** (`100.x.x.x`) everywhere you would otherwise use the LAN IP. Everything else is identical to the LAN setup.

**SSHFS over Tailscale** — replace the server IP in your SSHFS systemd service:

```ini
ExecStart=/usr/bin/sshfs youruser@100.x.x.x:/path/to/games \
    /home/deck/homeserver/drive \
    -f \
    -o IdentityFile=/home/deck/.ssh/deckyfin-key \
    -o reconnect \
    -o ServerAliveInterval=15 \
    -o ServerAliveCountMax=3 \
    -o _netdev \
    -o uid=1000 \
    -o gid=1000
```

**Samba over Tailscale** — replace the IP in your `.mount` unit:

```ini
[Mount]
What=//100.x.x.x/games
Where=/home/deck/homeserver/drive
Type=cifs
Options=credentials=/home/deck/.smb-credentials,uid=1000,gid=1000,iocharset=utf8,vers=3.0,_netdev,x-systemd.automount
```

**NFS over Tailscale** is not recommended. NFS is stateful and sensitive to latency and interruptions — it works poorly over the internet even with Tailscale. Use SSHFS instead.

---

### Notes

- Your Tailscale IP (`100.x.x.x`) is stable and permanent for each device — no need to update mount configs if your home IP changes.
- Tailscale's free tier supports up to 100 devices, which is more than enough.
- If the Steam Deck loses the Tailscale connection (e.g., Tailscale is wiped by a SteamOS update), the mount will go offline and Deckyfin will show the source as **offline** until reconnected.
- After reinstalling Tailscale post-update, run `sudo tailscale up` — the device is already registered, so no new auth link is needed.

---

## Adding the mount as a source in Deckyfin

Once the drive is mounted and you can see your game folders under `/home/deck/homeserver/drive`, open Deckyfin:

1. Go to **Settings → Sources**
2. Tap **Add Source**
3. Give it a name (e.g. "Home Server")
4. Set the path to `/home/deck/homeserver/drive` (or browse to it)
5. Tap **Save**, then **Rescan**

Deckyfin will detect your game folders and create config entries for each one.

---

## Troubleshooting

**Mount not appearing after reboot:**
- For user services (SSHFS): run `systemctl --user status home-deck-homeserver-drive.service`
- For system mounts (CIFS/NFS): run `sudo systemctl status home-deck-homeserver-drive.mount`
- Check that your router/server IP hasn't changed. Consider assigning a static LAN IP or using a hostname.

**CIFS: "mount error(13): Permission denied"**
- Check the credentials file path and contents
- Verify the Samba user exists: `sudo pdbedit -L`
- Ensure the share path in smb.conf is correct

**NFS: "mount.nfs: access denied by server"**
- Run `sudo exportfs -arv` on the server after editing `/etc/exports`
- Check the Steam Deck IP is within the allowed subnet in the export rule
- Run `showmount -e <server-ip>` from the Deck to verify the export is visible

**Packages missing after SteamOS update:**
```bash
sudo steamos-readonly disable
sudo pacman -S sshfs cifs-utils nfs-utils   # whichever you use
sudo steamos-readonly enable
sudo systemctl daemon-reload
sudo systemctl restart home-deck-homeserver-drive.mount  # or .service for SSHFS
```
