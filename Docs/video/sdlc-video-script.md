# Video script: "The Software Factory: an AI SDLC pipeline that is not allowed to cheat"

Main video (about 24 minutes, 16:9) plus 11 Shorts (45 to 60 seconds each, 9:16).
Audience: fresh software engineers and open-source contributors who have used an AI coding assistant but never built
a process around one. Tone: friendly, concrete, a little playful, no hype words. Every claim in this script can be
checked against the repository (see the fact-check table at the end).

Conventions in this script:
- **VO** is the narration, word for word.
- **SCREEN** is what the viewer sees. `[R:Name]` is an animated scene to build in Remotion (list in the production notes).
  `[CAP]` is a real screen capture of a terminal or of Claude Code.
- Stages are always called by name: Spec, Plan, Red tests, Implement, Test repair, Review, Ship. Never "stage 3".

---

## Main video

### 0. Cold open: the pitch (0:00 to 0:50)

**SCREEN:** Black. One line of text types itself: `- [ ] fix-user-validation - POST /users returns 500 when name is missing`.
`[R:PitchHook]` The line drops onto a conveyor belt. It passes seven glowing stations; at each one a document pops out
(spec, plan, tests, code, review), a red light turns green, and at the end a git branch slides out with two commits.

**VO:**
> You paste an error from your server logs. Or you just write one line: "POST /users crashes when the name is missing."
>
> You get a coffee, and when you come back there's a git branch waiting. In it: a written specification, a technical plan, a set of tests
> that failed before the fix and pass after it, the fix itself, a code review, and one clean commit.
>
> Nobody typed any of that code. AI agents did. But here is the part that matters: at no point were those agents
> allowed to grade their own homework. They could not edit the tests to make them pass. They could not guess what you
> meant. They could not commit your secrets. And when one of them claimed "this test is wrong", a second agent, a set of
> mechanical checks, and a third, independent auditor all had to agree before a single test line could change.
>
> This is a software factory. It's open source, it runs inside Claude Code, and by the end of this video you will
> know what a software factory is, the pattern behind this one, the safeguards that keep AI honest, how to run it on
> your own machine, and how you can help us turn it into a tool for every project.
>
> Let's open the factory doors.

**SCREEN:** Title card `[R:TitleCard]`: "The Software Factory". Subtitle: "An AI SDLC pipeline that is not allowed to cheat".

---

### 1. What is a software factory? (0:50 to 3:30)

**SCREEN:** `[R:FactoryAnalogy]` A car factory in flat illustration: raw steel enters, stations weld, paint, inspect;
a car rolls out. Labels appear: "stations", "conveyor", "inspection", "rejected parts bin".

**VO:**
> Let's start with the word "factory". A car factory isn't one genius building a car. It's a line of stations. Each
> station does one job, hands its work to the next, and between the stations there are inspections. A door that
> doesn't fit is rejected before it reaches the paint shop, not after the car is sold.
>
> Software has its own version of this line. It's called the SDLC: the Software Development Life Cycle. If you're new,
> here are the stations, in plain words:
>
> - **Requirements:** what exactly should the software do? What happens with bad input?
> - **Design:** which files and functions change, and in what order?
> - **Tests:** how will we prove it works?
> - **Implementation:** write the code.
> - **Review:** a second pair of eyes looks for bugs and security holes.
> - **Release:** commit it, merge it, ship it.

**SCREEN:** `[R:SDLCStations]` The six words appear as stations on a line, each with a small icon.

**VO:**
> In most teams, people do every station. A software factory automates the line. In our case the workers at each
> station are AI agents. And this is the first big idea of the video:
>
> **The factory is not the workers. The factory is the line, the stations, and the inspections.**
>
> An AI model that writes code is a very fast, very confident worker. Fast and confident is great on an assembly line,
> as long as the inspections are strict. A factory without inspections just produces broken cars faster.

**SCREEN:** Split screen. Left: "AI chat: one long conversation, you check everything by eye". Right: "Software factory:
separate stations, each output checked by a machine".

**VO:**
> You might be using AI today like this: you open a chat, you describe a feature, the model writes code, you read it,
> you ask for fixes, and you hope you caught everything. That works for small things. It does not scale, and it relies
> on you being the only inspector.
>
> A software factory flips that. Each AI worker gets one narrow job, a limited set of tools, and a written hand-off
> from the previous station. And after every station, a script, not a model, checks the result. Pass, and the work moves
> on. Fail, and it's rejected with a reason.
>
> The factory runs on a real project: an open-source Node.js and PostgreSQL backend I started for a company that
> produces goods, sells them in its own shop and sells to dealers from the warehouse. Products, stock, invoices, GST.
> Ordinary business software. Which is exactly why it's a good test bed: the factory has to work on boring, real code,
> not on a demo.

---

### 2. The pattern behind this pipeline (3:30 to 8:30)

**SCREEN:** `[R:PipelineMap]` The full line, left to right, with the intake dock in front of it:
`report -> /triage -> backlog (brief.md) -> Spec -> Plan -> Red tests -> Implement (x4) -> [Test repair] -> Review -> Ship`.
Each arrow carries a file name: `brief.md` and the `index.md` line, `specs-1.md`, `plan-1.md`, `test-cases-1.md` plus
tests, source changes, `review-1.md`, commits.

**VO:**
> Here's the whole line. It's driven by one shell script, `scripts/sdlc.sh`. You give it a backlog item, a short brief,
> and it runs these stations in order. But a factory is only as good as the raw material that comes in, so in front of
> the line there's an intake dock, and we'll get to it in a moment.
>
> The pattern has four ingredients, plus the intake. Let's take them one by one.

#### 2a. Ingredient one: a deterministic boss, AI workers

**SCREEN:** `[R:BossAndWorkers]` A plain grey box labelled `sdlc.sh (bash)` holds a clipboard. Seven coloured robots
line up. The box points at one robot at a time; the others stay asleep.

**VO:**
> The boss of this factory is not an AI. It's about four hundred lines of bash. The script decides which station runs,
> starts one AI agent for that station, waits for it to finish, and then checks the result with ordinary code: does the
> file exist, do the tests fail, do the tests pass, did anyone touch a file they shouldn't have.
>
> Each agent is started headless, meaning there's no chat window and no human typing: `claude -p` with a prompt, a list
> of allowed tools, and a maximum number of turns. When it's done, it's gone. The next station gets a fresh agent that
> knows nothing except what's written in the files.
>
> Why does that matter? Because an AI orchestrating other AIs can be talked out of its rules. A bash `if` statement
> can't. The rules live in code, so the rules hold.

**SCREEN:** `[CAP]` `scripts/sdlc.sh`, the `agent()` function, highlighting `claude -p "$prompt" ... --allowedTools ... --max-turns`.

#### 2b. Ingredient two: hand-offs through files

**SCREEN:** `[R:FileHandOff]` Documents slide from robot to robot: brief, specs, plan, test cases.

