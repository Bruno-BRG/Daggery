# Deployment

Daggery runs as one container. The server answers the API and serves the built web app, so a single domain is enough.

## Production build

The `Dockerfile` installs the workspace, builds the web app with `npm run build -w @daggery/web`, and starts the server with `tsx`. Production mode (`NODE_ENV=production`) requires an HTTPS origin in `DAGGERY_ORIGIN`, sets secure cookies, and refuses to start when the web build is missing.

## Persistent data

Everything the server writes lives in `DAGGERY_DATA_DIR`, which the container sets to `/app/data`. Mount a persistent volume there. The folder holds:

- `daggery.db`, the SQLite database with accounts, campaigns and sessions;
- `ai-keyring.key`, which encrypts saved AI provider keys. Losing it invalidates every saved key;
- `backups/`, written before each schema migration;
- `campaign-assets/`, uploaded campaign files;
- `cards/`, the card images served at `/cards/`.

The card images are not in Git, because the source PDFs they come from are not redistributed in this repository. Copy the `data/cards` folder from a local checkout into the volume once, under `cards/`.

## Environment

| Variable | Value | Notes |
| --- | --- | --- |
| `DAGGERY_ORIGIN` | `https://daggery.brunorocha.dev.br` | The public origin. Requests from any other origin are refused. |
| `DAGGERY_ALLOW_REGISTRATION` | `1` for the first account, then `0` | In production, registration is closed unless this is `1`. |
| `DAGGERY_AI_SECRET` | optional | Base64 key for AI key encryption. Leave unset to use `ai-keyring.key` in the volume. |
| `DAGGERY_SMTP_*` | optional | Enables e-mail sign-in. See `CAMPANHAS.md`. |

`HOST`, `PORT`, `NODE_ENV` and `DAGGERY_DATA_DIR` are set in the image.

## Coolify and automatic deploys

The application runs in Coolify on the `Asgard` server, in the Daggery project. It builds from `main` with the Dockerfile at the repository root and listens on port 3000. Coolify routes `daggery.brunorocha.dev.br` to that port and issues the certificate.

Pushes to `main` deploy automatically. A GitHub webhook calls Coolify's manual GitHub webhook endpoint for this application, and the webhook secret is shared between the two. Deployment history and logs are in Coolify.

## Health

`GET /health` returns `{"ok":true}` when the server is running.
