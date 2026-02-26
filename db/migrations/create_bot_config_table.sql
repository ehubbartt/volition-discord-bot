-- Bot Config Table
-- Stores all remotely-configurable settings (feature flags, game settings, wallet prices, loot tables)
-- Changes take effect within 60 seconds (in-memory cache TTL)

-- If table already exists, add missing columns:
-- ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS config_group TEXT NOT NULL DEFAULT 'general';
-- ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS description TEXT;

CREATE TABLE IF NOT EXISTS bot_config (
  config_name TEXT PRIMARY KEY,
  config_value JSONB NOT NULL,
  config_group TEXT NOT NULL DEFAULT 'general',
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_config_group ON bot_config(config_group);

-- Seed: Feature flags
INSERT INTO bot_config (config_name, config_value, config_group, description)
VALUES (
  'features',
  '{
    "events": {
      "autoJoinTickets": true,
      "autoAddUnverifiedRole": true,
      "handleGuildMemberAdd": true,
      "womMessageListener": true,
      "reactionAwardPoints": true
    },
    "verification": {
      "enabled": true,
      "autoUpdateNicknames": true,
      "requirementCheck": true,
      "pingAdminOnFailure": true,
      "useIntroModal": true
    },
    "ticketSystem": {
      "enabled": true,
      "allowJoinTickets": true,
      "allowGeneralTickets": true,
      "allowShopTickets": true,
      "createTranscripts": true,
      "archiveOnClose": true
    },
    "rankManagement": {
      "enabled": true,
      "autoSyncRanks": true,
      "autoUpdateRoles": true,
      "syncFromWiseOldMan": true
    },
    "pointsSystem": {
      "enabled": true,
      "allowPointAdjustments": true,
      "trackPointHistory": true,
      "showLeaderboard": true
    },
    "gamification": {
      "lootCrates": true,
      "dailyWordle": true,
      "duels": true,
      "weeklyTasks": true,
      "eventRewards": true
    },
    "commands": {
      "verification": {
        "verify": true,
        "adminverify": true,
        "forceverify": true,
        "createverifymessage": true
      },
      "tickets": {
        "createticketmessage": true,
        "close": true
      },
      "points": {
        "checkpoints": true,
        "adjustpoints": true,
        "leaderboard": true,
        "rewardevent": true
      },
      "wallet": {
        "wallet": true,
        "adminwallet": true
      },
      "admin": {
        "sync": true,
        "syncuser": true,
        "updateranks": true,
        "syncwomids": true,
        "inactive": true,
        "updateconfig": true,
        "syncconfig": true,
        "sendweeklytask": true,
        "senddailywordle": true
      },
      "fun": {
        "lootcrate": true,
        "duel": true
      },
      "moderation": {
        "warn": true,
        "warnings": true,
        "ban": true
      },
      "tileEvent": {
        "addplayer": true,
        "initboard": true,
        "updateboard": true,
        "roll": true,
        "reroll": true,
        "submit": true,
        "submitpet": true,
        "admintile": true,
        "checkprogress": true,
        "sabotage": true,
        "checksabotage": true,
        "tileleaderboard": true
      },
      "utility": {
        "allset": true,
        "fixarchiveperms": true,
        "age": true,
        "undonicknames": true
      }
    },
    "notifications": {
      "sendWelcomeMessages": false,
      "sendVerificationSuccess": true,
      "sendPointAdjustmentNotifications": true,
      "sendRankChangeNotifications": true,
      "sendEventReminders": true
    },
    "automation": {
      "dailyTaskReset": true,
      "weeklyTaskReset": true,
      "autoSyncPlayers": true,
      "autoKickInactive": false,
      "autoBackupDatabase": false
    },
    "integrations": {
      "wiseOldManAPI": true,
      "supabaseDatabase": true,
      "discordAPI": true
    },
    "moderation": {
      "requireAdminForPointAdjustment": true,
      "requireAdminForSync": true,
      "requireAdminForTicketManagement": true,
      "logCommandUsage": true,
      "preventDuplicateVerification": true
    },
    "limits": {
      "lootCrateDailyCooldown": true,
      "wordleDailyLimit": true,
      "duelMinimumStake": 10,
      "duelMaximumStake": 10000,
      "pointAdjustmentMaxPerCommand": 10000
    }
  }'::jsonb,
  'features',
  'Feature flags, command toggles, event toggles'
)
ON CONFLICT (config_name) DO NOTHING;

-- Seed: Game settings (duel/VP only, loot settings are in lootcrates group)
INSERT INTO bot_config (config_name, config_value, config_group, description)
VALUES (
  'game_settings',
  '{
    "duelMinimumStake": 10,
    "duelMaximumStake": 10000,
    "pointAdjustmentMaxPerCommand": 10000,
    "pointsAward": [50, 30, 20]
  }'::jsonb,
  'economy',
  'Duel limits, VP economy settings'
)
ON CONFLICT (config_name) DO NOTHING;

