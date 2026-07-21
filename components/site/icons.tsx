import type { SVGProps } from "react";

// A hexagonal hub with a lit center node and three spokes — the node-graph shorthand for the Model
// Context Protocol. Self-authored so it inherits `currentColor` and sits beside the GitHub / theme
// icons at the same weight, rather than pulling in a vendor mark.
export function McpIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
      width="1em"
      height="1em"
      {...props}
    >
      <path d="M12 2.5 20.23 7.25 20.23 16.75 12 21.5 3.77 16.75 3.77 7.25Z" />
      <path d="M12 12 12 2.5M12 12 3.77 16.75M12 12 20.23 16.75" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="2.5" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="3.77" cy="16.75" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="20.23" cy="16.75" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function GithubIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      width="1em"
      height="1em"
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.34.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.3-.51-1.46.11-3.04 0 0 .96-.31 3.16 1.18.92-.26 1.9-.39 2.88-.39s1.96.13 2.88.39c2.2-1.49 3.16-1.18 3.16-1.18.62 1.58.23 2.74.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.18c0 .31.21.68.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"
      />
    </svg>
  );
}
