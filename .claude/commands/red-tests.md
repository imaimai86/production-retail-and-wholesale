---
description: Write the failing tests for a backlog item and commit them
argument-hint: <slug>
allowed-tools: Bash(node scripts/sdlc-config.cjs skill:*)
---
Slug: $ARGUMENTS

!`node scripts/sdlc-config.cjs skill red-tests`