**VO:**
> Stations don't talk to each other. They write files. The Spec agent writes `specs-1.md`. The Plan agent reads that
> and writes `plan-1.md`. The Red tests agent reads both and writes a test matrix and real test files. Everything lives
> in `Docs/backlog/<slug>/`, so a human can read every hand-off, and so can the next agent. This is an old pattern
> called "pipes and filters": each filter does one thing and passes its output down the pipe.

#### 2c. Ingredient three: test-driven development, red then green

**SCREEN:** `[R:RedGreen]` A test list. All rows red. A lock icon snaps shut over the list with a git commit hash.
Then the rows turn green one by one.

**VO:**
> The third ingredient is test-driven development, TDD for short. If you haven't met it: you write the tests first,
> you watch them fail, that's "red", and only then you write the code that makes them pass, that's "green".
>
> This pipeline takes TDD literally. After the Red tests station, the script runs the test suite. If the new tests
> already pass, before any code was written, the run stops with "RED GATE FAILED". A test that passes against code that
> doesn't exist yet proves nothing.
>
> If they fail, as they should, the script commits them: `test(<slug>): add failing tests`. That commit is the lock.
> From that moment on, the tests are the contract. The Implement agent gets up to four attempts to make them green,
> and after each attempt the script compares the test folder with that locked commit. One changed line and it's
> "GUARD FAILED: tests were modified during implementation".

#### 2d. Ingredient four: separation of duties

**SCREEN:** `[R:MakerChecker]` Two columns, "Maker" and "Checker": Spec agent / developer answers; Red tests agent /
red gate; Implement agent / locked tests; Test repair agent / auditor on a different model; Implement / Review agent.

**VO:**
> The last ingredient is what banks call "maker-checker" and what security people call "separation of duties". The
> one who writes something is never the one who approves it. The agent that writes the tests doesn't write the code.
> The agent that writes the code can't change the tests. The agent that repairs a test is checked by an auditor that
> can't edit anything at all, and that runs on a different model by default, so it doesn't share the same blind spots.
>
> So that's the pattern: a deterministic boss, AI workers with one job each, hand-offs through files, tests locked
> before code, and nobody grades their own homework.

#### 2e. The intake dock: `/triage` builds the backlog

**SCREEN:** `[R:Triage]` A messy pile arrives at a loading dock: a pasted stack trace, a Slack-style complaint, a line
from `Engineering/bugs.md`. A sorting station splits it into two labelled crates, `fix-user-validation` (bug, P2) and
`add-db-health-check` (feature, P2), a third scrap marked "docs only" drops into a side tray, and the crates roll onto
the backlog shelf, `Docs/backlog/index.md`.

**VO:**
> Every station we just saw starts from a backlog item. So where do backlog items come from? In a real team they come
> from bug reports, error logs, customer complaints, half-finished notes. Messy stuff. If you feed messy stuff straight
> into the line, the Spec station spends round after round asking questions.
>
> So the factory has an intake tool: the `/triage` command in Claude Code. You paste whatever you have, an error
> message, a link to notes, a paragraph of complaints, and triage turns it into backlog items the pipeline can run with
> few or no question rounds. Here's what it does, in order:
>
> - **Split.** One report can hide three problems. Triage makes one item per problem and marks each as a bug, where
>   existing behaviour is wrong, or a feature, where something new is needed.
> - **Check for duplicates.** It reads the backlog and the known-bugs list first. If an item already covers the report,
>   it says which one and stops. No second copy.
> - **Ground it in the code.** It uses graft to find the real files, functions and endpoints. For a bug, it confirms
>   the cause from the code, and when it's cheap and safe, it reproduces it with the tests. It says what it verified
>   and what it didn't.
> - **Decide what it can.** Every question left open costs a full round at the Spec station. So triage settles what the
>   project's own conventions already answer: the error format, the validation order, what's in and out of scope, which
>   tests to write. It only asks you about real product decisions, up to four questions at a time, and writes your
>   answers into the brief as decisions.
> - **Write the item.** A `brief.md` with a fixed shape: type, priority from P0 for security or data loss down to P3
>   for nice to have, the source, the problem, the expected behaviour, decisions, scope, tests, docs, and open
>   questions. Plus one line in `Docs/backlog/index.md`, with P0 and P1 items placed above the rest, because the
>   pipeline works top-down.
>
> And the intake has its own safety rules. It never writes source code and never starts the pipeline. It never
> pastes a password or a token into a file; it names them instead. It refuses to make a backlog item for a
> documentation-only change, because the pipeline builds and tests code, and a docs-only item would ship docs with no
> feature. It tells you to edit those directly. And it never commits on its own: at the end it shows you exactly which
> files it would publish, to a new `triage/<slug>` branch, and asks. Commit and push, commit locally only, or do
> nothing. Anything that isn't a clear yes means do nothing.
>
> Here's a real run. One request, "let the pipeline work with other test frameworks", went into triage and came out as
> three backlog items that depend on each other: a test framework registry, the pipeline gates using the configured
> runner, and a config screen to pick the framework. Three briefs, three lines in the backlog, one commit on a
> `triage/` branch, which then went through a normal pull request.

**SCREEN:** `[CAP]` `git show --stat a23b93f`: three `brief.md` files and `Docs/backlog/index.md`. Then
`Docs/backlog/add-test-framework-registry/brief.md`, highlighting `Type:`, `Priority:`, `Source:` and `## Decisions`.

---

### 3. What is peculiar about this pipeline (8:30 to 12:00)

**SCREEN:** `[R:SectionCard]` "What's unusual here". Then each point appears as a card.

**VO:**
> Plenty of tools let an AI write code. Here's what this one does differently.

**Card 1: It asks before it guesses.**

**SCREEN:** `[CAP]` `Docs/backlog/fix-user-validation-v2/decisions.md`, scrolling through Q1 to Q6.

> The Spec agent runs under a rule we call zero-guessing. If the brief is ambiguous, it is not allowed to invent the
> answer. Instead it writes `questions.md`: each question, why it matters, and a suggested answer. The pipeline pauses.
>
> We tested this on purpose with a deliberately vague brief: "POST /users returns 500 when name is missing". The agent
> came back with six questions. What counts as a valid name? Is whitespace a name? What about extra fields like
> `password` that the old docs mentioned? Does the auth check run before validation? Each one came with a suggested
> answer. You type "accept", or your own answer, and the run continues. Your answers go into `decisions.md` and the
> agent is told: these are binding, never ask them again.

**Card 2: Tests are locked by git, not by a promise.**

> We just saw this one. The lock is a commit hash. A prompt can ask an AI not to touch the tests; a `git diff` against
> that hash proves whether it did.

**Card 3: "The test is wrong" is a formal claim, not an excuse.**

**SCREEN:** `[R:Courtroom]` A small courtroom: "Implement agent" files a claim, "Test repair agent" responds,
"Mechanical checks" as a jury of five, "Auditor" as the judge. Gavel: `VERDICT: VALID`.

> Sometimes a test really is wrong. It contradicts the spec, or it leaks a mock into another test. Most pipelines
> either let the AI edit the test, which is how cheating starts, or never let anyone fix it, which is how pipelines get
> stuck. Here, the Implement agent can file a claim in `test-issues.md`: test file, test name, and why, citing the spec.
> That opens Test repair, a station that only exists for this. We'll walk through its checks in the safeguards section.
> It's the most peculiar part of the whole factory.

