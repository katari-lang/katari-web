// The example programs, as the machine-facing surfaces list them (llms.txt and the MCP
// `onboarding` payload). A complete, running program is the highest-value artifact an AI author
// can be handed, and these four live in a separate repository — so unlike everything else on
// these surfaces they cannot be derived from this site's content at build time.
//
// Source of truth: https://github.com/katari-lang/examples (its README's "Reading order:"
// sentence). Kept here rather than in either consumer so llms.txt and the MCP server cannot
// describe them differently. When the examples repository gains or renames a project, this list is
// what has to move.

export interface ExampleProject {
  /** The directory name in the examples repository. The Katari package name in `katari.toml` is the
   *  same word with underscores (`release-watch` → `release_watch`), and that is what `katari run`
   *  takes. */
  name: string;
  url: string;
  /** What it does, for a reader deciding whether this is the one to open. */
  useCase: string;
  /** What reading it teaches — the Katari ideas it puts to work. */
  teaches: string;
}

export const EXAMPLES_REPOSITORY_URL = "https://github.com/katari-lang/examples";

export const EXAMPLE_PROJECTS: ExampleProject[] = [
  {
    name: "release-watch",
    url: `${EXAMPLES_REPOSITORY_URL}/tree/main/release-watch`,
    useCase: "A GitHub release monitor whose watch list one AI keeps from Discord.",
    teaches:
      "An AI front desk over a deterministic poll loop — `ai.route` with one AI beside one plain fiber, durable scheduling, store cursors, at-least-once announcements.",
  },
  {
    name: "standup-scribe",
    url: `${EXAMPLES_REPOSITORY_URL}/tree/main/standup-scribe`,
    useCase: "A Slack standup bot whose digest a human approves before it posts.",
    teaches:
      "The message plane vs the interaction plane, `ask` controls, approval before an irreversible step, scheduled jobs with timezones.",
  },
  {
    name: "concierge",
    url: `${EXAMPLES_REPOSITORY_URL}/tree/main/concierge`,
    useCase: "A two-AI Discord community concierge.",
    teaches:
      "Two `ai.spawn` lines on one route, a curated-knowledge membrane made of tool sets, mail between AIs. This is where the tutorial's last chapter sends you.",
  },
  {
    name: "inbox-butler",
    url: `${EXAMPLES_REPOSITORY_URL}/tree/main/inbox-butler`,
    useCase: "Gmail triage that proposes calendar events for one-click approval.",
    teaches:
      "OAuth credentials, AI triage with structured output, the gate-fiber idiom for an editable form.",
  },
];

/** The one-paragraph framing both surfaces put above the list. */
export const EXAMPLES_INTRO =
  "Four complete, deployable projects — clone, `katari lock`, one `npm install` inside the fetched " +
  "sidecar package, add tokens, `docker compose up`, `katari apply`. " +
  "Each pins a published registry snapshot and compiles in CI against the published CLI, so what " +
  "you clone is what runs. All four are residents: long-running programs that stay on a channel " +
  "or a schedule, and each README says what survives a runtime restart and what the interruption " +
  "costs. Prefer reading one of these over inventing a program shape.";
