---
title: prelude.time
description: durable な wall-clock 時刻 — now / sleep / sleep_until と、schedule を監視する watch。
---

durable な wall-clock 時刻。呼び出しは runtime の `time` reactor に route する (`http.fetch` と同じ
in-runtime — FFI sidecar なし)。default import 経由で `time.` qualified に呼ぶ。external 呼び出し
なので io を行い、呼び出し側の effect 行に `io` が加わる。時刻はすべて **epoch ミリ秒**
(1970-01-01T00:00:00Z からの整ミリ秒) の `number`。

## なぜ時計が reactor 経由なのか (replay 問題)

runtime の replay 契約は「turn は durable な入力の決定的な関数」— commit されていない turn は
再起動後に同じ入力から再実行される。素の prim が `Date.now()` を読むとこの契約が壊れる: replay
された turn は初回と**違う**時刻を観測してしまう。`now` を reactor 経由にすると時計の読み取りが
turn の**外**に出る: 時刻は呼び出し元の turn がただ消費するイベントとして届き、それを消費した
commit が「観測した全てと一緒に」値を durable にする — 以降どの replay も再計算しない。その commit
より前に再起動した場合は現在の時計から新しい時刻を解決するが、これは健全 (最初の時刻を durable に
観測したものが何もないため)。同じ reactor が `sleep` / `watch` のタイマーも所有するので、deadline は
永続化され再起動をまたいで re-arm される。

## 型

### `time.interval`

```katari
data interval(milliseconds: number)
```

固定間隔: watch 開始から `milliseconds` ごとの occurrence (最初の occurrence は開始時ではなく
1 間隔後)。`milliseconds` は正でなければならない。

### `time.cron`

```katari
data cron(expression: string, timezone: string)
```

cron スケジュール: 標準 cron `expression` (5 フィールド形、または先頭が秒の 6 フィールド形) の
occurrence を、IANA `timezone` (例: `"Asia/Tokyo"`, `"UTC"`) で読む。**timezone は必須で、ambient な
既定は無い** — 「毎日 09:00」は zone ごとに違う時刻を意味し、durable なスケジューラが推測してはならない。

### `time.schedule`

```katari
type schedule = interval | cron
```

各 occurrence がいつ発火するか。`watch` に渡す。

## agent

### `time.now`

```katari
external agent now() -> number from "time"
```

現在の wall-clock 時刻を epoch ミリ秒で返す。時刻は最初にそれを観測した処理と一緒に durable に
なるので、下流のどこかが値を見た後は replay / recovery で決して変わらない。

### `time.sleep`

```katari
external agent sleep(milliseconds: number) -> null from "time"
```

`milliseconds` だけ待ってから `null` で resolve する。wake deadline (now + `milliseconds`) は
永続化される: 再起動はタイマーを re-arm し、runtime のダウン中に過ぎた deadline は recovery で即座に
resolve する。0 以下の `milliseconds` は即座に resolve する。

### `time.sleep_until`

```katari
external agent sleep_until(time: number) -> null from "time"
```

絶対 epoch ミリ秒 `time` まで待ってから `null` で resolve する。`sleep` と同じ durable な deadline
だが、相対 delay ではなく絶対時刻に pin する — すでに過去の時刻は即座に resolve する。

```katari
agent timed() -> string {
  let before = time.now()
  time.sleep(milliseconds = 1000)
  let after = time.now()
  f"slept for ${string.to_string(value = after - before)}ms"
}
```

### `time.watch`

```katari
external agent watch[effect E](
  schedule: schedule,
  deliver_to: agent (time: number) -> null with E,
) -> never with E | io from "time"
```

`schedule` の occurrence ごとに `deliver_to` を 1 回呼び、occurrence の予定 epoch ミリ秒を `time`
として渡す。`watch` は自分からは決して resolve しない (`-> never`) — run が cancel されるまで走り、
cancel されると in-flight の delivery を cancel して watch を畳む。`deliver_to` の effect `E` は
呼び出し側の handler へそのまま流れる。

```katari
agent daily_report(time: number) -> null with io | prelude.throw[http.fetch_error] {
  let response = http.fetch(
    url = "https://example.com/report",
    method = "POST",
    headers = record.empty(),
    body = json.to_text(value = { scheduled = time }),
  )
  null
}

agent report_daemon() -> never with io | prelude.throw[http.fetch_error] {
  time.watch(
    schedule = time.cron(expression = "0 9 * * *", timezone = "Asia/Tokyo"),
    deliver_to = daily_report,
  )
}
```

**Durability の意味論:**

- **再起動 re-arm** — 次の occurrence は永続化され、再起動が re-arm する。
- **missed tick は 1 回だけ catch-up** — runtime のダウン中に occurrence を 1 つ以上逃した場合、
  recovery で **ちょうど 1 回** だけ即座に発火し (最も早い missed occurrence の予定時刻を渡す)、
  以降は元のスケジュールに戻る。逃した分をすべて backfill することはない — 全 missed tick の
  replay は下流を殺到させる。
- **tick は at-least-once** — delivery と cursor 前進の境界は commit であり、その窓での crash は
  同じ occurrence を recovery で再配達する。`deliver_to` は同じ予定時刻の繰り返しに耐えること —
  予定 epoch ミリ秒が渡されるのは、必要なら dedupe できるようにするためである。
- **delivery は直列** — 次の occurrence は現在の delivery が settle するまで arm されない。間隔より
  遅い `deliver_to` は tick をキューに積むのではなく rate-limit する (in-flight は常に高々 1)。
- **失敗は watch を殺す** — throw / panic する `deliver_to` は retry **されない**。失敗はそのまま
  伝播して watch を殺す (呼び出し先の未処理の失敗一般と同じ)。復元性は呼び出しサイトで合成する —
  [`retry.forever`]({docs}/{currentVersion}/standard-library/retry) で包むのが定形
  (retry のページに完全な合成例がある)。
- **不正な schedule は panic** — 壊れた cron 式・timezone や正でない interval は typed error では
  なく panic (正しいプログラムは有効な schedule を渡す、という
  [throw / panic の分界]({docs}/{currentVersion}/language-reference/effects))。

## 関連

<DocCards>
  <DocCard href="{docs}/{currentVersion}/standard-library/retry" />
  <DocCard href="{docs}/{currentVersion}/language-reference/effects" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/runtime" />
</DocCards>