**Card 4: Tests must run real code.**

> Every prompt carries the same rule: a test must import or run the code under test. A test that reads the README and
> checks that a sentence is there is a defect, because it passes even when the feature is missing. Documentation is
> checked by the Review station, never by a test.

**Card 5: Every pipeline gets its own copy of the repo.**

**SCREEN:** `[R:Worktrees]` One repo folder, two branches growing out of it into sibling folders
`../production-retail-and-wholesale-sdlc/<slug>`.

> The wrapper, `scripts/sdlc-mod.sh`, runs each backlog item in its own git worktree. A worktree is a second checkout of
> the same repository in another folder, on its own branch. So two features can be built at the same time without
> stepping on each other, and your main folder stays exactly as you left it.

**Card 6: Mission control lives inside Claude Code.**

> There's a control pane, a Claude Code plugin called `sdlc-monitor`. You start runs, watch stages, answer questions,
> allow or deny actions, and stop or discard runs, without leaving your editor session. We'll demo it in a minute.

**Card 7: Bring your own model.**

> Each station has its own model and effort level. By default, the thinking-heavy stations, Spec, Plan, Test audit and
> Review, use Opus, and the doing stations use Sonnet. You can override any station, and you can point a station at
> another provider's Anthropic-compatible endpoint, such as a LiteLLM or OpenRouter gateway.

**Card 8: The factory was built by the factory.**

**SCREEN:** `[CAP]` `Docs/backlog/index.md`, highlighting `[x] add-model-registry`, `[x] add-config-pane`,
`[x] add-permission-prompts`, `[x] retry-unclaimed-failing-test`.

> And maybe the most fun detail: many of the pipeline's own features went through the pipeline. The model registry, the
> config pane, the permission prompts, the flaky-test retry: each started as a backlog line, got a spec, locked tests,
> and an implementation. There are even three deprecated versions of the runner still in the repo, a nice record of how
> the design grew up.

---

### 4. The safeguards, and why each one exists (12:00 to 16:30)

**SCREEN:** `[R:SafeguardStack]` A tall stack of shields. Each shield, as it is named, slides in with a short
"threat" label on the left and "mechanism" label on the right.

**VO:**
> Now the heart of it. A safeguard is only worth having if you can say what it protects against. So for each one:
> the threat, and the mechanism.

**1. The red gate.**
> Threat: tests that pass before the code exists, so they test nothing. Mechanism: after Red tests, the suite must
> fail, or the run stops.

**2. The test lock.**
> Threat: an agent under pressure "fixes" the failing test instead of the code. Mechanism: the tests are committed, and
> after every Implement attempt and after Review, any difference in `server/__tests__` from that commit stops the run.

**3. The stage guard plugin.**
> Threat: an agent writing files outside its job, during the stage. The git check catches it afterwards; we'd rather
> stop it in the act. Mechanism: the `sdlc-guard` plugin is loaded into every agent. It reads the current stage from
> `status.json` and refuses writes the stage doesn't allow. Spec and Plan may only write their own docs folder. Red
> tests may write tests and docs, never source. Implement and Review may never write tests, not even through a sneaky
> `sed -i` or `mv` in the shell. It also refuses a plan written before the spec exists. And if the guard itself crashes,
> it refuses the call. A crashed check must not become an open door.

**SCREEN:** `[CAP]` `.claude/plugins/sdlc-guard/hooks/register.ts`, the `refuse()` switch and the `FAILED` constant.

**4. The Test repair chain.**

**SCREEN:** `[R:RepairChain]` Seven links of a chain light up one by one. If any link breaks, the chain snaps and a
"tests restored" stamp appears.

> Threat: a legitimate "this test is wrong" claim becomes a loophole. So Test repair is a chain, and every link has to
> hold:
> 1. **Flaky filter.** Failing tests that weren't claimed are re-run once. If one passes, it's flaky: recorded as a
>    warning in `flaky-tests.md`, not blamed on anyone.
> 2. **Pre-check.** Every still-failing test must be claimed, and at most three tests can be claimed. You can't claim
>    your way out of the whole suite.
> 3. **Hands off the source.** The repair agent may edit only the claimed test files. A hash of the source is taken
>    before and after; if it changed, rejected.
> 4. **Diff check.** Only claimed files changed. No fewer `expect()` calls than before. No new weak matchers like
>    `toBeTruthy` or `expect.anything`. No new `skip`, `only` or `todo`.
> 5. **Name check.** Every test that existed when the tests were locked still exists. No deleting, no renaming.
> 6. **Red check.** The repaired tests are run against the original, unimplemented code. They must still fail there.
>    A repaired test that passes on empty code was weakened.
> 7. **Independent audit.** A read-only auditor, on a different model by default, reads the spec, the claim and the
>    diff, and must end with exactly `VERDICT: VALID`. Its instructions end with: "If in any doubt, INVALID."
>
> Only then is the repair committed and the tests locked again. If any link breaks, the tests are restored to the
> locked commit. And the repair agent can also say "no repair needed: the code is wrong", which sends the work back.

**5. Real integration tests.**
> Threat: unit tests that mock the database pass while the real SQL is broken. Mechanism: after the unit tests, the
> integration suite runs against real PostgreSQL. It uses your local database if it answers, or starts a throwaway
> Docker container, and it creates and drops its own `prw_test_*` databases so it never touches your data. A remote
> database is ignored unless you opt in.

**6. Scoped tools, bounded turns, and asking permission.**
> Threat: an agent running commands nobody approved. Mechanism: each agent gets a short list of allowed tools: read,
> write, edit, search, `npm test`, lint, a few read-only git commands. Turns are capped. If an agent tries something
> outside the list, it's refused, the run pauses, and the pane shows the refused action with three buttons: **Allow
> this run**, **Allow always**, **Deny**. Then the stage restarts. Headless agents can't ask you questions, so the
> pipeline asks for them.
>
> Here's a real one. The Spec agent wanted to read the error handler with `cat` and `grep` in the shell, which isn't
> on its list. Later the Plan agent wanted to look inside `node_modules` for a logging library. Both runs stopped and
> asked. I allowed each, once for this run or always, and the stage started again.

**SCREEN:** `[CAP]` `s10-refused-actions.png`: "The spec agent was refused 2 action(s). Allow or deny each; the stage
restarts when none is left.", each command with **Allow this run (Bash(cd:\*))**, **Allow always**, **Deny**, and
**Allow all** / **Deny all** below. Then `c11-plan-allow-always.mp4` (18 s): the Plan agent's two refused commands,
**Allow always** on each, the toast "Allowed: 1 more to decide", then "Allowed" and Plan running again.

**7. Keys stay secret.**
> Threat: an API key leaking into a log, a command line, or the wrong company's server. Mechanism: the model registry
> stores the *name* of the environment variable, never the key. The key is exported only inside the subshell that
> starts the agent. Your Anthropic key is blanked for that call so it's never sent to a third-party endpoint. And
> endpoints must be `https`, or plain `http` only to localhost.

