import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GapCandidate, McpCall, ToolFamily } from '../types'

// mcp-gaps: a read-only observer. It never calls $.fs, $.process or $.http.
// It watches MCP tool calls, keeps a session log, and flags three signals that
// usually mean "the MCP could not do what the person wanted":
//   1. browser-fallback: AdRoll MCP calls and browser-automation calls in the same turn
//   2. tool-error: an AdRoll MCP tool answered an error or was denied
//   3. stated-gap: the answer says the MCP/tool/API doesn't support something
// Gap candidates persist on this machine through $.store so a week of dogfooding adds up.

const PANE = 'mcp-gaps'
const STORE_KEY = 'gaps'

const calls = atom({ plugin: 'mcp-gaps', key: 'calls' } as const, [] as McpCall[])
const gaps = atom({ plugin: 'mcp-gaps', key: 'gaps' } as const, [] as GapCandidate[])

// Tool names of the AdRoll MCP server. Matching by name, not server prefix, because the
// prefix differs between the desktop app (a connector id) and the CLI (whatever you named it).
const ADROLL_TOOLS = new Set([
  'whoami', 'get_entity_list', 'get_entity_details_batch', 'get_entity_metrics_batch',
  'get_abm_metrics_batch', 'get_account_lists', 'get_account_list_groups', 'get_account_list_items',
  'get_account_list_definitions', 'get_account_field_values', 'explore_account_count',
  'explore_account_list', 'get_account_spikes', 'get_account_spike_details_batch',
  'get_optimized_recommendations', 'get_revenue_impact', 'get_revenue_impact_opportunities',
  'search_geo', 'upload_ad', 'edit_ad', 'edit_strategy', 'create_strategy', 'campaigns_preview',
  'ads_preview', 'account_list_explorer', 'call_dev_tool', 'dev_tools',
])
const BROWSER_SERVER = /chrome|browser/i

// "not supported", "can't be done through the MCP", "no tool for", "isn't available via the API"...
const NEGATED_CAPABILITY = /\b(?:not|n['’]t|cannot|no|unable)\b[^.!?\n]{0,40}?\b(?:support|supported|available|expose[sd]?|offer|provide|allow|possible|exist|tool|endpoint|api|way)\b/i
const MCP_CONTEXT = /\b(?:MCP|tool|API|server|connector|programmatically)\b/i

// Per-turn scratch. Reset on each prompt; a hot reload loses it, which only costs one turn.
let turnPrompt = ''
let turnAdroll: string[] = []
let turnBrowser = 0
let turnErrors: McpCall[] = []

function parseTool(tool: string): { server: string; name: string } | null {
  const m = /^mcp__(.+?)__(.+)$/.exec(tool)
  return m ? { server: m[1], name: m[2] } : null
}

function familyOf(server: string, name: string): ToolFamily {
  if (ADROLL_TOOLS.has(name)) return 'adroll'
  if (BROWSER_SERVER.test(server)) return 'browser'
  return 'other'
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)]
}

function shorten(server: string): string {
  return server.length > 24 ? `${server.slice(0, 8)}…` : server
}

function statedGap(answer: string): string | undefined {
  for (const sentence of answer.split(/(?<=[.!?])\s+|\n+/)) {
    if (sentence.length < 12 || sentence.length > 400) continue
    if (NEGATED_CAPABILITY.test(sentence) && MCP_CONTEXT.test(sentence)) return sentence.trim()
  }
  return undefined
}

type ServerStat = { label: string; calls: number; errors: number; avgMs: number }

function summarize(list: readonly McpCall[]): ServerStat[] {
  const map = new Map<string, { calls: number; errors: number; ms: number; family: ToolFamily }>()
  for (const c of list) {
    const cur = map.get(c.server) ?? { calls: 0, errors: 0, ms: 0, family: c.family }
    cur.calls += 1
    cur.ms += c.ms
    if (c.status !== 'ok') cur.errors += 1
    if (c.family === 'adroll') cur.family = 'adroll'
    map.set(c.server, cur)
  }
  return [...map.entries()]
    .map(([server, s]) => ({
      label: s.family === 'adroll' ? `AdRoll MCP (${shorten(server)})` : shorten(server),
      calls: s.calls,
      errors: s.errors,
      avgMs: Math.round(s.ms / s.calls),
    }))
    .sort((a, b) => b.calls - a.calls)
}

async function refreshStatus($: EngineInterface): Promise<void> {
  const list = await read($, calls)
  const found = await read($, gaps)
  const errors = list.filter(c => c.status !== 'ok').length
  $.ui.status(`${list.length} MCP calls · ${errors} errors · ${found.length} gap candidates`)
}

