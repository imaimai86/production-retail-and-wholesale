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
>
> Here's the red gate on a real run. The tests agent wrote a test matrix and four test files. The suite comes back:
> 181 of 197 passing, 16 failing. Sixteen new tests fail because the feature doesn't exist yet. That's the point. And
> notice the files line: a moment ago it said 8 uncommitted, now it says 0. The pipeline has just committed the tests.
> They're locked.

**SCREEN:** `[CAP]` `c16-red-gate-failing.mp4` (8 s): the Red tests stage with "Red tests (5)" listing
`test-cases-1.md` and four test files, then "Tests 181/197 passing · 16 failing" in red and "8 changed since base ·
0 uncommitted". Freeze on `s20-red-gate-16-failing.png`, and contrast it with `s18-red-tests-running.png`, where the
same line still says "8 uncommitted".

> Then the Implement agent goes to work. Attempt one, attempt two. By attempt three, 237 of 238 tests pass: from 16
> failing down to one. And it never touched a test to get there.

**SCREEN:** `[CAP]` `c17-implement-attempts.mp4` (11 s): Spec, Plan and Red tests ticked, Implement running, "3/6
stages", the agent `impl-2` on "attempt 2/4", then `impl-3` on "attempt 3/4" and "Tests 237/238 passing · 1 failing".
Freeze on `s23-one-failing.png`.

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

> And here's one I recorded start to finish. I typed one line: "POST /sales currently trusts the price and GST sent by
> the client". Triage read the backlog and the bug list, found the sales route with graft, and confirmed it: the route
> checks the product, location, quantity and status, then stores whatever price, discount and GST the client sent. Then
> it asked me four questions it couldn't answer from the code. Retail or wholesale price? What if a client still sends
> a price? What about a product with no GST category? And discounts, with no user roles yet? On one of them I typed my
> own answer: the app isn't live yet, so make it GST zero and change the schema directly. It turned my answers into a
> table of decisions, wrote the brief as a P0 bug, put it at the top of the backlog, and only after I said yes, pushed it
> to a `triage/` branch and opened a pull request.

