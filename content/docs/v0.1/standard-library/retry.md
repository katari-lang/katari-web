---
title: prelude.retry
description: 失敗回復の use provider — exponential / forever / attended と、正規化境界 attempt。
---

失敗回復の provider 群。各々が普通の [`use` provider]({docs}/{currentVersion}/language-reference/providers)
で、続く block (継続) を失敗時に**再実行する** — 継続を複数回呼び直す初のコードでもある。durable な
[`time.sleep`]({docs}/{currentVersion}/standard-library/time) と 2 つのエラーチャネルの上に書かれた
素の Katari で、新しい reactor は無い。統合は 1 行:

```katari
data flaky_error(message: string)

agent retried() -> string with io | prelude.throw[flaky_error] {
  use retry.exponential(initial_delay_milliseconds = 100.0, factor = 2.0, max_attempts = 5.0)
  flaky_step()   // 以降の block 全体が、成功するか budget が尽きるまで再実行される
}

agent flaky_step() -> string with prelude.throw[flaky_error] {
  prelude.throw(error = flaky_error(message = "still warming up"))
}
```

## 設計の核: 1 つの正規化境界と、再送出できない panic

Katari の失敗チャネルは 2 本ある — プログラムが raise する typed な `throw[Error]` と、runtime が
起こす `panic`。retry はどちらも「その attempt は失敗した」として扱う必要があり、その catch は
`attempt` (下記) の **1 箇所** に集約される。各 provider は `succeeded | failed` の直和への `match`
だけで書かれ、カウンタへの比較はどこにも無い。

catch は **generic な** `Error` に対して `throw[Error]` を discharge するので、捕まえた throw は
`thrown[Error]` として型を保ったまま reify される — `http.fetch` を包んだ
`use retry.exponential(...)` は、枯渇時も `throw[http.fetch_error]` を (erase された
`throw[unknown]` ではなく) そのまま再送出する。

もう 1 つの制約が設計を規定する: **捕まえた `panic` は Katari から再送出できない** (プログラムは
`panic` を perform できない)。だから「失敗を保持して枯渇時に投げ直す」provider は書けない —
`exponential` の枯渇の扱い (最終 attempt を素通しで走らせる) はこの制約の帰結である。

## 型

### `retry.thrown` / `retry.panicked` / `retry.failure`

```katari
data thrown[Error](error: Error)
data panicked(message: string)
type failure[Error] = thrown[Error] | panicked
```

1 回の attempt の失敗を 2 チャネルにまたがって正規化した直和。`thrown` は捕まえた throw の payload
を型ごと保持し、`panicked` は捕まえた panic の message を運ぶ。2 つを区別したまま残すのは、
anticipated な typed error と壊れた不変条件は意味が違い、handler が別々に反応したいことがあるため。

### `retry.succeeded` / `retry.failed` / `retry.outcome`

```katari
data succeeded[R](value: R)
data failed[Error](failure: failure[Error])
type outcome[R, Error] = succeeded[R] | failed[Error]
```

継続を 1 回走らせた結果: 値、または正規化された失敗。

## agent

### `retry.attempt`

```katari
agent attempt[R, Error, effect E](
  run: agent (value: null) -> R with {...E, prelude.throw[Error]},
) -> outcome[R, Error] with E
```

`run` を 1 回走らせて outcome を reify する: 値は `succeeded`、捕まえた throw / panic は `failed`。
失敗が catch される **唯一の** 境界で、下の 3 provider はすべてこれの上に合成されている。`run` の
effect が union `E | throw[Error]` ではなく **overwrite 行** `{...E, prelude.throw[Error]}` なのは、
この handler が throw を discharge するから (discharge される request は常に overwrite 行に置く —
詳細は [Effects]({docs}/{currentVersion}/language-reference/effects) の行の節)。`run` の他の effect
`E` はそのまま通過する。

### `retry.exponential`

```katari
agent exponential[R, Error, effect E](
  initial_delay_milliseconds: number,
  factor: number,
  max_attempts: number,
  continuation: agent (value: null) -> R with {...E, prelude.throw[Error]},
) -> R with E | io | prelude.throw[Error]
```

block の残りを指数 backoff で最大 `max_attempts` 回まで再実行する。n 回目 (1-based) の失敗
(throw **または** panic) は、n < `max_attempts` なら `initial_delay_milliseconds` × `factor`^(n-1)
だけ durable に sleep して再実行する。

**枯渇は構造で分岐する**: `for` が catch 可能な attempt (`max_attempts - 1` 回) を回し、その `then`
節が **最終 attempt を `attempt` の外で** — 素の `continuation(...)` として — 走らせる。だから最終
attempt が raise したものは throw でも panic でも**無変更で**伝播する (throw は型を保って呼び出し元へ
re-throw、panic は re-panic)。「最後の attempt か?」という n への分岐は存在しない。捕まえた panic を
再送出できない以上、これが枯渇の唯一の表現である。attempt は最低 1 回は走る (1 未満の
`max_attempts` でも 1 回)。budget は `array.range` の 1000 万要素上限で頭打ち — 桁違いの
`max_attempts` はエントリで大声で panic する。無限リトライは大きな budget ではなく `forever` を使う。

