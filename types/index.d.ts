export type StationName = string

declare module 'claude-code' {
  interface PluginState {
    'dev-music': {
      isPlaying: boolean
      station: string
      volume: number
      time: number
      length: number
      isLive: boolean
      index: number
      names: Shaped<string[]>
    }
  }
}
