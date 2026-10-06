import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ponytail: tidak ada i18n routing Next — cukup cookie + dictionary (src/lib/i18n.ts).
  // Tambah routing /[locale] bila ada > 1 locale client-side.
  experimental: { optimizePackageImports: ["zod"] },
  outputFileTracingRoot: __dirname,
};

export default nextConfig;