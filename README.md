# Volition Discord Bot

Discord bot for the Volition OSRS clan, integrating with Wise Old Man API for player tracking, rank management, and clan engagement features.

## Features

- **Player Verification System**: Verify OSRS accounts and check clan requirements
- **Automatic Rank Management**: Sync Discord roles based on EHB (Efficient Hours Bossed)
- **Ticket System**: Automated support tickets for join requests, general support, and shop payouts
- **VP Points System**: Track and manage Volition Points for clan members
- **Engagement Features**: Daily challenges, weekly tasks, loot crates, duels
- **WOM Integration**: Full integration with Wise Old Man for player stats and clan tracking

## 📚 Documentation

- **[DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md)** - Quick start guide for deploying to fly.io
- **[HOSTING_GUIDE.md](HOSTING_GUIDE.md)** - Complete guide for hosting options (fly.io, Railway, Oracle Cloud)
- **[REMOTE_CONFIG_SUMMARY.md](REMOTE_CONFIG_SUMMARY.md)** - Overview of the hybrid configuration system
- **[MIGRATION_GUIDE.md](MIGRATION_GUIDE.md)** - Detailed guide for enabling remote config
- **[ENVIRONMENT_SWITCHING.md](ENVIRONMENT_SWITCHING.md)** - Guide for switching between prod/test configs
- **[QUICK_REFERENCE.md](QUICK_REFERENCE.md)** - Quick reference for common tasks

## Table of Contents

