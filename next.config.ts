import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_BUILD_DIR ?? ".next",
  // ponytail: tidak ada i18n routing Next — cukup cookie + dictionary (src/lib/i18n.ts).
  // Tambah routing /[locale] bila ada > 1 locale client-side.
  experimental: { optimizePackageImports: ["zod"] },
  outputFileTracingRoot: __dirname,
  async headers() {
    return [{ source: "/r/:token", headers: [
      { key: "X-Robots-Tag", value: "noindex" },
      { key: "Referrer-Policy", value: "no-referrer" },
    ] }];
  },
};

export default nextConfig;
