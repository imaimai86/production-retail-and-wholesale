import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import manifest from "../public/vo/short-01/manifest.json";
import { clamp, Panel, Stamp, useEnter } from "./components";
import { Cta, SceneComp, ShortShell, wordAt } from "./ShortShell";
import { C, MONO, SANS } from "./theme";
import { buildTimeline, Scene } from "./timeline";

export const FPS = 30;
export const timeline = buildTimeline(manifest, FPS);

const local = (scene: Scene, lineIndex: number) => scene.lines[lineIndex].from - scene.from;

const CODE = [
  "export async function createSale(req, res) {",
  "  const { items, customerId } = req.body;",
  "  const total = items.reduce((s, i) => s + i.price, 0);",
  "  const gst = total * 0.18;",
  "  await db.query(INSERT_SALE, [customerId, total]);",
  "  for (const i of items) await reserve(i.sku, i.qty);",
  "  res.status(201).json({ total, gst });",
  "}",
  "export function applyDiscount(price, tier) {",
  "  return tier === 'dealer' ? price * 0.9 : price;",
  "}",
];

// "AI writes code fast. So why does most AI code still break?"
const Hook: SceneComp = ({ scene }) => {
  const frame = useCurrentFrame();
  const line = scene.lines[0];
  const breakAt = wordAt(line, "So why");
  const broken = frame >= breakAt;
  const a = useEnter(0);
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 260 }}>
      <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: 112, lineHeight: 1, textAlign: "center", opacity: a,
        color: broken ? C.text : C.green }}>
        {broken ? <>SO WHY DOES IT<br /><span style={{ color: C.red }}>STILL BREAK?</span></> : <>AI WRITES<br />CODE FAST</>}
      </div>
      <Panel style={{ marginTop: 80, width: 960, height: 640, padding: "30px 36px", overflow: "hidden", position: "relative" }}>
        <div style={{ position: "absolute", left: 36, right: 36, top: 30 - ((frame * 9) % (CODE.length * 52)) }}>
          {[...CODE, ...CODE, ...CODE].map((l, i) => {
            const bad = broken && i % 5 === 3;
            return (
              <div key={i} style={{ fontFamily: MONO, fontSize: 27, lineHeight: "52px", whiteSpace: "pre",
                color: bad ? C.red : "#b9c8cc", background: bad ? "rgba(255,95,95,.14)" : "transparent" }}>
                {bad ? "✗ " : "  "}{l}
              </div>
            );
          })}
        </div>
      </Panel>
    </AbsoluteFill>
  );
};

