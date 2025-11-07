const supabase = require('./supabase');

/**
 * Lootcrate Analytics Module
 * Tracks aggregate metrics and rare drops without filling up storage
 */

// Define what counts as "rare" (adjust these thresholds as needed)
const RARE_THRESHOLDS = {
    VP_AMOUNT: 100,      // Log if VP won >= 100
    CHANCE_PERCENT: 5,   // Log if drop chance <= 5%
    ALWAYS_LOG: ['role', 'item']  // Always log these drop types
};

/**
 * Log a lootcrate opening (updates daily aggregates)
 * @param {string} userId - Discord user ID
 * @param {boolean} isFree - Whether it was a free daily claim
 * @param {object} result - Loot roll result {kind, amount, chance, itemName}
 */
async function logLootcrateOpen(userId, isFree, result) {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const { kind, amount = 0, chance = 0, itemName = null } = result;

    try {
        // 1. Update daily aggregate metrics
        await updateDailyMetrics(today, isFree, amount, kind);

        // 2. Track unique user for this day
        await trackDailyUser(today, userId);

        // 3. Log rare drops individually
        if (isRareDrop(result)) {
            await logRareDrop(userId, isFree, result);
        }

        console.log(`[Analytics] Logged lootcrate: user=${userId.slice(0, 8)}..., free=${isFree}, ${kind}=${amount}`);
    } catch (error) {
        // Don't let analytics failures break the lootcrate functionality
        console.error('[Analytics] Error logging lootcrate:', error.message);
    }
}

/**
 * Update daily aggregate metrics (upsert)
 */
async function updateDailyMetrics(date, isFree, vpAmount, dropType) {
    const vpWon = dropType === 'vp' ? vpAmount : 0;
    const vpSpent = isFree ? 0 : 5; // 5 VP cost for paid opens
    const isNothing = dropType === 'vp' && vpAmount === 0;

    const { data, error } = await supabase.client
        .rpc('increment_lootcrate_metrics', {
            p_date: date,
            p_total_opens: 1,
            p_free_opens: isFree ? 1 : 0,
            p_paid_opens: isFree ? 0 : 1,
            p_total_vp_won: vpWon,
            p_total_vp_spent: vpSpent,
            p_nothing_count: isNothing ? 1 : 0
        });

    if (error) throw error;
}

/**
 * Track unique user for the day (used to calculate unique_users count)
 */
async function trackDailyUser(date, userId) {
    const { error } = await supabase.client
        .from('lootcrate_daily_users')
        .upsert({
            date,
            user_id: userId,
            opens_count: 1
        }, {
            onConflict: 'date,user_id',
            ignoreDuplicates: false
        });

    if (error && error.code !== '23505') { // Ignore duplicate key errors
        throw error;
    }
}

/**
 * Log rare drop events individually
 */
async function logRareDrop(userId, isFree, result) {
    const { kind, amount, chance, itemName } = result;

    // Get username from cache if available (optional)
    const username = null; // Could fetch from interaction.user.username

    const { error } = await supabase.client
        .from('lootcrate_rare_drops')
        .insert({
            user_id: userId,
            username,
            drop_type: kind,
            item_name: itemName,
            amount: amount || 0,
            chance_percent: chance || 0,
            was_free: isFree
        });

    if (error) throw error;

    console.log(`[Analytics] 🎉 Rare drop logged: ${kind}=${amount || itemName}, chance=${chance}%`);
}

/**
 * Determine if a drop is "rare" enough to log individually
 */
function isRareDrop(result) {
    const { kind, amount = 0, chance = 0 } = result;

    // Always log roles and items
    if (RARE_THRESHOLDS.ALWAYS_LOG.includes(kind)) {
        return true;
    }

    // Log high VP amounts
    if (kind === 'vp' && amount >= RARE_THRESHOLDS.VP_AMOUNT) {
        return true;
    }

    // Log low-chance drops
    if (chance > 0 && chance <= RARE_THRESHOLDS.CHANCE_PERCENT) {
        return true;
    }

    return false;
}

/**
 * Get daily metrics for a date range
 */
async function getDailyMetrics(startDate, endDate) {
    const { data, error } = await supabase.client
        .from('lootcrate_daily_metrics')
        .select('*')
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: false });

    if (error) throw error;
    return data;
}

/**
 * Get recent rare drops
 */
async function getRecentRareDrops(limit = 50) {
    const { data, error } = await supabase.client
        .from('lootcrate_rare_drops')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(limit);

    if (error) throw error;
    return data;
}

/**
 * Calculate unique users for a specific date (from daily_users table)
 */
async function updateUniqueUsersCount(date) {
    const { count, error } = await supabase.client
        .from('lootcrate_daily_users')
        .select('user_id', { count: 'exact', head: true })
        .eq('date', date);

    if (error) throw error;

    // Update the daily metrics with unique user count
    const { error: updateError } = await supabase.client
        .from('lootcrate_daily_metrics')
        .update({ unique_users: count })
        .eq('date', date);

    if (updateError) throw updateError;

    return count;
}

module.exports = {
    logLootcrateOpen,
    getDailyMetrics,
    getRecentRareDrops,
    updateUniqueUsersCount,
    RARE_THRESHOLDS
};
