---
description: Turn a bug report or feature request into backlog items (uses graft when it is available, else Grep and Glob)
argument-hint: <report, pasted error, or a link/path to notes>
allowed-tools: Bash(node scripts/sdlc-config.cjs skill:*)
---
Report to triage (free text, pasted error, or a link/path to notes): $ARGUMENTS

!`node scripts/sdlc-config.cjs skill triage`
