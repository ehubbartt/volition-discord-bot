-- ============================================================================
-- GAMIFICATION ANALYTICS FUNCTIONS
-- Atomic, race-condition-free update functions
-- ============================================================================

-- -----------------------------------------------------------------------------
-- DUEL ANALYTICS FUNCTIONS
-- -----------------------------------------------------------------------------

-- Increment daily duel metrics
CREATE OR REPLACE FUNCTION increment_duel_daily_metrics(
    p_date DATE,
    p_total_duels INTEGER DEFAULT 1,
    p_vp_wagered INTEGER DEFAULT 0
)
RETURNS void AS $$
BEGIN
    INSERT INTO duel_daily_metrics (date, total_duels, total_vp_wagered, avg_wager)
    VALUES (p_date, p_total_duels, p_vp_wagered, p_vp_wagered)
    ON CONFLICT (date) DO UPDATE SET
        total_duels = duel_daily_metrics.total_duels + p_total_duels,
        total_vp_wagered = duel_daily_metrics.total_vp_wagered + p_vp_wagered,
        avg_wager = (duel_daily_metrics.total_vp_wagered + p_vp_wagered) /
                    NULLIF((duel_daily_metrics.total_duels + p_total_duels), 0),
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Update user duel stats (winner)
CREATE OR REPLACE FUNCTION update_duel_user_win(
    p_user_id TEXT,
    p_username TEXT,
    p_wager INTEGER,
    p_date DATE
)
RETURNS void AS $$
BEGIN
    INSERT INTO duel_user_stats (
        user_id, username, total_duels, wins, total_vp_won, largest_wager, last_duel_date
    )
    VALUES (p_user_id, p_username, 1, 1, p_wager, p_wager, p_date)
    ON CONFLICT (user_id) DO UPDATE SET
        username = COALESCE(p_username, duel_user_stats.username),
        total_duels = duel_user_stats.total_duels + 1,
        wins = duel_user_stats.wins + 1,
        total_vp_won = duel_user_stats.total_vp_won + p_wager,
        largest_wager = GREATEST(duel_user_stats.largest_wager, p_wager),
        last_duel_date = p_date,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Update user duel stats (loser)
CREATE OR REPLACE FUNCTION update_duel_user_loss(
    p_user_id TEXT,
    p_username TEXT,
    p_wager INTEGER,
    p_date DATE
)
RETURNS void AS $$
BEGIN
    INSERT INTO duel_user_stats (
        user_id, username, total_duels, losses, total_vp_lost, largest_wager, last_duel_date
    )
    VALUES (p_user_id, p_username, 1, 1, p_wager, p_wager, p_date)
    ON CONFLICT (user_id) DO UPDATE SET
        username = COALESCE(p_username, duel_user_stats.username),
        total_duels = duel_user_stats.total_duels + 1,
        losses = duel_user_stats.losses + 1,
        total_vp_lost = duel_user_stats.total_vp_lost + p_wager,
        largest_wager = GREATEST(duel_user_stats.largest_wager, p_wager),
        last_duel_date = p_date,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- TASK ANALYTICS FUNCTIONS
-- -----------------------------------------------------------------------------

-- Increment task completion metrics
CREATE OR REPLACE FUNCTION increment_task_metrics(
    p_date DATE,
    p_task_type TEXT, -- 'daily' or 'weekly'
    p_vp_earned INTEGER DEFAULT 0
)
RETURNS void AS $$
BEGIN
    IF p_task_type = 'daily' THEN
        INSERT INTO task_daily_metrics (date, daily_task_completions, total_vp_earned_from_tasks)
        VALUES (p_date, 1, p_vp_earned)
        ON CONFLICT (date) DO UPDATE SET
            daily_task_completions = task_daily_metrics.daily_task_completions + 1,
            total_vp_earned_from_tasks = task_daily_metrics.total_vp_earned_from_tasks + p_vp_earned,
            updated_at = NOW();
    ELSIF p_task_type = 'weekly' THEN
        INSERT INTO task_daily_metrics (date, weekly_task_completions, total_vp_earned_from_tasks)
        VALUES (p_date, 1, p_vp_earned)
        ON CONFLICT (date) DO UPDATE SET
            weekly_task_completions = task_daily_metrics.weekly_task_completions + 1,
            total_vp_earned_from_tasks = task_daily_metrics.total_vp_earned_from_tasks + p_vp_earned,
            updated_at = NOW();
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Track task type popularity
CREATE OR REPLACE FUNCTION track_task_completion(
    p_task_name TEXT
)
RETURNS void AS $$
BEGIN
    INSERT INTO task_type_stats (task_name, total_completions, last_completed)
    VALUES (p_task_name, 1, NOW())
    ON CONFLICT (task_name) DO UPDATE SET
        total_completions = task_type_stats.total_completions + 1,
        last_completed = NOW();
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- VERIFICATION ANALYTICS FUNCTIONS
-- -----------------------------------------------------------------------------

