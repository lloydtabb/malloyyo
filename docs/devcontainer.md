# The development container

`Dockerfile.dev` builds a prebuilt environment for working on a **Malloy model
repo**. It is not the server image — that is `Dockerfile`, covered in
[docker.md](./docker.md).

Published at `ghcr.io/malloydata/malloyyo-dev`, for `linux/amd64` and
`linux/arm64`.

## What's inside

| | |
| --- | --- |
| `malloyyo` | pinned, so the image and the project can't drift |
| `claude` | Claude Code |
| `gcloud`, `bq` | Google Cloud SDK — BigQuery models |
| `gh` | GitHub CLI |
| node 24, build toolchain | `lz4` compiles on install; without it nothing installs |

It is **large** — the Google Cloud SDK alone is ~815 MB installed. That is the
deliberate trade: pull once, and never ask someone to install a C++ toolchain
before their first query. On Windows especially, that install is the step that
loses people.

## Use it as a dev container

Put this in `.devcontainer/devcontainer.json` in your model repo:

```jsonc
{
  "name": "malloy-model",
  "image": "ghcr.io/malloydata/malloyyo-dev:latest",

  // 4173 serves the dashboard shell; `malloyyo dashboard dev` renders custom
  // (iframe) dashboards from a separate artifact origin on 4174 — without it
  // those dashboards come up blank. 41121 is the `malloyyo login` redirect.
  "forwardPorts": [4173, 4174],
  "appPort": ["41121:41121"],

  // Borrow the logins you already have on this machine, rather than signing in
  // again inside the container — and keep them across rebuilds.
  "mounts": [
    "source=${localEnv:HOME}/.config/gcloud,target=/home/node/.config/gcloud,type=bind,consistency=cached",
    "source=${localEnv:HOME}/.config/malloyyo,target=/home/node/.config/malloyyo,type=bind,consistency=cached",
    "source=${localEnv:HOME}/.config/gh,target=/home/node/.config/gh,type=bind,consistency=cached",
    "source=${localEnv:HOME}/.claude,target=/home/node/.claude,type=bind,consistency=cached"
  ],

  "customizations": {
    "vscode": { "extensions": ["malloydata.malloy-vscode"] }
  }
}
```

Then **Reopen in Container**. `.mcp.json` written by `malloyyo init` works
immediately, because `malloyyo` is already on PATH.

Those bind mounts have to exist on the host first — `mkdir -p ~/.config/malloyyo`
if you have never run the CLI locally. Somewhere with no host to borrow from
(Codespaces), drop the mounts and sign in inside the container instead; use
`type=volume` if you want that to survive a rebuild.

## Or plain Docker

```bash
docker run --rm -it \
  -v "$PWD:/work" -w /work \
  -p 4173:4173 -p 4174:4174 -p 41121:41121 \
  -v "$HOME/.config/gcloud:/home/node/.config/gcloud" \
  -v "$HOME/.config/malloyyo:/home/node/.config/malloyyo" \
  ghcr.io/malloydata/malloyyo-dev:latest bash
```

## Signing in from inside the container

**Malloyyo.** `malloyyo login` finishes its OAuth round trip by listening for a
redirect back on this machine. The image pins that listener to `41121` on all
interfaces (`MALLOYYO_OAUTH_PORT`, `MALLOYYO_OAUTH_HOST`) precisely so it can be
published — which is what `-p 41121:41121` / `appPort` above is for. Publish it
and `malloyyo login` works normally; the CLI prints the URL rather than trying to
open a browser it hasn't got.

This only works where your browser and the container share `localhost` — Docker
on your own machine. In a Codespace or on a remote host they don't, and the
redirect can't reach the listener; use a token (`--token`, or the env var named
in your `malloyyo` config block) until a device-code flow lands.

**Google / BigQuery.** The usual way, minus the browser launch:

```bash
gcloud auth application-default login --no-launch-browser
```

That writes Application Default Credentials to `~/.config/gcloud`, which is what
`@malloydata/db-bigquery` reads — so with the mount above you inherit whatever
you already did on the host and can skip this entirely.

For CI, or anywhere interactive sign-in doesn't belong, a service account key
works instead: `{"env": "BQ_JSON_KEY"}` in `malloy-config.json` and the key in
the environment. No gcloud involved.

**GitHub.** `gh auth login --web` prints a code to paste — a device flow, so it
works headless with nothing published.

## Other warehouses

Postgres, MySQL, Snowflake, Trino and Databricks connectors all ship inside
`@malloydata/malloy-connections`, so they are already present — a connection in
`malloy-config.json` is all they need. What each one may still want is its own
interactive sign-in; Snowflake's browser SSO has the same constraint as the two
above, and the same workarounds.

## Pinning

`:latest` moves. For a repo where everyone should be on the same toolchain, name
a version (`:0.2.40`) or the immutable digest the publish workflow prints.
