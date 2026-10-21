import React from "react";
import {
  AbsoluteFill, Audio, Img, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig,
} from "remotion";
import manifest from "../public/vo/short-02/manifest.json";
import { Backdrop, Captions, clamp, CodeCard, ease, Panel, Stamp, TopBar, useEnter } from "./components";
import { C, MONO, SANS } from "./theme";
import { buildTimeline, Scene } from "./timeline";

export const FPS = 30;
export const timeline = buildTimeline(manifest, FPS);

const local = (scene: Scene, lineIndex: number) => scene.lines[lineIndex].from - scene.from;

// "What stops an AI from just changing the test, so it passes?"
const Hook: React.FC<{ scene: Scene }> = () => {
  const frame = useCurrentFrame();
  const a = useEnter(0);
  const b = useEnter(14);
  // The AI "edits" the expected value until the test goes green.
  const edited = frame > 62;
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 300 }}>
      <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: 118, lineHeight: 1, color: C.text, textAlign: "center",
        opacity: a, translate: `0 ${(1 - a) * 40}px` }}>
        CAN THE AI<br /><span style={{ color: C.amber }}>CHANGE THE TEST?</span>
      </div>
      <Panel style={{ marginTop: 90, width: 900, opacity: b, translate: `0 ${(1 - b) * 60}px` }}>
        <div style={{ fontFamily: MONO, fontSize: 36, lineHeight: 1.7, color: "#b9c8cc" }}>
          <div>test("invoice total", () =&gt; {"{"}</div>
          <div style={{ paddingLeft: 40 }}>
            expect(total).toBe(
            <span style={{ color: edited ? C.amber : C.text, textDecoration: edited ? "none" : "none" }}>
              {edited ? "total" : "118"}
            </span>
            )
          </div>
          <div>{"}"})</div>
        </div>
        <div style={{ marginTop: 26, fontFamily: MONO, fontSize: 34, fontWeight: 700, color: edited ? C.green : C.red }}>
          {edited ? "✓ PASS  (but nothing was fixed)" : "✗ FAIL"}
        </div>
      </Panel>
    </AbsoluteFill>
  );
};

// Tests are written first and must fail; passing before code exists stops the run.
const RedGreen: React.FC<{ scene: Scene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stopAt = local(scene, 1);
  const steps = [
    { t: "1  Write the tests", c: C.blue },
    { t: "2  Run them, no code yet", c: C.blue },
    { t: "3  They must FAIL", c: C.red },
  ];
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 260 }}>
      <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: 92, color: C.text }}>
        RED <span style={{ color: C.dim }}>before</span> <span style={{ color: C.green }}>GREEN</span>
      </div>
      <div style={{ marginTop: 60, display: "flex", flexDirection: "column", gap: 26, width: 900 }}>
        {steps.map((s, i) => {
          const e = useEnter(8 + i * 12);
          return (
            <Panel key={i} style={{ padding: "30px 40px", opacity: e, translate: `${(1 - e) * -80}px 0`,
              borderColor: s.c, fontFamily: MONO, fontSize: 44, color: s.c }}>
              {s.t}
            </Panel>
          );
        })}
      </div>
      <div style={{ marginTop: 50, display: "grid", gridTemplateColumns: "repeat(8, 70px)", gap: 22 }}>
        {Array.from({ length: 16 }).map((_, i) => {
          const on = interpolate(frame, [40 + i * 2, 46 + i * 2], [0, 1], clamp);
          return <div key={i} style={{ width: 70, height: 70, borderRadius: 14, background: C.red, opacity: 0.25 + 0.75 * on,
            scale: String(0.6 + 0.4 * on) }} />;
        })}
      </div>
      <Sequence from={stopAt} layout="none">
        <div style={{ position: "absolute", top: 1180, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
          <Stamp text="ALL PASS? → STOP" at={0} color={C.amber} style={{ fontSize: 58 }} />
        </div>
      </Sequence>
    </AbsoluteFill>
  );
};

// Real run: the Red tests stage with 16 new tests failing (c16-red-gate-failing.mp4, 1920 x 898).
const Capture: React.FC<{ scene: Scene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = useEnter(0);
  const scale = 1.5;
  // Pan from the files list down towards the test bar.
  const x = interpolate(frame, [0, scene.frames], [-690, -720], clamp);
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 230 }}>
      <div style={{ fontFamily: MONO, fontSize: 34, color: C.red, marginBottom: 26, letterSpacing: 2, opacity: e }}>
        ● REAL RUN · RED TESTS STAGE
      </div>
      <div style={{ width: 1000, height: 1100, overflow: "hidden", borderRadius: 28, border: `3px solid ${C.line}`,
        position: "relative", opacity: e, scale: String(0.94 + 0.06 * e) }}>
        <OffthreadVideo
          src={staticFile("captures/c16-red-gate-failing.mp4")}
          muted
          playbackRate={Math.min(1, 7.7 / (scene.frames / fps))}
          style={{ position: "absolute", width: 1920 * scale, height: 898 * scale, left: x, top: 0 }}
        />
      </div>
    </AbsoluteFill>
  );
};

