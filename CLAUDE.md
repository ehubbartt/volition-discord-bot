# Volition Discord Bot — repository guide

discord.js bot for the Volition OSRS clan: member verification, rank sync from
WiseOldMan, a VP points economy (loot crates, duels, tasks, voice rewards), tickets,
LFG/party finder, and tile/bingo events. Shares one Supabase Postgres database with the
website (`volition-site`) and is configured at runtime via the `bot_config` table.

For the full picture — systems, routing, config layers, jobs, data flow — see
**[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**. Keep that file current when you change
how a system works.

## Authoring & naming conventions (important)

The maintainer does **not** want "Claude" — or any AI/model name — surfaced in this
repository or its Git/GitHub history. Apply this in **every** session:

- **Commit author/committer:** use the maintainer's git identity
  (`Ethan Hubbartt <ehubbartt@gmail.com>`). Never author or co-author commits as
  "Claude", "Anthropic", or any model name.
- **No attribution trailers:** do not add `Co-Authored-By: Claude`,
  `🤖 Generated with Claude Code`, `Claude-Session`, or similar lines to commit
  messages or PR bodies. `.claude/settings.json` disables these automatically —
  leave it in place.
- **Branch names:** topical names that describe the feature
  (e.g. `editable-command-messages`). Never include "claude".
- **PR titles & bodies:** describe the change only — no "Claude"/AI mentions.
- **Code, comments, and docs:** no "Claude"/AI mentions anywhere in committed content.

The only exception is this `CLAUDE.md` file and the `.claude/` directory themselves,
whose names are fixed by the tooling that loads them.

## Delivery notes

- One topical branch + one PR per feature; keep PRs free of merge conflicts.
- Don't push to someone else's branch — open a PR instead.

## Quick orientation

- **Stack:** Node 22, **discord.js v14**, CommonJS. Entry point `index.js` (client
  intents, command/event auto-loading, job scheduling). Slash commands are registered
  with `deploy-commands.js`. Deployed on Fly.io (`Dockerfile`, `fly.toml`; no HTTP
  service — gateway WebSocket only).
- **Commands:** `npm start` (`node index.js`), `npm test` / `test:watch` /
  `test:coverage` (Jest; 70% coverage threshold).
- **Where things live:**
  - `commands/{admin,fun,utility}/*.js` — slash commands (each exports `data` + `execute`).
  - `events/*.js` — gateway handlers; `events/interactionCreate.js` routes slash
    commands, buttons, modals, and selects (a long `customId` if-chain).
  - `handlers/` — feature business logic (lootcrate, wallet, lfg, tickets, bridge…).
  - `jobs/` — scheduled/polling tasks (voice tracking, event lifecycle, site pollers…).
  - `services/` — image generation (Sharp) and external proxies.
  - `utils/` — config + helpers (notably `hybridConfig.js`).
  - `db/` — Supabase client (`db/supabase.js`) and per-feature data modules; SQL in
    `db/migrations/`.
- **Config layers (don't confuse them):**
  - `utils/hybridConfig.js` — reads the **`bot_config`** Supabase table (60s cache) with
    `features.json` as local fallback. This is what the site's `/admin/config` edits.
  - `config.json` — **static IDs** (channels, roles, emojis, `CLAN_ICON_URL`,
    `ADMIN_ROLE_IDS`, client/guild IDs).
  - `config/*.json` — game data (`ranks`, `bosses`, `walletPrices`, `bingo*`, `boardConfig`).
- **Editable command messages:** `/allset` (and future commands) render from the
  `command_messages` group in `bot_config` via `utils/templateRenderer.js`, falling back
  to `config/commandMessages.json`. The renderer forces a safe `allowedMentions`
  allow-list so admin-authored text can never `@everyone` or mass-ping a role.
- **Env/secrets** (`.env`, gitignored): Discord bot token + application/guild IDs,
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (RLS is deny-all; `SUPABASE_ANON_KEY` is a
  dev-only fallback), and optional Cloudflare/Dink vars. Confirm names
  against `index.js`, `db/supabase.js`, and `config.json` before relying on them.
