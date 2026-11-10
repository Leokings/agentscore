/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@agentscore/shared"],
  env: {
    NEXT_PUBLIC_AGENTSCORE_API_URL: process.env.AGENTSCORE_API_URL ?? "http://localhost:8787",
  },
};

export default nextConfig;
