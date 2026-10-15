---
description: Commit a finished backlog item and tick it in the backlog
argument-hint: <slug>
allowed-tools: Bash(node scripts/sdlc-config.cjs skill:*)
---
Slug: $ARGUMENTS

!`node scripts/sdlc-config.cjs skill ship`
