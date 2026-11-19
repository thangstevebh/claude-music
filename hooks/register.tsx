import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

type Station = { url: string; name: string }
type Player = { port: number; password: string; isLive: boolean; startedAt: number }
type Shared = { volume: number; index: number; custom: Station[]; player?: Player }
type Status = { time: number; length: number }

const BUILTIN: Station[] = [
  { id: '5yx6BWlEVcY', name: 'Chillhop Radio' },
  { id: '7NOSDKb0HlU', name: 'lofi hip hop radio' },
  { id: 'blAFxjhg62k', name: 'Coffee Shop Radio' },
  { id: 'TfmECBzmOn4', name: 'Lofi Hip Hop Radio (relax)' },
  { id: 'i6WzngxTnBA', name: 'late night vibes' },
  { id: 'UedTcufyrHc', name: 'ChillSynth FM' },
  { id: 'FWjZ0x2M8og', name: 'sad & sleepy beats' },
  { id: 'qH3fETPsqXU', name: '24/7 chill lofi' },
  { id: 'BLIKwfIJIyo', name: 'Space Ambient' },
].map(s => ({ url: `https://www.youtube.com/watch?v=${s.id}`, name: s.name }))

const PANE = 'music'
const MARK = 'dev-music-player'
const STEP = 10
const BEAT_EVERY_MS = 15000
const STARTUP_GRACE_MS = 15000
const WATCHDOG_STALE_S = 90

const isPlayingA = atom({ plugin: 'dev-music', key: 'isPlaying' } as const, false)
const stationA = atom({ plugin: 'dev-music', key: 'station' } as const, '')
const volumeA = atom({ plugin: 'dev-music', key: 'volume' } as const, 50)
const timeA = atom({ plugin: 'dev-music', key: 'time' } as const, 0)
const lengthA = atom({ plugin: 'dev-music', key: 'length' } as const, 0)
const liveA = atom({ plugin: 'dev-music', key: 'isLive' } as const, false)
const indexA = atom({ plugin: 'dev-music', key: 'index' } as const, 0)
const namesA = atom({ plugin: 'dev-music', key: 'names' } as const, [], {
  shape: 'names-1',
})

let lastBeat = 0

const paths = async ($: EngineInterface) => {
  const home = (await $.env.get('HOME')) ?? ''
  const env = await $.process.hookEnv().catch(() => ({}) as Record<string, string>)
  const dir = env.CLAUDE_PLUGIN_DATA ?? `${home}/.claude/plugins/data/dev-music`

  return {
    state: `${dir}/state.json`,
    beat: `${dir}/heartbeat`,
    legacy: `${home}/.claude/dev-music-state.json`,
    ytdlp: `${home}/.local/bin/yt-dlp`,
  }
}

const readShared = async ($: EngineInterface): Promise<Shared> => {
  const { state, legacy } = await paths($)
  for (const file of [state, legacy]) {
    try {
      if (await $.fs.exists(file)) {
        const raw = JSON.parse(await $.fs.read(file))

        return {
          volume: Number(raw.volume ?? 50),
          index: Number(raw.index ?? 0),
          custom: Array.isArray(raw.custom) ? raw.custom : [],
          player: raw.player ?? undefined,
        }
      }
    } catch {
      void 0
    }
  }

  return {
    volume: Number((await $.store.get('volume')) ?? 50),
    index: Number((await $.store.get('station')) ?? 0),
    custom: ((await $.store.get('custom')) ?? []) as Station[],
  }
}

const writeShared = async ($: EngineInterface, shared: Shared) => {
  const { state } = await paths($)
  await $.process
    .run(['sh', '-c', 'umask 077; mkdir -p "$(dirname "$1")"; cat > "$1"', 'sh', state], {
      stdin: JSON.stringify(shared),
      timeoutMs: 5000,
    })
    .catch(() => undefined)
}

const beat = async ($: EngineInterface) => {
  const { beat: file } = await paths($)
  lastBeat = Date.now()
  await $.fs.write(file, String(lastBeat)).catch(() => undefined)
}

const control = ($: EngineInterface, p: Player, query: string) =>
  $.process
    .run(
      [
        'curl', '-s', '-m', '2', '-u', `:${p.password}`,
        `http://127.0.0.1:${p.port}/requests/status.json${query}`,
      ],
      { timeoutMs: 4000 },
    )
    .catch(() => undefined)

