const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');
const { formatRoleById, getRoleIdByIndex } = require('./ranks');

/**
 * Broadcast rank-up announcements to the #rank-ups channel. Handles both the composite
 * ladder ranks and the signature (prestige) ranks — signature unlocks get their own flavour.
 *
 * @param {Guild} guild - Discord guild object
 * @param {Array} announcements - Array of announcement objects. Preferred shape carries role
 *   ids: { member, rsn, ehb, oldRoleId, newRoleId, isInitial, isSignature }. Legacy index
 *   fields (oldRankIndex / newRankIndex) are still accepted as a fallback.
 * @param {string} logPrefix - Prefix for console logs
 */
async function broadcastRankUps (guild, announcements, logPrefix = '[RankAnnouncements]') {
    if (announcements.length === 0) return;

    try {
        const rankUpsChannel = await guild.channels.fetch(config.RANK_UPS_CHANNEL_ID);
        if (!rankUpsChannel) {
            console.error(`${logPrefix} Rank-ups channel not found: ${config.RANK_UPS_CHANNEL_ID}`);
            return;
        }

        for (const announcement of announcements) {
            const { member, rsn, ehb, isInitial, isSignature } = announcement;

            // Prefer explicit role ids; fall back to ladder indices for legacy callers.
            const newRoleId = announcement.newRoleId
                ?? (announcement.newRankIndex >= 0 ? getRoleIdByIndex(announcement.newRankIndex) : null);
            const oldRoleId = announcement.oldRoleId
                ?? (announcement.oldRankIndex >= 0 ? getRoleIdByIndex(announcement.oldRankIndex) : null);

            const embed = new EmbedBuilder()
                .setColor(isSignature ? 'Purple' : 'Gold')
                .setTitle(isSignature ? '✨ Signature Rank Unlocked!' : 'Rank Up!')
                .setDescription(
                    isSignature
                        ? `Congratulations <@${member.id}>! You've earned a **signature rank** — a mark of full clan completion. 👑`
                        : isInitial
                            ? `Congratulations <@${member.id}>! You've been assigned your first rank!`
                            : `Congratulations <@${member.id}>! You've ranked up!`
                )
                .addFields(
                    { name: 'RSN', value: rsn, inline: true },
                    { name: 'EHB', value: ehb.toString(), inline: true },
                    { name: '​', value: '​', inline: true }
                )
                .setThumbnail(member.user.displayAvatarURL())
                .setTimestamp();

            if (!isInitial && oldRoleId) {
                embed.addFields(
                    { name: 'Previous Rank', value: formatRoleById(guild, oldRoleId), inline: true },
                    { name: 'New Rank', value: formatRoleById(guild, newRoleId), inline: true }
                );
            } else {
                embed.addFields(
                    { name: 'Rank', value: formatRoleById(guild, newRoleId), inline: false }
                );
            }

            await rankUpsChannel.send({ embeds: [embed] });
        }

        console.log(`${logPrefix} Broadcast ${announcements.length} rank-up(s) to #rank-ups`);
    } catch (error) {
        console.error(`${logPrefix} Error broadcasting to rank-ups channel:`, error);
    }
}

module.exports = { broadcastRankUps };
