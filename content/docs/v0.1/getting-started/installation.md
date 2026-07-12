---
title: Installation
description: CLI を npm でインストールし、docker compose で自前の runtime を立てる。
---

Katari は 2 つのものを用意する: プロジェクトをコンパイル・デプロイする **CLI** と、それを実行する
**runtime**。

## CLI

`@katari-lang/cli` は薄い Node シムで、実体は `@katari-lang/cli-<platform>` パッケージが運ぶ
プリビルドのネイティブバイナリ (npm/pnpm が optionalDependency として自動選択する)。

```sh
npm i -g @katari-lang/cli
# または per-project に
pnpm add -D @katari-lang/cli
```

対応プラットフォームは `linux-x64` / `darwin-arm64` (Intel mac は Rosetta 2 経由)。それ以外の
環境では [Releases](https://github.com/katari-lang/katari/releases) からビルド済みの tarball を
落とすか、`stack build` でソースからビルドする。

```sh
katari --version
katari --help
```

## Runtime

プロジェクトをデプロイして実行するには runtime が要る。`katari init` (次の
[Quickstart]({docs}/{currentVersion}/getting-started/quickstart) 参照) が生成する `compose.yaml`
は、Postgres・S3 互換の blob ストア (SeaweedFS)・runtime イメージの 3 サービスからなる自前の
スタックを立てる。

```sh
cp .env.example .env
echo "KATARI_API_KEY=$(openssl rand -hex 32)"       >> .env
echo "KATARI_SECRET_KEY=$(openssl rand -base64 32)" >> .env
docker compose up -d
```

- `KATARI_API_KEY` — CLI と admin console が Bearer トークンとして認証に使う鍵。無いと runtime は
  起動しない。
- `KATARI_SECRET_KEY` — secret 値の at-rest 暗号化キー (base64, 32 bytes)。`KATARI_API_KEY` とは
  別の鍵。

起動すると admin console (`/`) と JSON API (`/api/v1`) が同じポート (既定 3000) で立ち上がる。
CLI は `katari.toml` の `[runtime].url` (既定 `http://localhost:3000`) と `.env` の
`KATARI_API_KEY` を読んでそこに繋ぐ。クラウドの blob ストレージに向けたい場合は
`BLOB_S3_ENDPOINT` を外して実際の AWS 認証情報を設定し、`seaweedfs` サービスを削除する。

## 関連

<DocCards>
  <DocCard href="{docs}/{currentVersion}/getting-started/quickstart" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/cli" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/runtime" />
</DocCards>