**SCREEN:** `[CAP]` `c29-triage-explores.mp4` (12 s, 4× speed): `/triage POST /sales currently trusts the price and gst
sent by the client`, then "Reading backlog index, bugs list, and locating sales handler", the graft and shell commands,
and "Confirmed: POST /sales only validates product_id, location, quantity, and status…" (`s44-triage-confirmed.png`).
Then `c30-triage-questions.mp4` (26 s): the four question tabs, Price tier, Client price, No category, Discount, each
with a recommended answer (`s45`, `s46`, `s47`); `c31-triage-own-answer.mp4` (18 s): typing "Make default zero, since
the app is not yet live" (`s48-triage-q-type-own.png`) and the discount question (`s49`). Then
`c32-triage-publish-pr.mp4` (36 s, 2× speed): Submit answers, the decisions table (`s51-triage-decisions.png`),
"Published", and the pull request "docs(backlog): triage derive-sale-price-gst"
([imaimai86/production-retail-and-wholesale#103](https://github.com/imaimai86/production-retail-and-wholesale/pull/103))
with its two files (`s53-triage-pr.png`).

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
>
> On our run, it happened. With one test left failing, the Implement agent filed this claim: a test still expects
> `console.error` to be called, but the spec and the plan replace `console.error` with a structured logger. The status
> and body checks still pass; only that one assertion contradicts the plan. That's not "the test is hard". That's "the
> test is out of date, and here's the line of the plan that proves it".

**SCREEN:** `[CAP]` `c23-show-claim.mp4` (3 s): **Show claim** on the finished run opens "Test repair claim
(Docs/backlog/add-json-logging/test-issues.md, written by the Implement agent)". Freeze on `s33-repair-claim.png` and
highlight "plan-1.md Step 4 and specs-1.md replace `console.error(err)` … with a structured logger entry".

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
>
> On the real run, the chain caught something on the first try. The Implement agent's first claim didn't cite the spec
> or a decision, so the pre-check rejected it before any agent ran: "claim gives no spec/decision/isolation
> justification", "TEST REPAIR REJECTED", and the tests were restored to the locked commit. The run stopped at Test
> repair with a red cross, and told me exactly how to resume once the claim was fixed.

**SCREEN:** `[CAP]` `c25-test-repair-rejected.mp4` (6 s): "add-json-logging failed at Test repair", the Test repair box
with a red ✗, and **Why it failed** listing "REJECT: claim gives no spec/decision/isolation justification", "TEST REPAIR
REJECTED: claims fail pre-check", "tests restored to 6efb554…" and "Resume at Test repair once fixed:
FROM=test-repair ./scripts/sdlc.sh add-json-logging". Freeze on `s36-why-it-failed.png`.

> The claim was rewritten to quote the plan and the spec, the one we saw a minute ago, and the run resumed at Test
> repair. This time Test repair ran as its own stage between Implement and Review, with two models on it: the repair
> agent on Sonnet and the auditor on Opus. When it finished, the log said "test repair accepted; tests locked again",
> with the new commit hash, and the suite read 238 of 238.

**SCREEN:** `[CAP]` `c18-test-repair.mp4` (10 s): the Test repair box, "repair sonnet · medium / audit opus · medium",
"4/7 stages", and the output "4b Test repair (only because the Implement agent claimed test defects)". Then
`s27-tests-238-passing.png`: "Tests 238/238 passing" and "test repair accepted; tests locked again at 3d9d92a".

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
>
> My favourite: the Review agent wrote its own little probe, a broken JSON body with a password in it and a script
> called `leak.js` run against the server, by the look of it to check that a password can't leak into the logs. And
> the pipeline still stopped and asked before running it.

**SCREEN:** `[CAP]` `s11-spec-refused-actions.png`: "The spec agent was refused 2 action(s). Allow or deny each; the stage
restarts when none is left.", each command with **Allow this run (Bash(cd:\*))**, **Allow always**, **Deny**, and
**Allow all** / **Deny all** below. Then `c13-plan-allow-always.mp4` (18 s): the Plan agent's two refused commands,
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
>
> On our run, Ship committed 15 files and skipped two: both under `.claude/`, marked "local or agent configuration".

**SCREEN:** `[CAP]` `s32-ship-skipped.png`: "6/6 Commit", "Skipped: .claude/plugins/sdlc-monitor/hooks/register.test.ts:
local or agent configuration", "Committed 15 file(s), skipped 2", "Review with: git log --oneline 3d9d92a…HEAD ; then
open a PR."

**9. Nothing is lost by accident, and nothing merges by accident.**
> Threat: a "discard" that throws away a day of work, or a bot that merges to main. Mechanism: before `discard` or
> `restart` deletes a branch, the branch tip is saved, and the command to bring it back is printed. And the house rules
> for the orchestrating Claude session say: never merge a pull request without asking the human first, with an explicit
> Merge or Do not merge choice. A green CI run is not a yes.

**SCREEN:** `[CAP]` `s38-confirm-discard-zoom.png`: "the branch tip is saved so it can be recovered".

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

**SCREEN:** `[R:CommandCard]` (an animated text card, not a screen capture):
```bash
git clone https://github.com/imaimai86/production-retail-and-wholesale
cd production-retail-and-wholesale
npm install -g @nanonets/graft
graft build
./install.sh
```

> Clone the repo, install graft, build the graph, and run `install.sh` to install dependencies.

**Step 1: describe the work.**

**SCREEN:** `[CAP]` `s42-triage-command.png`: Claude Code with `/triage POST /sales currently trusts the price and gst
sent by the client`. Then `s52-triage-published.png`: the brief committed and pushed to `triage/derive-sale-price-gst`.

> Every job starts as a backlog item: a line in `Docs/backlog/index.md` and a short `brief.md`. You can write them by
> hand, but the easy way is the intake dock we saw earlier: paste the bug report into `/triage`. It splits it, checks
> for duplicates, finds the real files with graft, asks you only what the code can't answer, and writes the brief and
> the backlog line. It ends with a table of the items it made and the command to run each one, and offers to publish
> them to a `triage/<slug>` branch once you say yes. To see what's waiting, run `/backlog-list pending`.

**Step 2: start a run.**

**SCREEN:** `[R:CommandCard]`:
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

**SCREEN:** `[CAP]` `c12-plan-running.mp4` (8 s): later in the same run, Spec has a tick, the Plan chip is lit,
"1/6 stages", the agent "plan opus · medium running 00:10"; back on the board the card now sits in the Plan column.
Freeze on `s15-board-plan-column.png`. Then `c15-board-red-tests.mp4` (5 s): one column further, the card in Red tests,
"tests (sonnet · medium)". Then `c20-review-allow-all.mp4` (12 s): in Review, "Tests 238/238 passing", the Review agent
refused 3 commands, **Allow all**, and Review starting again; and `c24-board-done.mp4` (5 s): the board, the card in
the Done column, "done · 29 files changed".

**Step 4: answer the questions.**

**SCREEN:** `[CAP]` `c09-spec-questions-cut.mp4` (19 s), or its three parts: `c06-paused-for-answers.mp4` (6 s), the
card turns amber, "needs answers: 7 questions", the toast "add-json-logging is paused: 7 question(s) need answers", and
"0/7 questions answered" above Q1; `c07-type-own-answer.mp4` (6 s), "My custom an…" typed into Q1's box and cleared;
`c08-accept-suggested.mp4` (8 s, four cuts), **Use suggested** on Q1 to Q4, each turning into "→ accept suggested".
Freeze on `s10-accept-suggested.png`.

> When the Spec agent has questions, the run pauses and the card turns amber. On this run it had seven: should an
> error reaching the handler be logged once or twice, how to log a thrown value that isn't an Error, whether to trust
> an incoming `X-Request-Id`, what happens when the client hangs up before the response finishes. Each one says why it
> matters and gives a suggested answer. Press **Use suggested**, or type your own answer and press Enter, then
> **Submit answers and resume**. Your answers are saved in `decisions.md`, so the agent never asks them again. If you
> work from the terminal, you fill the `**Answer:**` lines in `questions.md` and run the same command again.

**Step 5: steer, stop, resume.**

> When a run fails, the pane tells you why and offers to resume it, for example **Resume from Implement**, so it picks up
> from the last good stage instead of starting over. From the terminal it's `FROM=implement` before the command. And
> **Discard** throws the attempt away and lets you start fresh, after a second confirmation, with the old branch
> recoverable.
>
> What's not there yet: stopping a stage halfway and giving it a note before it restarts. That's on the backlog, and
> it's one of the first things the standalone library will do properly.

**SCREEN:** `[CAP]` `s35-test-repair-rejected.png`: a failed run offers **Resume from Implement** at the top. Then
`c26-discard-keep-it.mp4` (7 s): **Discard** turns into **Confirm discard** / **Keep it** with the warning "This
deletes the worktree and branch sdlc/add-json-logging (unpushed work is lost; the branch tip is saved so it can be
recovered). A running pipeline is stopped first.", then **Keep it**. Freeze on `s38-confirm-discard-zoom.png`. And when
you do mean it: `c27-confirm-discard.mp4` (10 s), **Confirm discard**, "Discarding add-json-logging (stopping it and
deleting its worktree)…", "Discarded add-json-logging."; then `c28-board-after-discard.mp4` (8 s), the card leaves the
Done column.

**Step 6: configure models.**

**SCREEN:** `[CAP]` `c33-config-add-provider.mp4` (20 s, 3× speed): the **CONFIG** pane with one provider, `openrouter`,
"OPENROUTER_API_KEY key set" (`s54-config-providers.png`); **Add provider** opens the form (`s55`): provider name,
endpoint, "API key variable NAME (not the key)", models, the effort flag; "Test Provider" is refused with "provider
name: must match ^[a-z0-9][a-z0-9-]*$" (`s56-config-name-rejected.png`); then "added test-provider (1 models)" with
"NEW_ENV key NOT set" (`s57-config-added-key-not-set.png`). Then `c34-config-edit-remove.mp4` (18 s, 1.5×): **Edit**
(`s58`), **Remove**, **Confirm remove** / **Keep it** (`s59`), "removed test-provider" (`s60`).

> The **CONFIG** button opens the model registry. Each provider shows its endpoint, the name of the variable that holds
> its key, and whether that variable is set in your environment. Add one: a name, an endpoint, the key variable's
> name, never the key itself, and its models. Watch the name check: "Test Provider" is refused, because a provider name
> has to be lowercase letters, digits and dashes. Saved, it says "key NOT set" until you export that variable. Edit and
> remove work the same way, with a confirmation before anything is deleted. Then pick models per stage, for example
> `MODEL_IMPLEMENT=opus EFFORT_IMPLEMENT=high`.

**Step 7: review the result.**

**SCREEN:** `[CAP]` `c22-done-and-ship.mp4` (7 s): "add-json-logging done", "7/7 stages", every box ticked including
Test repair, Review and Commit, then the Ship output ending "Review with: git log --oneline 3d9d92a…HEAD ; then open a
PR." Freeze on `s31-run-done.png`. Then `[R:CodeCard]`: `git log --oneline` of a finished `sdlc/<slug>` branch.

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
> a stage and restarting it with your own note in one action (the standalone library will have both), a full-screen redesign of the monitor, choosing the
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
- **Beat 2:** `[CAP]` `c16-red-gate-failing.mp4`. "Here's a real run: 16 new tests failing, because the feature doesn't exist yet. Then they're committed. That commit hash is the lock."
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
- **Beat 1:** `[R:Courtroom]`, then `c23-show-claim.mp4`. "The coding agent can't touch tests. It can only file a claim: which test, and which line of the spec proves it wrong. Three claims maximum."
- **Beat 2:** "A separate repair agent edits only those files. Then code checks: no fewer asserts, no weaker matchers, no skipped tests, no deleted tests."
- **Beat 3:** "The repaired test must still fail on the original empty code. Then an independent auditor, on a different model, must say exactly 'VERDICT: VALID'."
- **Payoff:** `[CAP]` `c18-test-repair.mp4`. "If in any doubt: invalid. Tests go back to the lock. On my run: accepted, and 238 of 238."
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
- **Beat 3:** `[CAP]` `c08-accept-suggested.mp4`, then `c13-plan-allow-always.mp4`. "Questions from the spec agent? Answer here. An agent tried a command it wasn't allowed? Allow once, always, or deny."
- **Payoff:** `[CAP]` `c24-board-done.mp4`. "And at the end, the card lands in Done. Every stage visible, every refused command yours to decide."
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
- **Beat 2:** `[CAP]` `c33-config-add-provider.mp4`. "Point a station at any Anthropic-compatible gateway, such as LiteLLM or OpenRouter, from the CONFIG pane."
- **Beat 3:** `[CAP]` `s57-config-added-key-not-set.png`. "The registry stores the variable name, never the key. The key only exists inside the agent's own process, and your Anthropic key is blanked so it never reaches a third party."
- **CTA.**

### Short 9: "It won't commit your .env" (45 s)
- **Hook:** "The scariest thing an AI pipeline can do is git add dot."
- **Beat 1:** "Ours snapshots your work in progress before it starts, and only commits what it changed itself."
- **Beat 2:** `[CAP]` `s32-ship-skipped.png`. "Secrets, editor config, generated files and anything over a megabyte are skipped, and listed so you can see why. On my run: 15 committed, 2 skipped."
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
- **Hook:** "I type one line about a bug. One command later, it's a ready-to-build backlog item."
- **Beat 1:** `[R:Triage]`, then `c29-triage-explores.mp4`. "The /triage command splits the report into one item per problem, bug or feature, and checks the backlog for duplicates first."
- **Beat 2:** `[CAP]` `c30-triage-questions.mp4`. "It finds the real file and line with a code graph, confirms the cause, asks only the four questions the code can't answer, and settles everything the project's conventions already answer."
- **Beat 3:** "Out comes a brief with type, priority, scope, tests and decisions, plus one line in the backlog, P0 on top."
- **Payoff:** `[CAP]` `s53-triage-pr.png`. "It never commits on its own. It shows you the files and asks. Then it opens the pull request."
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
| `CommandCard` | Main 5 steps 0 and 2 | 6 s each | Commands typed out line by line in a terminal-styled card |
| `CodeCard` | Main 2a, 2c, 3, 4, 5 step 7 | 6–10 s each | A file excerpt or git output from the repo, with the key lines highlighted |

Style: dark background, one accent colour per role (red for failing, green for passing, amber for paused, grey for
the bash orchestrator), monospace for file names and commands, no stock footage. Real screen captures (`[CAP]`) are
recorded at 1440p with a large terminal font (at least 20 px) so they stay readable in the Shorts crop.

### Captures already cut
From the recordings of the pane, the first `1-explore-backlog-n-start-task.mov` (47 s, 3612 × 2058, no audio). Everything is cropped to the
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
| `v01-select-and-run-vertical.mp4` | 0:24–0:38.6 | 1080 × 1920, Backlog and Spec columns, space above for a caption | Short 6 |
| **Recordings 2.1 and 2.2** `2.1-Spec-Dev-Qns.mov` (26 s) and `2.2-Spec-Dev-Qns.mov` (28 s), 3612 × 2058 | | | |
| `s08-paused-questions.png` | 2.1 at 0:01 | Paused, "7 question(s) need answers", "0/7 questions answered", Q1 | Main 5 step 4 |
| `s09-type-own-answer.png` | 2.1 at 0:16 | "My custom an…" typed into Q1's answer box | Main 5 step 4 |
| `s10-accept-suggested.png` | 2.1 at 0:25 | Q1 "→ accept suggested", Q2 to Q4 below | Main 5 step 4 |
| `c06-paused-for-answers.mp4` | 2.1 at 0:00–0:05.5 | The paused run, scrolling to the first question | Main 5 step 4 |
| `c07-type-own-answer.mp4` | 2.1 at 0:12.5–0:18.5 | Typing your own answer, then clearing it | Main 5 step 4 |
| `c08-accept-suggested.mp4` | 2.1 at 0:22; 2.2 at 0:08, 0:17, 0:27 | **Use suggested** on Q1 to Q4, four cuts | Main 3 card 1, 5 step 4, Short 6 |
| `c09-spec-questions-cut.mp4` | c06 + c07 + c08 | The whole question flow in 19 s | Main 5 step 4 |
| `v02-spec-questions-vertical.mp4` | same as c09 | 1080 × 1920, the left part of the question column (lines run off the right edge; caption over it) | Short 3 |
| **Recording 3** `3-Permissions.mov` (14 s, 3524 × 1970) | | | |
| `s11-spec-refused-actions.png` | 0:00.5 | Spec agent refused 2 actions, the buttons, **Allow all** / **Deny all** | Main 4 safeguard 6 |
| `s12-allowed.png` | 0:11.5 | "Saving your answer…", "Allowed" | Main 4 safeguard 6 |
| `c10-allow-all.mp4` | 0:00–0:12.6 | **Allow all**, saving, allowed | Main 4 safeguard 6 |
| **Recording 4** `4-Spec.mov` (17 s, 3612 × 2058) | | | |
| `c11-spec-allow-always.mp4` | whole | Spec agent refused `cat` / `grep`, **Allow always**, Spec restarts as spec-2 | Main 4 safeguard 6 |
| `s13-spec-restarted.png` | 0:15.5 | "add-json-logging running", agent spec-2 | Main 4 safeguard 6 |
| **Recording 5** `5-plan.mov` (8 s, 3612 × 2058) | | | |
| `c12-plan-running.mp4` | whole | Spec ticked, Plan running 1/6, then the board with the card in Plan | Main 5 step 3 |
| `s14-plan-running.png` | 0:00.5 | Pipeline view, Plan agent running 00:10 | Main 5 step 3 |
| `s15-board-plan-column.png` | 0:07.5 | The board, card in the Plan column | Main 5 step 3, Short 6 |
| **Recording 6** `6-allow-permission-allo-always.mov` (23 s, 3612 × 2058) | | | |
| `c13-plan-allow-always.mp4` | 0:00–0:18 | Plan agent refused 2 commands, **Allow always** on each, Plan restarts | Main 4 safeguard 6, Short 6 |
| `s16-plan-refused.png` | 0:04.5 | "The plan agent was refused 2 action(s)" with both commands | Main 4 safeguard 6 |
| `s17-one-more-to-decide.png` | 0:12 | Toast "Allowed: 1 more to decide" | Main 4 safeguard 6 |
| **Recording 7** `red-tests.mov` (35 s, 3612 × 2058; cropped from x 565 so the side panel with another session's transcript stays out) | | | |
| `s18-red-tests-running.png` | 0:01 | Spec and Plan ticked, Red tests running, 5 files under Red tests, agent tests 02:31, "8 uncommitted" | Main 2c |
| `s19-board-red-tests-column.png` | 0:20 | The board, card in the Red tests column | Main 5 step 3 |
| `s20-red-gate-16-failing.png` | 0:30 | "Tests 181/197 passing · 16 failing", "0 uncommitted", "3/6 Red tests (red gate)" in the output | Main 2c, Short 2 |
| `c14-red-tests-running.mp4` | 0:00–0:04 | The Red tests stage running | Main 2c |
| `c15-board-red-tests.mp4` | 0:18.5–0:23.6 | Card in the Red tests column | Main 5 step 3 |
| `c16-red-gate-failing.mp4` | 0:23.8–0:31.5 | The 16 failing tests appear and the run scrolls to the red gate output | Main 2c, Short 2 |
| **Recording 8** `Implement-2.mov` (20 s, 1920 × 1092; cropped to the pane, below a stale "paused: 0 question(s)" banner) | | | |
| `s21-implement-running.png` | 0:00.5 | Implement running, 3/6 stages, card "impl-2 … 04:44" | Main 2c |
| `s22-attempt-2-of-4.png` | 0:04 | Agent impl-2, "attempt 2/4", Implement (8) files | Main 2c |
| `s23-one-failing.png` | 0:13 | Agent impl-3, "attempt 3/4", "Tests 237/238 passing · 1 failing" | Main 2c |
| `c17-implement-attempts.mp4` | 0:00–0:17.5, four cuts | Attempt 2 to attempt 3, down to one failing test | Main 2c |
| **Recording 9** `test-repair.mov` (10 s, 3612 × 2058; cropped from x 545) | | | |
| `s24-test-repair-stage.png` | 0:00.5 | Test repair box, "repair sonnet · medium / audit opus · medium", 4/7 stages | Main 4 safeguard 4 |
| `s25-test-repair-output.png` | 0:09.8 | "4b Test repair (only because the Implement agent claimed test defects)" | Main 4 safeguard 4 |
| `c18-test-repair.mp4` | whole | The Test repair stage running | Main 4 safeguard 4, Short 4 |
| **Recording 10** `Review-permission.mov` (26 s, 3612 × 2058; cropped from x 860, then x 1125 when the side panel widens) | | | |
| `s26-review-running.png` | 0:01 | Review running, 5/7, Test repair ticked with **Show claim** | Main 5 step 3 |
| `s27-tests-238-passing.png` | 0:05 | "Tests 238/238 passing", review agent refused 3 actions, "test repair accepted; tests locked again at 3d9d92a" | Main 4 safeguards 4 and 6 |
| `s28-review-refused.png` | 0:09.5 | The three refused commands, **Allow all** | Main 4 safeguard 6 |
| `s29-review-restarted.png` | 0:19.5 | "Allowed", Review running again | Main 4 safeguard 6 |
| `s30-board-review-column.png` | 0:23 | The board, card in the Review column, Done column next to it | Main 5 step 3 |
| `c19-review-tests-green.mp4` | 0:00–0:06.5 | Review running, scroll to 238/238 | Main 2c, 5 step 3 |
| `c20-review-allow-all.mp4` | 0:08.5–0:20.5 | **Allow all** on the Review agent's commands, Review restarts | Main 4 safeguard 6, 5 step 3 |
| `c21-board-review.mp4` | 0:21.9–0:25.5 | Card in the Review column | Main 5 step 3 |
| **Recording 11** `Show-repair-claim-Done.mov` (29 s, 2888 × 1470, audio dropped) | | | |
| `s31-run-done.png` | 0:00.3 | "done", 7/7 stages, every box ticked | Main 5 step 7, end card |
| `s32-ship-skipped.png` | 0:05 | Commit files, "238/238 passing", Ship output with the two skipped `.claude/` files | Main 4 safeguard 8, Short 9 |
| `s33-repair-claim.png` | 0:11 | The Implement agent's Test repair claim, expanded | Main 3 card 3, Short 4 |
| `s34-board-done.png` | 0:20 | The board, card in the Done column | Main 5 step 3, Short 6 |
| `c22-done-and-ship.mp4` | 0:00–0:06.6 | The finished run and the Ship output | Main 5 step 7 |
| `c23-show-claim.mp4` | 0:09.5–0:12.5 | **Show claim** opening the claim | Main 3 card 3, Short 4 |
| `c24-board-done.mp4` | 0:16–0:21 | The board scrolling to the Done column | Main 5 step 3, Short 6 |
| **Recording 12** `Resume_from_implement.mov` (20 s, 3612 × 2058; cropped from x 545, audio dropped; the pane does not change) | | | |
| `s35-test-repair-rejected.png` | 0:03 | Failed at Test repair, red ✗, **Resume from Implement** | Main 4 safeguard 4, 5 step 5 |
| `s36-why-it-failed.png` | 0:03 | Zoom on **Why it failed**: the pre-check rejection and the resume command | Main 4 safeguard 4 |
| `c25-test-repair-rejected.mp4` | 0:00–0:06 | The rejected repair, held | Main 4 safeguard 4 |
| **Recording 13** `Discard-ConfirmDiscard-KeepIt` (12 s, 2888 × 1470, audio dropped) | | | |
| `s37-confirm-discard.png` | 0:04 | **Confirm discard** / **Keep it** and the warning | Main 5 step 5 |
| `s38-confirm-discard-zoom.png` | 0:04 | Zoom on the warning: "the branch tip is saved so it can be recovered" | Main 4 safeguard 9, 5 step 5 |
| `c26-discard-keep-it.mp4` | 0:00.8–0:08.2 | Discard, the confirmation, **Keep it** | Main 5 step 5 |
| **Recording 14** `Discard` (34 s, 2888 × 1470, audio dropped; the last 12 s browse the backlog and are not used) | | | |
| `s39-discarding.png` | 0:06 | "Discarding add-json-logging (stopping it and deleting its worktree)…" | Main 5 step 5 |
| `s40-discarded.png` | 0:10 | "Discarded add-json-logging." | Main 5 step 5 |
| `s41-board-after-discard.png` | 0:19.5 | The board, Done column empty | Main 5 step 5 |
| `c27-confirm-discard.mp4` | 0:01.5–0:11 | **Confirm discard** to "Discarded" | Main 5 step 5 |
| `c28-board-after-discard.mp4` | 0:13–0:21 | The card leaves the Done column | Main 5 step 5 |
| **Recordings 15 to 17** `triage-1.mov` (2:23), `triage-1.2.mov` (1:09), both 3372 × 1550, and `triage-1.5.mov` (1:12, only 640 × 296); audio dropped | | | |
| `s42-triage-command.png` | 1 at 0:03 | The `/triage` command | Main 5 step 1 |
| `s43-triage-exploring.png` | 1 at 0:20 | "Listing server files, checking related briefs, skeleton sales route" | Main 2e |
| `s44-triage-confirmed.png` | 1 at 0:52 | "Confirmed: POST /sales only validates…" | Main 2e |
| `s45-triage-q-price-tier.png` | 1 at 1:02 | Question 1, Price tier, with three options | Main 2e |
| `s46-triage-q-client-price.png` | 1 at 1:46 | Question 2, client sends price or GST | Main 2e |
| `s47-triage-q-no-category.png` | 1 at 2:10 | Question 3, product with no GST category | Main 2e |
| `s48-triage-q-type-own.png` | 2 at 0:20 | Typing an own answer to question 3 | Main 2e |
| `s49-triage-q-discount.png` | 2 at 0:55 | Question 4, discount | Main 2e |
| `s50-triage-submit.png` | 3 at 0:06 | Review your answers, Submit (low resolution) | Main 2e |
| `s51-triage-decisions.png` | 3 at 0:35 | The decisions table (low resolution) | Main 2e |
| `s52-triage-published.png` | 3 at 0:45 | Committed and pushed to `triage/derive-sale-price-gst` (low resolution) | Main 5 step 1 |
| `s53-triage-pr.png` | 3 at 0:58 | Pull request #103 (low resolution; browser bookmarks bar cropped off) | Main 2e, Short 11 |
| `c29-triage-explores.mp4` | 1 at 0:00–0:48.5, 4× | Command to "Confirmed" | Main 2e, Short 11 |
| `c30-triage-questions.mp4` | 1, five cuts | Confirmed and questions 1 to 3 | Main 2e, Short 11 |
| `c31-triage-own-answer.mp4` | 2, three cuts | Typing an own answer, question 4 | Main 2e |
| `c32-triage-publish-pr.mp4` | 3, whole, 2× | Submit, decisions, published, the pull request | Main 2e |
| **Recording 18** `CONFIG pane` (1:33, 3372 × 1550; cropped from x 508 so the transcript beside it stays out; audio dropped) | | | |
| `s54-config-providers.png` | 0:04 | One provider, `openrouter`, "OPENROUTER_API_KEY key set" | Main 5 step 6, Short 8 |
| `s55-config-add-form.png` | 0:08 | The empty Add provider form | Main 5 step 6 |
| `s56-config-name-rejected.png` | 0:51 | "provider name: must match ^[a-z0-9][a-z0-9-]*$" | Main 5 step 6 |
| `s57-config-added-key-not-set.png` | 1:09.5 | "added test-provider (1 models)", "NEW_ENV key NOT set" | Main 5 step 6, Short 8, safeguard 7 |
| `s58-config-edit.png` | 1:15 | The Edit form | Main 5 step 6 |
| `s59-config-confirm-remove.png` | 1:28 | **Confirm remove** / **Keep it** | Main 5 step 6 |
| `s60-config-removed.png` | 1:32 | "removed test-provider" | Main 5 step 6 |
| `c33-config-add-provider.mp4` | 0:01.5–1:02, 3× | Add provider, name refused, saved | Main 5 step 6, Short 8 |
| `c34-config-edit-remove.mp4` | 1:06–1:33, 1.5× | Edit, remove, confirm | Main 5 step 6 |

Recording 17 (`triage-1.5.mov`) is 640 × 296: its stills and `c32` are upscaled 3× and soft. Re-record that part at the
size of the other two if it will be on screen for long.

Left out on purpose: the end of recording 3, where the pane briefly says "Paused, but questions.md has no questions I
can read" after **Allow all**, and the long stretches of scrolling with no clicks in recordings 2.1 and 2.2.

The ticket view of `add-json-logging` also shows "Discarded. To get the old branch back: git branch
sdlc/add-json-logging 365573f…", a real example of the discard safeguard (Main 4, safeguard 9).

### Code and git cards (`[R:CodeCard]`, made from the repo, no recording needed)
1. `scripts/sdlc.sh`: the `agent()` function and the red gate and test-lock lines (Main 2a, 2c).
2. `Docs/backlog/fix-user-validation-v2/decisions.md`: Q1 to Q6 (Main 3 card 1, Short 3).
3. `.claude/plugins/sdlc-guard/hooks/register.ts`: `refuse()` and `FAILED` (Main 4 safeguard 3).
4. `git log --oneline` of a finished `sdlc/<slug>` branch (Main 5 step 7).
5. `Docs/backlog/index.md` with the completed pipeline features (Main 3 card 8).
6. `git show --stat a23b93f`, the earlier three-item triage run (Main 2e).
7. The setup and run commands (Main 5, steps 0 and 2), as typed-out command cards instead of terminal captures.

Not recorded, on purpose: **Stop** and steering a stage with a note (promised for the standalone library, see Main 5
step 5 and Main 6). Optional: triage part 3 again at full size.

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
