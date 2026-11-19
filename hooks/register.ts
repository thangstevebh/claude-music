import type { Register } from 'claude-code'

const STATIONS = [
  { id: '5yx6BWlEVcY', name: 'Chillhop Radio' },
  { id: '7NOSDKb0HlU', name: 'lofi hip hop radio' },
  { id: 'blAFxjhg62k', name: 'Coffee Shop Radio' },
  { id: 'TfmECBzmOn4', name: 'Lofi Hip Hop Radio (relax)' },
  { id: 'i6WzngxTnBA', name: 'late night vibes' },
  { id: 'UedTcufyrHc', name: 'ChillSynth FM' },
  { id: 'FWjZ0x2M8og', name: 'sad & sleepy beats' },
  { id: 'qH3fETPsqXU', name: '24/7 chill lofi' },
  { id: 'BLIKwfIJIyo', name: 'Space Ambient' },
] as const

type Station = { url: string; name: string }

const BUILTIN: Station[] = STATIONS.map(s => ({
  url: `https://www.youtube.com/watch?v=${s.id}`,
  name: s.name,
}))

const CUSTOM_KEY = 'custom'
const MARK = 'dev-music-player'
const INDEX_KEY = 'station'
const VOLUME_KEY = 'volume'
const STEP = 10

export const register: Register = on => {
  let playing: { stream: AsyncGenerator<unknown>; port: number; password: string } | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'music',
      description:
        'Toggle lofi radio. /music <n> picks a station, list, add <url> [name], rm <n>, + / - / vol <0-100> for volume.',
    })
    return next(e)
  })

  on('command.run', { command: 'music' }, async ($, e) => {
    const arg = e.args.trim()
    const was = playing

    const custom = ((await $.store.get(CUSTOM_KEY)) ?? []) as Station[]
    const all = [...BUILTIN, ...custom]

    if (arg === 'list') {
      const lines = all.map((st, i) => `${i + 1}. ${st.name}${i >= BUILTIN.length ? ' (custom)' : ''}`)
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
        const t = await $.process
          .run(['yt-dlp', '--no-playlist', '--print', 'title', '--', link], { timeoutMs: 45000 })
          .catch(() => undefined)
        if (t?.exitCode !== 0) {
          return { text: 'yt-dlp could not read that link.' }
        }
        name = t.stdout.split('\n')[0]?.trim() || link
      }
      await $.store.set(CUSTOM_KEY, [...custom, { url: link, name }])
      return { text: `Added #${all.length + 1}: ${name}. /music ${all.length + 1} to play.` }
    }

    const removed = /^rm\s+(\d+)$/.exec(arg)
    if (removed) {
      const n = Number(removed[1])
      if (n <= BUILTIN.length || n > all.length) {
        return { text: `Only custom stations (#${BUILTIN.length + 1}+) can be removed.` }
      }
      await $.store.set(CUSTOM_KEY, custom.filter((_, i) => i !== n - BUILTIN.length - 1))
      await $.store.set(INDEX_KEY, 0)
      return { text: `Removed #${n}.` }
    }

    let volume = Number((await $.store.get(VOLUME_KEY)) ?? 50)
    let index = Number((await $.store.get(INDEX_KEY)) ?? 0)
    let isChange = false

    if (arg === '+' || arg === '-' || /^vol(ume)?\s+\d+$/.test(arg)) {
      const next = arg === '+' ? volume + STEP : arg === '-' ? volume - STEP : Number(arg.split(/\s+/)[1])
      volume = Math.min(100, Math.max(0, next))
      await $.store.set(VOLUME_KEY, volume)
      isChange = true
      if (!was) {
        return { text: `Volume set to ${volume}%. /music to play.` }
      }
      const set = await $.process.run(
        [
          'curl', '-s', '-m', '3', '-u', `:${was.password}`,
          `http://127.0.0.1:${was.port}/requests/status.json?command=volume&val=${Math.round(volume * 2.56)}`,
        ],
        { timeoutMs: 5000 },
      ).catch(() => undefined)
      if (set?.exitCode === 0) {
        return { text: `Volume ${volume}%.` }
      }
    } else if (arg) {
      const n = Number(arg)
      if (!Number.isInteger(n) || n < 1 || n > all.length) {
        return { text: `Use /music, /music <1-${all.length}>, list, add <url> [name], rm <n>, +, -, vol <0-100>.` }
      }
      index = n - 1
      await $.store.set(INDEX_KEY, index)
    }

    playing = undefined
    await $.process.run(['pkill', '-f', MARK]).catch(() => undefined)
    await was?.stream.return(undefined).catch(() => undefined)
    if (was && !arg) {
      return { text: 'Music stopped.' }
    }

    const station = all[index] ?? all[0] ?? BUILTIN[0]
    const resolve = () =>
      $.process.run(
        ['yt-dlp', '-g', '-f', 'bestaudio/best', '--no-playlist', '--', station?.url ?? ''],
        { timeoutMs: 45000 },
      )
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
      return { text: `${station?.name}: ${reason}. Try another station, or pip install -U yt-dlp.` }
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
    const own = { stream, port, password }
    playing = own
    const level = Math.round(volume * 2.56)
    void (async () => {
      for (let i = 0; i < 10; i++) {
        await $.clock.sleep(1000)
        if (playing !== own) {
          return
        }
        const r = await $.process
          .run(
            [
              'curl', '-s', '-m', '3', '-u', `:${password}`,
              `http://127.0.0.1:${port}/requests/status.json?command=volume&val=${level}`,
            ],
            { timeoutMs: 5000 },
          )
          .catch(() => undefined)
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
      }
    })()

    return { text: `${isChange ? `Volume ${volume}%` : 'Playing'}: ${station?.name}. /music again to stop.` }
  })
}