function stamp(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

async function report($: EngineInterface): Promise<string> {
  const list = await read($, calls)
  const found = await read($, gaps)
  const stats = summarize(list)
  const lines: string[] = ['## MCP gap log', '']
  lines.push(`This session: ${list.length} MCP tool call(s) across ${stats.length} server(s).`)
  for (const s of stats) lines.push(`- ${s.label}: ${s.calls} calls, ${s.errors} errors, ${s.avgMs} ms avg`)
  lines.push('', `### Gap candidates (${found.length} on this machine, all sessions)`)
  if (found.length === 0) lines.push('- none yet')
  found.slice(-40).forEach((g, i) => {
    lines.push(`${i + 1}. [${g.kind}] ${stamp(g.at)}`)
    if (g.prompt) lines.push(`   - asked: "${g.prompt}"`)
    lines.push(`   - evidence: ${g.evidence}`)
    if (g.tools.length > 0) lines.push(`   - MCP tools in that turn: ${g.tools.join(', ')}`)
  })
  return lines.join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const stored = await $.store.get(STORE_KEY)
    if (Array.isArray(stored)) await update($, gaps, () => stored as GapCandidate[])
    try {
      await $.command.register({
        name: 'mcp-gaps',
        description: 'MCP gap log: open the pane, or `report` / `clear`',
        argumentHint: '[report|clear]',
      })
    } catch {
      // The name was taken; the observer still runs without its command.
    }
    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    // A prompt queued into a running turn keeps that turn's counters.
    if (e.turnId !== undefined) return next(e)
    turnPrompt = e.text.slice(0, 160)
    turnAdroll = []
    turnBrowser = 0
    turnErrors = []
    return next(e)
  })

  on('tool.call', { tool: /^mcp__/ }, async ($, e, next) => {
    const parsed = parseTool(e.tool)
    if (!parsed) return next(e)
    const family = familyOf(parsed.server, parsed.name)
    const startedAt = await $.clock.now()
    const ran = await next(e)
    const ms = (await $.clock.now()) - startedAt
    const status: McpCall['status'] = ran.deny !== undefined ? 'denied' : ran.isError ? 'error' : 'ok'
    const detail = ran.deny ?? (ran.isError ? (ran.text ?? '').slice(0, 240) : undefined)
    const call: McpCall = { id: e.tool_use_id, server: parsed.server, tool: parsed.name, family, ms, status, at: startedAt }
    if (detail) call.detail = detail
    await update($, calls, list => [...list, call].slice(-500))
    if (family === 'adroll') turnAdroll.push(parsed.name)
    if (family === 'browser') turnBrowser += 1
    if (family === 'adroll' && status !== 'ok') turnErrors.push(call)
    await refreshStatus($)
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const res = await next(e)
    if (e.agentId) return res
    const now = await $.clock.now()
    const found: GapCandidate[] = []
    if (turnAdroll.length > 0 && turnBrowser > 0) {
      found.push({
        id: `${e.turnId}-browser`,
        at: now,
        kind: 'browser-fallback',
        prompt: turnPrompt,
        evidence: `${turnBrowser} browser-automation call(s) in a turn that also made ${turnAdroll.length} AdRoll MCP call(s)`,
        tools: unique(turnAdroll),
      })
    }
    const stated = statedGap(e.answer)
    if (stated) {
      found.push({ id: `${e.turnId}-stated`, at: now, kind: 'stated-gap', prompt: turnPrompt, evidence: stated, tools: unique(turnAdroll) })
    }
    for (const err of turnErrors) {
      found.push({
        id: `${err.id}-error`,
        at: err.at,
        kind: 'tool-error',
        prompt: turnPrompt,
        evidence: `${err.tool} → ${err.status}${err.detail ? `: ${err.detail}` : ''}`,
        tools: [err.tool],
      })
    }
    if (found.length === 0) return res
    await update($, gaps, list => [...list, ...found].slice(-200))
    const all = await read($, gaps)
    await $.store.set(STORE_KEY, all)
    await refreshStatus($)
    const kinds = unique(found.map(g => g.kind)).join(', ')
    const text = `${found.length} possible MCP gap(s) recorded (${kinds}). /mcp-gaps to review · /mcp-gaps report to export`
    return e.usage ? { text, usage: e.usage } : { text }
  })

  on('command.run', { command: 'mcp-gaps' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'clear') {
      await update($, gaps, () => [])
      await $.store.delete(STORE_KEY)
      await refreshStatus($)
      return { text: 'MCP gap log cleared.' }
    }
    if (arg === 'report') return { text: await report($) }
    const opened = await $.ui.open({ id: PANE, title: 'MCP gaps' })
    return { text: opened.isPlaced ? 'MCP gaps pane opened.' : `MCP gaps pane is waiting: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, calls)
    const found = await read($, gaps)
    const stats = summarize(list)
    const room = Math.max(3, Math.floor(((e.viewport?.rows ?? 24) - 8 - stats.length) / 2))

    return (
      <Box flexDirection="column">
        <Text bold>MCP calls this session</Text>
        {stats.length === 0 && <Text dimColor>No MCP tool calls yet. Use an MCP tool and this fills in.</Text>}
        {stats.map(s => (
          <Text wrap="truncate-end">{s.label}: {s.calls} calls · {s.errors} errors · {s.avgMs} ms avg</Text>
        ))}
        <Text> </Text>
        <Text bold>Gap candidates ({found.length})</Text>
        {found.length === 0 && (
          <Text dimColor>None yet. A browser fallback, a tool error, or an answer saying the MCP can't do something lands here.</Text>
        )}
        {found.slice(-room).map(g => (
          <Box flexDirection="column">
            <Text wrap="truncate-end">• [{g.kind}] {g.prompt || '(no prompt)'}</Text>
            <Text dimColor wrap="truncate-end">  {g.evidence}</Text>
          </Box>
        ))}
        <Text> </Text>
        <Text dimColor>/mcp-gaps report → paste into #mcp-team · /mcp-gaps clear</Text>
      </Box>
    )
  })
}
