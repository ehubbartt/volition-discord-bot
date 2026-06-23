# Volition Discord Bot — Architecture

How the bot is put together. Pair this with `CLAUDE.md` (conventions + quick
orientation). Update this doc when you change how a system works.

> Some details below (exact table columns, job cadences, env-var names) reflect the code
> at time of writing — verify against the source before depending on specifics.

## Stack & startup

- **Node 22**, **discord.js v14**, CommonJS modules. Deployed on Fly.io (`Dockerfile`,
  `fly.toml`) as a long-lived gateway process — no HTTP service.
- **`index.js`** creates the Discord `Client` (intents: Guilds, GuildMembers,
  GuildMessages, GuildMessageReactions, GuildVoiceStates, MessageContent; relevant
  partials), auto-loads commands and events, and starts the scheduled jobs.
- **`deploy-commands.js`** registers slash commands with Discord's REST API (run when
  command definitions change).
- **Commands** auto-load from `commands/{category}/*.js`; each exports `data`
  (a `SlashCommandBuilder`) and `execute(interaction)`. **Events** auto-load from
  `events/*.js`; each exports `name`, `execute`, and optional `once`.

## Interaction routing (`events/interactionCreate.js`)

A single dispatcher handles all interactions:
- **Slash commands:** looked up in `client.commands`, gated by
  `features.isCommandEnabled(name)`, then `execute()`d; usage is tracked via the
  gamification analytics module.
- **Buttons / modals / select menus:** routed by `interaction.customId` through a large
  if-chain to the relevant handler (loot crate, verification/intro, tickets, wallet, LFG,
  events…). Buttons that need input call `interaction.showModal(...)`; the modal submit is
  then matched by its own `customId`. Some flows hold per-user locks to avoid race
  conditions (e.g. loot-crate spins).

> This if-chain is the main piece of tech debt — it's long. New button/modal flows append
> here; consider a registry keyed by `customId` prefix if it grows much more.

## Configuration (four layers — keep them straight)

1. **`utils/hybridConfig.js` → `bot_config` (Supabase).** The remote, hot-reloadable
   layer. `getConfigGroup(name, fallback)` reads a row's `config_value` with a **60s**
   per-group cache; `isEnabled`/`isCommandEnabled`/`isEventEnabled`/`get` walk the
   `features` blob with dot-notation. Falls back to local files when the DB is
   unavailable. `utils/features.js` is a thin backward-compatible wrapper. **This is what
   the website's `/admin/config` edits**, so changes apply within ~60s with no redeploy.
2. **`features.json`** — local fallback for the `features` group (flags for
   verification, tickets, ranks, points, gamification, per-command toggles).
3. **`config.json`** — **static IDs**: channels, roles, emojis, `CLAN_ICON_URL`,
   `ADMIN_ROLE_IDS`/`HEAD_ADMIN_ROLE_IDS`, client/guild IDs, `pointsAward`.
4. **`config/*.json`** — game data: `ranks.json` (EHB→role mapping), `bosses.json` (LFG),
   `walletPrices.json`, `bingoTiles.json` + `bingoBoardCoordinates.json`,
   `boardConfig.json`. Some have CRUD managers in `utils/` (`bingoConfigManager`,
   `boardConfigManager`).

### Editable command messages
`bot_config.command_messages` (group `messages`) holds per-command embed templates
rendered by **`utils/templateRenderer.js`**, with `config/commandMessages.json` as the
bundled fallback. Templates use tokens resolved from `config.json` at send time —
`{{channel:KEY}}`, `{{role:KEY}}`, `{{emoji:NAME}}`, `{{config:KEY}}`, plus runtime
`{{user}}`/`{{displayName}}` (optional `|fallback`). The renderer always returns an
explicit `allowedMentions` allow-list (never `everyone`/`here`, never blanket roles), so
admin-authored text can't trigger mass pings. `/allset` is the first command wired up;
others are converted one at a time.

## Database (`db/`)

- **`db/supabase.js`** initialises the client (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) and
  holds core player/points/warnings/bans helpers.
- Per-feature data modules: `events.js`, `tile_event.js`, `bingo_event.js`, `wallet.js`,
  `lfg.js`, `voice_analytics.js`, `lootcrate_analytics.js`, `gamification_analytics.js`,
  `siteSubmissions.js`, `clanLeavers.js`, `dinkTokens.js`, `cardPacks.js`, plus
  `botConfig.js`.
