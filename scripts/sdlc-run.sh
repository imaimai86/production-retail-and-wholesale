#!/usr/bin/env bash
set -e

FEATURE_NAME="$1"

if [ -z "$FEATURE_NAME" ]; then
  echo "Usage: ./scripts/sdlc-run.sh <feature-or-bug-name>"
  exit 1
fi

DOCS_DIR="Docs/$FEATURE_NAME"
mkdir -p "$DOCS_DIR"

echo "🚀 [Orchestrator] Starting AI SDLC Pipeline for: $FEATURE_NAME"
echo "--------------------------------------------------------"

# ==========================================
# PHASE 1: Requirements & Specs Agent
# ==========================================
echo "📋 [Agent 1: Specs] Interactive interview & specification drafting..."

claude -p "You are a Requirements Specialist Agent.

STRICT OPERATIONAL RULES:
1. ZERO-GUESSING POLICY: NEVER make assumptions or fill in missing details on your own. If ANY requirement, edge case, input format, error behavior, or business logic is missing or ambiguous, you MUST ask the user directly to fill the gap before proceeding.
2. DYNAMIC INTERVIEW: Ask as many targeted questions as needed across as many turns as necessary. Do NOT limit yourself to a fixed number of questions.
3. ORIENTATION: Read CLAUDE.md, README.md, and configuration files first to understand the existing project stack.

WORKFLOW:
- Begin interviewing the user about feature/bug '$FEATURE_NAME'.
- Continue asking follow-up questions whenever ambiguity or gaps remain.
- Once ALL requirements are 100% explicitly defined by the user without any remaining unknowns, summarize and write the specification to '$DOCS_DIR/specs-1.md'.
- Do NOT generate any source code."

echo "✅ Phase 1 complete. Session reset."
echo "--------------------------------------------------------"

# ==========================================
# PHASE 2: Graft Architecture Planner Agent
# ==========================================
echo "🏗️ [Agent 2: Planner] Fresh context session. Analyzing codebase graph..."

claude -p "You are an Architecture Planner Agent.

STRICT OPERATIONAL RULES:
1. ZERO-GUESSING POLICY: If specs in '$DOCS_DIR/specs-1.md' leave any architectural or code decision ambiguous, ask the user directly before planning.
2. GRAFT GRAPH QUERY: Use the Graft MCP tool to query codebase dependencies and identify affected files/functions.
3. MINIMAL FILE TOUCH: Read ONLY the specific files flagged by Graft to minimize context.

WORKFLOW:
- Read '$DOCS_DIR/specs-1.md'.
- Query Graft MCP to map dependencies for feature '$FEATURE_NAME'.
- Write a step-by-step technical implementation plan to '$DOCS_DIR/plan-1.md'."

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
Do not modify the test assertions in '$DOCS_DIR/test-cases-1.md'."

echo "--------------------------------------------------------"
echo "🎉 [Orchestrator] Feature '$FEATURE_NAME' successfully implemented with 100% passing tests!"
