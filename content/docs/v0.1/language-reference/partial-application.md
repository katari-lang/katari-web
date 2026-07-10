---
title: Partial Application
description: 引数の一部を今固定し、残りを穴 `_` として残した residual agent を作る。
---

agent 呼び出しの引数の一部を今のスコープで固定し、残りを穴 (`_`) として残すと、その穴だけを
受け取る **residual agent** が得られる。設定値やハンドラをあらかじめ束ねてから、繰り返し呼び出す
コールバックに渡す、といった合成に使う。

## 構文

名前付き引数のうち、値を書いたものは **今固定** され、`_` を書いたものは **穴** になる。結果は
穴として残したパラメータだけを取る新しい agent である。

```katari title="scale.ktr"
@"倍率と値を掛ける。"
agent scale(factor: number, value: number) -> number {
  factor * value
}

@"`scale(factor = 2.0, value = _)` は factor を今固定し、
residual `agent (value: number) -> number` を返す。以降の呼び出しは穴だけを渡す。"
agent doubles(values: array[number]) -> array[number] {
  let double = scale(factor = 2.0, value = _)
  for (let value in values) { next double(value = value) }
}
```

`scale(factor = 2.0, value = _)` の型は `agent (value: number) -> number`。固定した `factor` は
束縛時に評価され、residual を何度呼んでも再評価されない。

## オプショナルパラメータ

穴にも値にもしなかったオプショナルパラメータは **省略され、defaulted のまま** になる。residual は
そのパラメータを一切運ばず、呼び出しごとに callee 側の default が residual を通して埋める。

```katari title="decorate.ktr"
@"`body` を `prefix` と、既定 `\"!\"` の `suffix` で飾る。"
agent decorate(prefix: string, body: string, suffix: string ?= "!") -> string {
  f"${prefix}${body}${suffix}"
}

@"`prefix` を固定、`body` を穴、`suffix` は省略 (穴でも値でもない)。
residual は `body` だけを運び、`suffix` は callee の default が埋める。"
agent marked() -> string {
  let mark = decorate(prefix = ">> ", body = _)
  mark(body = "hello")   // ">> hello!"
}
```

- 値を書いた引数 — 束縛時に固定される。
- `_` を書いた引数 — residual のパラメータになる。
- 省略したオプショナル引数 — defaulted のまま。residual には現れず、各呼び出しで default が埋める。

## 関連

<DocCards>
  <DocCard href="{docs}/{currentVersion}/language-reference/providers" />
  <DocCard href="{docs}/{currentVersion}/language-reference/effects" />
</DocCards>
