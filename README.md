# dev-music

A Claude Code mod that plays looping lofi radio while you work. It streams the same ten live channels that lofi.cafe embeds.

## Install

In a Claude Code terminal session:

```
/plugin install dev-music --marketplace thangstevebh/claude-music
```

From a shell:

```
claude plugin install dev-music --marketplace thangstevebh/claude-music
```

## Requirements

- macOS
- `yt-dlp` (resolves the stream). Keep it current: YouTube changes often and old versions get HTTP 403. The mod uses `~/.local/bin/yt-dlp` when it exists, otherwise `yt-dlp` from your PATH.
- VLC, with `vlc` on your PATH (plays the stream)

## Usage

- `/music` toggles the last chosen station (default: Chillhop Radio).
- `/music list` shows all stations.
- `/music <n>` switches station (1-9 are the built-in lofi.cafe channels).
- `/music add <https-url> [name]` adds your own station: any link `yt-dlp` can stream, such as a YouTube live stream or video. Without a name, the title is read from the link. Custom stations are numbered after the built-in ones.
- `/music rm <n>` removes a custom station.
- `/music panel` shows or hides a compact control pane: now playing, play/stop, volume buttons and a clickable station list. In the pane, `p` plays or stops, `d` and `u` turn the volume down and up, `1`-`9` pick a station.
- `/music seek <mm:ss | seconds | +30 | -30 | 50%>` jumps within a regular video (not live streams). In the panel, `h` and `l` jump 30 s back and forward, and each block of the progress bar is clickable.
- `/music vol <0-100>` sets the volume.

Volume changes apply live through VLC's local HTTP interface (127.0.0.1, random port and password per session), so the music does not cut out. `curl` is required.
