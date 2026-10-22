import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import manifest from "../public/vo/main-ch01/manifest.json";
import { clamp, Panel, Stamp } from "./components";
import { SceneComp, ShortShell, wordAt } from "./ShortShell";
import { C, MONO, SANS } from "./theme";
import { buildTimeline, Scene } from "./timeline";

export const FPS = 30;
export const timeline = buildTimeline(manifest, FPS);

// ---- helpers -------------------------------------------------------------------------------------------------
// Frames (relative to the scene) at which `word` is spoken in line `i`.
const at = (scene: Scene, i: number, word: string) => scene.lines[i].from - scene.from + wordAt(scene.lines[i], word);
const start = (scene: Scene, i: number) => scene.lines[i].from - scene.from;

const usePop = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (when: number, damping = 200) => spring({ frame: frame - when, fps, config: { damping } });
};

const Title: React.FC<{ children: React.ReactNode; size?: number; color?: string; style?: React.CSSProperties }> = ({
  children, size = 84, color = C.text, style,
}) => (
  <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: size, lineHeight: 1.05, color, textAlign: "center", ...style }}>
    {children}
  </div>
);

const Tag: React.FC<{ color?: string; children: React.ReactNode; style?: React.CSSProperties }> = ({
  color = C.blue, children, style,
}) => (
  <div style={{ fontFamily: MONO, fontSize: 26, color, border: `2px solid ${color}`, borderRadius: 30, padding: "6px 20px",
    whiteSpace: "nowrap", ...style }}>{children}</div>
);

// ---- 0. the pitch ----------------------------------------------------------------------------------------------
const STATIONS = ["Spec", "Plan", "Red tests", "Implement", "Test repair", "Review", "Ship"];
const SX = (i: number) => 190 + i * 258;
const BRIEF = "- [ ] fix-user-validation - POST /users returns 500 when name is missing";

