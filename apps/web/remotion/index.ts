// Remotion entry for rendering the explainer to a video file or stills:
//   npx remotion render remotion/index.ts Explainer out/agentscore-explainer.mp4   (from apps/web)
import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);
