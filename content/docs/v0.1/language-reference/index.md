---
title: Language Overview
description: Katari 言語仕様の入口 — 構文・型・effect と、それぞれを深掘りする各ページ。
---

Katari は agent 間の delegation・並列実行・capability の受け渡しをそのまま構文で表す言語である。
このセクションは言語仕様のリファレンス。まずどこから読むかの案内:

- **構文が知りたい** → [Syntax]({docs}/{currentVersion}/language-reference/syntax) — 宣言・
  `match` / `for` / `parallel`・`use` / `finally`・部分適用の `_`。
- **型システムが知りたい** → [Types]({docs}/{currentVersion}/language-reference/types) — 基本型・
  object 型・direct union・private/public 属性・effect row の型の形。
- **副作用のモデルが知りたい** → [Effects]({docs}/{currentVersion}/language-reference/effects) —
  `request` / `use handler`、escalation、`throw[T]` と `panic` の使い分け。

個々のトピックを深掘りするページも独立して読める:

<DocCards>
  <DocCard href="{docs}/{currentVersion}/language-reference/syntax" />
  <DocCard href="{docs}/{currentVersion}/language-reference/types" />
  <DocCard href="{docs}/{currentVersion}/language-reference/effects" />
  <DocCard href="{docs}/{currentVersion}/language-reference/partial-application" />
  <DocCard href="{docs}/{currentVersion}/language-reference/providers" />
  <DocCard href="{docs}/{currentVersion}/language-reference/finally" />
</DocCards>

prelude 各サブモジュールの正確なシグネチャは
[Standard Library]({docs}/{currentVersion}/standard-library)、外部統合の手引きは
[Guides]({docs}/{currentVersion}/guides) を参照。