-- Log verification attempt
CREATE OR REPLACE FUNCTION log_verification(
    p_date DATE,
    p_success BOOLEAN,
    p_ehb INTEGER DEFAULT 0,
    p_total_level INTEGER DEFAULT 0
)
RETURNS void AS $$
DECLARE
    v_current_count INTEGER;
    v_current_avg_ehb NUMERIC;
    v_current_avg_level NUMERIC;
    v_new_count INTEGER;
BEGIN
    -- Get current values
    SELECT
        successful_verifications,
        COALESCE(avg_ehb, 0),
        COALESCE(avg_total_level, 0)
    INTO v_current_count, v_current_avg_ehb, v_current_avg_level
    FROM verification_daily_metrics
    WHERE date = p_date;

    v_current_count := COALESCE(v_current_count, 0);

    IF p_success THEN
        v_new_count := v_current_count + 1;

        INSERT INTO verification_daily_metrics (
            date, total_verifications, successful_verifications, avg_ehb, avg_total_level
        )
        VALUES (
            p_date, 1, 1,
            p_ehb,
            p_total_level
        )
        ON CONFLICT (date) DO UPDATE SET
            total_verifications = verification_daily_metrics.total_verifications + 1,
            successful_verifications = verification_daily_metrics.successful_verifications + 1,
            avg_ehb = ((verification_daily_metrics.avg_ehb * v_current_count) + p_ehb) / v_new_count,
            avg_total_level = ((verification_daily_metrics.avg_total_level * v_current_count) + p_total_level) / v_new_count,
            updated_at = NOW();
    ELSE
        INSERT INTO verification_daily_metrics (date, total_verifications, failed_verifications)
        VALUES (p_date, 1, 1)
        ON CONFLICT (date) DO UPDATE SET
            total_verifications = verification_daily_metrics.total_verifications + 1,
            failed_verifications = verification_daily_metrics.failed_verifications + 1,
            updated_at = NOW();
    END IF;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- COMMAND USAGE ANALYTICS FUNCTIONS
-- -----------------------------------------------------------------------------

-- Track command usage
CREATE OR REPLACE FUNCTION track_command_usage(
    p_date DATE,
    p_command_name TEXT
)
RETURNS void AS $$
BEGIN
    INSERT INTO command_daily_usage (date, command_name, usage_count)
    VALUES (p_date, p_command_name, 1)
    ON CONFLICT (date, command_name) DO UPDATE SET
        usage_count = command_daily_usage.usage_count + 1;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- CLEANUP FUNCTIONS
-- -----------------------------------------------------------------------------

-- Cleanup old analytics data (keep last 365 days for daily metrics)
CREATE OR REPLACE FUNCTION cleanup_old_analytics()
RETURNS TABLE(table_name TEXT, deleted_count INTEGER) AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    -- Clean duel metrics
    DELETE FROM duel_daily_metrics WHERE date < CURRENT_DATE - INTERVAL '365 days';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    table_name := 'duel_daily_metrics';
    deleted_count := v_deleted;
    RETURN NEXT;

    -- Clean task metrics
    DELETE FROM task_daily_metrics WHERE date < CURRENT_DATE - INTERVAL '365 days';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    table_name := 'task_daily_metrics';
    deleted_count := v_deleted;
    RETURN NEXT;

    -- Clean verification metrics
    DELETE FROM verification_daily_metrics WHERE date < CURRENT_DATE - INTERVAL '365 days';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    table_name := 'verification_daily_metrics';
    deleted_count := v_deleted;
    RETURN NEXT;

    -- Clean command usage (keep 180 days)
    DELETE FROM command_daily_usage WHERE date < CURRENT_DATE - INTERVAL '180 days';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    table_name := 'command_daily_usage';
    deleted_count := v_deleted;
    RETURN NEXT;

    -- Clean notable duels (keep 180 days)
    DELETE FROM duel_notable WHERE timestamp < NOW() - INTERVAL '180 days';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    table_name := 'duel_notable';
    deleted_count := v_deleted;
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;
