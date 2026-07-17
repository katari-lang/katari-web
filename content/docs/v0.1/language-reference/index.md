---
title: Language Overview
description: Entry point to the Katari language reference, covering syntax, types, and effects, with links to the pages that go deeper on each.
---

Katari is a language that expresses delegation between agents, parallel execution, and the
passing of capabilities directly in its syntax. This section is the language reference. Here is
where to start:

- **To learn the syntax**, see [Syntax]({docs}/{currentVersion}/language-reference/syntax):
  declarations, `match` / `for` / `parallel`, `use` / `finally`, and the partial application hole
  `_`.
- **To learn the type system**, see [Types]({docs}/{currentVersion}/language-reference/types):
  basic types, object types, direct unions, private/public attributes, and the shape of effect
  row types.
- **To learn the effect model**, see [Effects]({docs}/{currentVersion}/language-reference/effects):
  `request` / `use handler`, escalation, and the distinction between `throw[T]` and `panic`.

Each topic also has its own page that can be read independently:

<DocCards>
  <DocCard href="{docs}/{currentVersion}/language-reference/syntax" />
  <DocCard href="{docs}/{currentVersion}/language-reference/types" />
  <DocCard href="{docs}/{currentVersion}/language-reference/effects" />
  <DocCard href="{docs}/{currentVersion}/language-reference/partial-application" />
  <DocCard href="{docs}/{currentVersion}/language-reference/providers" />
  <DocCard href="{docs}/{currentVersion}/language-reference/finally" />
</DocCards>

For the exact signature of each prelude submodule, see
[Standard Library]({docs}/{currentVersion}/standard-library); for guides to integrating external
systems, see [Guides]({docs}/{currentVersion}/guides).