**8. Ship commits only what the factory built.**
> Threat: the pipeline commits your unrelated work in progress, or your `.env` file. Mechanism: at the start, the
> script takes a snapshot of every file you'd already changed. At the end, Ship commits only what changed since then.
> Secrets like `.env` and `*.pem`, editor and agent config, generated files and anything over 1 MiB are skipped and
> listed in `ship-skipped.md`. New keys added to `.env` are copied to `.env.example` with the value `change-me`, never
> the real value.

**9. Nothing is lost by accident, and nothing merges by accident.**
> Threat: a "discard" that throws away a day of work, or a bot that merges to main. Mechanism: before `discard` or
> `restart` deletes a branch, the branch tip is saved, and the command to bring it back is printed. And the house rules
> for the orchestrating Claude session say: never merge a pull request without asking the human first, with an explicit
> Merge or Do not merge choice. A green CI run is not a yes.

**SCREEN:** `[R:SafeguardStack]` collapses into one sentence.

**VO:**
> If you remember one thing from this section: **agents propose, gates dispose.** The AI does the creative work. Plain
> code decides whether it's accepted.

---

### 5. How to use it today (16:30 to 21:30)

**SCREEN:** `[R:WhereItLives]` A warehouse building labelled `production-retail-and-wholesale` (stock, own shop,
dealers and retailers, accounting). Inside it, a small glowing room labelled "software factory". A dotted outline next
to the building shows where the factory will move out on its own: "standalone library", then "app for developers".

**VO:**
> Before we run it, a word on where this factory lives, because I want to be upfront about it.
>
> It's built into an open-source project I started a while back and never finished: `production-retail-and-wholesale`.
> It's a proof of concept for a company that makes its own products, sells them in its own shop, and sells to dealers
> and retailers straight from the warehouse. Warehouse and stock management, sales, and accounting.
>
> I built the factory inside that project to finish it, so today it's wired to that one codebase. It isn't reusable
> yet. You can't drop it into your own repo and run it.
>
> That's changing. I'm pulling it out into a standalone open-source library, and eventually an app, to support
> developers on any project. I've only just started on that, and I'll keep posting steady progress on this channel.
>
> So what you'll see now is how to try it today, inside this project. It's the best way to see every station working
> for real, and the best starting point if you want to help build the standalone version.

**SCREEN:** `[R:Checklist]` Prerequisites ticking in: Node.js, git, Claude Code, graft, PostgreSQL or Docker.

**VO:**
> Let's run it. You need Node.js, git, Claude Code, and Docker or a local PostgreSQL for the integration tests. You
> also need graft, a code-graph tool the Plan station uses to find which files a change touches.

**SCREEN:** `[CAP]` Terminal:
```bash
git clone https://github.com/imaimai86/production-retail-and-wholesale
cd production-retail-and-wholesale
npm install -g @nanonets/graft
graft build
./install.sh
```

> Clone the repo, install graft, build the graph, and run `install.sh` to install dependencies.

**Step 1: describe the work.**

**SCREEN:** `[CAP]` Claude Code, typing `/triage POST /users returns 500 when the name is missing`.

> Every job starts as a backlog item: a line in `Docs/backlog/index.md` and a short `brief.md`. You can write them by
> hand, but the easy way is the intake dock we saw earlier: paste the bug report into `/triage`. It splits it, checks
> for duplicates, finds the real files with graft, asks you only what the code can't answer, and writes the brief and
> the backlog line. It ends with a table of the items it made and the command to run each one, and offers to publish
> them to a `triage/<slug>` branch once you say yes. To see what's waiting, run `/backlog-list pending`.

**Step 2: start a run.**

**SCREEN:** `[CAP]`
```bash
bash scripts/sdlc-mod.sh run fix-user-validation
bash scripts/sdlc-mod.sh watch fix-user-validation
```

> Start it with `sdlc-mod.sh run` and the slug. That creates the worktree and branch `sdlc/<slug>` and starts the
> pipeline in the background. Up to two run at once; a third waits. `watch` gives you a live view: the status line, the
> current stage and model, the uncommitted files, and the last lines of output.

**Step 3: or use the control pane.**

**SCREEN:** `[CAP]` Real recording, in four beats (files in `Docs/video/captures/`):
1. `s01-sdlc-button.png`, then `c01-open-board.mp4` (7 s): press **SDLC**; the board opens with a column per stage,
   Backlog (20), Spec, Plan, Red tests, Implement, Review, and the header "0 running · 0 paused · up to 2 at once".
2. `c02-read-briefs.mp4` (10 s, played at 1.6×): **Open** on three cards, `add-auth-token-table`,
   `add-db-health-check`, `add-json-logging`; each shows its ticket, the `brief.md` with type, priority, source,
   problem and expected behaviour. Freeze on `s03-ticket-brief.png`.
3. `c03-select-and-run.mp4` (15 s): tick `add-json-logging`, **Run selected (1)**, "Starting add-json-logging…", the
   toast "Started 1, queued 0 (at most 2 run at once).", and the card moving into the Spec column as
   "spec-1 (opus · medium) · 00:03".
4. `c04-pipeline-view.mp4` (8 s): open the card: "add-json-logging running · 0/6 stages", the stage chips with each
   stage's model and effort (Spec opus, Plan opus, Red tests sonnet, Implement sonnet, Review opus, Commit), the agent
   "spec-1 opus · medium running 00:03", "Files 0 changed since base · 0 uncommitted", and the first lines of output.
   Freeze on `s07-pipeline-view.png`.

```bash
claude --plugin-dir .claude/plugins/sdlc-monitor
```

> Most people will prefer the pane. Start Claude Code with the `sdlc-monitor` plugin and press **SDLC**, or type
> `/sdlc-monitor`. It opens as a board, one column per stage. On the left is the backlog: every pending item as a card
> with its type, priority and title. Press **Open** on a card and you read its ticket, the brief that triage wrote,
> before you commit to building it.
>
> Tick the ones you want and press **Run selected**. At most two run at once and the rest wait in a queue, so the
> header always says how many slots are free. Watch the card: a few seconds later it leaves the backlog and lands in
> the Spec column, with the agent's name, its model and effort, and a running clock.
>
> Open it, and you get the pipeline view: every stage as a chip, with the model and effort it will use, the agent
> that's working right now, how many files the run has changed, the documents it has produced so far, and the live
> output. As the run moves on, the card moves across the board, column by column.

**SCREEN:** `[CAP]` `c10-plan-running.mp4` (8 s): later in the same run, Spec has a tick, the Plan chip is lit,
"1/6 stages", the agent "plan opus · medium running 00:18"; back on the board the card now sits in the Plan column.
Freeze on `s14-board-plan-column.png`.

**Step 4: answer the questions.**

