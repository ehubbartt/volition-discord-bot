const ranksConfig = require('../config/ranks.json');

/**
 * Get all role IDs for rank roles
 * @returns {string[]} Array of role IDs
 */
function getAllRoleIds() {
    return ranksConfig.ranks.map(r => r.roleId);
}

/**
 * Get rank display with dynamic name/emoji (emoji name = role name)
 * @param {Guild} guild - Discord guild object
 * @param {number} rankIndex - Index of the rank (0 = lowest)
 * @returns {string} Formatted rank string like "<:Bronze:123> Bronze"
 */
function formatRank(guild, rankIndex) {
    const rank = ranksConfig.ranks[rankIndex];
    if (!rank) return 'Unknown';

    const role = guild.roles.cache.get(rank.roleId);
    const roleName = role?.name || 'Unknown';

    // Look up emoji by role name (emoji must be named same as role)
    const emoji = guild.emojis.cache.find(e => e.name === roleName);
    const emojiStr = emoji ? `${emoji} ` : '';

    return `${emojiStr}${roleName}`;
}

/**
 * Get just the role name (without emoji)
 * @param {Guild} guild - Discord guild object
 * @param {number} rankIndex - Index of the rank (0 = lowest)
 * @returns {string} Role name
 */
function getRankName(guild, rankIndex) {
    const rank = ranksConfig.ranks[rankIndex];
    if (!rank) return 'Unknown';

    const role = guild.roles.cache.get(rank.roleId);
    return role?.name || 'Unknown';
}

// Rank is NEVER calculated in the bot. The site computes the composite rank and
// writes players.rank; the bot only mirrors that stored value to Discord roles
// (applyRankByWomRole) or assigns the fixed ENTRY rank (index 0) to brand-new
// members the site hasn't scored yet (applyRankIndex(ENTRY_RANK_INDEX, ...)).
const ENTRY_RANK_INDEX = 0;

/**
 * Check if newIndex is higher than currentIndex (rank upgrade)
 * @param {number|null} currentIndex - Current rank index
 * @param {number} newIndex - New rank index
 * @returns {boolean} True if new rank is higher
 */
function isRankUpgrade(currentIndex, newIndex) {
    if (currentIndex === null || currentIndex === undefined || currentIndex === -1) return true;
    return newIndex > currentIndex;
}

/**
 * Get rank index from role ID
 * @param {string} roleId - Discord role ID
 * @returns {number} Rank index, or -1 if not found
 */
function getRankIndexByRoleId(roleId) {
    return ranksConfig.ranks.findIndex(r => r.roleId === roleId);
}

/**
 * Get role ID by rank index
 * @param {number} index - Rank index
 * @returns {string|null} Role ID or null
 */
function getRoleIdByIndex(index) {
    return ranksConfig.ranks[index]?.roleId || null;
}

/**
 * Get WOM role name for a rank index
 * @param {number} rankIndex - Rank index
 * @returns {string|null} WOM role name or null
 */
function getWomRole(rankIndex) {
    return ranksConfig.ranks[rankIndex]?.womRole || null;
}

/**
 * Get rank index from WOM role name
 * @param {string} womRole - WOM role name (e.g., "apothecary")
 * @returns {number} Rank index, or -1 if not found
 */
function getRankIndexByWomRole(womRole) {
    return ranksConfig.ranks.findIndex(r => r.womRole === womRole);
}

/**
 * Get the current rank index for a Discord member
 * @param {GuildMember} member - Discord guild member
 * @returns {number} Rank index, or -1 if no rank role found
 */
function getMemberRankIndex(member) {
    const allRoleIds = getAllRoleIds();
    const memberRankRole = member.roles.cache.find(role => allRoleIds.includes(role.id));

    if (!memberRankRole) return -1;

    return getRankIndexByRoleId(memberRankRole.id);
}

/**
 * Get rank configuration by index
 * @param {number} index - Rank index
 * @returns {object|null} Rank config object or null
 */
