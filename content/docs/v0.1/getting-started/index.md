---
title: Introduction
description: What Katari is, and how to read this documentation section.
---

Katari is a language for writing the orchestration logic of AI agents. The compiler translates
`.ktr` source into a JSON intermediate representation (IR), which a long-running runtime server
executes and persists. Calling one agent from another (delegation), running work in parallel, and
asking a human a question (escalation) are all expressed directly in the language's syntax.

```katari
@"Ask a human for a decision. The run waits until an answer arrives."
request ask(question: string) -> string

@"Review one source by asking a human what stands out in it."
agent review(source: string) -> string with ask {
  let note = ask(question = f"What stands out in ${source}?")
  f"${source}: ${note}"
}

@"Review all sources in parallel and combine the results into one report."
agent main(sources: array[string]) -> string with ask {
  let notes = parallel for (let source in sources) {
    next review(source = source)
  }
  string.join(parts = notes, separator = "\n")
}
```

The `with ask` clause in each signature is the effect row: it records in the type that these
agents may perform the `ask` request. Nothing here handles `ask`, so it escalates out of the run.
The runtime shows the blocked delegation tree on the run page, and `katari answer` (or the inbox
in the console) answers each question.

## How to read this section

1. [Installation]({docs}/{currentVersion}/getting-started/installation) sets up the CLI and the
   runtime.
2. [Quickstart]({docs}/{currentVersion}/getting-started/quickstart) scaffolds a project, deploys
   it, and runs it, in about five minutes.
3. After that, [Language Reference]({docs}/{currentVersion}/language-reference) covers syntax,
   types, and effects; [Standard Library]({docs}/{currentVersion}/standard-library) documents the
   signature of each prelude agent; and [Guides]({docs}/{currentVersion}/guides) covers integrating
   external systems such as MCP.

<DocCards>
  <DocCard href="{docs}/{currentVersion}/getting-started/installation" />
  <DocCard href="{docs}/{currentVersion}/getting-started/quickstart" />
  <DocCard href="{docs}/{currentVersion}/language-reference" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains" />
</DocCards>