- **SQL** lives in `db/migrations/` (e.g. `create_bot_config_table.sql`,
  `seed_command_messages.sql`) and is applied by hand against Supabase.
- The bot owns the **un-prefixed** tables (`players`, `bans`, `warnings`, `bot_config`,
  the event/tile/bingo/lootcrate/voice tables…) and reads some `vs_`-prefixed tables the
  **site** owns (e.g. `vs_submissions`, `vs_tasks`, `vs_events`) to sync rewards.

## Feature systems

- **Verification / intro** (`commands/utility/createVerifyMessage.js`, `verify.js`): an
  intro button opens a modal; the bot looks the RSN up on WiseOldMan, checks requirements,
  and assigns the verified role (or pings admins on failure). The intro modal is the
  template the data-driven forms work generalises.
- **Ranks / WiseOldMan** (`utils/api.js`, `utils/ranks.js`): periodic clan sync maps EHB
  to a Discord role; manual `sync` commands exist too.
- **Points / VP economy** (`db/supabase.js` players): VP comes from loot crates, duels,
  event submissions, voice rewards, and site submissions; `checkpoints`/`adjustpoints`/
  `leaderboard` commands read/write it.
- **Loot crates / gamba** (`handlers/lootcrate.js`, `commands/fun/lootCrate.js`): daily
  free claim + paid spins; VP-tier and item drop tables (configurable via
  `bot_config.loot_tables`); rare role reward; analytics recorded.
- **Duels** (`commands/fun/duel.js`): 50/50 VP wagers with VP-restore-on-error safety.
- **Tasks** (`commands/fun/weeklyTask.js`, pollers): instances are created from the
  site's `vs_tasks`/`vs_events`; proof submissions are approved for VP. (Daily Wordle is
  disabled.)
- **Tickets** (`interactionCreate.js`, `commands/utility/closeTicket.js`,
  `utils/ticket*`): join/general/shop tickets as private channels with claim/close/
  soft-close and transcript archiving.
- **Tile & bingo events** (`db/tile_event.js`, `db/bingo_event.js`,
  `services/tileBoard.js`, `services/bingoBoard.js`): team progress with Sharp-rendered
  board images.
- **Voice rewards** (`jobs/voiceTracker.js`, `utils/voiceRewards.js`): polls voice
  channels for eligible users and awards VP on a weekly cadence with a leaderboard post.
- **LFG / party finder** (`handlers/lfg.js`, `db/lfg.js`, `jobs/lfgExpiry.js`): boss/exp/
  time select-menu flow with auto-expiry.
- **Moderation** (`commands/utility/warn.js`, `warnings.js`, `ban.js`): warnings (expiring)
  and bans; the `bans` table also gates the website.
- **Site bridge** (`handlers/bridge.js`, `events/bridgeListener.js`): receives webhook
  events from the site and turns them into Discord actions/announcements.

## Scheduled jobs (`jobs/` + `index.js`)

Polling tasks (started at ready, run on intervals): voice tracking, event lifecycle /
soft-close, LFG expiry, voice-leaderboard refresh, and the site→bot pollers
(`siteSubmissionPoller`, `taskSyncPoller`, `eventAnnouncePoller`). Calendar-style jobs run
weekly/daily (weekly task creation, voice-reward payout, daily rank update, Skill-or-Kill
scheduling). Confirm exact cadences in `index.js`/the job files before relying on them.

## External integrations

- **Discord API** (bot token) — gateway + REST.
- **Supabase** — database.
- **WiseOldMan API** (`utils/api.js`) — clan/player stats, public, no auth.
- **Dink** (RuneLite plugin, `dinkconfig.json`, `db/dinkTokens.js`,
  `services/dinkProxy.js`) — OSRS in-game event notifications; tokens may sync to a
  Cloudflare Worker.

## Environment & testing

- **`.env`** (gitignored): Discord bot token + application/guild IDs, `SUPABASE_URL`,
  `SUPABASE_ANON_KEY`, optional Cloudflare/Dink vars.
- **Tests:** Jest (`jest.config.js`, `tests/`) with a 70% coverage threshold — DB modules,
  command/event/handler logic, and an integration suite. `npm test`.

## Known legacy / cleanup candidates

- The `interactionCreate.js` `customId` if-chain (length).
- Four overlapping config sources (hybridConfig/features.json/config.json/config/*.json).
- Disabled/deprecated bits (Daily Wordle; the old `tasks`/`wordles` tables superseded by
  the site's `vs_` tables; reaction-award-points).
