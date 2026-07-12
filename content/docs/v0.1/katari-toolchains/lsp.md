---
title: LSP
description: エディタ向けの hover / completion / definition / references と、デバウンスされた診断。
---

`haskell/lsp` (`katari-lsp`) は compiler と診断基盤を共有する Language Server Protocol の実装。
VSCode 拡張 (`typescript/vscode`) がこれを起動して繋ぐ — 拡張自体はシンタックスハイライトに加え、
`katari.check` / `katari.build` のようなコマンドパレット項目を提供する。

## 提供する機能

| 機能        | 内容                                                                                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hover       | カーソル位置の式のソース断片と型を 1 行で表示し、トップレベル参照なら qualified 名も添える                                                                                       |
| Completion  | 3 モード: `ident.` の直後はモジュール / object のメンバー一覧、開いた `(` の中は呼び出し先のパラメータ ラベル一覧 (使用済みラベルは除く)、それ以外はスコープに見えているもの全部 |
| Definition  | カーソル位置のシンボルの定義箇所へジャンプ (依存パッケージも含む cross-module 解決)                                                                                              |
| References  | ワークスペース全体でのシンボルの全出現箇所 (定義自体も 1 つの occurrence として含む)                                                                                             |
| Diagnostics | 編集のたびにバッファを更新し、150ms デバウンスした再コンパイルの診断を publish する                                                                                              |

Completion の候補フィルタリング (前方一致など) はエディタ側が行う — サーバーは各モードの候補
セット全体を返す。

## 再コンパイルの仕組み

`didOpen` / `didChange` / `didClose` はまずバッファのオーバーレイを更新し、150ms デバウンスした
ワークスペース再コンパイルをスケジュールする。再コンパイルはプロジェクトをディスクから
(バッファのオーバーレイを重ねて) 読み直すので、ファイルの作成・削除・依存の変更は
無効化すべきキャッシュを気にせず自然に拾われる。ディスク上のファイル変更 (`workspace/didChangeWatchedFiles`)
も同じ再コンパイルをトリガーする。

## 関連

<DocCards>
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/compiler" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/cli" />
</DocCards>
