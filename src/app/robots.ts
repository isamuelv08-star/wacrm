import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://wacrm.tech").replace(
    /\/+$/,
    "",
  );

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // App/dashboard routes require auth and carry no SEO value —
      // keep crawlers out of them and off the API entirely.
      disallow: [
        "/dashboard",
        "/inbox",
        "/contacts",
        "/pipelines",
        "/broadcasts",
        "/automations",
        "/flows",
        "/calendar",
        "/agents",
        "/notifications",
        "/settings",
        "/agency",
        "/join",
        "/api",
      ],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
