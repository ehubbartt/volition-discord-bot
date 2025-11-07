# Lootcrate Analytics Setup Guide

## Overview

This analytics system tracks lootcrate usage with **minimal storage**:
- **Daily aggregates**: 1 row per day = ~365 rows/year = ~50KB/year
- **Rare drops only**: ~10-50 events/year = ~10KB/year
- **Total storage**: ~60KB/year (0.006% of 1GB free tier!)

## Features

✅ Track total lootcrate opens per day
✅ Count unique users per day
✅ Track free vs paid opens
✅ Monitor VP economy (won vs spent)
✅ Log rare drops (roles, items, high VP)
✅ Configurable rarity thresholds

## Setup

### 1. Run SQL Scripts in Supabase

Go to your Supabase project → SQL Editor → New Query

**Step 1: Create Tables**
```sql
-- Copy and paste contents from: db/lootcrate_analytics_schema.sql
```

**Step 2: Create Functions**
```sql
-- Copy and paste contents from: db/lootcrate_analytics_functions.sql
```

### 2. Enable Row Level Security (RLS)

```sql
-- Allow service role to read/write (bot operations)
ALTER TABLE lootcrate_daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE lootcrate_rare_drops ENABLE ROW LEVEL SECURITY;
ALTER TABLE lootcrate_daily_users ENABLE ROW LEVEL SECURITY;

-- Create policies (adjust as needed for your use case)
CREATE POLICY "Service role can do everything on daily_metrics"
ON lootcrate_daily_metrics
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role can do everything on rare_drops"
ON lootcrate_rare_drops
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role can do everything on daily_users"
ON lootcrate_daily_users
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
```

### 3. Integrate with Lootcrate Code

In `events/interactionCreate.js`, add analytics logging:

```javascript
const lootcrateAnalytics = require('../db/lootcrate_analytics');

// Inside handleLootInteraction(), after giving rewards:
async function handleLootInteraction(interaction, free = false) {
    // ... existing loot roll code ...

    // After db.setPoints() succeeds:
    const { kind, amount, chance, label, color, title, image, itemName, roleId } = rollLoot(!free, !free);

    // ... give rewards to player ...

    // LOG TO ANALYTICS (non-blocking)
    lootcrateAnalytics.logLootcrateOpen(
        interaction.user.id,
        free,
        { kind, amount, chance, itemName }
    ).catch(err => console.error('[Analytics] Failed to log:', err.message));

    // ... send Discord response ...
}
```

### 4. Schedule Daily Unique User Count Update

Add to `index.js` (runs once per day at midnight):

```javascript
const lootcrateAnalytics = require('./db/lootcrate_analytics');

// Schedule daily unique user count update
setInterval(async () => {
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() === 0) {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const dateStr = yesterday.toISOString().split('T')[0];

        try {
            const count = await lootcrateAnalytics.updateUniqueUsersCount(dateStr);
            console.log(`[Analytics] Updated unique users for ${dateStr}: ${count}`);
        } catch (err) {
            console.error('[Analytics] Failed to update unique users:', err.message);
        }
    }
}, 60 * 1000); // Check every minute
```

## Usage Examples

### Get Last 7 Days of Metrics

```javascript
const analytics = require('./db/lootcrate_analytics');

const endDate = new Date().toISOString().split('T')[0];
const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

const metrics = await analytics.getDailyMetrics(startDate, endDate);
console.log(metrics);
```

**Example Output:**
```json
[
  {
    "date": "2025-01-06",
    "total_opens": 45,
    "unique_users": 12,
    "free_opens": 12,
    "paid_opens": 33,
    "total_vp_won": 850,
    "total_vp_spent": 165,
    "nothing_count": 8
  }
]
```

### Get Recent Rare Drops

```javascript
const recentRares = await analytics.getRecentRareDrops(10);
console.log(recentRares);
```

**Example Output:**
```json
[
  {
    "timestamp": "2025-01-06T15:30:00Z",
    "user_id": "123456789",
    "drop_type": "role",
    "item_name": "King Gamba",
    "chance_percent": 1.0,
    "was_free": false
  },
  {
    "timestamp": "2025-01-06T12:15:00Z",
    "user_id": "987654321",
    "drop_type": "vp",
    "amount": 250,
    "chance_percent": 2.5,
    "was_free": true
  }
]
```

## Customization

### Adjust Rarity Thresholds

Edit `db/lootcrate_analytics.js`:

```javascript
const RARE_THRESHOLDS = {
    VP_AMOUNT: 100,      // Log if VP won >= 100
    CHANCE_PERCENT: 5,   // Log if drop chance <= 5%
    ALWAYS_LOG: ['role', 'item']  // Always log these types
};
```

### Data Retention

Keep last 90 days of detailed user data (saves space):

```sql
-- Run monthly via cron or scheduled task
SELECT cleanup_old_lootcrate_data();
```

## Storage Estimates

**Year 1:**
- Daily metrics: 365 rows × ~150 bytes = ~55KB
- Rare drops: 50 events × ~200 bytes = ~10KB
- Daily users (90 day window): ~2,700 rows × ~50 bytes = ~135KB
- **Total: ~200KB/year**

**Year 5:**
- Daily metrics: 1,825 rows = ~275KB
- Rare drops: 250 events = ~50KB
- Daily users (rolling 90 days): ~135KB
- **Total: ~460KB** (still only 0.046% of 1GB!)

## Queries for Insights

### Most Active Day
```sql
SELECT date, total_opens, unique_users
FROM lootcrate_daily_metrics
ORDER BY total_opens DESC
LIMIT 1;
```

### VP Economy Balance
```sql
SELECT
    SUM(total_vp_won) as total_won,
    SUM(total_vp_spent) as total_spent,
    SUM(total_vp_won) - SUM(total_vp_spent) as net_vp
FROM lootcrate_daily_metrics;
```

### User with Most Rare Drops
```sql
SELECT user_id, COUNT(*) as rare_drop_count
FROM lootcrate_rare_drops
GROUP BY user_id
ORDER BY rare_drop_count DESC
LIMIT 10;
```
