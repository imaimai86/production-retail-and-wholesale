---
description: Run every SDLC stage for a backlog item with the slash commands
argument-hint: [slug]
allowed-tools: Bash(ai-sdlc-helper skill:*)
---
Slug (blank = the first pending item in the backlog): $ARGUMENTS

!`ai-sdlc-helper skill sdlc`
