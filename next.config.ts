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
      // The framework needs inline scripts and styles; everything else is limited to this site, the Google font host, and data/blob files the app makes itself.
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com data:",
          "img-src 'self' data: blob:",
          "connect-src 'self' data: blob:",
          "worker-src 'self' blob:",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "frame-ancestors 'none'",
        ].join("; "),
      },
    ];
    return [
      { source: "/:path*", headers: safe },
      { source: "/", headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }] },
    ];
  },
};
export default nextConfig;
