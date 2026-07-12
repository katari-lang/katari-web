---
title: Providers (use)
description: use 文で capability を導入する — handler リテラルから、引数を取る provider agent まで一様な適用形式。
---

`use handler { ... }` は、その後の block に capability を導入する。同じ導入をパラメータ化して
関数 (provider) に切り出せば、設定込みの capability をアプリのルートで積み重ねて合成できる —
`use gemini_provider(model = ..., api_key = ...)` のように。

## use は適用形式

`use <provider>` の provider に許される形は次の 4 つで、意味は常に一つ —
**provider を「書いた引数 ∪ continuation」に一回適用する**。continuation は `use` の後に続く残りの
block である。

| 形                   | 例                                                     |
| -------------------- | ------------------------------------------------------ |
| handler リテラル     | `use handler { request tick() -> integer { next 0 } }` |
| (qualified) 名前     | `use my_provider`                                      |
| 明示インスタンス化   | `use my_provider[integer]`                             |
| 適用 `callee(args…)` | `use my_provider(base = 1)`                            |

bare 形 (名前・インスタンス化) は零引数の適用である。フィールド読みや `match` など、それ以外の式は
**K3011** で拒否される — `let p = <式>` に束ねてから `use p`、または `use <式>(args…)` と書き直す。
形によって意味が変わる余地はない。

## provider はただの agent

provider は `continuation` パラメータを持つ普通の agent である。`continuation` は `use` 適用内の
**予約ラベル** で、明示的に渡すと拒否される (K3019)。もっとも単純な provider は continuation に値を
供給するだけで、R と effect E について generic に書ける。

```katari title="supply.ktr"
@"config 引数 + continuation を 1 つのパラメータレコードに持つ provider。"
agent supply[R, effect E](
  base: integer,
  continuation: agent (value: integer) -> R with E,
) -> R with E {
  continuation(value = base)
}

agent supplied() -> integer {
  let start: integer = use supply(base = 10)
  start + 1
}
```

`use supply(base = 10)` は `supply(base = 10, continuation = <残りの block>)` として一回適用される。
continuation の結果型 R と effect E は、この単一の呼び出しサイトから推論される。continuation が行う
request は、推論された E に乗って囲みの agent へ流れる。

## capability を導入する provider

continuation が使う request を provider が handler で discharge すると、provider は capability を
導入する。continuation のシグネチャにその request を宣言し、provider の内側で処理する。

```katari title="key_provider.ktr"
request get_key() -> string of private

@"api_key を `get_key` capability として continuation に導入する provider。"
agent key_provider(
  api_key: string of private,
  continuation: agent (value: null) -> string with get_key,
) -> string {
  use handler (var key = api_key) {
    request get_key() -> string of private { next key }
  }
  continuation(value = null)
}

agent client() -> string {
  use key_provider(api_key = env.get_secret(key = "SERVICE_KEY"))
  let key = get_key()
  "Bearer " ++ key
}
```

`use key_provider(api_key = ...)` の後の block が continuation になり、その中で `get_key` が使える。
provider の handler がそれを discharge するので、`client` の外へは escalate しない。

## use の束縛と注釈

`let x = use provider(...)` は continuation の **値** を束縛する (continuation が受け取る `value`)。
この形は型注釈が必須で、無いと **K3013** になる。

```katari
let start: integer = use supply(base = 10)   // OK
// let start = use supply(base = 10)          // K3013: 注釈が必要
```

## 関連

<DocCards>
  <DocCard href="{docs}/{currentVersion}/language-reference/effects" />
  <DocCard href="{docs}/{currentVersion}/language-reference/finally" />
  <DocCard href="{docs}/{currentVersion}/guides/mcp" />
</DocCards>
