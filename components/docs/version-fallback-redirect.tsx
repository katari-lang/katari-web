"use client";

import { usePathname } from "next/navigation";
import { ClientRedirect } from "@/components/site/client-redirect";

export function VersionFallbackRedirect({
  latestVersion,
}: {
  latestVersion: string;
}) {
  const pathname = usePathname();
  const href = `/docs/${latestVersion}${pathname.slice("/docs".length)}`;
  return <ClientRedirect href={href} />;
}
