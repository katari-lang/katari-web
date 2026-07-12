---
title: Quickstart
description: katari init から katari run まで — escalation に端末で回答する最初の一往復。
---

[Installation]({docs}/{currentVersion}/getting-started/installation) を済ませた前提で、
プロジェクトを 1 つ scaffold してデプロイし、実行するまでを辿る。

## 1. scaffold する

```sh
katari init my-project
cd my-project
```

`katari.toml` (プロジェクト設定)・`compose.yaml` / `.env.example` (自前 runtime 用)・`src/main.ktr`
が生成される。`src/main.ktr` の中身:

```katari title="src/main.ktr"
// Your first Katari program. `main` asks its operator a question: the `ask_name` request
// escalates out of the run, and `katari run` prompts you for the answer right in the
// terminal (or answer later with `katari answer`). Delete the request once you have real
// inputs — it is here to show the human-in-the-loop flow end to end.

request ask_name(prompt: string) -> string

agent main() -> string with ask_name {
  let name = ask_name(prompt = "What is your name?")
  f"Hello, ${name}!"
}
```

`ask_name` を handle するものがどこにも無いので、`main` の effect row にそのまま乗る —
呼び出すと escalation になる。

## 2. runtime を立てる

```sh
cp .env.example .env
echo "KATARI_API_KEY=$(openssl rand -hex 32)"       >> .env
echo "KATARI_SECRET_KEY=$(openssl rand -base64 32)" >> .env
docker compose up -d
```

admin console が [http://localhost:3000](http://localhost:3000) で立つ (初回アクセス時に
`KATARI_API_KEY` を訊かれる)。
CLI は `.env` からキーを読む。

## 3. デプロイして実行する

```sh
katari apply
katari run
```

`katari apply` はプロジェクトをコンパイルし、新しい snapshot として runtime にデプロイする。
`katari run` は agent を対話的に選べる (このプロジェクトでは `main.main` だけ) — 選ぶと
`ask_name` の escalation がそのまま端末のプロンプトになる:

```
? What is your name? Katari
```

答えると run が完了し、結果が表示される:

```
Hello, Katari!
```

`Ctrl-C` で detach しても run は runtime 側で走り続ける。回答が遅れる、あるいは別プロセスから
回答したい場合は `katari status <run>` で open question を確認し、`katari answer <escalation>`
で答えられる。

## 次は

- `src/main.ktr` の `request` / `use handler` を書き換えて、実際の入力を渡す agent に育てる —
  構文は [Syntax]({docs}/{currentVersion}/language-reference/syntax)、effect の考え方は
  [Effects]({docs}/{currentVersion}/language-reference/effects) を参照。
- `katari.toml` の `[dependencies]` に registry のパッケージを足すには `katari add`。
- 日々使うコマンドの一覧は [CLI]({docs}/{currentVersion}/katari-toolchains/cli)。

<DocCards>
  <DocCard href="{docs}/{currentVersion}/language-reference/syntax" />
  <DocCard href="{docs}/{currentVersion}/language-reference/effects" />
  <DocCard href="{docs}/{currentVersion}/katari-toolchains/cli" />
</DocCards>
