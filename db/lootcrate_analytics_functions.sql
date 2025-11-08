-- PostgreSQL function to atomically increment daily metrics
-- This prevents race conditions and is much faster than read-update-write

CREATE OR REPLACE FUNCTION increment_lootcrate_metrics(
    p_date DATE,
    p_total_opens INTEGER DEFAULT 0,
    p_free_opens INTEGER DEFAULT 0,
    p_paid_opens INTEGER DEFAULT 0,
    p_total_vp_won INTEGER DEFAULT 0,
    p_total_vp_spent INTEGER DEFAULT 0,
    p_nothing_count INTEGER DEFAULT 0
)
RETURNS void AS $$
DECLARE
    v_unique_count INTEGER;
BEGIN
    INSERT INTO lootcrate_daily_metrics (
        date,
        total_opens,
        free_opens,
        paid_opens,
        total_vp_won,
        total_vp_spent,
        nothing_count,
        unique_users
    ) VALUES (
        p_date,
        p_total_opens,
        p_free_opens,
        p_paid_opens,
        p_total_vp_won,
        p_total_vp_spent,
        p_nothing_count,
        0  -- Will be updated below
    )
    ON CONFLICT (date) DO UPDATE SET
        total_opens = lootcrate_daily_metrics.total_opens + p_total_opens,
        free_opens = lootcrate_daily_metrics.free_opens + p_free_opens,
        paid_opens = lootcrate_daily_metrics.paid_opens + p_paid_opens,
        total_vp_won = lootcrate_daily_metrics.total_vp_won + p_total_vp_won,
        total_vp_spent = lootcrate_daily_metrics.total_vp_spent + p_total_vp_spent,
        nothing_count = lootcrate_daily_metrics.nothing_count + p_nothing_count,
        updated_at = NOW();

    -- Calculate and update unique users count for this date
    SELECT COUNT(DISTINCT user_id) INTO v_unique_count
    FROM lootcrate_daily_users
    WHERE date = p_date;

    UPDATE lootcrate_daily_metrics
    SET unique_users = v_unique_count
    WHERE date = p_date;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate and update unique users for a date
-- Run this once per day (e.g., via cron job or scheduled task)
CREATE OR REPLACE FUNCTION update_daily_unique_users(p_date DATE)
RETURNS INTEGER AS $$
DECLARE
    v_unique_count INTEGER;
BEGIN
    SELECT COUNT(DISTINCT user_id)
    INTO v_unique_count
    FROM lootcrate_daily_users
    WHERE date = p_date;

    UPDATE lootcrate_daily_metrics
    SET unique_users = v_unique_count,
        updated_at = NOW()
    WHERE date = p_date;

    RETURN v_unique_count;
END;
$$ LANGUAGE plpgsql;

-- Update per-user lootcrate stats
CREATE OR REPLACE FUNCTION update_lootcrate_user_stats(
    p_user_id TEXT,
    p_username TEXT,
    p_is_free BOOLEAN,
    p_vp_won INTEGER,
    p_date DATE
)
RETURNS void AS $$
DECLARE
    v_vp_spent INTEGER := CASE WHEN p_is_free THEN 0 ELSE 5 END;
BEGIN
    INSERT INTO lootcrate_user_stats (
        user_id,
        username,
        total_opens,
        free_opens,
        paid_opens,
        total_vp_won,
        total_vp_spent,
        biggest_win,
        last_open_date
    ) VALUES (
        p_user_id,
        p_username,
        1,
        CASE WHEN p_is_free THEN 1 ELSE 0 END,
        CASE WHEN p_is_free THEN 0 ELSE 1 END,
        p_vp_won,
        v_vp_spent,
        p_vp_won,
        p_date
    )
    ON CONFLICT (user_id) DO UPDATE SET
        username = COALESCE(p_username, lootcrate_user_stats.username),
        total_opens = lootcrate_user_stats.total_opens + 1,
        free_opens = lootcrate_user_stats.free_opens + CASE WHEN p_is_free THEN 1 ELSE 0 END,
        paid_opens = lootcrate_user_stats.paid_opens + CASE WHEN p_is_free THEN 0 ELSE 1 END,
        total_vp_won = lootcrate_user_stats.total_vp_won + p_vp_won,
        total_vp_spent = lootcrate_user_stats.total_vp_spent + v_vp_spent,
        biggest_win = GREATEST(lootcrate_user_stats.biggest_win, p_vp_won),
        last_open_date = p_date,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Cleanup old daily user records (keep last 90 days)
-- Run this periodically to save space
CREATE OR REPLACE FUNCTION cleanup_old_lootcrate_data()
RETURNS INTEGER AS $$
DECLARE
    v_deleted_count INTEGER;
BEGIN
    DELETE FROM lootcrate_daily_users
    WHERE date < CURRENT_DATE - INTERVAL '90 days';

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql;
