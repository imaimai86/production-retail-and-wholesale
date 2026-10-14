---
description: Write the technical plan for a backlog item (uses graft when it is available, else Grep and Glob)
argument-hint: <slug>
allowed-tools: Bash(node scripts/sdlc-config.cjs skill:*)
---
Slug: $ARGUMENTS

!`node scripts/sdlc-config.cjs skill plan`
