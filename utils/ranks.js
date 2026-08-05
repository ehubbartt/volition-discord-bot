const ranksConfig = require('../config/ranks.json');
const signatureConfig = require('../config/signatureRanks.json');

// Signature (prestige) ranks — a SEPARATE set of roles earned on the site by fully
// completing whole rank categories (Savant 5/7, Curator 6/7, Paragon 7/7). Ordered
// low → high. A member displays EITHER their composite ladder rank OR their signature
// rank (their choice, stored on players.prefer_signature_rank), never both.
const SIGNATURE_RANKS = Array.isArray(signatureConfig.signatureRanks)
    ? signatureConfig.signatureRanks
    : [];

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

// --- Signature (prestige) rank helpers ------------------------------------

function getSignatureRoleIds() {
    return SIGNATURE_RANKS.map(s => s.roleId);
}
function getSignatureRoleIdByKey(key) {
    if (!key) return null;
    const found = SIGNATURE_RANKS.find(s => s.key === String(key).toLowerCase());
    return found ? found.roleId : null;
}
function getSignatureIndexByKey(key) {
    if (!key) return -1;
    return SIGNATURE_RANKS.findIndex(s => s.key === String(key).toLowerCase());
}
function getSignatureIndexByRoleId(roleId) {
    return SIGNATURE_RANKS.findIndex(s => s.roleId === roleId);
}
function getSignatureKeyByRoleId(roleId) {
    const found = SIGNATURE_RANKS.find(s => s.roleId === roleId);
    return found ? found.key : null;
}

/**
 * Every role the rank system manages — the composite ladder PLUS the signature ranks.
 * The set we clear on a swap so a member never ends up holding two rank roles at once.
 */
function getAllManagedRankRoleIds() {
    return [...getAllRoleIds(), ...getSignatureRoleIds()];
}

/**
 * Format ANY rank role (ladder or signature) as "<emoji> Name" from its role id.
 * Emoji is matched by role name, same convention as formatRank. Null id → "None".
 */
function formatRoleById(guild, roleId) {
    if (!roleId) return 'None';
    const role = guild?.roles?.cache?.get(roleId);
    const roleName = role?.name || 'Unknown';
    const emoji = guild?.emojis?.cache?.find(e => e.name === roleName);
    return `${emoji ? `${emoji} ` : ''}${roleName}`;
}

/**
 * The rank role a member SHOULD hold: their signature (prestige) role when they've opted
 * in AND currently qualify for one, otherwise their composite ladder role (players.rank).
 * Null when the member has no rank at all (the site hasn't scored them yet).
 * @param {object} player - players row ({ rank, prefer_signature_rank, signature_rank })
 * @returns {{isSignature: boolean, roleId: string, signatureKey: string|null, ladderIndex: number}|null}
 */
function resolveEffectiveRank(player) {
    if (!player) return null;
    const sigRoleId = player.prefer_signature_rank ? getSignatureRoleIdByKey(player.signature_rank) : null;
    if (sigRoleId) {
        return { isSignature: true, roleId: sigRoleId, signatureKey: getSignatureKeyByRoleId(sigRoleId), ladderIndex: -1 };
    }
    const ladderIndex = getRankIndexByWomRole(player.rank);
    if (ladderIndex === -1) return null;
    return { isSignature: false, roleId: getRoleIdByIndex(ladderIndex), signatureKey: null, ladderIndex };
}

/**
 * Mechanically move a member to exactly one managed rank role: remove every managed rank
 * role that isn't the target, then add the target. Handles crossing between the ladder and
 * signature categories.
 */
async function swapToRoleId(member, targetRoleId) {
    try {
        const managed = getAllManagedRankRoleIds();
        const toRemove = member.roles.cache.filter(r => managed.includes(r.id) && r.id !== targetRoleId);
        if (toRemove.size > 0) await member.roles.remove([...toRemove.keys()]);
        if (!member.roles.cache.has(targetRoleId)) await member.roles.add(targetRoleId);
        return { changed: true, error: null };
    } catch (err) {
        return { changed: false, error: err.message };
    }
}

/**
 * Apply a member's EFFECTIVE clan rank role — signature when they've opted into it and
 * earned one, otherwise their composite ladder role — removing any other managed rank role.
 * The single mirror path the site's chosen rank flows through everywhere (/sync, /syncuser,
 * the daily job, WOM listener, updateRanksEhb), so a signature role sticks instead of being
 * reverted to composite on the next sync.
 *
 * @param {object}            options
 * @param {object}            options.player               - players row (rank + prefer/signature)
 * @param {GuildMember|null}  [options.member=null]
 * @param {boolean}           [options.allowDowngrade=true] - gates PURE LADDER downgrades only;
 *                                                            signature transitions always apply
 * @returns {Promise<{changed:boolean, error:string|null, isSignature:boolean, signatureKey:string|null,
 *   oldRoleId:string|null, newRoleId:string|null, oldRankIndex:number, newRankIndex:number,
 *   isInitial:boolean, isUpgrade:boolean}>}
 */
async function applyEffectiveRank({ player, member = null, allowDowngrade = true }) {
    const target = resolveEffectiveRank(player);
    const managed = getAllManagedRankRoleIds();
    const currentRole = member ? member.roles.cache.find(r => managed.includes(r.id)) : null;
    const oldRoleId = currentRole ? currentRole.id : null;
    const oldLadderIndex = member ? getMemberRankIndex(member) : -1;

    const result = {
        changed: false,
        error: null,
        isSignature: !!target?.isSignature,
        signatureKey: target?.signatureKey ?? null,
        oldRoleId,
        newRoleId: target?.roleId ?? null,
        oldRankIndex: oldLadderIndex,
        newRankIndex: target && !target.isSignature ? target.ladderIndex : -1,
        isInitial: oldRoleId === null,
        isUpgrade: false,
    };

    if (!target) { result.error = 'No valid target rank'; return result; }
    if (!member) return result;                 // calculation only
    if (oldRoleId === target.roleId) return result; // already correct

    const fromSignature = oldRoleId ? getSignatureKeyByRoleId(oldRoleId) !== null : false;
    if (target.isSignature) {
        // Reaching a signature rank (from the ladder) or climbing the signature tiers = up.
        const oldSig = oldRoleId ? getSignatureIndexByRoleId(oldRoleId) : -1;
        result.isUpgrade = getSignatureIndexByKey(target.signatureKey) > oldSig;
    } else if (fromSignature) {
        result.isUpgrade = false;               // toggled prestige off → back to composite (silent)
    } else {
        result.isUpgrade = isRankUpgrade(oldLadderIndex, target.ladderIndex);
    }

    // Only a pure ladder downgrade honours allowDowngrade; every signature transition (opt-in,
    // opt-out, or tier change) reflects the member's explicit choice and always applies.
    const isPureLadderDowngrade = !target.isSignature && !fromSignature && !result.isUpgrade;
    if (isPureLadderDowngrade && !allowDowngrade) return result;

    const swap = await swapToRoleId(member, target.roleId);
    result.changed = swap.changed;
    result.error = swap.error;
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
    standardWomRoles,
    // Signature (prestige) ranks
    SIGNATURE_RANKS,
    getSignatureRoleIds,
    getSignatureRoleIdByKey,
    getSignatureIndexByKey,
    getSignatureKeyByRoleId,
    getAllManagedRankRoleIds,
    formatRoleById,
    resolveEffectiveRank,
    swapToRoleId,
    applyEffectiveRank
};
