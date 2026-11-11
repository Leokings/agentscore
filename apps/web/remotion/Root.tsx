import { loadFont as loadGeist } from "@remotion/google-fonts/Geist";
import { loadFont as loadGeistMono } from "@remotion/google-fonts/GeistMono";
import { Composition } from "remotion";
import { DURATION, Explainer, FPS, HEIGHT, WIDTH } from "./Explainer";

// The website loads these fonts itself; a rendered video loads them here.
const sans = loadGeist();
const mono = loadGeistMono();

function Video() {
  return (
    <div style={{ ["--font-sans" as string]: sans.fontFamily, ["--font-mono" as string]: mono.fontFamily, width: "100%", height: "100%" }}>
      <Explainer />
    </div>
  );
}

export function RemotionRoot() {
  return <Composition id="Explainer" component={Video} durationInFrames={DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />;
}
