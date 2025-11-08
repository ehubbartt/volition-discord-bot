-- Daily Lootcrate Metrics (1 row per day)
CREATE TABLE IF NOT EXISTS lootcrate_daily_metrics (
    date DATE PRIMARY KEY,
    total_opens INTEGER DEFAULT 0,
    unique_users INTEGER DEFAULT 0,
    free_opens INTEGER DEFAULT 0,
    paid_opens INTEGER DEFAULT 0,
    total_vp_won INTEGER DEFAULT 0,
    total_vp_spent INTEGER DEFAULT 0,
    nothing_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Rare Drop Events Only (logged individually)
CREATE TABLE IF NOT EXISTS lootcrate_rare_drops (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    user_id TEXT NOT NULL,
    username TEXT,
    drop_type TEXT NOT NULL, -- 'role', 'item', 'high_vp'
    item_name TEXT,
    amount INTEGER,
    chance_percent NUMERIC(5,2),
    was_free BOOLEAN DEFAULT FALSE
);

-- Optional: Track unique daily users efficiently
CREATE TABLE IF NOT EXISTS lootcrate_daily_users (
    date DATE NOT NULL,
    user_id TEXT NOT NULL,
    opens_count INTEGER DEFAULT 1,
    PRIMARY KEY (date, user_id)
);

-- Per-User Lootcrate Stats (1 row per user, updated continuously)
CREATE TABLE IF NOT EXISTS lootcrate_user_stats (
    user_id TEXT PRIMARY KEY,
    username TEXT,
    total_opens INTEGER DEFAULT 0,
    free_opens INTEGER DEFAULT 0,
    paid_opens INTEGER DEFAULT 0,
    total_vp_won INTEGER DEFAULT 0,
    total_vp_spent INTEGER DEFAULT 0,
    biggest_win INTEGER DEFAULT 0,
    last_open_date DATE,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_rare_drops_timestamp ON lootcrate_rare_drops(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_rare_drops_user ON lootcrate_rare_drops(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_users_date ON lootcrate_daily_users(date DESC);
CREATE INDEX IF NOT EXISTS idx_lootcrate_user_stats_opens ON lootcrate_user_stats(total_opens DESC);

-- Auto-update timestamp function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_lootcrate_daily_metrics_updated_at
    BEFORE UPDATE ON lootcrate_daily_metrics
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_lootcrate_user_stats_updated_at
    BEFORE UPDATE ON lootcrate_user_stats
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