-- Seed: Wallet prices (lootcrates group)
INSERT INTO bot_config (config_name, config_value, config_group, description)
VALUES (
  'wallet_prices',
  '{
    "items": {
      "Abyssal Whip": { "price": 1300000, "emoji": "🗡️" },
      "Elidinis'' Ward": { "price": 3800000, "emoji": "🛡️" },
      "Bond": { "price": 15000000, "emoji": "💎" },
      "25M GP": { "price": 25000000, "emoji": "💰" },
      "Dragon Claws": { "price": 50000000, "emoji": "🐉" },
      "100M GP": { "price": 100000000, "emoji": "💰" },
      "Twisted Bow": { "price": 1400000000, "emoji": "🏹" }
    },
    "CASHOUT_THRESHOLD": 10000000
  }'::jsonb,
  'lootcrates',
  'Loot crate item prices and cashout threshold'
)
ON CONFLICT (config_name) DO NOTHING;

-- Seed: Loot tables (lootcrates group - VP tiers, item drop rates, spin cost, role reward)
INSERT INTO bot_config (config_name, config_value, config_group, description)
VALUES (
  'loot_tables',
  '{
    "spinCost": 5,
    "vpTiers": [
      { "label": "Junk", "chance": 29.7, "min": 0, "max": 0, "color": "808080", "title": "Loot Crate Result", "image": "https://i.imgur.com/jABzYyd.png?v=2" },
      { "label": "Common (1–3 VP)", "chance": 50.0, "min": 1, "max": 3, "color": "808080", "title": "Loot Crate Result", "image": "https://i.imgur.com/EF6qFMM.png" },
      { "label": "Uncommon (4–10 VP)", "chance": 10.0, "min": 4, "max": 10, "color": "808080", "title": "Loot Crate Result", "image": "https://i.imgur.com/FyOzqw2.png" },
      { "label": "Rare (11–25 VP)", "chance": 5.55, "min": 11, "max": 25, "color": "00FF00", "title": "Loot Crate Result", "image": "https://i.imgur.com/SWDduXl.png" },
      { "label": "Unique (25–50 VP)", "chance": 2.2, "min": 26, "max": 50, "color": "00FF00", "title": "Not bad!", "image": "https://i.imgur.com/FIaGFsf.png" },
      { "label": "Legendary (100 VP)", "chance": 0.4, "min": 100, "max": 100, "color": "00FF00", "title": "Hooo boy, it''s a big one!", "image": "https://i.imgur.com/nYUY964.png" },
      { "label": "Megarare (200–400 VP)", "chance": 0.05, "min": 200, "max": 400, "color": "800080", "title": "VP JACKPOT!", "image": "https://i.imgur.com/uweE4rx.png" }
    ],
    "itemDropChance": 2.0,
    "roleReward": {
      "enabled": true,
      "chance": 0.01,
      "roleId": "1423714480369434675",
      "label": "King Gamba role",
      "color": "800080",
      "title": "A King of Gamba has been crowned!",
      "image": "https://i.imgur.com/zeSTA3O.png"
    },
    "items": [
      { "name": "Abyssal Whip", "chance": 80, "enabled": true, "color": "00FF00", "image": "https://i.imgur.com/tMM7G91.png" },
      { "name": "Elidinis'' Ward", "chance": 16.55, "enabled": true, "color": "00FF00", "image": "https://i.imgur.com/ZrL4y9r.png" },
      { "name": "Bond", "chance": 2.82, "enabled": true, "color": "00FF00", "image": "https://i.imgur.com/K9rLNtO.png" },
      { "name": "25M GP", "chance": 0.4, "enabled": true, "color": "800080", "image": "https://i.imgur.com/bEkl6mC.png" },
      { "name": "Dragon Claws", "chance": 0.1, "enabled": true, "color": "800080", "image": "https://i.imgur.com/Szu9nxV.png" },
      { "name": "100M GP", "chance": 0.13, "enabled": true, "color": "800080", "image": "https://i.imgur.com/CPxoJ4k.png" },
      { "name": "Twisted Bow", "chance": 0.0, "enabled": false, "color": "800080", "image": "https://i.imgur.com/RzONkPT.png" }
    ]
  }'::jsonb,
  'lootcrates',
  'Loot crate drop tables - VP tiers, item chances, spin cost, role reward'
)
ON CONFLICT (config_name) DO NOTHING;

-- Seed: Event active flag
INSERT INTO bot_config (config_name, config_value, config_group, description)
VALUES (
  'event_active',
  'false'::jsonb,
  'events',
  'Is the tile event open for players'
)
ON CONFLICT (config_name) DO NOTHING;

-- Seed: Sabotage enabled flag
INSERT INTO bot_config (config_name, config_value, config_group, description)
VALUES (
  'sabotage_enabled',
  'true'::jsonb,
  'events',
  'Are sabotage commands enabled'
)
ON CONFLICT (config_name) DO NOTHING;
