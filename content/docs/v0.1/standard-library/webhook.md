---
title: prelude.webhook
description: 動的に生成される inbound HTTP エンドポイント — inbound(callback, subscriber)。
---

`http.fetch` の逆向き: プログラムが外の世界を呼ぶのではなく、外の世界がプログラムを呼ぶ。呼び出しは
runtime の `webhook` reactor に route する (`http.fetch` / `mcp.*` と同じく in-runtime — FFI sidecar
なし)。default import 経由で `webhook.` qualified に呼ぶ。external 呼び出しなので io を行い、
呼び出し側の effect 行に `io` が加わる。

## agent

### `webhook.inbound`

```katari
external agent inbound[R, effect E](
  callback: agent never -> unknown with E,
  subscriber: agent (url: string) -> R with E,
) -> R with E from "webhook"
```

`subscriber` が走っている間だけ生きる、推測不能な公開 URL を発行する。その URL への POST は
すべて `callback` の呼び出しに変換される — JSON body が引数になり (`callback` の入力スキーマに
適合しなければ 400 で拒否され、`callback` は走らない)、`callback` の結果が JSON 応答になる。URL の
所持が唯一の credential — bearer 認証の API 面の外に mount され、他の誰にも呼べない。

`subscriber` が URL の生存期間を所有する: 発行された URL を受け取り、典型的には外部サービス
(カレンダーの push 通知 API、リポジトリの webhook 設定 — 通常は FFI 経由) にそれを登録して、
配信が流れるべき間 生き続ける。`subscriber` が return すると URL は失効し、その結果が `inbound` の
結果になる。run を cancel すると `subscriber` を cancel し (その FFI cleanup が走る)、同じ経路で
URL を失効させる。

```katari title="webhook.ktr"
agent double(value: integer) -> integer {
  value * 2
}

agent self_subscriber(url: string) -> string {
  let first = deliver(url = url, value = 21)
  f"delivered: ${first}"
}

agent deliver(url: string, value: integer) -> string {
  let response = http.fetch(
    url = url,
    method = "POST",
    headers = record.empty(),
    body = json.to_text(value = { value = value }),
  )
  response.body
}

agent main() -> string {
  webhook.inbound(callback = double, subscriber = self_subscriber)
}
```

再起動を跨いで配信中だった HTTP 待機は失われる (プロバイダのリトライが再配達する) が、URL 自体は
durable — `subscriber` が settle するまで再起動を生き延びる。

## 関連

<DocCards>
  <DocCard href="{docs}/{currentVersion}/standard-library/http" />
  <DocCard href="{docs}/{currentVersion}/standard-library/mcp" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/runtime" />
</DocCards>