// "Then they're committed. That commit hash is the lock."
const Lock: React.FC<{ scene: Scene }> = () => {
  const a = useEnter(0);
  const b = useEnter(22);
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 250 }}>
      <div style={{ width: 1000, height: 330, overflow: "hidden", borderRadius: 28, border: `3px solid ${C.line}`,
        position: "relative", opacity: a }}>
        <Img src={staticFile("captures/s20-red-gate-16-failing.png")}
          style={{ position: "absolute", width: 2930 * 0.87, left: -700 * 0.87, top: -880 * 0.87 }} />
      </div>
      <Panel style={{ marginTop: 50, width: 1000, opacity: b, translate: `0 ${(1 - b) * 60}px`, borderColor: C.green }}>
        <div style={{ fontFamily: MONO, fontSize: 32, color: C.dim }}>git commit</div>
        <div style={{ fontFamily: MONO, fontSize: 36, color: C.text, marginTop: 14 }}>
          test(add-json-logging):<br />add failing tests
        </div>
        <div style={{ height: 2, background: C.line, margin: "30px 0" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 30 }}>
          <svg width="90" height="100" viewBox="0 0 90 100">
            <path d="M22 44V30a23 23 0 0 1 46 0v14" fill="none" stroke={C.green} strokeWidth="10" />
            <rect x="8" y="44" width="74" height="52" rx="10" fill={C.green} />
          </svg>
          <div style={{ fontFamily: MONO, fontSize: 40, color: C.green }}>
            RED_SHA=$(git rev-parse HEAD)
          </div>
        </div>
      </Panel>
    </AbsoluteFill>
  );
};

// scripts/sdlc.sh lines 346 to 351: the guard after every Implement attempt.
const Guard: React.FC<{ scene: Scene }> = ({ scene }) => {
  const { fps } = useVideoConfig();
  const e = useEnter(0);
  const failAt = local(scene, 1) + 14;
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 250 }}>
      <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: 80, color: C.text, opacity: e, textAlign: "center" }}>
        AFTER <span style={{ color: C.amber }}>EVERY</span> ATTEMPT
      </div>
      <CodeCard
        style={{ marginTop: 50, width: 1000, opacity: e }}
        file="scripts/sdlc.sh"
        firstLine={346}
        code={[
          'for i in $(seq 1 "$MAX_ATTEMPTS"); do',
          '  agent "impl-$i" implement',
          '  if [ -n "$(git diff --name-only \\',
          '      "$RED_SHA" -- "$TEST_DIR")" ]; then',
          '    echo "GUARD FAILED: tests were',
          '          modified during implementation"',
          "    exit 1",
        ]}
        hot={[2, 3]}
        hotAt={Math.round(0.8 * fps)}
      />
      <div style={{ position: "absolute", top: 1170 }}>
        <Stamp text="GUARD FAILED" at={failAt} />
      </div>
    </AbsoluteFill>
  );
};

const Payoff: React.FC<{ scene: Scene }> = ({ scene }) => {
  const a = useEnter(0);
  const b = useEnter(local(scene, 0) + 38);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingBottom: 380, gap: 50 }}>
      <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 84, color: C.dim, textAlign: "center", opacity: a,
        lineHeight: 1.1 }}>
        Don't ask the AI<br />to be honest.
      </div>
      <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: 112, color: C.green, textAlign: "center", opacity: b,
        scale: String(0.9 + 0.1 * b), lineHeight: 1 }}>
        MAKE CHEATING<br />DETECTABLE.
      </div>
    </AbsoluteFill>
  );
};

const Cta: React.FC<{ scene: Scene }> = () => {
  const a = useEnter(0);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingBottom: 380 }}>
      <Panel style={{ width: 940, textAlign: "center", opacity: a, scale: String(0.9 + 0.1 * a) }}>
        <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: 70, color: C.text, lineHeight: 1.05 }}>
          THE SOFTWARE<br /><span style={{ color: C.green }}>FACTORY</span>
        </div>
        <div style={{ fontFamily: MONO, fontSize: 32, color: C.dim, marginTop: 30 }}>
          full video + open-source repo
        </div>
        <div style={{ fontFamily: MONO, fontSize: 34, color: C.blue, marginTop: 14 }}>↓ link in the description</div>
      </Panel>
    </AbsoluteFill>
  );
};

const SCENES: Record<string, React.FC<{ scene: Scene }>> = {
  hook: Hook, redgreen: RedGreen, capture: Capture, lock: Lock, guard: Guard, payoff: Payoff, cta: Cta,
};

export const Short02: React.FC = () => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const lines = timeline.scenes.flatMap((s) => s.lines);
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Backdrop />
      {timeline.scenes.map((scene) => {
        const Comp = SCENES[scene.name];
        const out = interpolate(frame, [scene.from + scene.frames - 6, scene.from + scene.frames], [1, 0], clamp);
        return (
          <Sequence key={scene.name} name={scene.name} from={scene.from} durationInFrames={scene.frames} premountFor={fps}>
            <AbsoluteFill style={{ opacity: scene.name === "cta" ? 1 : out }}>
              <Comp scene={scene} />
            </AbsoluteFill>
          </Sequence>
        );
      })}
      {lines.map((l) => (
        <Sequence key={l.id} name={`vo ${l.id}`} from={l.from} durationInFrames={l.frames + 4} premountFor={fps}>
          <Audio src={staticFile(`vo/short-02/${l.file}`)} />
        </Sequence>
      ))}
      <TopBar label="SOFTWARE FACTORY · SAFEGUARD #1" />
      <Captions lines={lines} />
      <div style={{ position: "absolute", left: 0, bottom: 0, height: 10, background: C.green,
        width: `${interpolate(frame, [0, timeline.total], [0, 100], { ...clamp, easing: ease })}%` }} />
    </AbsoluteFill>
  );
};