- [Setup](#setup)
- [Deployment](#deployment)
- [Commands](#commands)
  - [Verification Commands](#verification-commands)
  - [Ticket Commands](#ticket-commands)
  - [Points Commands](#points-commands)
  - [Admin Commands](#admin-commands)
  - [Fun Commands](#fun-commands)
- [Configuration](#configuration)
- [Remote Configuration](#remote-configuration)

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file with:
   ```
   DISCORD_TOKEN=your_bot_token
   SUPABASE_URL=your_supabase_url
   SUPABASE_KEY=your_supabase_key
   ```
4. Configure your environment:
   - Edit `config.production.json` with your production Discord server IDs
   - Edit `config.test.json` with your test Discord server IDs
   - Set environment mode in `features.json` or use the switcher:
     ```bash
     node switch-env.js production   # Use production config
     node switch-env.js test          # Use test config
     node switch-env.js status        # Check current environment
     ```
5. Deploy commands:
   ```bash
   node deploy-commands.js
   ```
6. Start the bot:
   ```bash
   node index.js
   ```

## Deployment

### Quick Start (fly.io - FREE)

1. **Install flyctl:**
```bash
brew install flyctl  # macOS
# or
curl -L https://fly.io/install.sh | sh  # Linux/Windows
```

2. **Deploy:**
```bash
fly launch
fly secrets set TOKEN="your_discord_token"
fly secrets set SUPABASE_URL="your_supabase_url"
fly secrets set SUPABASE_KEY="your_supabase_key"
fly deploy
```

3. **Done!** Your bot is now running 24/7 for free.

For detailed deployment instructions, see [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md).

For other hosting options (Railway, Oracle Cloud), see [HOSTING_GUIDE.md](HOSTING_GUIDE.md).

## Commands

### Verification Commands

#### `/verify`
Verify your RuneScape account and check if you meet clan requirements.

**Requirements:**
- 1750+ Total Level OR 50+ EHB

**Usage:**
```
/verify
```
- Click the verification button
- Enter your RuneScape username
- Bot checks your stats and displays results
- If requirements met: adds verified role, removes unverified role
- If requirements not met: pings admin roles for assistance

---

#### `/createverifymessage`
**(Admin Only)** Create a verification panel with a button that members can click to start verification.

**Usage:**
```
/createverifymessage
```
- Posts an embed with a "Verify My Account" button
- Members click the button to start the verification flow
- Useful for join tickets or verification channels

---

### Ticket Commands

#### `/createticketmessage`
**(Admin Only)** Create a ticket panel with dropdown menu for users to create support tickets.

**Usage:**
```
/createticketmessage [channel:#channel]
```

**Parameters:**
- `channel` (optional): Channel to post the panel in (defaults to current channel)

**Ticket Types:**
- **Join Ticket**: For new members wanting to join the clan
- **General Support**: For general questions and assistance
- **Shop Payout**: For VP shop payout requests

---

#### `/close`
Close the current ticket channel. Can be used by ticket creator or admins.

**Usage:**
```
/close
```

**Flow:**
1. Sends close request notification
2. Admins receive message with two options:
   - **Delete Ticket**: Permanently delete without archiving
   - **Transcript**: Create archive and save to archive channel

**Transcript Features:**
- Saves all messages to a text file
- Includes server info, participant stats, and admin summary
- Posts to appropriate archive channel based on ticket type

---

### Points Commands

#### `/checkpoints`
Check VP (Volition Points) for yourself or another player.

**Usage:**
```
/checkpoints
/checkpoints player:Zezima
/checkpoints player:@username
```

**Parameters:**
- `player` (optional): RSN or Discord mention
  - If omitted, checks your own points
  - Can use RuneScape name: `player:Zezima`
  - Can use Discord mention: `player:@username`

**Display:**
- Player's RSN
- Current VP points
- Discord account (if linked)

---

#### `/adjustpoints`
**(Admin Only)** Add or remove VP points for players.

**Usage:**
```
/adjustpoints player:Zezima points:50
/adjustpoints player:@username points:-25
/adjustpoints player:Zezima,@user1,@user2 points:100
```

**Parameters:**
- `player`: RSN or @mention (comma-separated for multiple)
- `points`: Amount to add (positive) or remove (negative)

**Examples:**
- Add 50 points to one player: `/adjustpoints player:Zezima points:50`
- Remove 25 points from a user: `/adjustpoints player:@user points:-25`
- Add points to multiple: `/adjustpoints player:Zezima,Lynx Titan points:100`

---

### Admin Commands

#### `/adminverify`
**(Admin Only)** Manually verify a player and add them to the database.

**Usage:**
```
/adminverify rsn:PlayerName user:@discorduser
```

**Parameters:**
- `rsn`: RuneScape username
- `user`: Discord user to link

---

#### `/sync`
**(Admin Only)** Sync all clan members from Wise Old Man to database and assign Discord roles based on EHB.

**Usage:**
```
/sync
```

**What it does:**
- Fetches all clan members from WOM
- Updates database with current stats
- Assigns appropriate rank roles based on EHB
- Removes old rank roles
- Reports mismatches and changes

---

#### `/syncuser`
**(Admin Only)** Sync a specific user's stats and roles from Wise Old Man.

**Usage:**
```
/syncuser user:@discorduser
```

---

#### `/updateranks`
**(Admin Only)** Update Discord roles for all clan members based on current EHB.

**Usage:**
```
/updateranks
```

**Rank Tiers (based on EHB):**
- Specific rank thresholds defined in `sync.js`

---

#### `/syncwomdiscids`
**(Admin Only)** Sync Discord IDs from Wise Old Man with the database.

**Usage:**
```
/syncwomdiscids
```

---

#### `/inactive`
**(Admin Only)** Check for inactive clan members.

**Usage:**
```
/inactive days:30
```

---

#### `/rewardevent`
**(Admin Only)** Reward VP points to event participants.

**Usage:**
```
/rewardevent
```

---

### Fun Commands

#### `/lootcrate`
Open a loot crate for a chance to win VP points, items, or special roles.

**Usage:**
```
/lootcrate
```

**Rewards:**
- VP points (various tiers)
- In-game items (bonds, gear, GP)
- King Gamba role (rare)

**Options:**
- **Free Daily Claim**: Once per day (resets at 3 AM)
- **Open for 5 VP**: Anytime, costs 5 VP

---

#### `/weeklytask`
View the current weekly challenge or submit your completion.

**Usage:**
```
/weeklytask
/weeklytask screenshot:[attachment]
```

**Parameters:**
- `screenshot` (optional): Proof of completion

**Rewards:**
- 1st place: 50 VP
- 2nd place: 30 VP
- 3rd place: 20 VP

---

#### `/dailywordle`
Play the daily OSRS-themed Wordle game.

**Usage:**
```
/dailywordle
/dailywordle guess:ZEZIMA
```

**Features:**
- OSRS-themed words
- Standard Wordle rules
- Daily refresh

---

#### `/duel`
Challenge another player to a duel with VP stakes.

**Usage:**
```
/duel opponent:@username stake:100
```

**Parameters:**
- `opponent`: Discord user to challenge
- `stake`: VP amount to wager

---

#### `/leaderboard`
View VP points leaderboard.

**Usage:**
```
/leaderboard [page:2]
```

**Parameters:**
- `page` (optional): Leaderboard page number

---

## Feature Toggles

The bot includes a comprehensive feature toggle system that allows you to enable/disable any command or feature without modifying code.

### Environment Switching

The bot supports multiple environments (production and test) with automatic config loading:

**Quick Switch:**
```bash
node switch-env.js production   # Switch to production environment
node switch-env.js test          # Switch to test environment
node switch-env.js status        # Check current environment
```

**Manual Configuration:**
Set the environment mode in [features.json](features.json):
```json
{
  "environment": {
    "mode": "production"    // or "test"
  }
}
```

When you switch environments:
- `production` mode loads [config.production.json](config.production.json)
- `test` mode loads [config.test.json](config.test.json)
- The active config is automatically synced to `config.json`

### Using features.json

All feature toggles are configured in [features.json](features.json). You can enable or disable features by setting their values to `true` or `false`.

**Example:**
```json
{
  "events": {
    "autoJoinTickets": true,     // Enable/disable automatic join ticket creation
    "autoAddUnverifiedRole": true,
    "handleGuildMemberAdd": true
  },
  "commands": {
    "verification": {
      "verify": true,              // Enable /verify command
      "adminverify": true
    },
    "fun": {
      "lootcrate": true,           // Enable /lootcrate command
      "duel": false                // Disable /duel command
    }
  }
}
```

### Feature Categories

- **events**: Control automatic bot behaviors (join tickets, role assignment, etc.)
- **verification**: Player verification system settings
- **ticketSystem**: Ticket types and archiving features
- **rankManagement**: Automatic rank syncing
- **pointsSystem**: VP tracking and adjustments
- **gamification**: Fun features (loot crates, wordle, duels, etc.)
- **commands**: Individual command toggles by category
- **notifications**: Bot notification preferences
- **automation**: Automated tasks and scheduled operations
- **moderation**: Security and permission settings
- **limits**: Rate limits and restrictions

### Disabling Features

To disable a feature, set its value to `false`:

```json
{
  "events": {
    "autoJoinTickets": false    // Stops creating tickets on member join
  },
  "gamification": {
    "lootCrates": false          // Disables loot crate buttons
  },
  "commands": {
    "debug": {
      "testpreverify": false     // Disables debug commands
    }
  }
}
```

When a disabled command is used, the bot will reply with: `⚠️ The /command command is currently disabled.`

---

## Database Schema

The bot uses Supabase (PostgreSQL) with the following main tables:

- **players**: Stores RSN, Discord ID, WOM ID
- **player_points**: Tracks VP points for each player
- **weekly_tasks**: Manages weekly challenge submissions
- Additional tables for tracking various features

---

## Features Overview

### Automatic Join Ticket Creation
When a user joins the Discord server:
1. Automatically creates a private join ticket
2. Adds unverified role
3. Provides verification button
4. Only visible to the user and admins

### Verification Flow
1. User clicks "Verify My Account"
2. Enters RuneScape username
3. Bot fetches stats from WOM
4. Checks requirements (1750+ total OR 50+ EHB)
5. If met: adds verified role, removes unverified, updates nickname
6. If not met: pings admins for manual review

### Rank Sync System
- Automatically assigns Discord roles based on EHB
- Pulls data from Wise Old Man
- Updates on sync commands
- Maintains rank hierarchy

### Ticket Archive System
- Saves complete ticket transcripts
- Includes metadata (participants, message count, timestamps)
- Organizes by ticket type
- Downloadable text file format

---

## Remote Configuration

The bot includes a hybrid configuration system that supports both local and remote config management.

### Local Mode (Default)
- Reads from `features.json` file
- Changes require file edit + bot restart
- Works immediately, no setup required

### Remote Mode (Optional)
- Reads from Supabase database
- Changes via Discord commands (no restart!)
- Perfect for future admin dashboard

### Enable Remote Config

1. **Run database migration** in Supabase:
   - Copy contents of `db/migrations/create_bot_config_table.sql`
   - Run in Supabase SQL Editor

2. **Sync local config to database:**
```
/syncconfig
```

3. **Update features remotely:**
```
/updateconfig feature:events.autoJoinTickets value:false reason:Testing
```

Changes apply within 60 seconds automatically!

### Admin Commands

#### `/updateconfig`
**(Admin Only)** Update any bot feature remotely without restarting.

**Usage:**
```
/updateconfig feature:events.autoJoinTickets value:false reason:High server load
/updateconfig feature:limits.duelMinimumStake value:50 reason:Prevent spam
```

**Examples:**
- Disable auto join tickets: `feature:events.autoJoinTickets value:false`
- Change duel limits: `feature:limits.duelMinimumStake value:50`
- Toggle commands: `feature:commands.fun.lootcrate value:false`

#### `/syncconfig`
**(Admin Only)** One-time sync of local `features.json` to remote database.

**Usage:**
```
/syncconfig
```

Enables remote configuration system.

### Future: Admin Dashboard

Once remote config is enabled, you can build a web dashboard to manage bot settings:
- Visual toggle switches for all features
- Real-time updates (60-second cache)
- Multi-admin support
- Change history tracking

See [REMOTE_CONFIG_SUMMARY.md](REMOTE_CONFIG_SUMMARY.md) for dashboard examples and code.

---

## Technologies

- **Discord.js v14**: Discord bot framework
- **Wise Old Man API v2**: OSRS player tracking
- **Supabase**: PostgreSQL database
- **Node.js**: Runtime environment
- **Axios**: HTTP requests
- **Hybrid Config System**: Local + remote configuration

## License

Private bot for Volition OSRS Clan