**SCREEN:** `[CAP]` `c06-paused-for-answers.mp4` (6 s): the card turns amber, "needs answers: 7 questions", the
toast "add-json-logging is paused: 7 question(s) need answers", and "0/7 questions answered" above Q1. Then
`c07-accept-suggested.mp4` (7 s, three cuts): **Use suggested** pressed on Q1 to Q4, each turning into
"→ accept suggested". Freeze on `s09-accept-suggested.png`. The recording stops before **Submit answers and resume**;
`c08-allow-refused-actions.mp4` later shows the answers recorded ("recorded round 1 answers in
Docs/backlog/add-json-logging/decisions.md").

> When the Spec agent has questions, the run pauses and the card turns amber. On this run it had seven: should an
> error reaching the handler be logged once or twice, how to log a thrown value that isn't an Error, whether to trust
> an incoming `X-Request-Id`, what happens when the client hangs up before the response finishes. Each one says why it
> matters and gives a suggested answer. Press **Use suggested**, or type your own answer and press Enter, then
> **Submit answers and resume**. Your answers are saved in `decisions.md`, so the agent never asks them again. If you
> work from the terminal, you fill the `**Answer:**` lines in `questions.md` and run the same command again.

**Step 5: steer, stop, resume.**

> Something going the wrong way? **Stop**, press twice to confirm. A stopped or failed pipeline shows a text box per
> stage. Type an instruction for that stage, for example "keep the existing error format", press **Resume at
> Implement**, and that text is handed to the agent as binding input. From the terminal it's `FROM=implement` before the
> command. And **Discard** throws the attempt away and lets you start fresh, with the old branch recoverable.

**Step 6: configure models.**

**SCREEN:** `[CAP]` The **CONFIG** pane: a provider row, **Test** on a model, a toast "ok".

> The **CONFIG** button opens the model registry: add a provider, its endpoint, the name of the variable that holds its
> key, and its models. Press **Test** to send one request and see if it answers. Then pick models per stage, for
> example `MODEL_IMPLEMENT=opus EFFORT_IMPLEMENT=high`.

**Step 7: review the result.**

**SCREEN:** `[CAP]` `git log --oneline` on `sdlc/fix-user-validation-v2`:
`test(...): add failing tests and spec/plan docs`, `feat(...)`, and the backlog tick.

> When it's done you have a branch with the locked tests commit, the feature commit, and the backlog item ticked.
> Read the spec, the plan and the review in the docs folder, look at the diff, and open a pull request. The factory
> builds; a human still decides what ships.

---

### 6. Where it's going: the roadmap and ai-sdlc-helper (21:30 to 23:15)

**SCREEN:** `[R:Roadmap]` A road with two lanes: "Next in this repo" and "ai-sdlc-helper".

**VO:**
> As I said, today this factory is wired into one project: Jest tests in `server/__tests__`, `npm test`, PostgreSQL.
> The next big step is to lift it out so any project can use it: first as a standalone open-source library, and
> eventually as an app for developers. I call it the ai-sdlc-helper. The working name in the plan is `sdlc-helper`,
> and the final name is still open.

**SCREEN:** Two boxes: "npm package: the engine (CLI, pipeline, test adapters, registries, prompts)" and "Claude Code
plugin: the interface (slash commands, control pane, guard hooks, working rules)".

> It ships as two pieces from one repo. An npm package is the engine: the command-line tool, the pipeline, the model
> registry and the default prompts. It works without any UI, so it runs in a terminal or in CI too. And a Claude Code
> plugin is the interface: the slash commands, the control pane, the guard, and the working rules that today live in
> this repo's CLAUDE.md.
>
> Each project gets a small `sdlc.config.json`: where the backlog lives, which test suites exist, which test runner,
> the integration command, branch names. And `sdlc-helper add` will look at your project and propose that config for
> you.
>
> The key piece is test runner adapters. Every runner gets a small adapter that turns its output into one common
> result shape. The first release targets Node and TypeScript: Jest, Vitest, Mocha and node:test, plus a generic JUnit
> XML adapter so other languages can already plug in. Python, Go, Rust, Java, .NET, Ruby and PHP come after launch.
>
> The engine moves from bash to TypeScript, so it's unit-testable and runs on Windows without WSL. And end-to-end
> checks will run the whole pipeline on sample projects in CI, with the AI replaced by a recorded stub so CI needs no
> API key.

**SCREEN:** Backlog cards fly in: "stage input gate", "stop a stage and add input", "full-screen monitor",
"model per stage from the pane", "requirements viewer", "notes on accepted answers", "test framework registry",
"choose the base branch", "every DB or API change must bring integration tests".

> In this repo, the backlog has more: an opt-in gate where the pipeline waits for your input before each stage, stopping
> a stage and restarting it with new instructions in one action, a full-screen redesign of the monitor, choosing the
> model per stage from the pane, a test framework registry, a base-branch dropdown, and a gate that demands
> integration tests for every database or API change.

---

### 7. Join us (23:15 to 24:15)

**SCREEN:** `[R:CallToAction]` The repo URL, the MIT license badge, and a grid of "help wanted" tiles.

**VO:**
> This is open source, MIT licensed, and it's early. I've only just started turning the factory into a standalone
> library, and I'll keep posting progress here as it grows. Early is the best time to join, because the shape of the
> library is still being decided. Here's where help matters most:
>
> - **Test runner adapters.** If you know Vitest, Mocha, pytest or Go testing well, an adapter is a small, well-defined
>   piece of work.
> - **Try it on your project** and tell us where it breaks. Every unusual repo layout teaches the detection rules
>   something.
> - **Prompts.** Each station's prompt is a plain markdown file in `scripts/prompts/`. Better prompts mean fewer
>   question rounds and fewer failed attempts.
> - **The control pane.** UI ideas, the full-screen redesign, and testing it on other machines and other Claude Code
>   versions.
> - **Windows and CI.** Making it run everywhere.
> - **Docs and tutorials,** for the next fresh engineer who opens the repo.
>
> Pick a backlog item, open an issue, or just run the factory and tell us what you saw. Links are in the description.
> Subscribe if you want to follow along: the next videos will show the library taking shape, step by step.
> If you made it this far, you now know more about AI software factories than most people who talk about them.
> Thanks for watching, and see you in the pull requests.

**SCREEN:** End card: repo URL, "Subscribe", and two Shorts thumbnails ("AI can't grade its own homework",
"The AI that asks before it codes").

---

## Shorts

Each Short is vertical (1080 x 1920), 45 to 60 seconds, with burned-in captions. Structure: hook in the first two
seconds, three to four beats, one-line call to action. The end line for all of them: "Full video and the open-source
repo: link in the description."

### Short 1: "What is a software factory?" (55 s)
- **Hook (0 to 3 s):** "AI writes code fast. So why does most AI code still break?"
- **Beat 1:** "Because speed isn't the problem. Inspection is. A car factory doesn't trust its welders; it inspects every door."
- **Beat 2:** `[R:SDLCStations]` vertical. "A software factory is the same line for code: requirements, design, tests, code, review, release. AI agents work the stations."
- **Beat 3:** "Between every station, plain code checks the work. Not another AI. Code."
- **Payoff:** "The factory isn't the workers. It's the line and the inspections."
- **CTA.**

### Short 2: "AI can't grade its own homework" (50 s)
- **Hook:** "What stops an AI from just changing the test so it passes?"
- **Beat 1:** `[R:RedGreen]` "In our pipeline, tests are written first, and they must fail. If they pass before any code exists, the run stops."
- **Beat 2:** "Then they're committed. That commit hash is the lock."
- **Beat 3:** "After every coding attempt, the script diffs the test folder against that lock. One changed line: GUARD FAILED."
- **Payoff:** "Don't ask the AI to be honest. Make cheating detectable."
- **CTA.**

### Short 3: "The AI that asks before it codes" (55 s)
- **Hook:** "I gave an AI a deliberately vague bug report. It refused to guess."
- **Beat 1:** `[CAP]` the brief: "POST /users returns 500 when name is missing."
- **Beat 2:** "Instead of a spec, it wrote six questions. Is whitespace a valid name? What about the password field the old docs mention? Does auth run before validation?"
- **Beat 3:** `[CAP]` `v02-spec-questions-vertical.mp4`. "Each with a suggested answer. I pressed Use suggested, the pipeline continued, and those answers are saved so it never asks twice."
- **Payoff:** "A wrong guess costs more than a good question."
- **CTA.**

### Short 4: "When the AI says 'the test is wrong'" (60 s)
- **Hook:** "Sometimes the test really is wrong. So how do you let an AI fix it without letting it cheat?"
- **Beat 1:** `[R:Courtroom]` "The coding agent can't touch tests. It can only file a claim: which test, and which line of the spec proves it wrong. Three claims maximum."
- **Beat 2:** "A separate repair agent edits only those files. Then code checks: no fewer asserts, no weaker matchers, no skipped tests, no deleted tests."
- **Beat 3:** "The repaired test must still fail on the original empty code. Then an independent auditor, on a different model, must say exactly 'VERDICT: VALID'."
- **Payoff:** "If in any doubt: invalid. Tests go back to the lock."
- **CTA.**

### Short 5: "Why bash is the boss of my AI agents" (50 s)
- **Hook:** "My AI agents have a boss. It's 400 lines of bash."
- **Beat 1:** `[R:BossAndWorkers]` "Each agent gets one job, a short list of tools, and a turn limit. Then it's gone."
- **Beat 2:** "An AI orchestrator can be talked out of its rules. A bash if-statement can't."
- **Beat 3:** "Agents hand work to each other through files you can read: spec, plan, test cases, review."
- **Payoff:** "Agents propose. Gates dispose."
- **CTA.**

### Short 6: "Mission control inside Claude Code" (55 s)
- **Hook:** "This is mission control for AI agents, and it lives inside Claude Code."
- **Beat 1:** `[CAP]` `v01-select-and-run-vertical.mp4`. "One column per stage. Tick a backlog item, press Run selected, and watch the card jump into Spec with its agent, model and clock. Two run side by side."
- **Beat 2:** `[CAP]` `c04-pipeline-view.mp4`, cropped to the stage chips and agent. "Every stage, which model is on it, the running agent, files changed, live output."
- **Beat 3:** `[CAP]` `c07-accept-suggested.mp4`, then `c11-plan-allow-always.mp4`. "Questions from the spec agent? Answer here. An agent tried a command it wasn't allowed? Allow once, always, or deny."
- **Payoff:** "Stop, steer with a note, resume at any stage."
- **CTA.**

### Short 7: "Two features at once, zero conflicts" (45 s)
- **Hook:** "How do two AI pipelines edit the same repo at the same time without colliding?"
- **Beat 1:** `[R:Worktrees]` "Git worktrees: a second checkout of the same repo, in its own folder, on its own branch."
- **Beat 2:** "Each backlog item gets one. Your main folder is never touched."
- **Beat 3:** "Discard one? Its branch tip is saved first, with the command to bring it back."
- **CTA.**

### Short 8: "Bring your own model, keep your keys" (50 s)
- **Hook:** "Want Opus for planning and a cheaper model for coding? One variable."
- **Beat 1:** "Every station has its own model and effort. Defaults: Opus for Spec, Plan, Audit and Review; Sonnet for the hands-on work."
- **Beat 2:** "Point a station at any Anthropic-compatible gateway, such as LiteLLM or OpenRouter."
- **Beat 3:** "The registry stores the variable name, never the key. The key only exists inside the agent's own process, and your Anthropic key is blanked so it never reaches a third party."
- **CTA.**

### Short 9: "It won't commit your .env" (45 s)
- **Hook:** "The scariest thing an AI pipeline can do is git add dot."
- **Beat 1:** "Ours snapshots your work in progress before it starts, and only commits what it changed itself."
- **Beat 2:** "Secrets, editor config, generated files and anything over a megabyte are skipped, and listed so you can see why."
- **Beat 3:** "New keys in .env reach .env.example as 'change-me'. Never the real value."
- **CTA.**

### Short 10: "Help us build ai-sdlc-helper" (55 s)
- **Hook:** "We built an AI software factory for one project. Now we want it in yours."
- **Beat 1:** `[R:Roadmap]` "ai-sdlc-helper: an npm engine plus a Claude Code plugin, configured by one sdlc.config.json."
- **Beat 2:** "Jest, Vitest, Mocha and node:test first, plus JUnit XML for every other language."
- **Beat 3:** "Today it lives inside my warehouse-and-sales proof of concept and isn't reusable yet. I've just started pulling it out into a library, and later an app."
- **Beat 4:** "We need adapter authors, prompt tinkerers, UI people, Windows testers and brave early users. I'll post progress as it grows."
- **Payoff:** "MIT licensed. Pick an item, open an issue."
- **CTA.**

### Short 11: "From bug report to backlog in one command" (55 s)
- **Hook:** "I paste a raw server error. One command later, it's a ready-to-build backlog item."
- **Beat 1:** `[R:Triage]` "The /triage command splits the report into one item per problem, bug or feature, and checks the backlog for duplicates first."
- **Beat 2:** "It finds the real file and line with a code graph, confirms the cause, and settles everything the project's conventions already answer."
- **Beat 3:** "Out comes a brief with type, priority, scope, tests and decisions, plus one line in the backlog, P0 on top."
- **Payoff:** "It never commits on its own. It shows you the files and asks."
- **CTA.**

---

## Production notes

### Video description (main video)
> An open-source AI software factory built on Claude Code: backlog brief in, spec, plan, locked failing tests,
> implementation, review and a clean commit out, with safeguards that stop AI agents from editing their own tests,
> guessing requirements or committing secrets. MIT licensed. Contributions welcome.
>
> 0:00 The pitch · 0:50 What is a software factory · 3:30 The pattern and the intake · 8:30 What's unusual · 12:00 Safeguards ·
> 16:30 How to use it today · 21:30 Roadmap and ai-sdlc-helper · 23:15 Join us
>
> Repo: https://github.com/imaimai86/production-retail-and-wholesale

### Remotion scenes
The Remotion skills are installed in `.claude/skills/remotion-*` (from `remotion-dev/skills`, locked in
`skills-lock.json`). Start with `/remotion-create` to scaffold the project in its own folder outside `server/`, use
`remotion-markup` for animation, `remotion-captions` for the Shorts' burned-in captions, `remotion-studio` to preview
and `remotion-render` to export. Build each scene as a composition with props so 16:9 and 9:16 share code.

| Scene | Used in | Length at 30 fps | Content |
|---|---|---|---|
| `PitchHook` | Main 0, Short 1 | 20 s | Backlog line on a conveyor through seven stations; documents pop out; red lights turn green; branch slides out |
| `TitleCard` | Main 0 | 4 s | Title and subtitle |
| `FactoryAnalogy` | Main 1 | 15 s | Car factory: stations, conveyor, inspection, rejected-parts bin |
| `SDLCStations` | Main 1, Short 1 | 12 s | Requirements, Design, Tests, Implementation, Review, Release |
| `PipelineMap` | Main 2 | 20 s | `report -> /triage -> brief.md -> Spec -> Plan -> Red tests -> Implement (x4) -> [Test repair] -> Review -> Ship`, file names on arrows |
| `Triage` | Main 2e, Short 11 | 15 s | Messy reports arrive at a dock, are split into labelled crates (slug, type, priority), a "docs only" scrap drops aside, crates roll onto the backlog shelf |
| `BossAndWorkers` | Main 2a, Short 5 | 12 s | Grey `sdlc.sh` box waking one robot at a time |
| `FileHandOff` | Main 2b | 8 s | Documents passed robot to robot |
| `RedGreen` | Main 2c, Short 2 | 12 s | Red rows, lock with commit hash, rows turn green |
| `MakerChecker` | Main 2d | 10 s | Maker and checker pairs |
| `SectionCard` | Main 3, 4 | 3 s | Reusable section title |
| `Courtroom` | Main 3, Short 4 | 15 s | Claim, repair agent, five-check jury, auditor verdict |
| `Worktrees` | Main 3, Short 7 | 10 s | One repo, sibling worktree folders, separate branches |
| `SafeguardStack` | Main 4 | 40 s total | Nine shields with threat and mechanism labels; collapses to "agents propose, gates dispose" |
| `RepairChain` | Main 4 | 20 s | Seven links light up; a broken link restores the tests |
| `WhereItLives` | Main 5 | 15 s | Warehouse building `production-retail-and-wholesale` (stock, own shop, dealers, accounting) with the factory as a room inside; a dotted outline beside it for the standalone library, then the app |
| `Checklist` | Main 5 | 6 s | Prerequisites |
| `Roadmap` | Main 6, Short 10 | 15 s | Two lanes: repo backlog and ai-sdlc-helper |
| `CallToAction` | Main 7 | 15 s | Repo URL, MIT badge, help-wanted grid |

Style: dark background, one accent colour per role (red for failing, green for passing, amber for paused, grey for
the bash orchestrator), monospace for file names and commands, no stock footage. Real screen captures (`[CAP]`) are
recorded at 1440p with a large terminal font (at least 20 px) so they stay readable in the Shorts crop.

### Captures already cut
From six recordings, the first `1-explore-backlog-n-start-task.mov` (47 s, 3612 × 2058, no audio). Everything is cropped to the
pane: the weekly usage-limit warning (first 3 s) and the "bypass permissions on" status line below the pane stay out of
frame, which matters in a video about safeguards. Clips are H.264, 30 fps, no audio.

| File | Source time | What it shows | Used in |
|---|---|---|---|
| `s01-sdlc-button.png` | 0:02 | The **SDLC** and **CONFIG** buttons, "0 pending" | Main 5 step 3 |
| `s02-board-backlog.png` | 0:08 | The board: Backlog (20) and empty stage columns, "up to 2 at once", "2 slot(s) free" | Main 5 step 3 |
| `s03-ticket-brief.png` | 0:20 | Ticket view of `add-json-logging`: the brief with type, priority, source, problem, expected behaviour; **Start** | Main 2e, 5 step 1 |
| `s04-run-selected.png` | 0:26 | `[x] add-json-logging` ticked, **Run selected (1)** pressed | Main 5 step 3 |
| `s05-starting.png` | 0:31 | "Starting add-json-logging…" | Main 5 step 3 |
| `s06-started-in-spec.png` | 0:37 | Toast "Started 1, queued 0 (at most 2 run at once)." and the card in Spec: "spec-1 (opus · medium) · 00:03" | Main 5 step 3, Short 6 |
| `s07-pipeline-view.png` | 0:45 | Pipeline view: 0/6 stages, stage chips with models, agent spec-1 running, files 0 changed, recent output | Main 3 card 7, 5 step 3, Short 8 |
| `c01-open-board.mp4` | 0:02.6–0:09.5 | Pressing **SDLC** and the board loading | Main 5 step 3 |
| `c02-read-briefs.mp4` | 0:10–0:26, 1.6× | Opening three tickets | Main 2e, 5 step 1 |
| `c03-select-and-run.mp4` | 0:24–0:38.6 | Tick, Run selected, Starting, toast, card lands in Spec | Main 5 step 3 |
| `c04-pipeline-view.mp4` | 0:38.4–0:46.6 | Opening the running pipeline | Main 5 step 3, Short 6 |
| `c05-full-timelapse.mp4` | whole, 2.2× | The whole flow in 20 s | Cold open B-roll, end card |
| **Recording 2** `2-Spec-Dev-Qns.mp4` (52 s, 848 × 480) | | | |
| `s08-paused-questions.png` | 0:01 | Paused, "7 question(s) need answers", "0/7 questions answered", Q1 | Main 5 step 4 |
| `s09-accept-suggested.png` | 0:28 | Q1 "→ accept suggested", Q2 to Q5 below | Main 5 step 4 |
| `c06-paused-for-answers.mp4` | 0:00–0:05.6 | The paused run and the first question | Main 5 step 4 |
| `c07-accept-suggested.mp4` | 0:22–0:43, three cuts | **Use suggested** on Q1 to Q4 | Main 3 card 1, 5 step 4, Short 6 |
| `v02-spec-questions-vertical.mp4` | same cuts | 1080 × 1920, the question column | Short 3 |
| **Recording 3** `3-Permissions.mp4` (14 s, 832 × 464) | | | |
| `s10-refused-actions.png` | 0:00.5 | Spec agent refused 2 actions, the buttons, **Allow all** / **Deny all** | Main 4 safeguard 6 |
| `s11-allowed.png` | 0:11.5 | "Saving your answer…", "Allowed" | Main 4 safeguard 6 |
| `c08-allow-refused-actions.mp4` | 0:00–0:12.6 | **Allow all**, saving, allowed, answers recorded | Main 4 safeguard 6 |
| **Recording 4** `4-Spec.mp4` (17 s, 848 × 480) | | | |
| `c09-spec-allow-always.mp4` | whole | Spec agent refused `cat` / `grep`, **Allow always**, Spec restarts as spec-2 | Main 4 safeguard 6 |
| `s12-spec-restarted.png` | 0:15.5 | "add-json-logging running", agent spec-2 | Main 4 safeguard 6 |
| **Recording 5** `5-plan.mp4` (8 s, 832 × 480) | | | |
| `c10-plan-running.mp4` | whole | Spec ticked, Plan running 1/6, then the board with the card in Plan | Main 5 step 3 |
| `s13-plan-running.png` | 0:00.5 | Pipeline view, Plan agent running 00:18 | Main 5 step 3 |
| `s14-board-plan-column.png` | 0:07.5 | The board, card in the Plan column | Main 5 step 3, Short 6 |
| **Recording 6** `6-allow-permission-allo-always.mp4` (23 s, 832 × 480) | | | |
| `c11-plan-allow-always.mp4` | 0:00–0:18 | Plan agent refused 2 commands, **Allow always** on each, Plan restarts | Main 4 safeguard 6, Short 6 |
| `s15-plan-refused.png` | 0:04.5 | "The plan agent was refused 2 action(s)" with both commands | Main 4 safeguard 6 |
| `s16-one-more-to-decide.png` | 0:12 | Toast "Allowed: 1 more to decide" | Main 4 safeguard 6 |

Recordings 2 to 6 are low resolution (about 840 × 480), so their stills and clips are upscaled 2× and look soft;
small text will not read on a phone. Re-record those screens at the size of recording 1 before the final edit.
| `v01-select-and-run-vertical.mp4` | 0:24–0:38.6 | 1080 × 1920, Backlog and Spec columns, space above for a caption | Short 6 |

The ticket view of `add-json-logging` also shows "Discarded. To get the old branch back: git branch
sdlc/add-json-logging 365573f…", a real example of the discard safeguard (Main 4, safeguard 9).

### Screen captures still to record
1. `scripts/sdlc.sh`: the `agent()` function and the red gate and test-lock lines.
2. `Docs/backlog/fix-user-validation-v2/decisions.md`: Q1 to Q6.
3. `.claude/plugins/sdlc-guard/hooks/register.ts`: `refuse()` and `FAILED`.
4. A real run: `bash scripts/sdlc-mod.sh run <slug>` and `watch <slug>` in a split terminal.
5. The `sdlc-monitor` pane, the parts not recorded yet: **Submit answers and resume**, the run in Red tests and
   Implement (with an attempt number), Stop, Resume at a stage, the manual input box, Discard, and the CONFIG pane
   with **Test**. Also recordings 2 to 6 again at full resolution.
6. `git log --oneline` of a finished `sdlc/<slug>` branch.
7. `Docs/backlog/index.md` with the completed pipeline features.
8. A live `/triage` run on a throwaway report: the questions it asks, the result table, and the publish confirmation
   (choose "Do nothing" so no branch is created). Then `git show --stat a23b93f` for the real three-item run.

Use a throwaway backlog item for the live recording so the demo branch can be discarded afterwards.

### Fact-check table
Every claim the narration makes, and where it is true in the repo. Re-check before recording; the code moves.

| Claim | Source |
|---|---|
| Stations and order; one bash script runs them | `scripts/sdlc.sh` (Spec, Plan, Red tests, Implement, Test repair, Review, Commit/Ship sections) |
| Headless agents with allowed tools and a turn limit (default 40) | `scripts/sdlc.sh` `agent()`, `ALLOWED`, `MAX_TURNS` |
| Implement gets up to 4 attempts | `scripts/sdlc.sh` `MAX_ATTEMPTS` (default 4) |
| Red gate: new tests must fail | `scripts/sdlc.sh`, "RED GATE FAILED" |
| Tests committed as the lock; diff after each attempt and after Review | `scripts/sdlc.sh`, `test($SLUG): add failing tests`, "GUARD FAILED" |
| Zero-guessing Spec, `questions.md`, `decisions.md`, "accept" | `scripts/prompts/prompt-spec.md`, Spec section of `scripts/sdlc.sh` |
| Six questions on the vague brief | `Docs/backlog/fix-user-validation-v2/decisions.md` |
| Tests must run real code, never docs | `scripts/prompts/prompt-plan.md`, `prompt-red-tests.md`, `prompt-review.md`, `CLAUDE.md` |
| Test repair chain: flaky retry, pre-check (max 3 claims), source hash, diff check, name check, red check, audit | `scripts/sdlc.sh` Test repair section, `scripts/sdlc-testcheck.cjs`, `MAX_REPAIR_TESTS` (default 3) |
| Auditor is read-only, different default model, "If in any doubt, INVALID" | `scripts/prompts/prompt-test-audit.md`, `stage_defaults()` (test-audit opus, test-repair sonnet), audit runs with `Read Glob Grep` only |
| Default models per stage | `stage_defaults()` in `scripts/sdlc.sh` |
| Providers, registry stores variable name, key only in subshell, Anthropic key blanked, https or localhost http | `scripts/sdlc.sh` `resolve_provider`, `apply_provider_env`; `README.md` "Custom models and providers" |
| Stage guard rules, Bash write patterns, prerequisite docs, fails closed | `.claude/plugins/sdlc-guard/hooks/register.ts` |
| Worktrees at `../<repo>-sdlc/<slug>`, at most 2 in parallel | `scripts/sdlc-mod.sh`, `SDLC_MAX_PARALLEL` (default 2) |
| Discard saves the branch tip | `README.md` "Interactive SDLC", `scripts/sdlc-mod.sh` discard |
| Integration suite on real Postgres, local or Docker, `prw_test_*` databases, remote DB opt-in | `scripts/sdlc-integration.sh`, `README.md` "SDLC pipeline: integration tests" |
| Refused actions: Allow this run, Allow always, Deny | `scripts/sdlc-permissions.cjs`, `README.md` "Refused actions" |
| Ship baseline, skipped files, `.env.example` with `change-me` | `scripts/sdlc-ship.sh`, `scripts/sdlc-changes.cjs`, `README.md` "what the Ship stage commits" |
| Monitor pane features | `.claude/plugins/sdlc-monitor/hooks/register.tsx`, `README.md` "Control pane" |
| Never merge without asking | `CLAUDE.md` "Merging pull requests" |
| Pipeline features built through the pipeline | `Docs/backlog/index.md` (`[x]` items), `git log` (`test(<slug>)` / `feat(<slug>)` commits) |
| Three deprecated runners | `scripts/DEPRECATED-sdlc-run*.sh` |
| ai-sdlc-helper: npm engine plus plugin, `sdlc.config.json`, adapters, first release Node/TS plus generic JUnit, TypeScript port, recorded-stub CI | `Docs/sdlc-helper-plan.md` |
| Roadmap items | `Docs/backlog/index.md` (`[ ]` items) |
| `/triage`: split, duplicates check, graft grounding, decide by conventions, at most 4 questions per round, brief shape, P0/P1 on top, no secrets, no docs-only items, no source code, publishes to `triage/<slug>` only after an explicit yes | `.claude/commands/triage.md` |
| One triage run produced three dependent backlog items | commit `a23b93f`, merged in pull request #82 (`triage/add-test-framework-registry-and-2-more`) |
| MIT license | `LICENSE` |
| Today the factory is wired to this one project and not reusable elsewhere | `Docs/sdlc-helper-plan.md` section 4 (hard-coded `npm test`, `server/__tests__`, Jest JSON, paths) |
| The host project is a warehouse, own-shop, dealer sales and accounting proof of concept | `CLAUDE.md` "Implementation plan", `README.md` |
