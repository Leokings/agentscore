// Remotion CLI config (used by `npx remotion render|still` in apps/web).
// Tailwind v4 lets the explainer render the website's own components, styled as on the site.
import { Config } from "@remotion/cli/config";
import { enableTailwind } from "@remotion/tailwind-v4";

Config.overrideWebpackConfig((config) => enableTailwind(config));
Config.setPublicDir("public");
