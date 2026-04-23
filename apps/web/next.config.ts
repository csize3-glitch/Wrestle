import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: ["@wrestlewell/types", "@wrestlewell/firebase", "@wrestlewell/lib"],
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

export default nextConfig;
