/**
 * Permission checking utilities
 */

const config = require('./config');

/**
 * Check if a member has any of the admin roles
 * @param {GuildMember} member - Discord guild member
 * @returns {boolean} - True if member has at least one admin role
 */
function isAdmin(member) {
    if (!member || !member.roles) return false;

    const adminRoleIDs = config.ADMIN_ROLE_IDS || [];

    // Check if member has any of the admin roles
    return adminRoleIDs.some(roleId => member.roles.cache.has(roleId));
}

module.exports = {
    isAdmin
};
