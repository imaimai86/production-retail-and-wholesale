#!/usr/bin/env bash
set -e

MODE="${1:-interactive}"
PARAM="${2:-}"

BACKLOG_DIR="Docs/backlog"
mkdir -p "$BACKLOG_DIR"

if [ ! -f "$BACKLOG_DIR/index.md" ]; then
  cat << 'EOF' > "$BACKLOG_DIR/index.md"
# Backlog Tracker

## Pending Items
EOF
fi

echo "🔍 [Discovery Agent] Initializing Feature & Bug Discovery..."
echo "--------------------------------------------------------"

if [ "$MODE" = "feat" ] || [ "$MODE" = "bug" ]; then
  if [ -z "$PARAM" ]; then
    echo "Usage: ./scripts/discover.sh feat \"Feature title or description\""
    echo "       ./scripts/discover.sh bug \"Bug title or stack trace\""
    exit 1
  fi

  # Headless mode is fine here because input was provided directly as an argument
  claude -p "You are a Product Discovery & Triage Agent.
A user wants to log a new $MODE: '$PARAM'.

TASK:
1. Generate a URL-friendly slug for this item (e.g., 'FEAT-oauth-login' or 'BUG-null-pointer').
2. Create directory '$BACKLOG_DIR/<slug>/'.
3. Write a structured '$BACKLOG_DIR/<slug>/brief.md' containing:
   - Title
   - Type ($MODE)
   - Goal / Problem Statement
   - Initial Context / Details provided by user
   - Expected Behavior & Success Criteria
   - Known Constraints or Affected Areas
4. Append '- [ ] \`<slug>\` - $PARAM' under '## Pending Items' in '$BACKLOG_DIR/index.md' (if not already listed).
5. Output a brief confirmation showing where the brief was saved."

elif [ "$MODE" = "--scan" ]; then
  echo "🤖 [Discovery Agent] Scanning codebase for TODOs, technical debt, and test gaps..."

  # Interactive mode (claude "...") so user can approve candidate items in terminal
  claude "You are an Automated Codebase Discovery Agent.

TASK:
1. Search the codebase for 'TODO', 'FIXME', 'HACK', 'XXX' comments, missing error handlers, or unhandled edge cases.
2. Check Graft knowledge graph / AST structure if available to identify unhandled dependencies.
3. Present candidate features/bugs to the user in this terminal session for approval.
4. For any item the user approves, create '$BACKLOG_DIR/<slug>/brief.md' and add it as '- [ ] \`<slug>\` - <title>' to '$BACKLOG_DIR/index.md'.
5. Do NOT modify source code or tests."

else
  echo "💬 [Discovery Agent] Interactive Discovery & Brainstorming Session..."

  # Interactive mode (claude "...") so developer can brainstorm with the agent in real time
  claude "You are a Senior Product & Architecture Discovery Agent.

STRICT OPERATIONAL RULES:
1. ZERO-GUESSING POLICY: Ask clarifying questions to understand what the user wants to build or fix.
2. ORIENTATION: Read CLAUDE.md, README.md, and Docs/backlog/index.md to know what's already built or in queue.

WORKFLOW:
1. Interview the user to brainstorm upcoming features, improvements, or bug fixes.
2. Break down large ideas into distinct, executable feature/bug items.
3. For each identified item:
   - Create a directory '$BACKLOG_DIR/<slug>/'
   - Write a detailed '$BACKLOG_DIR/<slug>/brief.md'
   - Append '- [ ] \`<slug>\` - <title>' to '$BACKLOG_DIR/index.md'
4. Confirm created backlog briefs once complete."

fi

echo "--------------------------------------------------------"
echo "✅ Discovery complete! Your backlog in '$BACKLOG_DIR/index.md' is updated."
