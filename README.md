# Volition Discord Bot

Discord bot for the Volition OSRS clan.

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

**Options:**
- **Delete Ticket**: Permanently delete without archiving
- **Transcript**: Create archive and save to archive channel

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

---

### Admin Commands

#### `/adminverify`
**(Admin Only)** Manually verify a player and add them to the database.

**Usage:**
```
/adminverify rsn:PlayerName user:@discorduser
```

---

#### `/sync`
**(Admin Only)** Sync all clan members from Wise Old Man to database and assign Discord roles based on EHB.

**Usage:**
```
/sync
```

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

#### `/sendweeklytask`
**(Admin Only)** Manually trigger the weekly task post.

**Usage:**
```
/sendweeklytask
```

---

#### `/senddailywordle`
**(Admin Only)** Manually trigger the daily wordle post.

**Usage:**
```
/senddailywordle
```

---

### Fun Commands

#### `/lootcrate`
Open a loot crate for a chance to win VP points, items, or special roles.

**Usage:**
```
/lootcrate
```

**Options:**
- **Free Daily Claim**: Once per day (resets at 3 AM)
- **Open for 5 VP**: Anytime, costs 5 VP

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
