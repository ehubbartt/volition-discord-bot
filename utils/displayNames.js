/**
 * Resolve live Discord display names (server nickname, falling back to username).
 *
 * The voice tables store the username captured at tick time, so it goes stale the
 * moment someone renames. Anything shown back to members should resolve names now
 * rather than replay what was true months ago.
 */

const config = require('./config');

/**
 * @param {import('discord.js').Client} client
 * @param {string[]} userIds
 * @returns {Promise<Map<string, string>>} id -> display name, missing for anyone
 *          who could not be resolved (left the guild, fetch failed).
 */
async function resolveDisplayNames(client, userIds) {
    const map = new Map();
    const ids = [...new Set((userIds || []).filter(Boolean))];
    if (!client || ids.length === 0) return map;
    try {
        const guild = client.guilds.cache.get(config.guildId);
        if (!guild) return map;
        const members = await guild.members.fetch({ user: ids });
        for (const [id, member] of members) map.set(id, member.displayName);
    } catch (err) {
        // A stale name is cosmetic — callers fall back to the stored username rather
        // than failing the whole embed over it.
        console.error('[DisplayNames] Failed to resolve nicknames:', err.message);
    }
    return map;
}

module.exports = { resolveDisplayNames };
