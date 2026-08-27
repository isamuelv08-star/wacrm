import type { MetadataRoute } from "next";

// The public marketing site (the only thing worth crawling) now
// lives at saleslid.com, a separate project — everything on this
// domain requires auth and carries no SEO value, so this disallows
// crawling entirely instead of listing routes one by one.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}
