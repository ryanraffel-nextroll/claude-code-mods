# claude-code-mods

A small marketplace of [Claude Code mods](https://code.claude.com/docs/en/plugins/mods/overview). A mod is TypeScript that runs inside Claude Code: it can watch, rewrite or answer tool calls and prompts, and draw its own pane or status line. Mods run in the Claude Code CLI and the desktop app's Code tab (not claude.ai chat or Cowork), and they need Claude Code **2.1.287 or later** (`claude --version`, then `claude update`).

A mod runs with your permissions. Read it before you install it. `claude plugin validate <dir>` prints what a mod hooks and what it calls without running it.

## Install

One command, in a Claude Code session:

    /plugin install mcp-gaps --marketplace ryanraffel-nextroll/claude-code-mods

Or from your shell:

    claude plugin marketplace add ryanraffel-nextroll/claude-code-mods
    claude plugin install mcp-gaps@claude-code-mods

Then `/reload-plugins` in an open session, or start a new one.

## Mods

| Mod | What it does | Reaches |
|---|---|---|
| [`mcp-gaps`](plugins/mcp-gaps) | Counts MCP tool calls and errors under the prompt, records a gap candidate when a turn falls back to browser automation, an AdRoll MCP tool errors, or the answer says the MCP can't do something. `/mcp-gaps` opens a pane, `/mcp-gaps report` prints a paste-ready list. | Nothing outside Claude Code: no files, processes or network. Gap candidates live in the plugin's own store on your machine. |

## Try a mod for one session without installing

    git clone https://github.com/ryanraffel-nextroll/claude-code-mods
    claude --plugin-dir ./claude-code-mods/plugins/mcp-gaps
