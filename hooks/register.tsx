import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

type Station = { url: string; name: string }
type Playing = {
  stream: AsyncGenerator<unknown>
  port: number
  password: string
  isLive: boolean
  startedAt: number
}

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
const INDEX_KEY = 'station'
const VOLUME_KEY = 'volume'
const CUSTOM_KEY = 'custom'
const STEP = 10

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

let playing: Playing | undefined

const listStations = async ($: EngineInterface): Promise<Station[]> => {
  const custom = ((await $.store.get(CUSTOM_KEY)) ?? []) as Station[]

  return [...BUILTIN, ...custom]
}

const publish = async ($: EngineInterface) => {
  const all = await listStations($)
  const index = Number((await $.store.get(INDEX_KEY)) ?? 0)
  const volume = Number((await $.store.get(VOLUME_KEY)) ?? 50)
  await update($, namesA, () => all.map(s => s.name))
  await update($, indexA, () => index)
  await update($, volumeA, () => volume)
  await update($, isPlayingA, () => playing !== undefined)
  await update($, liveA, () => playing?.isLive ?? false)
  await update($, stationA, () => all[index]?.name ?? '')
}

const halt = async ($: EngineInterface) => {
  const was = playing
  playing = undefined
  await $.process.run(['pkill', '-f', MARK]).catch(() => undefined)
  await was?.stream.return(undefined).catch(() => undefined)
  await update($, timeA, () => 0)
  await update($, lengthA, () => 0)
  await publish($)
}

const volumeUrl = (p: { port: number }, volume: number) =>
  `http://127.0.0.1:${p.port}/requests/status.json?command=volume&val=${Math.round(volume * 2.56)}`

const pushVolume = ($: EngineInterface, p: Playing, volume: number) =>
  $.process
    .run(['curl', '-s', '-m', '3', '-u', `:${p.password}`, volumeUrl(p, volume)], {
      timeoutMs: 5000,
    })
    .catch(() => undefined)

const pushStatus = ($: EngineInterface, p: Playing) =>
  $.process
    .run(
      ['curl', '-s', '-m', '2', '-u', `:${p.password}`, `http://127.0.0.1:${p.port}/requests/status.json`],
      { timeoutMs: 4000 },
    )
    .catch(() => undefined)

let isTicking = false

const tick = async ($: EngineInterface) => {
  const now = playing
  if (!now || isTicking) {
    return
  }
  const open = await $.ui.panes()
  if (!open.some(p => p.id === PANE)) {
    return
  }
  isTicking = true
  try {
    let time = Math.floor((Date.now() - now.startedAt) / 1000)
    let length = 0
    if (!now.isLive) {
      const r = await pushStatus($, now)
      const body = r?.exitCode === 0 ? r.stdout : ''
      time = Number(/"time"\s*:\s*(\d+)/.exec(body)?.[1] ?? 0)
      length = Number(/"length"\s*:\s*(\d+)/.exec(body)?.[1] ?? 0)
    }
    await update($, timeA, () => time)
    await update($, lengthA, () => length)
  } finally {
    isTicking = false
  }
}

const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const sec = String(s % 60).padStart(2, '0')

  return h > 0 ? `${h}:${m}:${sec}` : `${m}:${sec}`
}

