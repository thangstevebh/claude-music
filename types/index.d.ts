export type StationName = string

declare module 'claude-code' {
  interface PluginState {
    'dev-music': {
      isPlaying: boolean
      station: string
      volume: number
      index: number
      names: Shaped<string[]>
    }
  }
}
