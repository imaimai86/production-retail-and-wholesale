import React from "react";
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop, Captions, clamp, ease, Panel, TopBar, useEnter } from "./components";
import { C, MONO, SANS } from "./theme";
import type { Scene, buildTimeline } from "./timeline";

export type SceneComp = React.FC<{ scene: Scene }>;

// Frame shared by every Short: backdrop, one Sequence per scene (fading out at its end),
// the VO clips, burned-in captions, the top label and a progress bar.
export const ShortShell: React.FC<{
  timeline: ReturnType<typeof buildTimeline>;
  scenes: Record<string, SceneComp>;
  vo: string;
  label: string;
}> = ({ timeline, scenes, vo, label }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const lines = timeline.scenes.flatMap((s) => s.lines);
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Backdrop />
      {timeline.scenes.map((scene) => {
        const Comp = scenes[scene.name];
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
          <Audio src={staticFile(`vo/${vo}/${l.file}`)} />
        </Sequence>
      ))}
      <TopBar label={label} />
      <Captions lines={lines} />
      <div style={{ position: "absolute", left: 0, bottom: 0, height: 10, background: C.green,
        width: `${interpolate(frame, [0, timeline.total], [0, 100], { ...clamp, easing: ease })}%` }} />
    </AbsoluteFill>
  );
};

export const Cta: SceneComp = () => {
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

// Frame (relative to the line's start) at which `word` is spoken, estimated from character position,
// the same estimate the captions use.
export const wordAt = (line: { text: string; frames: number }, word: string) => {
  const i = line.text.indexOf(word);
  return i < 0 ? 0 : Math.round((i / line.text.length) * line.frames);
};
