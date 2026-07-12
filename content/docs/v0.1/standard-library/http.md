---
title: prelude.http
description: ランタイム組み込みの HTTP クライアント (fetch / post_json) — header と body の private-capable な提出面。
---

ランタイム組み込みの HTTP クライアント。呼び出しは runtime の `http` reactor に route する
(FFI sidecar なし — `mcp` / `webhook` と同じ「runtime 内蔵の外部呼び出し」)。default import 経由で
`http.` qualified に呼ぶ。external 呼び出しなので io を行い、呼び出し側の effect 行に `io` が
加わる。

## private の情報流: 宛先サーバーへの提出面だけが通す

private な値がランタイムを出てよいのは、**リクエストの宛先サーバーへ向かうときだけ**。その意図的な
提出面 — header の値 **と** `body` — は `string of private` で、secret (認証トークン、フォーム
エンコードされた `refresh_token` など) をそのまま渡せる。両方とも 1 箇所の transport 境界で reveal
され、そこでリクエストはプログラムが名指した唯一のサーバーへ発つ。

`url` と `method` は public な `string` のまま — private を渡すと型エラーになる。URL はログ・
キャッシュ・プロキシ・`Referer` ヘッダに漏れる、つまり宛先サーバー以外の場所にも流れるからだ。
レスポンスは public (declassify 済み) — サーバーの応答であって secret の関数ではないので、
private な body を持つリクエストの応答も汚染されない。

## 型

### `http.fetch_error`

```katari
data fetch_error(message: string)
```

リクエストが完結しなかった: DNS 失敗、接続拒否、タイムアウト、途中でのランタイム再起動。`fetch` が
投げる。応答が届いた場合は (どんな `status` でも) エラーではない — `status` で分岐する。

### `http.status_error`

```katari
data status_error(status: integer, body: string)
```

JSON API が非 2xx を返した。`post_json` が投げる (生の `fetch` は届いた応答をエラー扱いしない —
この wrapper だけが JSON API の作法を前提にする)。

## agent

### `http.fetch`

```katari
external agent fetch(
  url: string,
  method: string,
  headers: record[string of private],
  body: string of private,
) -> { status: integer, headers: record[string], body: string } with prelude.throw[fetch_error] from "http"
```

`url` に `method` (`"GET"` / `"POST"` など) でリクエストする。各 header 値と `body` は secret でよい
(両方とも `url` のサーバーにのみ提出され、`url` と `method` は public のまま)。応答の `status`・
`headers` (名前は小文字化、重複ヘッダは `", "` で join)・`body` テキストを返す。リクエストが完結
しなければ `fetch_error` を投げる。

```katari
agent get_item(token: string) -> string with io | prelude.throw[http.fetch_error] {
  let response = http.fetch(
    url = "https://api.example.com/items",
    method = "GET",
    headers = record.set(target = record.empty(), key = "Authorization", value = "Bearer " ++ token),
    body = "",
  )
  match (response.status) {
    case 200 -> response.body
    case _ -> "request failed"
  }
}
```

- **Throws** `fetch_error` (リクエストが完結しなかった)。

### `http.post_json`

```katari
agent post_json(
  url: string,
  body: string of private,
  headers: record[string of private],
) -> string with io | prelude.throw[status_error | fetch_error] {
  let effective_headers = record.merge(
    left = record.set(target = record.empty(), key = "Content-Type", value = "application/json"),
    right = headers,
  )
  let response = fetch(url = url, method = "POST", headers = effective_headers, body = body)
  if (response.status >= 200 && response.status < 300) {
    response.body
  } else {
    prelude.throw(error = status_error(status = response.status, body = response.body))
  }
}
```

`body` を `application/json` として `url` に POST する。`body` と各 header 値は secret でよい (両方
`url` のサーバーにのみ提出される)。`Content-Type: application/json` を既定で加えるが、呼び出し側が
同じキーを持てばそちらが勝つ。応答の body テキストを返す。JSON API 統合の一撃呼び出し: body を
Katari で `json` として組み、POST し、応答を Katari で `json` として読む。

```katari
agent respond(prompt: string, api_key: string of private) -> string with io | prelude.throw[http.status_error | http.fetch_error] {
  let body = json.to_text(value = { model = "gpt-5", input = prompt })
  let headers = record.set(target = record.empty(), key = "Authorization", value = "Bearer " ++ api_key)
  http.post_json(url = "https://api.example.com/responses", body = body, headers = headers)
}
```

- **Throws** `status_error` (非 2xx 応答)、`fetch_error` (リクエストが完結しなかった)。

## 関連

<DocCards>
  <DocCard href="{docs}/{currentVersion}/standard-library/json" />
  <DocCard href="{docs}/{currentVersion}/standard-library/webhook" />
  <DocCard href="{docs}/{currentVersion}/language-reference/types" />
</DocCards>
