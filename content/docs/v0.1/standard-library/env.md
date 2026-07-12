---
title: prelude.env
description: プロジェクトスコープの環境アクセス — get_secret (private, throw) と get_all (public)。
---

プロジェクトスコープの環境アクセス。ランタイムが起動時にプロジェクトの `env_entries` ストアへ
束縛する host primitive で、default import 経由で `env.` qualified に呼ぶ。secret とそれ以外で
読み方を分けている: secret はキーごとに `get_secret` で読み、結果は `string of private`
(user-facing な境界を越えられない — header や FFI 呼び出しのような sink にのみ渡せる)。secret
でないエントリは `get_all` でまとめて公開 (public) な `string` として読む。

secret の設定・一覧・削除は CLI 側の操作 —
[CLI › env]({docs}/{currentVersion}/katari-toolchains/cli#env) を参照。

## 型

### `env.missing_secret`

```katari
data missing_secret(key: string, message: string)
```

`key` の下に secret なエントリが設定されていない。`get_secret` が投げる — オプショナルな設定・
既定値へのフォールバックのように、プログラムが回復し得る想定内の失敗としてモデル化されている。
catch しなければ run は失敗する。

## agent

### `env.get_secret`

```katari
primitive agent get_secret(key: string) -> string of private with prelude.throw[missing_secret]
```

`key` の secret エントリを private な文字列として読む (値は secret として汚染されており、
user-facing な境界に流れられない)。キーが無ければ `missing_secret` を投げる (`key` を運ぶので、
どの secret が不在かで分岐できる)。

```katari
agent optional_api_key() -> string of private {
  use handler {
    request prelude.throw(error: env.missing_secret) -> never { break "" }
  }
  env.get_secret(key = "OPTIONAL_API_KEY")
}
```

- **Throws** `missing_secret` (`key` の下にエントリが無い)。

### `env.get_all`

```katari
primitive agent get_all() -> record[string]
```

secret でないすべての env エントリを、env のキーをキーとする public な文字列の record として読む。

## 関連

<DocCards>
  <DocCard href="{docs}/{currentVersion}/language-reference/types" />
  <DocCard href="{docs}/{currentVersion}/language-reference/providers" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/cli" />
</DocCards>