const probe = async ($: EngineInterface, p: Player): Promise<Status | undefined> => {
  const r = await control($, p, '')
  if (r?.exitCode !== 0 || !r.stdout.includes('"state"')) {
    return undefined
  }

  return {
    time: Number(/"time"\s*:\s*(\d+)/.exec(r.stdout)?.[1] ?? 0),
    length: Number(/"length"\s*:\s*(\d+)/.exec(r.stdout)?.[1] ?? 0),
  }
}

const current = async ($: EngineInterface) => {
  const shared = await readShared($)
  const p = shared.player
  if (!p) {
    return { shared, status: undefined as Status | undefined }
  }
  const status = await probe($, p)
  if (status) {
    return { shared, status }
  }
  if (Date.now() - p.startedAt < STARTUP_GRACE_MS) {
    return { shared, status: { time: 0, length: 0 } }
  }
  shared.player = undefined
  await writeShared($, shared)

  return { shared, status: undefined as Status | undefined }
}

const publish = async ($: EngineInterface) => {
  const { shared, status } = await current($)
  const all = [...BUILTIN, ...shared.custom]
  const p = shared.player
  const isLive = p?.isLive ?? false
  const time = p && isLive ? Math.floor((Date.now() - p.startedAt) / 1000) : (status?.time ?? 0)
  await update($, namesA, () => all.map(s => s.name))
  await update($, indexA, () => shared.index)
  await update($, volumeA, () => shared.volume)
  await update($, isPlayingA, () => p !== undefined)
  await update($, liveA, () => isLive)
  await update($, stationA, () => all[shared.index]?.name ?? '')
  await update($, timeA, () => time)
  await update($, lengthA, () => (isLive ? 0 : (status?.length ?? 0)))
}

const tick = async ($: EngineInterface) => {
  if (Date.now() - lastBeat > BEAT_EVERY_MS) {
    await beat($)
  }
  const open = await $.ui.panes()
  if (open.some(p => p.id === PANE)) {
    await publish($)
  }
}

const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const sec = String(s % 60).padStart(2, '0')

  return h > 0 ? `${h}:${m}:${sec}` : `${m}:${sec}`
}

const halt = async ($: EngineInterface) => {
  const shared = await readShared($)
  await $.process.run(['pkill', '-f', MARK]).catch(() => undefined)
  shared.player = undefined
  await writeShared($, shared)
  await publish($)
}

const LAUNCH = [
  'hb="$1"; shift',
  '( "$@" >/dev/null 2>&1 </dev/null &',
  '  pid=$!',
  '  while kill -0 "$pid" 2>/dev/null; do',
  '    sleep 15',
  '    t=$(stat -f %m "$hb" 2>/dev/null || echo 0)',
  `    [ $(( $(date +%s) - t )) -gt ${WATCHDOG_STALE_S} ] && kill "$pid"`,
  '  done',
  ') >/dev/null 2>&1 </dev/null &',
].join('\n')

const start = async ($: EngineInterface, wanted: number): Promise<string> => {
  const shared = await readShared($)
  const all = [...BUILTIN, ...shared.custom]
  const index = all[wanted] ? wanted : 0
  const station = all[index]
  if (!station) {
    return 'No station.'
  }
  const where = await paths($)
  const bin = (await $.fs.exists(where.ytdlp)) ? where.ytdlp : 'yt-dlp'
  const resolve = () =>
    $.process.run([bin, '-g', '-f', 'bestaudio/best', '--no-playlist', '--', station.url], {
      timeoutMs: 45000,
    })
  let found = await resolve().catch(() => undefined)
  if (found?.exitCode !== 0 || !found.stdout.trim()) {
    found = await resolve().catch(() => undefined)
  }
  const url = found?.stdout.split('\n')[0]?.trim()
  if (!found || found.exitCode !== 0 || !url) {
    const reason =
      found?.stderr
        .split('\n')
        .filter(l => l.startsWith('ERROR'))
        .pop() ?? 'yt-dlp did not run or timed out'

    return `${station.name}: ${reason}. Try another station, or update yt-dlp.`
  }

  await $.process.run(['pkill', '-f', MARK]).catch(() => undefined)
  await beat($)
  const port = 20000 + Math.floor(Math.random() * 40000)
  const password = Math.random().toString(36).slice(2)
  const launched = await $.process
    .run(
      [
        'sh', '-c', LAUNCH, 'sh', where.beat,
        'vlc', '-I', 'dummy', '--no-video', `--volume=${Math.round(shared.volume * 2.56)}`,
        '--extraintf', 'http', '--http-host', '127.0.0.1',
        '--http-port', String(port), '--http-password', password,
        `--input-title-format=${MARK}`, url,
      ],
      { timeoutMs: 10000 },
    )
    .catch(() => undefined)
  if (launched?.exitCode !== 0) {
    return 'Could not start VLC.'
  }
  const player: Player = {
    port,
    password,
    isLive: url.includes('yt_live_broadcast'),
    startedAt: Date.now(),
  }
  shared.player = player
  shared.index = index
  await writeShared($, shared)
  await publish($)

  void (async () => {
    const level = Math.round(shared.volume * 2.56)
    for (let i = 0; i < 10; i++) {
      await $.clock.sleep(1000)
      const now = await readShared($)
      if (now.player?.startedAt !== player.startedAt) {
        return
      }
      const r = await control($, player, `?command=volume&val=${level}`)
      if (r?.exitCode === 0) {
        return
      }
    }
  })()

  return `Playing: ${station.name}.`
}

