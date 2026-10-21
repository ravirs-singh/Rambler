import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'luce-dash',
  component: 'Pane',
  requestId: 'luce-dash',
  props: {
    title: 'LUCE',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('the dashboard draws its gauges and counts a lap and a tool call', async ($, on) => {
  on('command.register', () => ({ value: { command: 'luce' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, percent: 40 }, rateLimits: [], cost: { usd: 0.42 } } }))
  const clock = mock.clock(on, { now: 1_000_000 })
  on('turn.complete', () => ({ text: 'done', usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.advance(2500)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 8100, isAborted: false, reason: 'answer' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /LUCE/ }))?.text).toBe('◆ LUCE')
    expect((await ui.find({ type: 'Text', text: /LAP 1/ }))?.text).toBe('LAP 1')
    expect((await ui.find({ type: 'Text', text: /1 tools/ }))?.text).toBe('1 tools')
    expect((await ui.find({ type: 'Text', text: /00:08\.1/ }))?.text).toBe('00:08.1')
    expect((await ui.find({ type: 'Text', text: /tok\/min/ }))?.text).toBe('tok/min')
    expect((await ui.find({ type: 'Text', text: /60%/ }))?.text).toBe('60%')
    expect((await ui.find({ type: 'Text', text: /\$0\.42/ }))?.text).toBe('$0.42')
    await ui.unmount()
  }

  const strip = await $.ui.mount({
    plugin: 'luce-dash',
    component: 'AbovePrompt',
    requestId: 'strip',
    surface: 'terminal',
    props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100, scroll: { offset: 0, bodyRows: 3 }, view: {} },
  })
  expect((await strip.find({ type: 'Text', text: /LAP 1/ }))?.text).toBe('LAP 1')
  expect((await strip.find({ type: 'Text', text: /60%/ }))?.text).toBe('60%')
  await strip.unmount()
})
