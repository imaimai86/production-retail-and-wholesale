import React from "react";
import { Composition } from "remotion";
import * as S01 from "./Short01";
import * as S02 from "./Short02";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Short01" component={S01.Short01} durationInFrames={S01.timeline.total} fps={S01.FPS} width={1080} height={1920} />
    <Composition id="Short02" component={S02.Short02} durationInFrames={S02.timeline.total} fps={S02.FPS} width={1080} height={1920} />
  </>
);