const Pitch: SceneComp = ({ scene }) => {
  const frame = useCurrentFrame();
  const pop = usePop();
  const p1 = scene.lines[0];
  const typed = Math.floor(interpolate(frame, [10, p1.frames * 0.7], [0, BRIEF.length], clamp));
  const drop0 = start(scene, 0) + p1.frames - 6;
  const drop = interpolate(frame, [drop0, drop0 + 30], [0, 1], clamp);
  // Moments in the second line, where each station lights up.
  const words = ["specification", "technical plan", "tests that", "fix itself", null, "code review", "clean commit"];
  const raw = words.map((w) => (w ? at(scene, 1, w) : 0));
  raw[4] = Math.round((raw[3] + raw[5]) / 2);
  const t = raw.map((x) => x - 8);
  const pathX = interpolate(frame, [drop0 + 30, ...t.map((x) => x + 12)], [SX(0), ...STATIONS.map((_, i) => SX(i))], clamp);
  const cx = interpolate(drop, [0, 1], [960, SX(0)]) + (pathX - SX(0));
  const w = interpolate(drop, [0, 1], [1600, 330]);
  const docs = [
    { i: 0, name: "specs-1.md" }, { i: 1, name: "plan-1.md" }, { i: 2, name: "test-cases-1.md" },
    { i: 3, name: "src/ + tests green" }, { i: 5, name: "review-1.md" },
  ];
  const branch = pop(t[6] + 10);
  return (
    <AbsoluteFill>
      {/* the brief, typed, then dropped onto the belt */}
      <div style={{ position: "absolute", left: cx - w / 2, top: interpolate(drop, [0, 1], [380, 672]), width: w }}>
        <Panel style={{ padding: drop > 0.5 ? "12px 18px" : 44, borderRadius: 18, borderColor: drop > 0.5 ? C.amber : C.line }}>
          <div style={{ fontFamily: MONO, fontSize: interpolate(drop, [0, 1], [38, 22]), color: C.text, whiteSpace: "nowrap",
            overflow: "hidden", textAlign: "center" }}>
            {drop > 0.5 ? "fix-user-validation" : BRIEF.slice(0, typed)}<span style={{ opacity: (frame % 20 < 10 && drop < 0.1) ? 1 : 0, color: C.green }}>▌</span>
          </div>
        </Panel>
      </div>
      <AbsoluteFill style={{ opacity: drop }}>
        <div style={{ position: "absolute", left: 40, right: 40, top: 650, height: 16, borderRadius: 8, background: C.line }} />
        {STATIONS.map((s, i) => {
          const lit = interpolate(frame, [t[i], t[i] + 8], [0, 1], clamp);
          const col = lit > 0.5 ? C.green : C.red;
          return (
            <div key={s} style={{ position: "absolute", left: SX(i) - 110, top: 450, width: 220, height: 190 }}>
              <div style={{ height: 150, borderRadius: 22, background: C.panel, border: `3px solid ${lit > 0.5 ? C.green : C.line}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: SANS, fontWeight: 800, fontSize: 34, color: C.text, textAlign: "center",
                boxShadow: lit > 0.5 ? `0 0 40px ${C.green}44` : "none" }}>{s}</div>
              <div style={{ position: "absolute", right: 14, top: 14, width: 22, height: 22, borderRadius: 11, background: col }} />
            </div>
          );
        })}
        {docs.map((d) => {
          const e = pop(t[d.i] + 4);
          return (
            <div key={d.name} style={{ position: "absolute", left: SX(d.i) - 105, top: 340 - 50 * e, opacity: e, width: 210 }}>
              <div style={{ fontFamily: MONO, fontSize: 21, color: C.blue, background: C.panel, border: `2px solid ${C.blue}`,
                borderRadius: 12, padding: "10px 6px", textAlign: "center" }}>{d.name}</div>
            </div>
          );
        })}
        <div style={{ position: "absolute", left: 1230, top: 740, width: 640, opacity: branch, translate: `${(1 - branch) * 140}px 0` }}>
          <Panel style={{ padding: "18px 26px", borderColor: C.green }}>
            <div style={{ fontFamily: MONO, fontSize: 26, color: C.green }}>⎇ sdlc/fix-user-validation</div>
            <div style={{ fontFamily: MONO, fontSize: 20, color: C.dim, marginTop: 8 }}>● test(fix-user-validation): add failing tests</div>
            <div style={{ fontFamily: MONO, fontSize: 20, color: C.dim }}>● fix(fix-user-validation): reject a missing name</div>
          </Panel>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const NOT_ALLOWED = [
  { w: "edit the tests", t: "EDIT THE TESTS" },
  { w: "guess what you meant", t: "GUESS WHAT YOU MEANT" },
  { w: "commit your secrets", t: "COMMIT YOUR SECRETS" },
];

const Claims: SceneComp = ({ scene }) => {
  const frame = useCurrentFrame();
  const pop = usePop();
  const s = [0, 1, 2, 3].map((i) => start(scene, i));
  const phase = frame >= s[3] ? 3 : frame >= s[2] ? 2 : frame >= s[1] ? 1 : 0;
  const head = ["NOBODY TYPED THAT CODE.", "NO GRADING THEIR OWN HOMEWORK.", "THEY COULD NOT…", "ONE CLAIM. THREE JUDGES."][phase];
  const hp = pop(s[phase]);
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 150 }}>
      <Title size={phase === 1 ? 74 : 92} color={phase === 0 ? C.green : phase === 1 ? C.amber : C.text} style={{ opacity: hp, scale: String(0.94 + 0.06 * hp) }}>
        {head}
      </Title>
      {phase === 0 && (
        <div style={{ marginTop: 100, display: "flex", gap: 60, opacity: pop(18) }}>
          {["spec", "plan", "tests", "code", "review"].map((x, i) => (
            <Tag key={x} color={C.blue} style={{ fontSize: 38, padding: "14px 34px" }}>{x} · by AI</Tag>
          ))}
        </div>
      )}
      {phase === 1 && (
        <Panel style={{ marginTop: 80, width: 1000, textAlign: "center" }}>
          <div style={{ fontFamily: MONO, fontSize: 36, color: C.dim }}>agent writes the tests</div>
          <div style={{ fontFamily: MONO, fontSize: 36, color: C.dim, margin: "10px 0" }}>agent writes the code</div>
          <div style={{ fontFamily: MONO, fontSize: 40, color: C.red, textDecoration: "line-through" }}>agent grades both</div>
        </Panel>
      )}
      {phase === 2 && (
        <div style={{ marginTop: 70, display: "flex", gap: 44 }}>
          {NOT_ALLOWED.map((n) => {
            const e = pop(at(scene, 2, n.w) - 10);
            return (
              <Panel key={n.t} style={{ width: 520, textAlign: "center", opacity: e, scale: String(0.9 + 0.1 * e), borderColor: C.red }}>
                <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: 46, color: C.text }}>{n.t}</div>
                <div style={{ fontFamily: MONO, fontSize: 72, color: C.red, marginTop: 14 }}>✗</div>
              </Panel>
            );
          })}
        </div>
      )}
      {phase === 3 && (
        <div style={{ marginTop: 60, display: "flex", flexDirection: "column", alignItems: "center", gap: 36 }}>
          <Panel style={{ padding: "22px 46px", borderColor: C.amber }}>
            <span style={{ fontFamily: MONO, fontSize: 38, color: C.amber }}>claim: "this test is wrong"</span>
          </Panel>
          <div style={{ display: "flex", gap: 40 }}>
            {[["2nd agent", "repairs"], ["mechanical checks", "scripts"], ["independent auditor", "read-only"]].map(([a, b], i) => {
              const e = pop(at(scene, 3, ["a second agent", "mechanical checks", "independent auditor"][i]) - 8);
              return (
                <Panel key={a} style={{ width: 480, textAlign: "center", opacity: e, translate: `0 ${(1 - e) * 40}px` }}>
                  <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 44, color: C.text }}>{a}</div>
                  <div style={{ fontFamily: MONO, fontSize: 26, color: C.dim, margin: "8px 0 14px" }}>{b}</div>
                  <div style={{ fontFamily: MONO, fontSize: 40, color: C.green, opacity: pop(at(scene, 3, "all had to agree") + 6 + i * 6) }}>✓ agree</div>
                </Panel>
              );
            })}
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};

const PROMISES = [
  { w: "what a software factory is", t: "What a software factory is" },
  { w: "the pattern behind this one", t: "The pattern behind this one" },
  { w: "the safeguards that keep AI honest", t: "The safeguards that keep AI honest" },
  { w: "how to run it", t: "How to run it on your machine" },
  { w: "how you can help", t: "How you can help" },
];

const Promise_: SceneComp = ({ scene }) => {
  const pop = usePop();
  const a = pop(0);
  const second = start(scene, 1);
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 110 }}>
      <Title size={110} style={{ opacity: a, scale: String(0.92 + 0.08 * a) }}>
        THE SOFTWARE <span style={{ color: C.green }}>FACTORY</span>
      </Title>
      <div style={{ display: "flex", gap: 24, marginTop: 36, opacity: pop(30) }}>
        <Tag color={C.green} style={{ fontSize: 34 }}>open source · MIT</Tag>
        <Tag color={C.blue} style={{ fontSize: 34 }}>runs inside Claude Code</Tag>
      </div>
      <div style={{ marginTop: 36, display: "flex", flexDirection: "column", gap: 12, width: 1100 }}>
        {PROMISES.map((p, i) => {
          const e = pop(second + wordAt(scene.lines[1], p.w) - 6);
          return (
            <Panel key={p.t} style={{ padding: "10px 34px", display: "flex", gap: 26, alignItems: "center", opacity: e,
              translate: `${(1 - e) * 80}px 0` }}>
              <div style={{ fontFamily: MONO, fontSize: 34, color: C.green }}>{i + 1}</div>
              <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 38, color: C.text }}>{p.t}</div>
            </Panel>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const TitleCard: SceneComp = () => {
  const pop = usePop();
  const a = pop(0);
  const b = pop(14);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingBottom: 90 }}>
      <Title size={170} style={{ opacity: a, scale: String(0.9 + 0.1 * a) }}>
        The Software<br /><span style={{ color: C.green }}>Factory</span>
      </Title>
      <div style={{ fontFamily: MONO, fontSize: 40, color: C.amber, marginTop: 50, opacity: b }}>
        An AI SDLC pipeline that is not allowed to cheat
      </div>
    </AbsoluteFill>
  );
};

// ---- 1. what is a software factory -------------------------------------------------------------------------------
const CarShape: React.FC<{ x: number; y: number; door?: "ok" | "bad" | "none"; tint?: string }> = ({ x, y, door = "ok", tint = "#5b7c88" }) => (
  <svg style={{ position: "absolute", left: x - 130, top: y - 100 }} width="260" height="130" viewBox="0 0 260 130">
    <path d="M10 92 L10 70 Q10 56 28 52 L68 46 L96 18 Q102 12 114 12 L170 12 Q182 12 190 20 L214 46 L240 54 Q252 58 252 72 L252 92 Z"
      fill={tint} stroke="#0c1316" strokeWidth="3" />
    <path d="M104 22 L96 46 L146 46 L146 22 Z M156 22 L156 46 L204 46 L184 22 Z" fill="#a9c7d1" />
    {door !== "none" && (
      <rect x="112" y="52" width="62" height="34" rx="6" fill={door === "bad" ? C.red : "#456572"} stroke="#0c1316" strokeWidth="3" />
    )}
    <circle cx="64" cy="94" r="22" fill="#10181b" /><circle cx="64" cy="94" r="9" fill="#7f959c" />
    <circle cx="204" cy="94" r="22" fill="#10181b" /><circle cx="204" cy="94" r="9" fill="#7f959c" />
  </svg>
);

const Car: SceneComp = ({ scene }) => {
  const frame = useCurrentFrame();
  const pop = usePop();
  const BELT = 500, V = 5, GAP = 480, INSPECT = 880;
  const a1 = at(scene, 0, "line of stations"), a2 = start(scene, 1) + wordAt(scene.lines[1], "inspections"), a3 = start(scene, 2);
  const items = [0, 1, 2, 3, 4].map((k) => ({ k, x: -200 - k * GAP + frame * V }));
  const stations = [{ x: 520, n: "WELD" }, { x: INSPECT, n: "INSPECT" }, { x: 1300, n: "PAINT" }, { x: 1680, n: "FINAL CHECK" }];
  const label = (txt: string, x: number, y: number, when: number, color = C.dim) => (
    <div style={{ position: "absolute", left: x - 200, width: 400, top: y, textAlign: "center", opacity: pop(when),
      fontFamily: MONO, fontSize: 30, color }}>{txt}</div>
  );
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 0, right: 0, top: BELT, height: 18, background: C.line }} />
      {stations.map((s, i) => (
        <div key={s.n}>
          <div style={{ position: "absolute", left: s.x - 90, top: BELT - 330, width: 180, height: 330 }}>
            <div style={{ position: "absolute", left: 0, top: 0, width: 14, height: 330, background: C.line }} />
            <div style={{ position: "absolute", right: 0, top: 0, width: 14, height: 330, background: C.line }} />
            <div style={{ position: "absolute", left: 0, top: 0, right: 0, height: 56, background: i % 2 ? C.amber : C.blue, borderRadius: 12,
              fontFamily: MONO, fontWeight: 700, fontSize: 24, color: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>{s.n}</div>
          </div>
        </div>
      ))}
      {items.map(({ k, x }) => {
        const bad = k === 3;
        const fall = bad && x > INSPECT ? Math.min(1, (x - INSPECT) / 60) : 0;
        const passed = x > INSPECT + 40;
        return (
          <React.Fragment key={k}>
            <CarShape x={x} y={BELT + 4 + fall * 0} door={bad && !passed ? "bad" : "ok"} />
            {bad && fall > 0 && (
              <div style={{ position: "absolute", left: INSPECT - 40, top: BELT + 30 + fall * 210, opacity: 1 - 0.3 * fall,
                width: 82, height: 46, borderRadius: 8, background: C.red, rotate: `${fall * 40}deg` }} />
            )}
            {passed && !bad && x < 1300 && (
              <div style={{ position: "absolute", left: x - 20, top: BELT - 150, fontFamily: MONO, fontSize: 48, color: C.green }}>✓</div>
            )}
          </React.Fragment>
        );
      })}
      <div style={{ position: "absolute", left: INSPECT - 190, width: 380, top: BELT + 250, height: 130, border: `4px dashed ${C.red}`,
        borderRadius: 14, opacity: pop(a3), display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 12,
        fontFamily: MONO, fontSize: 28, color: C.red, whiteSpace: "nowrap" }}>rejected parts bin</div>
      {label("stations", 1480, BELT - 385, a1)}
      {label("conveyor", 1500, BELT + 36, a1 + 12)}
      {label("inspection", INSPECT, BELT - 385, a2, C.amber)}
      <div style={{ position: "absolute", left: INSPECT + 40, top: BELT - 200, opacity: pop(a3 + 120 > frame ? 0 : 0) }} />
      {frame > a3 + 40 && <div style={{ position: "absolute", left: INSPECT + 190, top: BELT + 270 }}>
        <Stamp text="REJECTED" at={a3 + 90} color={C.red} style={{ fontSize: 44 }} />
      </div>}
    </AbsoluteFill>
  );
};

const SDLC_STATIONS = [
  { n: "Requirements", q: "What should it do? What about bad input?", s: "Spec" },
  { n: "Design", q: "Which files and functions change, in what order?", s: "Plan" },
  { n: "Tests", q: "How will we prove it works?", s: "Red tests" },
  { n: "Implementation", q: "Write the code.", s: "Implement" },
  { n: "Review", q: "A second pair of eyes: bugs, security holes.", s: "Review" },
  { n: "Release", q: "Commit it, merge it, ship it.", s: "Ship" },
];

const Sdlc: SceneComp = ({ scene }) => {
  const pop = usePop();
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 150 }}>
      <Title size={76} style={{ opacity: pop(0) }}>
        <span style={{ color: C.amber }}>SDLC</span> · Software Development Life Cycle
      </Title>
      <div style={{ display: "flex", gap: 14, marginTop: 120, padding: "0 37px" }}>
        {SDLC_STATIONS.map((s, i) => {
          const e = pop(start(scene, i + 1) - 4);
          return (
            <div key={s.n} style={{ width: 296, opacity: e, translate: `0 ${(1 - e) * 60}px` }}>
              <Panel style={{ padding: 22, height: 400 }}>
                <div style={{ fontFamily: MONO, fontSize: 30, color: C.dim }}>{i + 1}</div>
                <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: 28, color: C.text, margin: "6px 0 18px", whiteSpace: "nowrap" }}>{s.n}</div>
                <div style={{ fontFamily: SANS, fontSize: 28, lineHeight: 1.3, color: "#b9c8cc", minHeight: 130 }}>{s.q}</div>
                <Tag color={C.blue} style={{ marginTop: 18, display: "inline-block" }}>{s.s}</Tag>
              </Panel>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const Idea: SceneComp = ({ scene }) => {
  const frame = useCurrentFrame();
  const pop = usePop();
  const s2 = start(scene, 1), s3 = start(scene, 2);
  const inCards = frame >= s3;
  const phase = frame >= s3 ? 2 : frame >= s2 ? 1 : 0;
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 180 }}>
      {phase === 0 && (
        <>
          <div style={{ fontFamily: MONO, fontSize: 38, color: C.dim, opacity: pop(0), letterSpacing: 4 }}>THE FIRST BIG IDEA</div>
          <div style={{ display: "flex", gap: 30, marginTop: 120, alignItems: "center", opacity: pop(at(scene, 0, "In most teams"))}}>
            <Tag color={C.dim} style={{ fontSize: 40 }}>people</Tag>
            <span style={{ fontFamily: MONO, fontSize: 50, color: C.dim }}>→</span>
            <Tag color={C.blue} style={{ fontSize: 40, opacity: pop(at(scene, 0, "AI agents")) }}>AI agents</Tag>
          </div>
        </>
      )}
      {phase === 1 && (
        <>
          <Title size={86} color={C.dim} style={{ opacity: pop(s2) }}>The factory is <span style={{ textDecoration: "line-through", color: C.red }}>not</span><br />the workers.</Title>
          <Title size={110} color={C.green} style={{ marginTop: 70, opacity: pop(s2 + wordAt(scene.lines[1], "The factory is the line")) }}>
            THE LINE<span style={{ color: C.dim }}>,</span> THE STATIONS<span style={{ color: C.dim }}>,</span><br />
            <span style={{ color: C.amber }}>THE INSPECTIONS</span>
          </Title>
        </>
      )}
      {inCards && (
        <div style={{ display: "flex", gap: 50, marginTop: 20 }}>
          <Panel style={{ width: 760 }}>
            <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: 46, color: C.text }}>An AI worker</div>
            {["very fast", "very confident"].map((x, i) => (
              <div key={x} style={{ fontFamily: MONO, fontSize: 38, color: C.green, marginTop: 20, opacity: pop(s3 + 10 + i * 24) }}>✓ {x}</div>
            ))}
            <div style={{ fontFamily: MONO, fontSize: 38, color: C.amber, marginTop: 20, opacity: pop(at(scene, 2, "as long as"))}}>? inspections strict</div>
          </Panel>
          <Panel style={{ width: 760, borderColor: C.red, opacity: pop(at(scene, 2, "A factory without"))}}>
            <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: 46, color: C.text }}>No inspections</div>
            <div style={{ display: "flex", gap: 14, marginTop: 28, flexWrap: "wrap" }}>
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} style={{ width: 56, height: 56, borderRadius: 12, background: C.red,
                  opacity: interpolate(frame, [at(scene, 2, "broken cars") + i * 4, at(scene, 2, "broken cars") + i * 4 + 6], [0.15, 1], clamp) }} />
              ))}
            </div>
            <div style={{ fontFamily: MONO, fontSize: 34, color: C.red, marginTop: 24 }}>broken cars, faster</div>
          </Panel>
        </div>
      )}
    </AbsoluteFill>
  );
};

const Split: SceneComp = ({ scene }) => {
  const pop = usePop();
  const d2 = start(scene, 1), d3 = start(scene, 2);
  const chat = ["describe a feature", "model writes code", "you read it", "you ask for fixes", "you hope you caught everything"];
  return (
    <AbsoluteFill style={{ padding: "110px 90px 0" }}>
      <div style={{ display: "flex", gap: 60 }}>
        <Panel style={{ flex: 1, height: 660, opacity: pop(0), borderColor: C.dim }}>
          <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: 46, color: C.text }}>AI chat</div>
          <div style={{ fontFamily: MONO, fontSize: 26, color: C.dim, margin: "6px 0 26px" }}>one long conversation, you check everything by eye</div>
          {chat.map((c, i) => (
            <div key={c} style={{ fontFamily: SANS, fontSize: 34, color: "#b9c8cc", background: C.bg, borderRadius: 18, padding: "12px 24px",
              marginBottom: 14, width: i % 2 ? "80%" : "92%", marginLeft: i % 2 ? "20%" : 0, opacity: pop(start(scene, 0) + 40 + i * 70) }}>{c}</div>
          ))}
          <div style={{ fontFamily: MONO, fontSize: 32, color: C.amber, marginTop: 22, opacity: pop(at(scene, 0, "only inspector")) }}>
            you = the only inspector
          </div>
        </Panel>
        <Panel style={{ flex: 1, height: 660, opacity: pop(d2 - 8), borderColor: C.green }}>
          <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: 46, color: C.green }}>Software factory</div>
          <div style={{ fontFamily: MONO, fontSize: 26, color: C.dim, margin: "6px 0 26px" }}>separate stations, each output checked by a machine</div>
          {[["one narrow job", "narrow job"], ["a limited set of tools", "limited set of tools"], ["a written hand-off", "written hand-off"]].map(([t, w], i) => (
            <div key={t} style={{ fontFamily: SANS, fontWeight: 700, fontSize: 36, color: C.text, marginBottom: 16,
              opacity: pop(d2 + wordAt(scene.lines[1], w) - 6) }}>• {t}</div>
          ))}
          <div style={{ marginTop: 26, opacity: pop(d3) }}>
            <Tag color={C.amber} style={{ fontSize: 30, display: "inline-block" }}>a script checks, not a model</Tag>
            <div style={{ fontFamily: MONO, fontSize: 32, color: C.green, marginTop: 18, opacity: pop(d3 + wordAt(scene.lines[2], "Pass")) }}>pass → the work moves on</div>
            <div style={{ fontFamily: MONO, fontSize: 32, color: C.red, marginTop: 10, opacity: pop(d3 + wordAt(scene.lines[2], "Fail")) }}>✗ fail → rejected, with a reason</div>
          </div>
        </Panel>
      </div>
    </AbsoluteFill>
  );
};

const Real: SceneComp = ({ scene }) => {
  const frame = useCurrentFrame();
  const pop = usePop();
  const boxes = ["Products", "Stock", "Invoices", "GST"];
  const who = ["produces goods", "own shop", "dealers, from the warehouse"];
  const e2 = start(scene, 1);
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 140 }}>
      <div style={{ fontFamily: MONO, fontSize: 40, color: C.dim, opacity: pop(0) }}>a real, open-source project</div>
      <Title size={84} style={{ marginTop: 14, opacity: pop(8) }}>production-retail-and-wholesale</Title>
      <div style={{ display: "flex", gap: 20, marginTop: 40, opacity: pop(30) }}>
        <Tag color={C.green} style={{ fontSize: 30 }}>Node.js</Tag><Tag color={C.blue} style={{ fontSize: 30 }}>PostgreSQL</Tag>
        <Tag color={C.amber} style={{ fontSize: 30 }}>Jest</Tag>
      </div>
      <div style={{ display: "flex", gap: 28, marginTop: 60 }}>
        {who.map((w, i) => (
          <Panel key={w} style={{ padding: "20px 34px", opacity: pop(at(scene, 0, ["produces goods", "own shop", "dealers"][i]) - 4) }}>
            <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: 38, color: C.text }}>{w}</span>
          </Panel>
        ))}
      </div>
      <div style={{ display: "flex", gap: 28, marginTop: 40 }}>
        {boxes.map((b, i) => (
          <Panel key={b} style={{ width: 270, textAlign: "center", opacity: pop(at(scene, 0, "Products") + i * 16) }}>
            <span style={{ fontFamily: MONO, fontSize: 36, color: C.blue }}>{b}</span>
          </Panel>
        ))}
      </div>
      <div style={{ position: "absolute", top: 830, opacity: interpolate(frame, [e2 + wordAt(scene.lines[1], "boring"), e2 + wordAt(scene.lines[1], "boring") + 10], [0, 1], clamp) }}>
        <Stamp text="BORING, REAL CODE · NOT A DEMO" at={e2 + wordAt(scene.lines[1], "boring")} color={C.amber} style={{ fontSize: 46 }} />
      </div>
    </AbsoluteFill>
  );
};

const SCENES: Record<string, SceneComp> = {
  pitch: Pitch, claims: Claims, promise: Promise_, title: TitleCard, car: Car, sdlc: Sdlc, idea: Idea, split: Split, real: Real,
};

const LABELS: Record<string, string> = {
  pitch: "0 · THE PITCH", claims: "0 · THE PITCH", promise: "0 · THE PITCH", title: "",
  car: "1 · WHAT IS A SOFTWARE FACTORY?", sdlc: "1 · WHAT IS A SOFTWARE FACTORY?", idea: "1 · WHAT IS A SOFTWARE FACTORY?",
  split: "1 · WHAT IS A SOFTWARE FACTORY?", real: "1 · WHAT IS A SOFTWARE FACTORY?",
};

export const Main01: React.FC = () => (
  <ShortShell wide timeline={timeline} scenes={SCENES} vo="main-ch01" label={(s) => LABELS[s] ?? ""} />
);
