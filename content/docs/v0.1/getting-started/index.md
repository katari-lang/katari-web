---
title: Introduction
description: Katari は agent オーケストレーションを書くための言語 — このセクションの読み方。
---

Katari は AI agent のオーケストレーションロジックを書くための言語である。`.ktr` ソースは
コンパイラが JSON の中間表現 (IR) にコンパイルし、常駐する runtime サーバーがそれを実行・永続化
する。agent 同士の呼び出し (delegation)、並列実行、人間への質問 (escalation) が、すべて言語の
構文としてそのまま書ける。

```katari
@"人間に判断を仰ぐ。回答が来るまで run は待つ。"
request ask(question: string) -> string

@"1 つのソースについて、人間に何が重要かを尋ねてレビューする。"
agent review(source: string) -> string with ask {
  let note = ask(question = f"What stands out in ${source}?")
  f"${source}: ${note}"
}

@"すべてのソースを並列にレビューし、結果を 1 つの report にまとめる。"
agent main(sources: array[string]) -> string with ask {
  let notes = parallel for (let source in sources) {
    next review(source = source)
  }
  string.join(parts = notes, separator = "\n")
}
```

各シグネチャの `with ask` が effect row — この agent 群が `ask` という request を行いうることを
型で追跡する。`ask` を handle するものが無いので、run の外へ escalate する: runtime は run ページに
ブロックされた delegation tree を表示し、`katari answer` (またはコンソールの inbox) が各質問に
回答する。

## このセクションの読み方

1. [Installation]({docs}/{currentVersion}/getting-started/installation) — CLI と runtime を
   用意する。
2. [Quickstart]({docs}/{currentVersion}/getting-started/quickstart) — プロジェクトを 1 つ
   scaffold し、デプロイして実行するまでを 5 分で辿る。
3. そのあとは [Language Reference]({docs}/{currentVersion}/language-reference) で構文・型・effect
   を、[Standard Library]({docs}/{currentVersion}/standard-library) で prelude の各 agent の
   シグネチャを、[Guides]({docs}/{currentVersion}/guides) で MCP のような外部統合の手引きを読む。

<DocCards>
  <DocCard href="{docs}/{currentVersion}/getting-started/installation" />
  <DocCard href="{docs}/{currentVersion}/getting-started/quickstart" />
  <DocCard href="{docs}/{currentVersion}/language-reference" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains" />
</DocCards>
