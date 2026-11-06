import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  serverExternalPackages: ["mammoth", "xlsx"],
  // The page itself is never cached, so a browser can't hold an old page that points at files a newer publish has replaced.
  async headers() {
    return [{ source: "/", headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }] }];
  },
};
export default nextConfig;