const seekValue = (spec: string): string | undefined => {
  const text = spec.trim()
  if (/^[+-]\d+$/.test(text)) {
    return `${text}S`
  }
  if (/^\d+%$/.test(text) || /^\d+$/.test(text)) {
    return text
  }
  const parts = /^(?:(\d+):)?(\d+):(\d+)$/.exec(text)
  if (parts) {
    return String(Number(parts[1] ?? 0) * 3600 + Number(parts[2]) * 60 + Number(parts[3]))
  }

  return undefined
}

const seek = async ($: EngineInterface, spec: string): Promise<string> => {
  const { shared } = await current($)
  const p = shared.player
  if (!p) {
    return 'Nothing is playing.'
  }
  if (p.isLive) {
    return 'Cannot seek a live stream.'
  }
  const value = seekValue(spec)
  if (!value) {
    return 'Use /music seek <mm:ss | h:mm:ss | seconds | +30 | -30 | 50%>.'
  }
  const r = await control($, p, `?command=seek&val=${encodeURIComponent(value)}`)
  if (r?.exitCode !== 0) {
    return 'Seek failed.'
  }
  await publish($)

  return 'Seeked.'
}

const setVolume = async ($: EngineInterface, wanted: number): Promise<string> => {
  const volume = Math.min(100, Math.max(0, wanted))
  const { shared } = await current($)
  shared.volume = volume
  await writeShared($, shared)
  const p = shared.player
  if (!p) {
    await publish($)

    return `Volume set to ${volume}%. /music to play.`
  }
  const r = await control($, p, `?command=volume&val=${Math.round(volume * 2.56)}`)
  if (r?.exitCode !== 0) {
    return start($, shared.index)
  }
  await publish($)

  return `Volume ${volume}%.`
}