function getRankByIndex(index) {
    return ranksConfig.ranks[index] || null;
}

/**
 * Get the total number of ranks
 * @returns {number} Number of ranks
 */
function getRankCount() {
    return ranksConfig.ranks.length;
}

/**
 * Mechanically swap a member's rank role to the one for newRankIndex (removes any
 * existing rank role first). Caller decides WHEN to swap; this just does it.
 * @param {GuildMember} member
 * @param {number} newRankIndex
 * @returns {Promise<{changed: boolean, error: string|null}>}
 */
async function swapRankRole(member, newRankIndex) {
    const newRoleId = getRoleIdByIndex(newRankIndex);
    if (!newRoleId) return { changed: false, error: `Role ID not configured for rank index ${newRankIndex}` };

    try {
        const allRankRoleIds = getAllRoleIds();
        const currentRoleObj = member.roles.cache.find(r => allRankRoleIds.includes(r.id));
        if (currentRoleObj) await member.roles.remove(currentRoleObj);
        await member.roles.add(newRoleId);
        return { changed: true, error: null };
    } catch (err) {
        return { changed: false, error: err.message };
    }
}

/**
 * Apply a target rank to a member and return change info. The shared core behind
 * both rank paths — given a resolved newRankIndex, it figures out the member's
 * current rank, honours allowDowngrade, and swaps the role if needed.
 * @param {number} newRankIndex
 * @param {GuildMember|null} member
 * @param {boolean} allowDowngrade
 * @returns {Promise<{newRankIndex: number, oldRankIndex: number, changed: boolean, isUpgrade: boolean, error: string|null}>}
 */
async function applyRankIndex(newRankIndex, member, allowDowngrade) {
    const oldRankIndex = member ? getMemberRankIndex(member) : -1;

    const result = {
        newRankIndex,
        oldRankIndex,
        changed: false,
        isUpgrade: isRankUpgrade(oldRankIndex, newRankIndex),
        error: null,
    };

    if (newRankIndex === -1) {
        result.error = 'No valid target rank';
        return result;
    }
    if (!member) return result;            // No Discord member — just the calculation
    if (oldRankIndex === newRankIndex) return result; // Already correct
    if (!result.isUpgrade && !allowDowngrade) return result; // Skip disallowed downgrade

    const swap = await swapRankRole(member, newRankIndex);
    result.changed = swap.changed;
    result.error = swap.error;
    return result;
}

/**
 * Sync a member's Discord rank role to a stored WOM role string (players.rank, which
 * the SITE now computes). This is the mirror path: the bot no longer derives rank from
 * EHB for role assignment — it reflects whatever the site wrote.
 *
 * @param {Object} options
 * @param {string}            options.womRole               - Stored rank womRole (e.g. "dragon")
 * @param {GuildMember|null}  [options.member=null]         - Discord guild member, or null if not linked
 * @param {boolean}           [options.allowDowngrade=true]  - Whether to apply downgrades
 * @returns {Promise<{newRankIndex: number, oldRankIndex: number, changed: boolean, isUpgrade: boolean, error: string|null}>}
 */
async function applyRankByWomRole({ womRole, member = null, allowDowngrade = true }) {
    return applyRankIndex(getRankIndexByWomRole(womRole), member, allowDowngrade);
}

/**
 * List of standard WOM roles that are part of the progression system
 */
const standardWomRoles = ranksConfig.ranks
    .map(r => r.womRole)
    .filter(r => r !== null);

module.exports = {
    ranksConfig,
    ENTRY_RANK_INDEX,
    getAllRoleIds,
    formatRank,
    getRankName,
    isRankUpgrade,
    getRankIndexByRoleId,
    getRoleIdByIndex,
    getWomRole,
    getRankIndexByWomRole,
    getMemberRankIndex,
    getRankByIndex,
    getRankCount,
    swapRankRole,
    applyRankIndex,
    applyRankByWomRole,
    standardWomRoles
};
