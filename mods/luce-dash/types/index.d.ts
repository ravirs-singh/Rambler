export type Stamp = { at: number; n: number }

export type Telemetry = {
  turns: number
  toolCalls: number
  toolErrors: number
  tokensIn: number
  tokensOut: number
  lastLapMs: number | null
  bestLapMs: number | null
  turnStartedAt: number | null
  gear: string
  lastModel: string
  recentTools: Stamp[]
  recentTokens: Stamp[]
}

declare module 'claude-code' {
  interface PluginState {
    'luce-dash': { telemetry: Telemetry; tick: number }
  }
}