const start = async ($: EngineInterface, index: number): Promise<string> => {
  const all = await listStations($)
  const station = all[index] ?? all[0]
  if (!station) {
    return 'No station.'
  }
  const volume = Number((await $.store.get(VOLUME_KEY)) ?? 50)
  await $.store.set(INDEX_KEY, all[index] ? index : 0)
  await halt($)

  const home = await $.env.get('HOME')
  const local = home ? `${home}/.local/bin/yt-dlp` : ''
  const bin = local && (await $.fs.exists(local)) ? local : 'yt-dlp'
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

  const port = 20000 + Math.floor(Math.random() * 40000)
  const password = Math.random().toString(36).slice(2)
  const stream = $.process.spawn({
    argv: [
      'vlc', '-I', 'dummy', '--no-video', `--volume=${Math.round(volume * 2.56)}`,
      '--extraintf', 'http', '--http-host', '127.0.0.1',
      '--http-port', String(port), '--http-password', password,
      `--input-title-format=${MARK}`, url,
    ],
  })
  const own: Playing = {
    stream,
    port,
    password,
    isLive: url.includes('yt_live_broadcast'),
    startedAt: Date.now(),
  }
  playing = own
  await publish($)

  void (async () => {
    for (let i = 0; i < 10; i++) {
      await $.clock.sleep(1000)
      if (playing !== own) {
        return
      }
      const r = await pushVolume($, own, volume)
      if (r?.exitCode === 0) {
        return
      }
    }
  })()
  void (async () => {
    try {
      for await (const _ of stream) {
        void _
      }
    } catch {
      void 0
    }
    if (playing === own) {
      playing = undefined
      await publish($)
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
  const now = playing
  if (!now) {
    return 'Nothing is playing.'
  }
  if (now.isLive) {
    return 'Cannot seek a live stream.'
  }
  const value = seekValue(spec)
  if (!value) {
    return 'Use /music seek <mm:ss | h:mm:ss | seconds | +30 | -30 | 50%>.'
  }
  const url = `http://127.0.0.1:${now.port}/requests/status.json?command=seek&val=${encodeURIComponent(value)}`
  const r = await $.process
    .run(['curl', '-s', '-m', '3', '-u', `:${now.password}`, url], { timeoutMs: 5000 })
    .catch(() => undefined)
  if (r?.exitCode !== 0) {
    return 'Seek failed.'
  }
  await tick($)

  return 'Seeked.'
}

const setVolume = async ($: EngineInterface, wanted: number): Promise<string> => {
  const volume = Math.min(100, Math.max(0, wanted))
  await $.store.set(VOLUME_KEY, volume)
  const now = playing
  if (!now) {
    await publish($)

    return `Volume set to ${volume}%. /music to play.`
  }
  const r = await pushVolume($, now, volume)
  if (r?.exitCode !== 0) {
    return start($, Number((await $.store.get(INDEX_KEY)) ?? 0))
  }
  await publish($)

  return `Volume ${volume}%.`
}

const toggle = async ($: EngineInterface): Promise<string> => {
  if (playing) {
    await halt($)

    return 'Music stopped.'
  }

  return start($, Number((await $.store.get(INDEX_KEY)) ?? 0))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'music',
      description:
        'Toggle lofi radio. /music <n>, list, add <url> [name], rm <n>, + / - / vol <0-100>, seek <mm:ss>, panel.',
    })
    await publish($)
    $.clock.every(1000, () => void tick($))

    return next(e)
  })

  on('command.run', { command: 'music' }, async ($, e) => {
    const arg = e.args.trim()
    const all = await listStations($)

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
        const home = await $.env.get('HOME')
        const local = home ? `${home}/.local/bin/yt-dlp` : ''
        const bin = local && (await $.fs.exists(local)) ? local : 'yt-dlp'
        const t = await $.process
          .run([bin, '--no-playlist', '--print', 'title', '--', link], { timeoutMs: 45000 })
          .catch(() => undefined)
        if (t?.exitCode !== 0) {
          return { text: 'yt-dlp could not read that link.' }
        }
        name = t.stdout.split('\n')[0]?.trim() || link
      }
      const custom = all.slice(BUILTIN.length)
      await $.store.set(CUSTOM_KEY, [...custom, { url: link, name }])
      await publish($)

      return { text: `Added #${all.length + 1}: ${name}. /music ${all.length + 1} to play.` }
    }

    const removed = /^rm\s+(\d+)$/.exec(arg)
    if (removed) {
      const n = Number(removed[1])
      if (n <= BUILTIN.length || n > all.length) {
        return { text: `Only custom stations (#${BUILTIN.length + 1}+) can be removed.` }
      }
      const custom = all.slice(BUILTIN.length)
      await $.store.set(
        CUSTOM_KEY,
        custom.filter((_, i) => i !== n - BUILTIN.length - 1),
      )
      await $.store.set(INDEX_KEY, 0)
      await publish($)

      return { text: `Removed #${n}.` }
    }

    if (arg === '+' || arg === '-' || /^vol(ume)?\s+\d+$/.test(arg)) {
      const now = Number((await $.store.get(VOLUME_KEY)) ?? 50)
      const wanted =
        arg === '+' ? now + STEP : arg === '-' ? now - STEP : Number(arg.split(/\s+/)[1])

      return { text: await setVolume($, wanted) }
    }

    const n = Number(arg)
    if (Number.isInteger(n) && n >= 1 && n <= all.length) {
      return { text: await start($, n - 1) }
    }

    return {
      text: `Use /music, /music <1-${all.length}>, list, add <url> [name], rm <n>, +, -, vol <0-100>, panel.`,
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
