"use client";

import { Player } from "@remotion/player";
import { DURATION, Explainer, FPS, HEIGHT, WIDTH } from "../../remotion/Explainer";

/** The motion explainer, playing in the page. The same composition renders the 45-second video. */
export function ExplainerPlayer({ controls = false }: { controls?: boolean }) {
  return (
    <Player
      component={Explainer}
      durationInFrames={DURATION}
      fps={FPS}
      compositionWidth={WIDTH}
      compositionHeight={HEIGHT}
      autoPlay
      loop
      controls={controls}
      clickToPlay={controls}
      initiallyMuted
      acknowledgeRemotionLicense
      style={{ width: "100%", aspectRatio: `${WIDTH} / ${HEIGHT}`, borderRadius: 18, overflow: "hidden" }}
    />
  );
}