// "Speed isn't the problem. Inspection is." / "A car factory ... inspects every door."
const Inspect: SceneComp = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const second = wordAt(scene.lines[0], "Inspection");
  const b = spring({ frame: frame - second, fps, config: { damping: 200 } });
  const beltFrom = local(scene, 1);
  const belt = useEnter(beltFrom);
  const gateX = 540;
  const doors = [0, 1, 2, 3, 4, 5];
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 250 }}>
      <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 70, color: C.dim, textAlign: "center" }}>
        Speed isn't the problem.
      </div>
      <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: 100, color: C.amber, opacity: b,
        scale: String(0.85 + 0.15 * b), marginTop: 10 }}>
        INSPECTION IS.
      </div>
      <div style={{ position: "absolute", top: 760, left: 0, width: 1080, height: 520, opacity: belt }}>
        {/* Conveyor */}
        <div style={{ position: "absolute", top: 330, left: 40, right: 40, height: 22, borderRadius: 11, background: C.line }} />
        {/* Inspection gate */}
        <div style={{ position: "absolute", left: gateX - 90, top: 0, width: 180, height: 352, border: `6px solid ${C.amber}`,
          borderBottom: "none", borderRadius: "24px 24px 0 0" }} />
        <div style={{ position: "absolute", left: gateX - 150, top: -66, width: 300, textAlign: "center", fontFamily: MONO,
          fontSize: 30, color: C.amber, letterSpacing: 3 }}>INSPECT</div>
        {doors.map((d) => {
          const x = interpolate(frame - beltFrom, [0, 120], [-160 - d * 230, 1180 - d * 230], {
            extrapolateLeft: "clamp", extrapolateRight: "extend" });
          const passed = x > gateX;
          const reject = d === 2;
          const drop = reject && passed ? Math.min(400, (x - gateX) * 1.6) : 0;
          return (
            <div key={d} style={{ position: "absolute", left: x - 60, top: 150 + drop, width: 120, height: 176,
              borderRadius: 14, background: "#2b3d44", border: `4px solid ${passed ? (reject ? C.red : C.green) : "#4b5f66"}`,
              opacity: drop > 300 ? 0 : 1 }}>
              <div style={{ position: "absolute", top: 18, left: 14, right: 14, height: 60, borderRadius: 8, background: "#1a272c" }} />
              {passed && (
                <div style={{ position: "absolute", top: 96, width: "100%", textAlign: "center", fontFamily: MONO,
                  fontSize: 48, fontWeight: 700, color: reject ? C.red : C.green }}>{reject ? "✗" : "✓"}</div>
              )}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const STATIONS = [
  { word: "requirements", label: "Requirements", stage: "Spec" },
  { word: "design", label: "Design", stage: "Plan" },
  { word: "tests,", label: "Tests", stage: "Red tests" },
  { word: "code,", label: "Code", stage: "Implement" },
  { word: "review,", label: "Review", stage: "Review" },
  { word: "release", label: "Release", stage: "Ship" },
];
// The real checks scripts/sdlc.sh runs between stations.
const GATES = ["questions answered", "plan-1.md written", "red gate: tests must fail", "test lock + green gate",
  "lock + checks still pass"];

const Line: React.FC<{ scene: Scene; gates: boolean }> = ({ scene, gates }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const l0 = scene.lines[0];
  const agentsAt = gates ? -999 : local(scene, 1);
  return (
    <div style={{ position: "absolute", top: 230, left: 90, right: 90, display: "flex", flexDirection: "column" }}>
      {STATIONS.map((s, i) => {
        // In the stations scene each station appears as it is named; in the gates scene all are there.
        const at = gates ? -30 : wordAt(l0, s.word) - 4;
        const e = spring({ frame: frame - at, fps, config: { damping: 200 } });
        const agent = spring({ frame: frame - agentsAt - i * 3, fps, config: { damping: 200 } });
        const gateOn = gates ? interpolate(frame, [12 + i * 9, 18 + i * 9], [0, 1], clamp) : 0;
        return (
          <React.Fragment key={s.label}>
            <div style={{ height: 118, display: "flex", alignItems: "center", gap: 28, padding: "0 34px", borderRadius: 22,
              background: C.panel, border: `2px solid ${C.line}`, opacity: e, translate: `${(1 - e) * 120}px 0` }}>
              <div style={{ fontFamily: MONO, fontSize: 34, color: C.dim, width: 40 }}>{i + 1}</div>
              <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 52, color: C.text, flex: 1 }}>{s.label}</div>
              {gates ? null : (
                <div style={{ fontFamily: MONO, fontSize: 28, color: C.blue, border: `2px solid ${C.blue}`, borderRadius: 30,
                  padding: "6px 18px", opacity: agent, scale: String(0.6 + 0.4 * agent) }}>AI agent</div>
              )}
              <div style={{ fontFamily: MONO, fontSize: 26, color: C.dim, width: 150, textAlign: "right" }}>{s.stage}</div>
            </div>
            {i < STATIONS.length - 1 && (
              <div style={{ height: gates ? 74 : 26, display: "flex", alignItems: "center", gap: 20, paddingLeft: 60 }}>
                {gates && (
                  <>
                    <div style={{ width: 52, height: 52, borderRadius: 26, display: "flex", alignItems: "center",
                      justifyContent: "center", background: gateOn > 0.5 ? C.green : C.line, color: C.bg,
                      fontFamily: MONO, fontWeight: 700, fontSize: 30 }}>✓</div>
                    <div style={{ fontFamily: MONO, fontSize: 28, color: gateOn > 0.5 ? C.green : C.dim }}>{GATES[i]}</div>
                  </>
                )}
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

const Stations: SceneComp = ({ scene }) => <Line scene={scene} gates={false} />;

const Gates: SceneComp = ({ scene }) => (
  <AbsoluteFill>
    <Line scene={scene} gates />
    <div style={{ position: "absolute", top: 1180, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
      <Stamp text="NOT AI. CODE." at={local(scene, 1)} color={C.green} style={{ fontSize: 64 }} />
    </div>
  </AbsoluteFill>
);

const Payoff: SceneComp = ({ scene }) => {
  const a = useEnter(0);
  const b = useEnter(wordAt(scene.lines[0], "It's"));
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingBottom: 380, gap: 50 }}>
      <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 80, color: C.dim, textAlign: "center", opacity: a,
        lineHeight: 1.1 }}>
        The factory isn't<br />the workers.
      </div>
      <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: 104, color: C.green, textAlign: "center", opacity: b,
        scale: String(0.9 + 0.1 * b), lineHeight: 1 }}>
        IT'S THE LINE<br /><span style={{ color: C.amber }}>+ THE INSPECTIONS</span>
      </div>
    </AbsoluteFill>
  );
};

const SCENES: Record<string, SceneComp> = {
  hook: Hook, inspect: Inspect, stations: Stations, gates: Gates, payoff: Payoff, cta: Cta,
};

export const Short01: React.FC = () => (
  <ShortShell timeline={timeline} scenes={SCENES} vo="short-01" label="SOFTWARE FACTORY · 101" />
);
