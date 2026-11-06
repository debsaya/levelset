import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  serverExternalPackages: ["mammoth", "xlsx"],
  // The page itself is never cached, so a browser can't hold an old page that points at files a newer publish has replaced.
  async headers() {
    const safe = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];
    return [
      { source: "/:path*", headers: safe },
      { source: "/", headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }] },
    ];
  },
};
export default nextConfig;
