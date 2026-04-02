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

/**
 * Determine rank index based on EHB and time in clan
 * @param {number} ehb - Efficient Hours Bossed
 * @param {number|null} clanJoinTimestamp - Timestamp when player joined clan
 * @returns {number} Rank index (0 = lowest)
 */
function determineRankIndex(ehb) {
    // Check from highest to lowest
    for (let i = ranksConfig.ranks.length - 1; i >= 0; i--) {
        if (ehb >= ranksConfig.ranks[i].ehbMin) return i;
    }

    return 0; // Default to lowest rank
}

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
 * Calculate rank from EHB, optionally update Discord roles, and return change info.
 * Centralizes the rank determination + role assignment pattern used across the bot.
 *
 * @param {Object} options
 * @param {number}            options.ehb                  - Player's EHB value
 * @param {GuildMember|null}  [options.member=null]         - Discord guild member, or null if not linked
 * @param {boolean}           [options.allowDowngrade=true]  - Whether to apply downgrades
 * @returns {Promise<{newRankIndex: number, oldRankIndex: number, changed: boolean, isUpgrade: boolean, error: string|null}>}
 */
async function applyRank({ ehb, member = null, allowDowngrade = true }) {
    const newRankIndex = determineRankIndex(Math.round(ehb));
    const oldRankIndex = member ? getMemberRankIndex(member) : -1;

    const result = {
        newRankIndex,
        oldRankIndex,
        changed: false,
        isUpgrade: isRankUpgrade(oldRankIndex, newRankIndex),
        error: null,
    };

    // No Discord member — just return the calculation
    if (!member) return result;

    // Already correct rank
    if (oldRankIndex === newRankIndex) return result;

    // Skip downgrades when not allowed
    if (!result.isUpgrade && !allowDowngrade) return result;

    // Apply the role change
    try {
        const allRankRoleIds = getAllRoleIds();
        const currentRoleObj = member.roles.cache.find(r => allRankRoleIds.includes(r.id));
        if (currentRoleObj) await member.roles.remove(currentRoleObj);

        const newRoleId = getRoleIdByIndex(newRankIndex);
        if (newRoleId) {
            await member.roles.add(newRoleId);
            result.changed = true;
        } else {
            result.error = `Role ID not configured for rank index ${newRankIndex}`;
        }
    } catch (err) {
        result.error = err.message;
    }

    return result;
}

/**
 * List of standard WOM roles that are part of the progression system
 */
const standardWomRoles = ranksConfig.ranks
    .map(r => r.womRole)
    .filter(r => r !== null);

module.exports = {
    ranksConfig,
    getAllRoleIds,
    formatRank,
    getRankName,
    determineRankIndex,
    isRankUpgrade,
    getRankIndexByRoleId,
    getRoleIdByIndex,
    getWomRole,
    getRankIndexByWomRole,
    getMemberRankIndex,
    getRankByIndex,
    getRankCount,
    applyRank,
    standardWomRoles
};
