# Add Deckyfin to Plugin Store

Deckyfin lets you manage a Windows game library from the Decky sidebar without leaving Gaming Mode. It's aimed at users who store games on a home server, NAS, or local drive and want to add them to Steam as non-Steam shortcuts with proper Proton configuration and artwork — all from the Deck.

**What it does:**

- **Library view** — scans a configured games folder and lists detected games in a card or list view with SteamGridDB artwork
- **Steam shortcut integration** — adds any game as a non-Steam shortcut with a single tap; removes it just as easily
- **Proton version picker** — sets a per-game Proton/Wine version via CompatToolMapping (all installed Proton versions listed)
- **Dependency installation** — installs Windows runtimes (vcrun2022, dotnet40/48, directx9, etc.) into the game's Proton prefix via a 4-method fallback chain (native protontricks → flatpak protontricks → runuser → sudo), with xvfb-run wrapping for headless X display
- **Prefix initialization** — creates and initializes a fresh Wine/Proton prefix for the game
- **SteamGridDB artwork** — searches SteamGridDB and applies portrait, hero, logo, and wide art directly to Steam's grid folder; also supports applying any image type manually via URL

Multiple game sources (folders) can be configured, each with its own scan path. Offline network mounts are handled gracefully — the source shows as offline rather than freezing the UI.

## Task Checklist

### Developer

- [x] I am the original author or an authorized maintainer of this plugin.
- [x] I have abided by the licenses of the libraries I am utilizing, including attaching license notices where appropriate.
- [ ] Generative AI was NOT used to write a majority of the code I am submitting.

### Plugin

- [x] I have verified that my plugin works properly on the Stable and Beta update channels of SteamOS.
- [x] I have verified my plugin is unique or provides more/alternative functionality to a plugin already on the store.

### Backend

- **No**: I am using a custom backend other than Python.
- **No**: I am using a tool or software from a 3rd party FOSS project that does not have it's dependencies statically linked.
- **No**: I am using a custom binary that has all of it's dependencies statically linked.

### Community

- [ ] I have tested and left feedback on two other [pull requests][pulls] for new or updating plugins.
- [ ] I have commented links to my testing report in this PR.

## Testing

- [ ] Tested by a third party on SteamOS Stable or Beta update channel.

[pulls]: https://github.com/steamdeckHomebrew/decky-plugin-database/pulls?q=is%3Apr+is%3Aopen+sort%3Acreated-desc+-status%3Afailure+-draft%3Atrue+-author%3A%40me
