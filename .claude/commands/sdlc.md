---
description: Run every SDLC stage for a backlog item with the slash commands
argument-hint: [slug]
allowed-tools: Bash(node scripts/sdlc-config.cjs skill:*)
---
Slug (blank = the first pending item in the backlog): $ARGUMENTS

!`node scripts/sdlc-config.cjs skill sdlc`
