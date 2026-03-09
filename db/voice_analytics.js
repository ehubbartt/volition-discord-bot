const { supabase } = require('./supabase');

/**
 * Voice Analytics Module
 * Tracks voice chat activity — logs per-tick records, aggregates user stats and daily metrics.
 * Voice Minutes are a separate stat from VP.
 */

/**
 * Log a single voice tick for a user and update their aggregate stats
 */
async function logVoiceTick(userId, username, channelId, channelName, eligibleUsers, minutesAwarded) {
    try {
        // 1. Insert detailed log record
        const { error: logError } = await supabase
            .from('voice_activity_log')
            .insert({
                user_id: userId,
                username,
                channel_id: channelId,
                channel_name: channelName,
                eligible_users: eligibleUsers,
                minutes_awarded: minutesAwarded
            });

        if (logError) throw logError;

        // 2. Update aggregated user stats via RPC
        const { error: statsError } = await supabase.rpc('increment_voice_user_stats', {
            p_user_id: userId,
            p_username: username,
            p_ticks: 1,
            p_minutes: minutesAwarded
        });

        if (statsError) throw statsError;
    } catch (error) {
        console.error('[VoiceAnalytics] Error logging voice tick:', error.message);
    }
}

/**
 * Update daily aggregate metrics
 */
async function logDailyMetrics(date, ticks, minutes, uniqueUsers, peakConcurrent) {
    try {
        const { error } = await supabase.rpc('increment_voice_daily_metrics', {
            p_date: date,
            p_ticks: ticks,
            p_minutes: minutes,
            p_unique_users: uniqueUsers,
            p_peak_concurrent: peakConcurrent
        });

        if (error) throw error;
    } catch (error) {
        console.error('[VoiceAnalytics] Error logging daily metrics:', error.message);
    }
}

/**
 * Get a specific user's voice stats
 */
async function getUserVoiceStats(userId) {
    const { data, error } = await supabase
        .from('voice_user_stats')
        .select('*')
        .eq('user_id', userId)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        throw error;
    }
    return data;
}

/**
 * Get voice activity leaderboard
 */
async function getVoiceLeaderboard(limit = 10) {
    const { data, error } = await supabase
        .from('voice_user_stats')
        .select('*')
        .order('total_minutes', { ascending: false })
        .limit(limit);

    if (error) throw error;
    return data || [];
}

/**
 * Get daily metrics for a date range
 */
async function getDailyMetrics(startDate, endDate) {
    const { data, error } = await supabase
        .from('voice_daily_metrics')
        .select('*')
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: false });

    if (error) throw error;
    return data || [];
}

/**
 * Get weekly voice leaderboard (top users by minutes in last N days)
 * Aggregates directly from voice_activity_log
 */
async function getWeeklyVoiceLeaderboard(days = 7, limit = 3) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Paginate through all rows to avoid Supabase's default 1000-row limit
    const totals = {};
    const PAGE_SIZE = 1000;
    let from = 0;

    while (true) {
        const { data, error } = await supabase
            .from('voice_activity_log')
            .select('user_id, username, minutes_awarded')
            .gte('created_at', since)
            .range(from, from + PAGE_SIZE - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;

        for (const row of data) {
            if (!totals[row.user_id]) {
                totals[row.user_id] = { user_id: row.user_id, username: row.username, week_minutes: 0 };
            }
            totals[row.user_id].week_minutes += row.minutes_awarded;
        }

        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
    }

    return Object.values(totals)
        .sort((a, b) => b.week_minutes - a.week_minutes)
        .slice(0, limit);
}

module.exports = {
    logVoiceTick,
    logDailyMetrics,
    getUserVoiceStats,
    getVoiceLeaderboard,
    getDailyMetrics,
    getWeeklyVoiceLeaderboard
};
