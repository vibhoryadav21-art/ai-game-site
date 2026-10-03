import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        // Anything under theadda.vercel.app/admin gets silently proxied
        // to the analytics portal's own Vercel deployment. To the
        // visitor's browser it still looks like theadda.vercel.app/admin —
        // only this server-to-server hop knows it's actually a separate app.
        source: "/admin/:path*",
        destination: "https://ai-game-admin-imhyekbky-ai-futures1.vercel.app/admin/:path*",
      },
    ];
  },
};

export default nextConfig;
