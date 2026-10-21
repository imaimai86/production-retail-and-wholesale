import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, MONO, SANS } from "./theme";
import type { TimedLine } from "./timeline";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export const useEnter = (delay = 0, damping = 200) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping } });
};

// Burned-in caption for the line being spoken. Word timing is estimated from character
// counts, which is close enough for Kokoro's even pace.
export const Captions: React.FC<{ lines: TimedLine[]; top?: number }> = ({ lines, top = 1480 }) => {
  const frame = useCurrentFrame();
  const line = lines.find((l) => frame >= l.from && frame < l.from + l.frames + 8);
  if (!line) return null;
  const words = line.text.split(" ");
  const total = words.reduce((n, w) => n + w.length + 1, 0);
  const progress = ((frame - line.from) / line.frames) * total;
  let acc = 0;
  const enter = interpolate(frame - line.from, [0, 6], [0, 1], clamp);
  return (
    <div
      style={{
        position: "absolute", left: 70, right: 70, top, textAlign: "center",
        fontFamily: SANS, fontWeight: 800, fontSize: 64, lineHeight: 1.18,
        opacity: enter, translate: `0 ${(1 - enter) * 20}px`,
        textShadow: "0 4px 18px rgba(0,0,0,.8)",
      }}
    >
      {words.map((w, i) => {
        const start = acc;
        acc += w.length + 1;
        const spoken = progress >= start;
        return (
          <span key={i} style={{ color: spoken ? C.text : "rgba(232,240,242,.35)" }}>
            {w}{" "}
          </span>
        );
      })}
    </div>
  );
};

export const TopBar: React.FC<{ label: string }> = ({ label }) => (
  <div
    style={{
      position: "absolute", top: 90, left: 70, right: 70, display: "flex", alignItems: "center", gap: 18,
      fontFamily: MONO, fontSize: 30, color: C.dim, letterSpacing: 2,
    }}
  >
    <div style={{ width: 18, height: 18, borderRadius: 9, background: C.green }} />
    {label}
  </div>
);

export const Panel: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div
    style={{
      background: C.panel, border: `2px solid ${C.line}`, borderRadius: 28, padding: 44,
      boxShadow: "0 30px 80px rgba(0,0,0,.45)", ...style,
    }}
  >
    {children}
  </div>
);

// A code card with real source lines; `hot` lines light up at `hotAt` frames.
export const CodeCard: React.FC<{
  file: string; firstLine: number; code: string[]; hot?: number[]; hotAt?: number; style?: React.CSSProperties;
}> = ({ file, firstLine, code, hot = [], hotAt = 0, style }) => {
  const frame = useCurrentFrame();
  const glow = interpolate(frame, [hotAt, hotAt + 10], [0, 1], clamp);
  return (
    <Panel style={{ padding: 0, overflow: "hidden", ...style }}>
      <div
        style={{
          padding: "22px 36px", borderBottom: `2px solid ${C.line}`, fontFamily: MONO, fontSize: 28, color: C.dim,
          display: "flex", gap: 14, alignItems: "center",
        }}
      >
        <span style={{ color: C.red }}>●</span><span style={{ color: C.amber }}>●</span>
        <span style={{ color: C.green }}>●</span>
        <span style={{ marginLeft: 12 }}>{file}</span>
      </div>
      <div style={{ padding: "26px 0", fontFamily: MONO, fontSize: 29, lineHeight: 1.6 }}>
        {code.map((l, i) => {
          const isHot = hot.includes(i);
          return (
            <div
              key={i}
              style={{
                display: "flex", padding: "0 36px", whiteSpace: "pre",
                background: isHot ? `rgba(255,95,95,${0.16 * glow})` : "transparent",
                borderLeft: `6px solid ${isHot ? `rgba(255,95,95,${glow})` : "transparent"}`,
              }}
            >
              <span style={{ width: 70, color: "#4b5f66", flexShrink: 0 }}>{firstLine + i}</span>
              <span style={{ color: isHot && glow > 0.5 ? C.text : "#b9c8cc" }}>{l}</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
};

export const Stamp: React.FC<{ text: string; at: number; color?: string; style?: React.CSSProperties }> = ({
  text, at, color = C.red, style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - at, fps, config: { damping: 12, stiffness: 180 } });
  if (frame < at) return null;
  return (
    <div
      style={{
        fontFamily: MONO, fontWeight: 700, fontSize: 76, color, border: `8px solid ${color}`, borderRadius: 18,
        padding: "16px 34px", rotate: "-6deg", scale: String(interpolate(s, [0, 1], [2.2, 1])), opacity: s,
        background: "rgba(12,19,22,.85)", ...style,
      }}
    >
      {text}
    </div>
  );
};

export const Backdrop: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${C.line}55 2px, transparent 2px), linear-gradient(90deg, ${C.line}55 2px, transparent 2px)`,
          backgroundSize: "90px 90px",
          backgroundPosition: `0 ${frame * 0.6}px`,
          maskImage: "radial-gradient(ellipse at 50% 40%, black 20%, transparent 75%)",
        }}
      />
    </AbsoluteFill>
  );
};

export const ease = Easing.bezier(0.16, 1, 0.3, 1);
export { clamp };
