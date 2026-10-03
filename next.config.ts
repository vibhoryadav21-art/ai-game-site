import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        // The bare "/admin" path (no trailing segment) needs its own
        // exact rule. Without this, it would only match the rule below,
        // whose destination template leaves a trailing slash when
        // :path* is empty ("/admin/"). The portal (which has basePath
        // set) auto-redirects that trailing slash away, and because the
        // redirect gets built from this domain's Host header, it sends
        // the browser right back to /admin on THIS domain — an infinite
        // loop. This rule matches first and avoids ever producing that
        // trailing slash.
        source: "/admin",
        destination: "https://YOUR-PORTAL-PROJECT.vercel.app/admin",
      },
      {
        // Everything else under /admin/* is silently proxied to the
        // analytics portal's own Vercel deployment. To the visitor's
        // browser it still looks like theadda.vercel.app/admin/... —
        // only this server-to-server hop knows it's actually a separate app.
        source: "/admin/:path*",
        destination: "https://YOUR-PORTAL-PROJECT.vercel.app/admin/:path*",
      },
    ];
  },
};

export default nextConfig;
