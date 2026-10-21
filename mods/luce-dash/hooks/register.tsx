// luce-dash: a Ferrari Luce inspired telemetry pane for Claude Code.
//
//   SPEED  tokens per minute          RPM   tool calls per minute
//   FUEL   context window remaining   GEAR  the tool running now
//   LAP    current / last / best turn time, ODO total tokens, cost, errors
//
// Rosso corsa on black, yellow needles, red line when fuel runs low.

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Stamp, Telemetry } from '../types'

const PANE = 'luce-dash'
const ROSSO = '#ff2800'
const GIALLO = '#ffd200'
const CARBON = '#9a9a9a'
const NERO = '#000000'
const WINDOW_MS = 60_000

const fresh: Telemetry = {
  turns: 0,
  toolCalls: 0,
  toolErrors: 0,
  tokensIn: 0,
  tokensOut: 0,
  lastLapMs: null,
  bestLapMs: null,
  turnStartedAt: null,
  gear: 'N',
  lastModel: '',
  recentTools: [],
  recentTokens: [],
}

const telemetry = atom({ plugin: 'luce-dash', key: 'telemetry' } as const, fresh)
const tick = atom({ plugin: 'luce-dash', key: 'tick' } as const, 0)

const prune = (list: Stamp[], now: number) => list.filter(s => now - s.at <= WINDOW_MS)
const perMinute = (list: Stamp[], now: number) => prune(list, now).reduce((n, s) => n + s.n, 0)

function lap(ms: number | null): string {
  if (ms == null) return '--:--.-'
  const total = Math.max(0, ms)
  const m = Math.floor(total / 60_000)
  const s = ((total % 60_000) / 1000).toFixed(1).padStart(4, '0')
  return `${String(m).padStart(2, '0')}:${s}`
}

