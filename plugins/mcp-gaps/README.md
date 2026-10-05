# mcp-gaps

A Claude Code mod that logs MCP tool calls and flags likely MCP gaps while you work.

What it records, with no setup:
- a status line under the prompt: `N MCP calls · N errors · N gap candidates`
- a note under any answer where it saw a browser fallback, an AdRoll MCP tool error, or a sentence like "the MCP doesn't support X"
- `/mcp-gaps` opens a pane with per-server counts and the gap candidates
- `/mcp-gaps report` prints a paste-ready markdown list for #mcp-team; `/mcp-gaps clear` resets it

What it reaches: nothing outside Claude Code. It calls no `$.fs`, `$.process` or `$.http`. Gap candidates are kept in the plugin's own `$.store` on your machine. Check for yourself with `claude plugin validate <this folder>` and read the `calls:` line.

Try it for one session (Claude Code 2.1.287 or later):

    claude --plugin-dir /path/to/mcp-gaps

Editing it: `tsconfig.json` extends `.claude-plugin/types/tsconfig.json`, which Claude Code writes beside the mod the first time it loads it (or run `/plugin-types` in a session). That folder is generated for your build and is not committed.
