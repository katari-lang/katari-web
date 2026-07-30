import Link from "next/link";
import { ArrowRight, Network, Zap, Layers, Wrench } from "lucide-react";
import { siteConfig } from "@/lib/site-config";
import { LogoMark } from "@/components/site/logo";
import { FeatureCard } from "@/components/site/feature-card";
import { latestVersion } from "@/lib/content";

export default function Home() {
  const version = latestVersion();

  const featureCards = [
    {
      icon: Network,
      title: "Agent Networks",
      href: `/docs/${version}/concepts/agents-and-delegation`,
      description: "Compose multi-agent systems with clear delegation and communication patterns.",
    },
    {
      icon: Zap,
      title: "Effect System",
      href: `/docs/${version}/concepts/effects-and-handlers`,
      description:
        "Handle side effects safely via the request/handler model — typed, structured, and composable.",
    },
    {
      icon: Layers,
      title: "Expressive Types",
      href: `/docs/${version}/concepts/types-and-schemas`,
      description: "Subtyping, type inference, and pattern matching. Catch errors at compile time.",
    },
    {
      icon: Wrench,
      title: "Full Toolchain",
      href: `/docs/${version}/toolchain/cli`,
      description:
        "Compiler, runtime, and LSP — everything you need to build, run, and edit Katari programs.",
    },
  ];

  return (
    <>
      <section className="flex flex-1 flex-col items-center justify-center px-6 py-32 text-center sm:py-32 relative gap-24 min-h-[clamp(10rem,70vh,70rem)]">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-24">
          <div className="mx-auto flex max-w-full flex-col items-center gap-6">
            <h1 className="font-display font-black tracking-tight text-6xl sm:text-7xl md:text-8xl flex flex-col items-center justify-center">
              <LogoMark className="absolute size-60 md:size-72 text-paper-100 dark:text-background -z-1 dark:drop-shadow-none" />
              KATARI
            </h1>

            <p className="max-w-xl text-lg text-muted-foreground sm:text-xl font-display-text font-light">
              {siteConfig.description}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href={`/docs/${version}/getting-started`}
            className="inline-flex h-11 items-center justify-center gap-2
            px-6 text-base font-display-text font-normal text-accent-foreground transition-all hover:opacity-80
            bg-highlight
            shadow-2xl shadow-highlight-300/5"
          >
            Get Started
            <ArrowRight className="size-4" />
          </Link>
          <Link
            href={siteConfig.github}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center justify-center border border-border px-6 text-base font-display-text font-normal transition-all hover:bg-muted hover:border-border-strong"
          >
            View on GitHub
          </Link>
        </div>
      </section>

      <section className="px-6 py-24 text-center">
        <div className="mx-auto max-w-2xl flex flex-col items-center gap-4">
          <h2 className="font-display-text font-bold text-3xl sm:text-4xl tracking-tight">
            Why Katari?
          </h2>
          <p className="text-muted-foreground font-light text-lg max-w-xl">
            Building agent networks is inherently complex. Katari is a language designed from the
            ground up to orchestrate agents — with a structured effect system, expressive types, and
            a complete toolchain.
          </p>
          <Link
            href={`/docs/${version}/getting-started/why-katari`}
            className="inline-flex items-center gap-2 text-base font-display-text font-normal text-foreground underline underline-offset-4 decoration-border-strong transition-all hover:opacity-70"
          >
            The long answer
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>

      <section className="px-6 pb-32">
        <div className="mx-auto max-w-5xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {featureCards.map((card) => (
            <FeatureCard key={card.title} {...card} />
          ))}
        </div>
      </section>
    </>
  );
}
