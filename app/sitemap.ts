import type { MetadataRoute } from "next";
import { latestVersion, listAllSlugs, listVersions } from "@/lib/content";
import { listReferencePackages } from "@/lib/reference/data";
import { siteConfig } from "@/lib/site-config";

// `output: "export"` で静的生成するため。
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteConfig.url.replace(/\/$/, "");
  const lastModified = new Date();

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/docs`, lastModified, changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/packages`, lastModified, changeFrequency: "weekly", priority: 0.9 },
  ];

  const referenceEntries: MetadataRoute.Sitemap = listReferencePackages().map((entry) => ({
    url: `${base}/packages/${entry.name}`,
    lastModified,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  const versionEntries: MetadataRoute.Sitemap = listVersions().map((version) => ({
    url: `${base}/docs/${version}`,
    lastModified,
    changeFrequency: "weekly",
    priority: version === latestVersion() ? 0.8 : 0.5,
  }));

  const docEntries: MetadataRoute.Sitemap = listAllSlugs().map(({ version, slug }) => ({
    url: `${base}/docs/${version}/${slug.join("/")}`,
    lastModified,
    changeFrequency: "monthly",
    priority: version === latestVersion() ? 0.7 : 0.4,
  }));

  return [...staticEntries, ...referenceEntries, ...versionEntries, ...docEntries];
}
