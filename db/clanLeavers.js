const { supabase } = require('./supabase');

/**
 * Clan Leavers Module
 * Archives player data when they leave the clan and supports cross-referencing returning members.
 */

/**
 * Archive a player's data before deletion
 * @param {Object} player - Full player object from the players table
 */
async function archivePlayer(player) {
    const { error } = await supabase
        .from('clan_leavers')
        .insert({
            rsn: player.rsn,
            discord_id: player.discord_id || null,
            wom_id: player.wom_id?.toString() || null,
            points: player.points || 0,
            lifetime_vp: player.lifetime_vp || 0,
            clan_joined_at: player.clan_joined_at || null,
            original_created_at: player.created_at || null
        });

    if (error) throw error;
    console.log(`[ClanLeavers] Archived player: ${player.rsn} (WOM: ${player.wom_id}, VP: ${player.points}, Lifetime: ${player.lifetime_vp})`);
}

/**
 * Get most recent non-rejoined leaver record by WOM ID
 */
async function getFormerMemberByWomId(womId) {
    const { data, error } = await supabase
        .from('clan_leavers')
        .select('*')
        .eq('wom_id', womId.toString())
        .eq('rejoined', false)
        .order('left_at', { ascending: false })
        .limit(1)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        throw error;
    }
    return data;
}

/**
 * Get most recent non-rejoined leaver record by Discord ID
 */
async function getFormerMemberByDiscordId(discordId) {
    const { data, error } = await supabase
        .from('clan_leavers')
        .select('*')
        .eq('discord_id', discordId)
        .eq('rejoined', false)
        .order('left_at', { ascending: false })
        .limit(1)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        throw error;
    }
    return data;
}

/**
 * Get a leaver record by ID
 */
async function getFormerMemberById(id) {
    const { data, error } = await supabase
        .from('clan_leavers')
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
    }
    return data;
}

/**
 * Mark a leaver as rejoined
 */
async function markRejoined(leaverId) {
    const { error } = await supabase
        .from('clan_leavers')
        .update({
            rejoined: true,
            rejoined_at: new Date().toISOString()
        })
        .eq('id', leaverId);

    if (error) throw error;
}

/**
 * Get all former members (most recent leavers first)
 */
async function getAllFormerMembers(limit = 50) {
    const { data, error } = await supabase
        .from('clan_leavers')
        .select('*')
        .order('left_at', { ascending: false })
        .limit(limit);

    if (error) throw error;
    return data || [];
}

module.exports = {
    archivePlayer,
    getFormerMemberByWomId,
    getFormerMemberByDiscordId,
    getFormerMemberById,
    markRejoined,
    getAllFormerMembers
};
