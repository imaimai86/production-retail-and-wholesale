import React from "react";
import { Composition } from "remotion";
import { FPS, Short02, timeline } from "./Short02";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Short02" component={Short02} durationInFrames={timeline.total} fps={FPS} width={1080} height={1920} />
  </>
);
