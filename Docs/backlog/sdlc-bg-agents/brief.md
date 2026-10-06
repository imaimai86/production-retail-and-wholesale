# sdlc-bg-agents

Type: feature
Priority: P3 (nice to have)
Status: parked (see "Why parked")
Source: user question (2026-10-06): "can we run the sub agents in any other mode than -p so it allows better monitoring", and have Spec and Plan agents ask their questions with AskUserQuestion.

## Problem
Every pipeline stage runs as a headless `claude -p` process. That gives almost no live visibility (one text blob at the end) and the agent cannot ask the developer anything: `AskUserQuestion` is not available under `-p`, so the Spec agent writes `questions.md` and the script exits with code 2.

## Idea
Run the agents as background sessions instead: `claude --bg --name <slug>-<stage> "<prompt>"`.

## Findings so far (tested with Claude Code 2.1.291)
- `AskUserQuestion` IS available in a `--bg` session. A test session showed the question picker and waited for input.
- `claude agents --json` lists every session with a `state` (`blocked` while it waits, `done` when finished) and `waitingFor: "input needed"`. `claude stop`, `attach`, `respawn` and `rm` manage them; `claude --resume` / `attach` give stop and resume for free.
- `claude --worktree [name]` creates a git worktree per session, which fits running features in parallel.
- `claude logs <id>` prints raw terminal escape codes, so it is not machine-readable. Tools and tokens would have to come from the session transcript.
- Not available: `AskUserQuestion` under `-p`, including `-p --input-format stream-json --permission-prompts host`.

## Open questions (verify before building)
- `--bg` needs a trusted workspace (it refused in an untrusted directory). Does a freshly created worktree count as trusted, or does the first run block on a trust prompt?
- Do `--max-turns`, `--allowedTools` and `--permission-mode` apply to a `--bg` session as they do to `-p`? A `--bg` session showed "auto mode on" by default.
- Completion and failure detection: a `--bg` session ends as `done` and leaves no exit code, so `sdlc.sh` would poll `claude agents --json` and check the files the agent wrote.
- The developer would answer by running `claude attach <id>`, which does not show the orchestrator's drafted answer and decision. `decisions.md` would depend on the agent recording the answer.

## Why parked
Two cheaper steps cover most of the need:
1. Monitoring: `-p --output-format stream-json --verbose` gives a live event stream (tool calls, tokens), consumed by the sdlc-monitor reporter mod.
2. Questions: the orchestrator session prints each question, the suggested answer and its own decision, then asks with `AskUserQuestion` (rule in CLAUDE.md and `/sdlc`).

Revisit if the agents themselves need to ask mid-stage (not only at the end of Spec), or if `-p` monitoring proves too thin.

## Scope (when unparked)
- In: a `SDLC_AGENT_MODE=bg` option in the SDLC wrapper that starts Spec and Plan as `--bg` sessions and polls `claude agents --json`.
- Out: replacing `-p` for Implement, Test repair and Review, which never need to ask.
