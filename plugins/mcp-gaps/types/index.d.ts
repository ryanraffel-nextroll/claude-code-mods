export type ToolFamily = 'adroll' | 'browser' | 'other'

export type McpCall = {
  id: string
  server: string
  tool: string
  family: ToolFamily
  ms: number
  status: 'ok' | 'error' | 'denied'
  detail?: string
  at: number
}

export type GapKind = 'browser-fallback' | 'stated-gap' | 'tool-error'

export type GapCandidate = {
  id: string
  at: number
  kind: GapKind
  prompt: string
  evidence: string
  tools: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'mcp-gaps': { calls: McpCall[]; gaps: GapCandidate[] }
  }
}