- **Throws** 継続の `throw[Error]` (枯渇した最終 attempt のものが、型を保ってそのまま)。

### `retry.forever`

```katari
agent forever[R, Error, effect E](
  initial_delay_milliseconds: number,
  factor: number,
  max_delay_milliseconds: number,
  continuation: agent (value: null) -> R with {...E, prelude.throw[Error], done[R], backoff},
) -> R with E | io
```

block の残りを **永遠に** 再実行する。すべての失敗 (throw **または** panic) は catch されて
retry され、失敗値は**破棄される** (意図的 — 決して re-raise せず、自分からは return しない)。
backoff は `factor` 倍で伸び、`max_delay_milliseconds` を上限とする。transient な失敗と再起動を
またいで生き続けるべき daemon のための形である。

ループは [`forever { ... }` 構文]({docs}/{currentVersion}/language-reference/syntax#forever) —
1 本の iterating thread で、settle した attempt の frame は回収されるので、**durable な状態は失敗
回数によらず flat**: 100 万回 retry した daemon も 1 回のそれと同じ行数しか占めない。継続の
overwrite 行の `done[R]` / `backoff` は provider 自身の handler が discharge する内部プロトコルで、
アプリコードには決して届かない。

**time.watch との合成** — このリリースの主役の形。`deliver_to` の失敗は
[`time.watch`]({docs}/{currentVersion}/standard-library/time) を殺す (watch の設計):
`retry.forever` がそれを catch して backoff し、`watch` を再実行する — `watch` は永続化された次の
occurrence から re-arm するので、cron / daemon が transient な失敗をまたいで復元する。

```katari
data delivery_failed(scheduled: number)

agent flaky_deliver(time: number) -> null with prelude.throw[delivery_failed] {
  prelude.throw(error = delivery_failed(scheduled = time))
}

agent daemon() -> never with io {
  use retry.forever(initial_delay_milliseconds = 100.0, factor = 2.0, max_delay_milliseconds = 5000.0)
  time.watch(schedule = time.interval(milliseconds = 1000), deliver_to = flaky_deliver)
}
```

### `retry.attended`

```katari
request attention[Error](failure: failure[Error]) -> null

agent attended[R, Error, effect E](
  continuation: agent (value: null) -> R with {...E, prelude.throw[Error], done[R]},
) -> R with E | attention[Error]
```

人間をループに入れた retry: 失敗 (throw **または** panic) のたびに、正規化した failure (typed error
は型ごと) を載せて `attention` を perform し、それが resolve したら block を再実行する。

- **未処理なら escalate → park → answer で再実行** — `attention` は普通の user-facing request なので、
  handler が無ければ [escalation]({docs}/{currentVersion}/language-reference/effects) として durable
  な open question になり、run は `katari answer` (または console) の回答まで park する。回答すると
  block が再実行される。これが再認証の定形: revoke されたトークンが throw し、`attended` がそれを
  通知に変え、人間が再認可して answer し、block が復元された credential に対して再実行される。
- **intercept できる** — `use retry.attended()` より上にアプリ自身の `attention` handler を置けば
  横取りできる (例: Discord に投稿してそこで待つ)。`next null` で retry をトリガーし、`break value`
  で諦めて値で抜ける。escalate (既定) も intercept も同じ機構で、handler がスコープにあるかどうかだけ
  で決まる — `attended` の側に分岐は無い。

`forever` と同じく `forever { ... }` 構文でループするので、失敗 → 回答のサイクルを何回繰り返しても
durable な状態は flat のまま。

```katari
data token_revoked(message: string)

agent call_api() -> string with prelude.throw[token_revoked] {
  prelude.throw(error = token_revoked(message = "re-authorize and answer to retry"))
}

agent resilient_call() -> string with retry.attention[token_revoked] {
  use retry.attended()
  call_api()   // 失敗のたびに attention が上がり、回答で再実行される
}
```

## 使い分け

| provider      | 失敗の行き先                                      | 終わり方                                             |
| ------------- | ------------------------------------------------- | ---------------------------------------------------- |
| `exponential` | durable sleep して再実行                          | 成功、または budget 枯渇で元の失敗が型を保って素通し |
| `forever`     | durable sleep (上限つき) して再実行、失敗値は破棄 | 成功のみ (自分からは決して失敗しない) — daemon 向け  |
| `attended`    | `attention` request → park または intercept       | 成功、または intercepting handler の `break`         |

retry すべきでないエラーがある場合は、そのエラーを block の**内側** (provider より近い
`use handler`) で catch して provider に届かなくする — フィルタのノブは無い。

## 関連

<DocCards>
  <DocCard href="{docs}/{currentVersion}/standard-library/time" />
  <DocCard href="{docs}/{currentVersion}/language-reference/providers" />
  <DocCard href="{docs}/{currentVersion}/language-reference/effects" />
  <DocCard href="{docs}/{currentVersion}/language-reference/syntax" />
</DocCards>
