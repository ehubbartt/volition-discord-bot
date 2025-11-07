const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

// Threshold for logging "notable" duels
const NOTABLE_DUEL_THRESHOLD = 100; // Only log duels with wager >= 100 VP

/**
 * Log a completed duel
 * @param {string} challengerId - Discord ID of challenger
 * @param {string} opponentId - Discord ID of opponent
 * @param {number} wager - VP amount wagered
 * @param {string} winnerId - Discord ID of winner
 * @param {string} loserId - Discord ID of loser
 * @param {string} winnerUsername - Username of winner (optional)
 * @param {string} loserUsername - Username of loser (optional)
 */
async function logDuel(challengerId, opponentId, wager, winnerId, loserId, winnerUsername = null, loserUsername = null) {
    const today = new Date().toISOString().split('T')[0];

    try {
        // 1. Update daily metrics
        await supabase.rpc('increment_duel_daily_metrics', {
            p_date: today,
            p_total_duels: 1,
            p_vp_wagered: wager
        });

        // 2. Update winner stats
        await supabase.rpc('update_duel_user_win', {
            p_user_id: winnerId,
            p_username: winnerUsername,
            p_wager: wager,
            p_date: today
        });

        // 3. Update loser stats
        await supabase.rpc('update_duel_user_loss', {
            p_user_id: loserId,
            p_username: loserUsername,
            p_wager: wager,
            p_date: today
        });

        // 4. Log notable duels (high stakes only)
        if (wager >= NOTABLE_DUEL_THRESHOLD) {
            await supabase
                .from('duel_notable')
                .insert({
                    challenger_id: challengerId,
                    opponent_id: opponentId,
                    wager: wager,
                    winner_id: winnerId,
                    loser_id: loserId
                });
        }

        console.log(`[Analytics] Logged duel: ${wager} VP wagered`);
    } catch (error) {
        console.error('[Analytics] Error logging duel:', error.message);
    }
}

/**
 * Log a task completion
 * @param {string} taskType - 'daily' or 'weekly'
 * @param {string} taskName - Name of the task completed
 * @param {number} vpEarned - VP earned from task
 */
async function logTaskCompletion(taskType, taskName, vpEarned = 0) {
    const today = new Date().toISOString().split('T')[0];

    try {
        // Update daily metrics
        await supabase.rpc('increment_task_metrics', {
            p_date: today,
            p_task_type: taskType,
            p_vp_earned: vpEarned
        });

        // Track which tasks are popular
        await supabase.rpc('track_task_completion', {
            p_task_name: taskName
        });

        console.log(`[Analytics] Logged ${taskType} task completion: ${taskName}`);
    } catch (error) {
        console.error('[Analytics] Error logging task:', error.message);
    }
}

/**
 * Log a verification attempt
 * @param {boolean} success - Whether verification was successful
 * @param {number} ehb - EHB value (if successful)
 * @param {number} totalLevel - Total level (if successful)
 */
async function logVerification(success, ehb = 0, totalLevel = 0) {
    const today = new Date().toISOString().split('T')[0];

    try {
        await supabase.rpc('log_verification', {
            p_date: today,
            p_success: success,
            p_ehb: ehb || 0,
            p_total_level: totalLevel || 0
        });

        console.log(`[Analytics] Logged verification: ${success ? 'success' : 'failed'}`);
    } catch (error) {
        console.error('[Analytics] Error logging verification:', error.message);
    }
}

/**
 * Track command usage (lightweight)
 * @param {string} commandName - Name of the command used
 */
async function trackCommandUsage(commandName) {
    const today = new Date().toISOString().split('T')[0];

    try {
        await supabase.rpc('track_command_usage', {
            p_date: today,
            p_command_name: commandName
        });
    } catch (error) {
        // Silently fail for command tracking to not impact user experience
        console.error('[Analytics] Error tracking command:', error.message);
    }
}

/**
 * Get duel leaderboard (top winners)
 * @param {number} limit - Number of results to return
 */
async function getDuelLeaderboard(limit = 10) {
    try {
        const { data, error } = await supabase
            .from('duel_user_stats')
            .select('*')
            .order('total_vp_won', { ascending: false })
            .limit(limit);

        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[Analytics] Error getting duel leaderboard:', error.message);
        return [];
    }
}

/**
 * Get user's duel stats
 * @param {string} userId - Discord user ID
 */
async function getUserDuelStats(userId) {
    try {
        const { data, error } = await supabase
            .from('duel_user_stats')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[Analytics] Error getting user duel stats:', error.message);
        return null;
    }
}

module.exports = {
    logDuel,
    logTaskCompletion,
    logVerification,
    trackCommandUsage,
    getDuelLeaderboard,
    getUserDuelStats
};
