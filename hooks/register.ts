import type { Register } from 'claude-code'

const STATIONS = [
  { id: '5yx6BWlEVcY', name: 'Chillhop Radio' },
  { id: '7NOSDKb0HlU', name: 'lofi hip hop radio' },
  { id: 'blAFxjhg62k', name: 'Coffee Shop Radio' },
  { id: 'TfmECBzmOn4', name: 'Lofi Hip Hop Radio (relax)' },
  { id: 'lkcjlTqmoDY', name: 'videogame lofi' },
  { id: 'i6WzngxTnBA', name: 'late night vibes' },
  { id: 'UedTcufyrHc', name: 'ChillSynth FM' },
  { id: 'FWjZ0x2M8og', name: 'sad & sleepy beats' },
  { id: 'qH3fETPsqXU', name: '24/7 chill lofi' },
  { id: 'BLIKwfIJIyo', name: 'Space Ambient' },
] as const

const MARK = 'dev-music-player'
const INDEX_KEY = 'station'
const VOLUME_KEY = 'volume'
const STEP = 10

export const register: Register = on => {
  let playing: { stream: AsyncGenerator<unknown>; port: number; password: string } | undefined

  on('session.start', async ($, e, next) => {
    const list = STATIONS.map((s, i) => `${i + 1}=${s.name}`).join(', ')
    await $.command.register({
      name: 'music',
      description: `Toggle lofi radio. /music <n> picks a station (${list}); /music + or - or vol <0-100> sets volume.`,
    })
    return next(e)
  })

  on('command.run', { command: 'music' }, async ($, e) => {
    const arg = e.args.trim()
    const was = playing

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
      if (!Number.isInteger(n) || n < 1 || n > STATIONS.length) {
        return { text: `Use /music, /music <1-${STATIONS.length}>, /music +, /music -, /music vol <0-100>.` }
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

    const station = STATIONS[index] ?? STATIONS[0]
    const found = await $.process.run(
      ['yt-dlp', '-g', '-f', 'bestaudio/best', `https://www.youtube.com/watch?v=${station.id}`],
      { timeoutMs: 45000 },
    )
    const url = found.stdout.split('\n')[0]?.trim()
    if (found.exitCode !== 0 || !url) {
      return { text: 'yt-dlp could not resolve the stream. Try `pip install -U yt-dlp`.' }
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

    return { text: `${isChange ? `Volume ${volume}%` : 'Playing'}: ${station.name}. /music again to stop.` }
  })
}
