-- ============================================================================
-- GAMIFICATION ANALYTICS SCHEMA
-- Storage-efficient analytics for duels, tasks, verifications, and more
-- ============================================================================

-- -----------------------------------------------------------------------------
-- DUEL ANALYTICS
-- -----------------------------------------------------------------------------

-- Daily Duel Metrics (1 row per day)
CREATE TABLE IF NOT EXISTS duel_daily_metrics (
    date DATE PRIMARY KEY,
    total_duels INTEGER DEFAULT 0,
    total_vp_wagered INTEGER DEFAULT 0,
    avg_wager NUMERIC(10,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Per-User Duel Stats (1 row per user, updated continuously)
CREATE TABLE IF NOT EXISTS duel_user_stats (
    user_id TEXT PRIMARY KEY,
    username TEXT,
    total_duels INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    total_vp_won INTEGER DEFAULT 0,
    total_vp_lost INTEGER DEFAULT 0,
    largest_wager INTEGER DEFAULT 0,
    last_duel_date DATE,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notable Duels (high stakes only - saves storage)
CREATE TABLE IF NOT EXISTS duel_notable (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    challenger_id TEXT NOT NULL,
    opponent_id TEXT NOT NULL,
    wager INTEGER NOT NULL,
    winner_id TEXT NOT NULL,
    loser_id TEXT NOT NULL
);

-- Only log duels with wager >= 100 VP as "notable"
CREATE INDEX IF NOT EXISTS idx_duel_notable_timestamp ON duel_notable(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_duel_notable_wager ON duel_notable(wager DESC);

-- -----------------------------------------------------------------------------
-- TASK COMPLETION ANALYTICS (Daily/Weekly Tasks)
-- -----------------------------------------------------------------------------

-- Daily Task Metrics
CREATE TABLE IF NOT EXISTS task_daily_metrics (
    date DATE PRIMARY KEY,
    daily_task_completions INTEGER DEFAULT 0,
    weekly_task_completions INTEGER DEFAULT 0,
    total_vp_earned_from_tasks INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Task Type Popularity (which tasks are completed most)
-- Only track task names, not individual completions
CREATE TABLE IF NOT EXISTS task_type_stats (
    task_name TEXT PRIMARY KEY,
    total_completions INTEGER DEFAULT 0,
    last_completed TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- VERIFICATION ANALYTICS
-- -----------------------------------------------------------------------------

-- Daily Verification Metrics
CREATE TABLE IF NOT EXISTS verification_daily_metrics (
    date DATE PRIMARY KEY,
    total_verifications INTEGER DEFAULT 0,
    successful_verifications INTEGER DEFAULT 0,
    failed_verifications INTEGER DEFAULT 0,
    avg_ehb NUMERIC(10,2) DEFAULT 0,
    avg_total_level NUMERIC(10,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- COMMAND USAGE ANALYTICS (Lightweight)
-- -----------------------------------------------------------------------------

-- Daily Command Usage (aggregated counts only)
CREATE TABLE IF NOT EXISTS command_daily_usage (
    date DATE NOT NULL,
    command_name TEXT NOT NULL,
    usage_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (date, command_name)
);

CREATE INDEX IF NOT EXISTS idx_command_usage_date ON command_daily_usage(date DESC);

-- -----------------------------------------------------------------------------
-- TRIGGERS FOR AUTO-UPDATE TIMESTAMPS
-- -----------------------------------------------------------------------------

CREATE TRIGGER update_duel_daily_metrics_updated_at
    BEFORE UPDATE ON duel_daily_metrics
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_task_daily_metrics_updated_at
    BEFORE UPDATE ON task_daily_metrics
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_verification_daily_metrics_updated_at
    BEFORE UPDATE ON verification_daily_metrics
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_duel_user_stats_updated_at
    BEFORE UPDATE ON duel_user_stats
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------------------------------
-- STORAGE ESTIMATES
-- -----------------------------------------------------------------------------
-- Daily metrics tables: ~365 rows/year × ~100 bytes = ~36 KB/year each
-- User stats: ~500 users × ~150 bytes = ~75 KB total (one-time)
-- Notable duels: Assuming 10 high-stakes duels/day × 365 days = ~3650 rows/year × ~100 bytes = ~365 KB/year
-- Task type stats: ~50 unique tasks × ~100 bytes = ~5 KB total (one-time)
-- Command usage: ~30 commands × 365 days = ~10,950 rows/year × ~80 bytes = ~876 KB/year
--
-- TOTAL ESTIMATE: ~1.4 MB/year for all gamification analytics
-- This is extremely storage-efficient!
-- -----------------------------------------------------------------------------