function k(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

function gauge(ratio: number, cells: number): string {
  const r = Math.max(0, Math.min(1, ratio))
  const lit = Math.round(r * cells)
  return '█'.repeat(lit) + '░'.repeat(cells - lit)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'luce', description: 'Open the Ferrari Luce telemetry dashboard' })
    void $.ui.open({ id: PANE, title: 'LUCE' }).then(opened => {
      if (!opened.isPlaced) $.ui.log(`luce-dash: pane not placed yet (${opened.reason}); /luce asks for it, the strip above the prompt is always on`)
    })
    // One tick a second drives the running lap timer while a turn is on.
    $.clock.every(1000, () => {
      void (async () => {
        const t = await read($, telemetry)
        if (t.turnStartedAt != null) await update($, tick, n => n + 1)
      })()
    })

    return next(e)
  })

  on('command.run', { command: 'luce' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'LUCE' })

    return { text: opened.isPlaced ? 'Luce dashboard on track.' : `Luce dashboard waits for room: ${opened.reason}` }
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      const now = await $.clock.now()
      await update($, telemetry, t => ({ ...t, turns: t.turns + 1, turnStartedAt: now }))
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId) {
      const now = await $.clock.now()
      const usage = done.usage
      await update($, telemetry, t => {
        const out = usage?.output_tokens ?? 0
        const inn = (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0)
        return {
          ...t,
          turnStartedAt: null,
          lastLapMs: e.durationMs,
          bestLapMs: t.bestLapMs == null || e.durationMs < t.bestLapMs ? e.durationMs : t.bestLapMs,
          tokensIn: t.tokensIn + inn,
          tokensOut: t.tokensOut + out,
          lastModel: usage?.model ?? t.lastModel,
          recentTokens: [...prune(t.recentTokens, now), { at: now, n: out }],
          gear: 'N',
        }
      })
      $.ui.status(`LAP ${lap(e.durationMs)} · ${k(usage?.output_tokens ?? 0)} tok`)
    }

    return done
  })

  on('tool.call', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, telemetry, t => ({
      ...t,
      gear: e.tool,
      toolCalls: t.toolCalls + 1,
      recentTools: [...prune(t.recentTools, now), { at: now, n: 1 }],
    }))
    const ran = await next(e)
    const failed = ran.deny === undefined && ran.isError === true
    await update($, telemetry, t => ({ ...t, gear: 'N', toolErrors: t.toolErrors + (failed ? 1 : 0) }))

    return ran
  }).catch(($, e, next) => (next.called ? next(e) : next(e)))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const t = await read($, telemetry)
    await read($, tick)
    const now = await $.clock.now()
    let fuel: number | null = null
    try {
      const usage = await $.session.usage()
      if (usage.context.percent != null) fuel = Math.max(0, 100 - usage.context.percent)
    } catch {
      // no usage on this host
    }
    const running = t.turnStartedAt != null ? now - t.turnStartedAt : null
    const fuelColor = fuel != null && fuel <= 15 ? ROSSO : fuel != null && fuel <= 35 ? GIALLO : '#2ecc71'

    return (
      <Box flexDirection="row" gap={1} backgroundColor={NERO} paddingX={1}>
        <Text color={ROSSO} bold>◆ LUCE</Text>
        <Text color={GIALLO} bold>LAP {t.turns}</Text>
        <Text color={running != null ? GIALLO : CARBON} tabular>{lap(running ?? t.lastLapMs)}</Text>
        <Text color={ROSSO} bold>SPD</Text>
        <Text color={CARBON} tabular>{k(perMinute(t.recentTokens, now))}</Text>
        <Text color={ROSSO} bold>RPM</Text>
        <Text color={CARBON} tabular>{String(perMinute(t.recentTools, now))}</Text>
        <Text color={ROSSO} bold>FUEL</Text>
        <Text color={fuelColor}>{gauge(fuel == null ? 0 : fuel / 100, 10)}</Text>
        <Text color={fuelColor} tabular>{fuel == null ? '--' : `${Math.round(fuel)}%`}</Text>
        <Text color={ROSSO} bold>GEAR</Text>
        <Text color={t.gear === 'N' ? CARBON : GIALLO} bold>{t.gear}</Text>
        <Text color={t.toolErrors ? ROSSO : CARBON} dimColor>{t.toolErrors} err</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const t = await read($, telemetry)
    await read($, tick)
    const now = await $.clock.now()

    let fuelPercent: number | null = null
    let cost: number | null = null
    try {
      const usage = await $.session.usage()
      if (usage.context.percent != null) fuelPercent = Math.max(0, 100 - usage.context.percent)
      if (usage.cost) cost = usage.cost.usd
    } catch {
      // usage unavailable on this host; gauges show what the hooks counted
    }

    const cols = Math.max(28, e.props.bodyColumns ?? e.viewport?.columns ?? 40)
    const cells = Math.max(8, Math.min(24, cols - 22))
    const speed = perMinute(t.recentTokens, now)
    const rpm = perMinute(t.recentTools, now)
    const running = t.turnStartedAt != null ? now - t.turnStartedAt : null
    const redline = fuelPercent != null && fuelPercent <= 15
    const fuelColor = redline ? ROSSO : fuelPercent != null && fuelPercent <= 35 ? GIALLO : '#2ecc71'

    const Row = (p: { label: string; value: string; ratio: number; color: string; unit: string }) => (
      <Box flexDirection="row" gap={1}>
        <Text color={ROSSO} bold>{p.label.padEnd(5)}</Text>
        <Text color={p.color}>{gauge(p.ratio, cells)}</Text>
        <Text color={GIALLO} bold>{p.value}</Text>
        <Text color={CARBON} dimColor>{p.unit}</Text>
      </Box>
    )

    return (
      <Box flexDirection="column" backgroundColor={NERO} paddingX={1} gap={0}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text color={ROSSO} bold>◆ LUCE</Text>
          <Text color={CARBON} dimColor>{t.lastModel || 'claude'}</Text>
          <Text color={GIALLO} bold>LAP {t.turns}</Text>
        </Box>
        <Text color={ROSSO}>{'━'.repeat(Math.max(10, cols - 2))}</Text>
        <Row label="SPEED" value={k(speed)} ratio={speed / 3000} color={ROSSO} unit="tok/min" />
        <Row label="RPM" value={String(rpm)} ratio={rpm / 30} color={GIALLO} unit="tools/min" />
        <Row
          label="FUEL"
          value={fuelPercent == null ? '--' : `${Math.round(fuelPercent)}%`}
          ratio={fuelPercent == null ? 0 : fuelPercent / 100}
          color={fuelColor}
          unit="context"
        />
        <Box flexDirection="row" gap={1}>
          <Text color={ROSSO} bold>{'GEAR'.padEnd(5)}</Text>
          <Text color={t.gear === 'N' ? CARBON : GIALLO} bold inverse={t.gear !== 'N'}>{` ${t.gear} `}</Text>
          {redline && <Text color={ROSSO} bold> ⚠ PIT: context nearly full</Text>}
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text color={ROSSO} bold>{'LAP'.padEnd(5)}</Text>
          <Text color={running != null ? GIALLO : CARBON} bold tabular>{lap(running)}</Text>
          <Text color={CARBON} dimColor>last</Text>
          <Text color={CARBON} tabular>{lap(t.lastLapMs)}</Text>
          <Text color={CARBON} dimColor>best</Text>
          <Text color="#2ecc71" tabular>{lap(t.bestLapMs)}</Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text color={ROSSO} bold>{'ODO'.padEnd(5)}</Text>
          <Text color={CARBON} tabular>{k(t.tokensIn + t.tokensOut)} tok</Text>
          <Text color={CARBON} dimColor>·</Text>
          <Text color={CARBON} tabular>{t.toolCalls} tools</Text>
          <Text color={CARBON} dimColor>·</Text>
          <Text color={t.toolErrors ? ROSSO : CARBON} tabular>{t.toolErrors} err</Text>
          {cost != null && <Text color={GIALLO} tabular>${cost.toFixed(2)}</Text>}
        </Box>
        <Text color={ROSSO}>{'━'.repeat(Math.max(10, cols - 2))}</Text>
        <Text color={CARBON} dimColor>/luce reopens · hold the line, keep the fuel above 15%</Text>
      </Box>
    )
  })
}