const toggle = async ($: EngineInterface): Promise<string> => {
  const { shared } = await current($)
  if (shared.player) {
    await halt($)

    return 'Music stopped.'
  }

  return start($, shared.index)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'music',
      description:
        'Toggle lofi radio (shared by all sessions). /music <n>, list, add <url> [name], rm <n>, + / - / vol <0-100>, seek <mm:ss>, panel.',
    })
    await beat($)
    await publish($)
    $.clock.every(1000, () => void tick($))

    return next(e)
  })

  on('command.run', { command: 'music' }, async ($, e) => {
    const arg = e.args.trim()
    const { shared } = await current($)
    const all = [...BUILTIN, ...shared.custom]

    if (arg === '') {
      return { text: await toggle($) }
    }

    if (arg === 'panel') {
      const open = await $.ui.panes()
      if (open.some(p => p.id === PANE)) {
        await $.ui.close({ id: PANE })

        return { text: 'Music panel hidden.' }
      }
      await publish($)
      await $.ui.open({
        id: PANE,
        title: 'Music',
        columns: 36,
        focus: true,
        backgroundColor: 'transparent',
      })

      return { text: 'Music panel shown.' }
    }

    const sought = /^seek\s+(.+)$/.exec(arg)
    if (sought) {
      return { text: await seek($, sought[1] ?? '') }
    }

    if (arg === 'list') {
      const lines = all.map(
        (st, i) => `${i + 1}. ${st.name}${i >= BUILTIN.length ? ' (custom)' : ''}`,
      )

      return { text: lines.join('\n') }
    }

    const added = /^add\s+(\S+)(?:\s+(.+))?$/.exec(arg)
    if (added) {
      const link = added[1] ?? ''
      if (!/^https:\/\//.test(link)) {
        return { text: 'Use /music add <https-url> [name]. YouTube links (live or video) work.' }
      }
      let name = added[2]?.trim()
      if (!name) {
        const where = await paths($)
        const bin = (await $.fs.exists(where.ytdlp)) ? where.ytdlp : 'yt-dlp'
        const t = await $.process
          .run([bin, '--no-playlist', '--print', 'title', '--', link], { timeoutMs: 45000 })
          .catch(() => undefined)
        if (t?.exitCode !== 0) {
          return { text: 'yt-dlp could not read that link.' }
        }
        name = t.stdout.split('\n')[0]?.trim() || link
      }
      shared.custom = [...shared.custom, { url: link, name }]
      await writeShared($, shared)
      await publish($)

      return { text: `Added #${all.length + 1}: ${name}. /music ${all.length + 1} to play.` }
    }

    const removed = /^rm\s+(\d+)$/.exec(arg)
    if (removed) {
      const n = Number(removed[1])
      if (n <= BUILTIN.length || n > all.length) {
        return { text: `Only custom stations (#${BUILTIN.length + 1}+) can be removed.` }
      }
      shared.custom = shared.custom.filter((_, i) => i !== n - BUILTIN.length - 1)
      shared.index = 0
      await writeShared($, shared)
      await publish($)

      return { text: `Removed #${n}.` }
    }

    if (arg === '+' || arg === '-' || /^vol(ume)?\s+\d+$/.test(arg)) {
      const wanted =
        arg === '+'
          ? shared.volume + STEP
          : arg === '-'
            ? shared.volume - STEP
            : Number(arg.split(/\s+/)[1])

      return { text: await setVolume($, wanted) }
    }

    const n = Number(arg)
    if (Number.isInteger(n) && n >= 1 && n <= all.length) {
      return { text: await start($, n - 1) }
    }

    return {
      text: `Use /music, /music <1-${all.length}>, list, add <url> [name], rm <n>, +, -, vol <0-100>, seek <mm:ss>, panel.`,
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const isPlaying = await read($, isPlayingA)
    const station = await read($, stationA)
    const volume = await read($, volumeA)
    const index = await read($, indexA)
    const names = await read($, namesA)
    const time = await read($, timeA)
    const length = await read($, lengthA)
    const isLive = await read($, liveA)
    const done = length > 0 ? Math.min(16, Math.round((time / length) * 16)) : 0
    const track = isLive ? `${clock(time)} · LIVE` : `${clock(time)} · loading`
    const filled = Math.round(volume / 10)
    const bar = `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`

    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end" color={isPlaying ? 'success' : undefined}>
          {isPlaying ? '▶' : '■'} {station || 'Stopped'}
        </Text>
        {isPlaying && length === 0 && <Text dimColor>{track}</Text>}
        {isPlaying && length > 0 && (
          <Box>
            <Button key="seek-back" label="<<" hotkey="h" onPress={() => void seek($, '-30')} />
            <Text> </Text>
            {Array.from({ length: 16 }, (_, i) => (
              <Button
                key={`seek:${i}`}
                plain
                label={i < done ? '▰' : '▱'}
                onPress={() => void seek($, String(Math.floor((length * (i + 0.5)) / 16)))}
              />
            ))}
            <Text> </Text>
            <Button key="seek-fwd" label=">>" hotkey="l" onPress={() => void seek($, '+30')} />
          </Box>
        )}
        {isPlaying && length > 0 && (
          <Text dimColor>
            {clock(time)} / {clock(length)}
          </Text>
        )}
        <Box>
          <Button
            key="toggle"
            label={isPlaying ? '■ Dừng' : '▶ Phát'}
            hotkey="p"
            onPress={() => void toggle($)}
          />
          <Text> </Text>
          <Button key="vol-down" label="−" hotkey="d" onPress={() => void setVolume($, volume - STEP)} />
          <Text> {bar} {volume}% </Text>
          <Button key="vol-up" label="+" hotkey="u" onPress={() => void setVolume($, volume + STEP)} />
        </Box>
        {names.map((name, i) => (
          <Button
            key={`st:${i}`}
            plain
            hotkey={i < 9 ? String(i + 1) : undefined}
            onPress={() => void start($, i)}
          >
            <Text wrap="truncate-end" dimColor={i !== index}>
              {i === index ? '›' : ' '} {i + 1} {name}
            </Text>
          </Button>
        ))}
      </Box>
    )
  })
}
