#!/usr/bin/env bash
set -e

FEATURE_SLUG="$1"

# If no argument is provided, look for the first pending item in Docs/backlog/index.md
if [ -z "$FEATURE_SLUG" ]; then
  if [ -f "Docs/backlog/index.md" ]; then
    FEATURE_SLUG=$(grep -m 1 '^- \[ \]' Docs/backlog/index.md | sed -E 's/.*\[ \] `([^`]+)`.*/\1/' || true)
  fi
fi

if [ -z "$FEATURE_SLUG" ]; then
  echo "Usage: ./scripts/sdlc-run.sh <feature-or-bug-slug>"
  echo "Or add a pending item to Docs/backlog/index.md"
  exit 1
fi

DOCS_DIR="Docs/backlog/$FEATURE_SLUG"
if [ ! -d "$DOCS_DIR" ]; then
  if [ -d "Docs/$FEATURE_SLUG" ]; then
    DOCS_DIR="Docs/$FEATURE_SLUG"
  else
    DOCS_DIR="Docs/backlog/$FEATURE_SLUG"
  fi
fi

mkdir -p "$DOCS_DIR"

echo "🚀 [Orchestrator] Running AI SDLC Pipeline for: $FEATURE_SLUG"
echo "📁 Source Docs Directory: $DOCS_DIR"
echo "--------------------------------------------------------"

# ==========================================
# PHASE 1: Targeted Specs Agent (Doc-Driven)
# ==========================================
echo "📋 [Agent 1: Specs] Reading backlog brief & evaluating completeness..."

claude -p "You are a Requirements Specialist Agent.

CONTEXT:
1. Project standards: Read CLAUDE.md and README.md.
2. Backlog Brief: Read '$DOCS_DIR/brief.md' (or any raw notes in '$DOCS_DIR/').

STRICT OPERATIONAL RULES:
1. TARGETED INTERVIEW ONLY: Do NOT ask the user to describe the whole feature again. Work directly from '$DOCS_DIR/brief.md'.
2. ZERO-GUESSING POLICY: If '$DOCS_DIR/brief.md' is missing crucial edge cases, error handling, or API specs, ask ONLY specific targeted questions to fill those exact gaps.
3. AUTO-PASS IF COMPLETE: If '$DOCS_DIR/brief.md' is clear and complete, do NOT ask unnecessary questions—proceed directly to writing '$DOCS_DIR/specs-1.md'.

OUTPUT:
Write the complete specification to '$DOCS_DIR/specs-1.md'. Do NOT generate any source code."

echo "✅ Phase 1 complete. Session reset."
echo "--------------------------------------------------------"

# ==========================================
# PHASE 2: Graft Architecture Planner Agent
# ==========================================
echo "🏗️ [Agent 2: Planner] Fresh context session. Analyzing codebase graph..."

claude -p "You are an Architecture Planner Agent.

STRICT OPERATIONAL RULES:
1. ZERO-GUESSING POLICY: If '$DOCS_DIR/specs-1.md' has architectural ambiguities, ask the developer directly before planning.
2. GRAFT GRAPH QUERY: Query Graft MCP to map codebase dependencies and identify affected files/functions.
3. MINIMAL FILE TOUCH: Read ONLY the specific files flagged by Graft.

OUTPUT:
Read '$DOCS_DIR/specs-1.md', query Graft MCP, and write the step-by-step technical plan to '$DOCS_DIR/plan-1.md'."

echo "✅ Phase 2 complete. Session reset."
echo "--------------------------------------------------------"

# ==========================================
# PHASE 3: Test Specification Agent
# ==========================================
echo "🧪 [Agent 3: Test Spec] Fresh context session. Generating test matrix..."

claude -p "You are a QA Test Engineer Agent.

WORKFLOW:
1. Read '$DOCS_DIR/specs-1.md' and '$DOCS_DIR/plan-1.md'.
2. Generate a comprehensive test matrix in '$DOCS_DIR/test-cases-1.md'.
3. Create corresponding test code files in the codebase that assert these specifications.
4. Run the test command to confirm all new tests currently FAIL."

echo "✅ Phase 3 complete. Session reset."
echo "--------------------------------------------------------"

# ==========================================
# PHASE 4: TDD Fix Loop Agent
# ==========================================
echo "⚡ [Agent 4: TDD Developer] Fresh context session. Executing code fixes..."

claude -p "You are a Senior TDD Developer Agent.

WORKFLOW:
1. Read '$DOCS_DIR/test-cases-1.md'.
2. Run the test suite to identify failing tests.
3. Edit source files to make failing tests pass one by one.
4. Repeat until 100% of tests pass.
Do not modify test assertions in '$DOCS_DIR/test-cases-1.md'."

# Mark item as completed in Docs/backlog/index.md if present
if [ -f "Docs/backlog/index.md" ]; then
  sed -i '' "s/\[ \] \`$FEATURE_SLUG\`/\[x\] \`$FEATURE_SLUG\`/" Docs/backlog/index.md 2>/dev/null || true
fi

echo "--------------------------------------------------------"
echo "🎉 [Orchestrator] '$FEATURE_SLUG' complete with 100% passing tests!"
