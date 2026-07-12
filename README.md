# katari-web

Katari project の公式サイト。Next.js 16 (App Router / Turbopack) + Tailwind CSS v4 で構築。

## 開発

```sh
pnpm install
pnpm dev      # http://localhost:3000
```

`pnpm dev` / `pnpm build` は内部で `pnpm run search-index` を呼び、検索インデックスを
`public/search-index/<version>.json` に生成する。

その他のスクリプト:

| script              | 役割                            |
| ------------------- | ------------------------------- |
| `pnpm lint`         | ESLint                          |
| `pnpm typecheck`    | `tsc --noEmit`                  |
| `pnpm format`       | Prettier で全ファイル整形       |
| `pnpm format:check` | Prettier の整形チェック (CI 用) |
| `pnpm search-index` | 検索インデックスのみ再生成      |

## ディレクトリ

```
app/                    # ルート / docs / [version] / [...slug] のルーティング
components/
  site/                 # Header / Footer / Logo / ThemeToggle / icons
  docs/                 # Sidebar / VersionSwitcher / SearchDialog
  mdx/                  # Markdown render 用コンポーネントマップ
  theme-provider.tsx
content/docs/<version>/<category>/<slug>.md   # ドキュメント本体
lib/
  docs.ts               # version / nav / page / search-index のロジック
  site-config.ts        # サイトメタ・nav / footer link
public/                 # 画像など。katari.svg がロゴ (mask-image で塗り分ける)
scripts/build-search-index.ts                 # 検索インデックス生成
```

## ドキュメントの追加 (contributors)

新しいページを追加するには、以下のディレクトリ構造に従って `.md` を置くだけ:

```
content/docs/<version>/<category>/<slug>.md
```

各ページは frontmatter を持つ:

```markdown
---
title: ページタイトル
description: ページ説明 (任意)
---

# ページ内容
```

並び順を制御したい場合は各ディレクトリに `_meta.json` を置く:

```json
{
  "label": "Getting Started",
  "order": ["index", "installation", "quickstart"]
}
```

`_meta.json` がなければファイル名のアルファベット順で並ぶ。新しいバージョンを追加する場合は
`content/docs/<new-version>/` を作るだけ。サイドバーのバージョン切替は自動で出る。

## 差し替えポイント

- ロゴ画像: `public/katari.svg` を上書き (`lib/site-config.ts` の `logo` で参照パスを変更可)、または [components/site/logo.tsx](components/site/logo.tsx) を編集
- サイトメタ・footer link: [lib/site-config.ts](lib/site-config.ts)
- カラートークン: [app/globals.css](app/globals.css) の `:root` / `.dark` ブロック
- Markdown のスタイリング: [components/mdx/components.tsx](components/mdx/components.tsx)
- Hero コピー / ボタン: [app/page.tsx](app/page.tsx)

## デプロイ (Cloudflare Workers Static Assets)

`output: "export"` で静的書き出しした `out/` を Cloudflare Workers Static Assets で
配信する。Worker スクリプトは持たず、純粋に CDN 上で静的ファイルを返す構成。

```sh
pnpm cf:deploy           # pnpm build → wrangler deploy
pnpm cf:dev              # ローカルで wrangler dev (Cloudflare 互換ランタイム)
pnpm cf:preview          # 本番未昇格の preview version をアップロード
```

設定は [wrangler.jsonc](wrangler.jsonc) に集約。`name` を変えればデプロイ先 Worker
名を変更できる。`out/_headers` (= `public/_headers`) で `/opengraph-image` の
`Content-Type` を `image/png` に指定している。

## ライセンス

[MIT](LICENSE)。バンドルしている Lexend フォントは [SIL Open Font License (OFL)](public/OFL.txt) の下で配布されている。
