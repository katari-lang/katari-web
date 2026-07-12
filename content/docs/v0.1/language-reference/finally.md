---
title: finally
description: instance の終了時に必ず走る finalizer を積む文 — 正常完了でもキャンセルでも走り、panic では走らない。
---

長寿命の agent instance には、正常終了でもキャンセルでも最後に必ず走らせたい後始末がある
(確保したリソースの解放、外部への「もう使わない」通知など)。`finally` は Go の `defer` に相当する
専用の **文** で、その後始末を漏れなく表現する。

## 構文と意味

`finally { <block> }` は文であり、値を返さない。評価すると、その block を現在の instance の
**finalizer スタックに積む** (arming)。body はパラメータを持たず、囲みスコープを通常の parent chain
越しに読む。

```katari title="finalizers.ktr"
@"後始末に使う capability — それを使う finalizer の内側で提供し、discharge する。"
request cleanup() -> null

agent run() -> string {
  finally { let _note = "bookkeeping done" }
  finally {
    use handler {
      request cleanup() -> null { next null }
    }
    let _released = cleanup()
  }
  "work complete"
}
```

## 発火のタイミングと順序

armed finalizer は、instance が自分の terminal を ack する直前に **arming の逆順** で走る。
同じ `finally` を二度通れば (ループ body など) 二度積まれる — これはスタック規律である。

| 状況                                              | finalizer は走るか                                |
| ------------------------------------------------- | ------------------------------------------------- |
| 正常完了 (delegate ack の直前)                    | 走る                                              |
| キャンセル到着 (cancel ack の直前)                | 走る                                              |
| panic (instance 異常終了)                         | 走らない                                          |
| ハンドラ待ちで停止中 (キャンセルがまだ来ていない) | 走らない (キャンセルが実際に到着してはじめて走る) |

正常完了の ack もキャンセルの ack も、どちらも terminal を確定させる一手前で同じ finalizer スタックを
消化する。panic は後始末の前提 (スコープが健全) を壊しているので、意図的に走らせない。

## io 限定規則 (K3021)

finalizer body の **残余 effect row は `io` の範囲内** でなければならない。finalizer は、親がすでに
この instance のキャンセルを待っている最中に走り得る。`io` は sibling reactor に流れて親を経由しない
が、request (escalation) は親を経由して proxy されるため、finalizer からの escalation はその待ちと
デッドロックし得る。これを避けるため、残余に残る request をコンパイル時に禁じる (K3021)。

- body 内で `use handler` により **ローカルに処理された** request は残余に現れないので OK
  (上の例の `cleanup` はこれ)。
- 制御 escape (`return` / `break` / `next`) も、終了時には行き先が無いので残余に残れば K3021。
- 検査は既存の推論が計算する **残余 row にだけ** `⊆ io` を課す。

正しい finalizer が行い得る effect は `io` に限られるので、それが囲みの effect row に寄与するのも
`io` だけである (`finally` の body が io を行う agent は、その row に `io` を持つ)。

## 原子性と panic

- finalizer 実行中の turn は、キャンセルが到着しても割り込まれず、1 つの atomic commit として畳まれる
  (既存の turn batching に乗る)。到着したキャンセルは実行後まで保留され、最終的な ack は変換される —
  finalizer を二重に走らせない。
- finalizer 自身が panic したら、それは instance の panic として扱う (後始末の失敗は握り潰さない)。
- 既知のトレードオフ: finalizer が `io` (外部呼び出し) でハングすると、その finalizer は割り込めない —
  instance の terminal はその io の完了を待つ。長時間の外部処理は finalizer ではなく通常の body 側に
  置く。

## 関連

<DocCards>
  <DocCard href="{docs}/{currentVersion}/language-reference/providers" />
  <DocCard href="{docs}/{currentVersion}/language-reference/effects" />
</DocCards>
