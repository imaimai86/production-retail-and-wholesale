// Builds scene timing from a Kokoro VO manifest (vo/tts.py): every line keeps its real
// audio length, lines get a short gap, and a scene ends a beat after its last line.
export type VoLine = { id: string; scene: string; text: string; file: string; seconds: number };
export type TimedLine = VoLine & { from: number; frames: number };
export type Scene = { name: string; from: number; frames: number; lines: TimedLine[] };

export const buildTimeline = (manifest: VoLine[], fps: number, gap = 0.25, tail = 0.45) => {
  const scenes: Scene[] = [];
  let t = 0.3 * fps;
  for (const line of manifest) {
    let scene = scenes[scenes.length - 1];
    if (!scene || scene.name !== line.scene) {
      if (scene) {
        t += Math.round(tail * fps);
        scene.frames = t - scene.from;
      }
      scene = { name: line.scene, from: t, frames: 0, lines: [] };
      scenes.push(scene);
    }
    const frames = Math.ceil(line.seconds * fps);
    scene.lines.push({ ...line, from: t, frames });
    t += frames + Math.round(gap * fps);
  }
  const last = scenes[scenes.length - 1];
  t += Math.round(1.2 * fps);
  last.frames = t - last.from;
  return { scenes, total: t };
};
