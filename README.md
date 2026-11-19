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
- `yt-dlp` (resolves the stream; keep it updated with `pip install -U yt-dlp`)
- VLC, with `vlc` on your PATH (plays the stream)

## Usage

- `/music` toggles the last chosen station (default: Chillhop Radio).
- `/music <1-10>` switches station.
- `/music +` and `/music -` change volume by 10%.
- `/music vol <0-100>` sets the volume.

Changing volume while playing restarts the stream, so the music cuts out for a few seconds.
