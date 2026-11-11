"use client";

import { Player } from "@remotion/player";
import { DURATION, Explainer, FPS, HEIGHT, WIDTH } from "../../remotion/Explainer";

/**
 * The motion explainer, playing in the page (the same composition renders the 45-second video).
 * Muted autoplay loop, with controls so phone visitors can pause or go fullscreen.
 */
export function ExplainerPlayer({ controls = true }: { controls?: boolean }) {
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
      clickToPlay={false}
      allowFullscreen
      initiallyMuted
      acknowledgeRemotionLicense
      style={{ width: "100%", aspectRatio: `${WIDTH} / ${HEIGHT}`, borderRadius: 18, overflow: "hidden" }}
    />
  );
}
