---
title: Effects
description: request と use handler、escalation (open question として park)、throw / panic の二本立て。
---

Katari の副作用は request/handler モデルで表面化する: `request` が effect を宣言し、`use handler`
がその実装を導入し、宣言されているのに手元で discharge されない request は **escalation** として
呼び出し元へ、最終的には run の外へ上がる。

## request の宣言

```katari
@"1 回ごとに次のカウンタ値を返す capability。"
request tick() -> integer
```

`request name[generics](params) -> T` は本体を持たない — 実装は呼び出し側のスコープにある
`use handler` が供給する。宣言した agent のシグネチャに `with tick` のように現れ、これが
**effect row** のエントリになる。

## handler で実装する

```katari
request tick() -> integer

agent count_three() -> array[integer] with tick {
  use handler (var counter = 0) {
    request tick() { next counter with { counter = counter + 1 } }
  }
  [tick(), tick(), tick()]
}
```

`use handler { request name(params) [-> T] { body } ... }` は続く block (継続) に capability を
導入する。`(var counter = 0)` は handler 自身の状態変数 — 呼ばれるたびに body が走り、
`next value [with { counter = ... }]` が呼び出し元へ値を返しつつ状態を更新して次の呼び出しへ備える。
`break value` は handler を discharge して block 自体を終了させる (`then` があればそちらへ)。
状態を持たない handler は `(var ...)` を省略してよい (前出の `tick` のように)。

`use` は provider の一回適用として定義されている一般構文で、`handler` リテラルはその 1 形態 —
設定を取る provider agent への一般化は
[Providers]({docs}/{currentVersion}/language-reference/providers) を参照。

## marker effect

```katari
effect scoped[resource]
```

`effect name[generics]` は **オペレーションを持たない** capability マーカー: 一度も perform
されず、handle もされず、lowering で消える。effect row に乗って「このスコープの中でしか呼べない」
という静的な gate を表す (呼び出しを許可するかどうかだけの判定に使い、実行時には何もしない)。
[`prelude.mcp`]({docs}/{currentVersion}/standard-library/mcp) の `scope[URL]` がその実例 —
`provide` が継続の行にこれを mint し、自分の結果行から discharge するので、スコープが閉じた後は
そのマーカーを持つ呼び出しが型検査を通らなくなる。

## escalation

`use handler` で discharge されない request は、そのまま囲みの effect row に残って上へ伝播する。
どの agent も handle しないまま run の root まで達すると、**escalation** として run の外に出る —
run は「open question」を抱えたまま park し、runtime のコンソール (Escalations inbox) や
`katari answer` (詳細は [CLI]({docs}/{currentVersion}/katari-toolchains/cli)) で答えるまで
そこで待つ。並行して動く複数の delegation はそれぞれ独立した escalation を持てる。

```katari
request ask(question: string) -> string

agent consult(topic: string) -> string with ask {
  let advice = ask(question = f"What should we consider about ${topic}?")
  f"${topic}: ${advice}"
}

agent panel(first: string, second: string) -> array[string] with ask {
  parallel [consult(topic = first), consult(topic = second)]
}
```

`panel` を実行すると、2 つの並列な `consult` それぞれが `ask` で park する — run ページの
delegation tree に、どの agent が何を尋ねているか (`main` → `panel` → 2 つの `consult`) が
そのまま表示される。両方に回答すると run が完了する。

## throw[T] — 型付きエラー

```katari
request throw[T](error: T) -> never
```

`throw` は prelude の generic な request 1 つで、ペイロード型 `T` は失敗する操作のそばに宣言する
ドメイン固有の `data` (`json.parse_error`、`http.fetch_error`、`env.missing_secret` など)。
`-> never` は「resume できない」ことを型で保証する — handler は `next` できず、`break` で handle を
抜けるか、re-throw するしかない (catch-and-break)。

```katari
data not_even(value: integer)

agent half(value: integer) -> integer with prelude.throw[not_even] {
  if (value % 2 == 0) {
    math.floor(value = value / 2)
  } else {
    prelude.throw(error = not_even(value = value))
  }
}

agent describe_half(value: integer) -> string {
  use handler {
    request prelude.throw(error: not_even) -> never {
      break f"${string.to_string(value = error.value)} is odd — no half"
    }
  }
  f"half=${string.to_string(value = half(value = value))}"
}
```

同じスコープで複数の `throw` が起きても行のエントリは 1 つに合流する — `throw[a]` と `throw[b]`
が混ざれば `throw[a | b]` になる。handler はそのペイロード注釈でどの型を discharge するか宣言し、
**合流した union をすべて処理するか、何も処理しないか** のどちらかしかない (一部だけを handle して
残りを re-throw するなら `match` で分けて再度 `prelude.throw` する)。catch し忘れた `throw` は run
を失敗させる。

## panic — ランタイム自身の失敗チャネル

`panic` は prelude に**宣言が無い** — プログラムから raise することはできない。非網羅的な
`match`、ゼロ除算、FFI インフラの異常、エンジンの backstop といった「プログラムやデプロイが壊れて
いる」ことを示す不変条件違反でランタイムが起こす。ハンドルしなければ run はそのまま失敗する。

宣言がなくても、`panic` という**予約されたハンドラ名**で捕まえることはできる (ambient — raise は
できないが handle はできる):

```katari
agent survive_panic() -> string {
  use handler {
    request panic(msg: string) { break f"panic caught: ${msg}" }
  }
  let boom = 1 / 0   // ゼロ除算は throw ではなく panic
  "unreachable"
}
```

`throw` と `panic` の使い分けは「正しいプログラムがこの失敗に実行時に出会って、まともに続行
できるか」で決める。できる (`json.parse` の不正なテキスト、`http.fetch` の接続断) なら `throw` に
ドメインエラーの `data` を添える。できない (壊れた不変条件) なら panic のままにする。

| 操作                                  | 失敗                            | 経路                                      |
| ------------------------------------- | ------------------------------- | ----------------------------------------- |
| `json.parse` / `parse_as`             | 不正なテキスト / スキーマ不適合 | `throw[json.parse_error \| decode_error]` |
| `http.fetch`                          | 接続が完結しない                | `throw[http.fetch_error]`                 |
| `env.get_secret`                      | キー未設定                      | `throw[env.missing_secret]`               |
| `reflection.call_agent`               | callable でない / 引数不適合    | `throw[reflection.call_error]`            |
| ゼロ除算 (`/` `%`)                    | —                               | panic                                     |
| 非網羅的な `match`、エンジン backstop | —                               | panic                                     |

## 関連

<DocCards>
  <DocCard href="{docs}/{currentVersion}/language-reference/providers" />
  <DocCard href="{docs}/{currentVersion}/language-reference/finally" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/runtime" />
</DocCards>
