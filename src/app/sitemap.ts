import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://wacrm.tech";

  return [
    {
      url: base.replace(/\/+$/, ""),
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
