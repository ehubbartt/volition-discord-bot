const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');
const { formatRank } = require('./ranks');

/**
 * Broadcast rank-up announcements to the #rank-ups channel
 * @param {Guild} guild - Discord guild object
 * @param {Array} announcements - Array of { member, rsn, ehb, oldRankIndex, newRankIndex, isInitial }
 * @param {string} logPrefix - Prefix for console logs (e.g. '[UpdateRanks]' or '[Daily Rank Update]')
 */
async function broadcastRankUps(guild, announcements, logPrefix = '[RankAnnouncements]') {
    if (announcements.length === 0) return;

    try {
        const rankUpsChannel = await guild.channels.fetch(config.RANK_UPS_CHANNEL_ID);
        if (!rankUpsChannel) {
            console.error(`${logPrefix} Rank-ups channel not found: ${config.RANK_UPS_CHANNEL_ID}`);
            return;
        }

        for (const announcement of announcements) {
            const { member, rsn, ehb, oldRankIndex, newRankIndex, isInitial } = announcement;

            const embed = new EmbedBuilder()
                .setColor('Gold')
                .setTitle('Rank Up!')
                .setDescription(
                    isInitial
                        ? `Congratulations <@${member.id}>! You've been assigned your first rank!`
                        : `Congratulations <@${member.id}>! You've ranked up!`
                )
                .addFields(
                    { name: 'RSN', value: rsn, inline: true },
                    { name: 'EHB', value: ehb.toString(), inline: true },
                    { name: '\u200B', value: '\u200B', inline: true }
                )
                .setThumbnail(member.user.displayAvatarURL())
                .setTimestamp();

            if (!isInitial) {
                embed.addFields(
                    { name: 'Previous Rank', value: formatRank(guild, oldRankIndex), inline: true },
                    { name: 'New Rank', value: formatRank(guild, newRankIndex), inline: true }
                );
            } else {
                embed.addFields(
                    { name: 'Rank', value: formatRank(guild, newRankIndex), inline: false }
                );
            }

            await rankUpsChannel.send({ content: `<@${member.id}>`, embeds: [embed] });
        }

        console.log(`${logPrefix} Broadcast ${announcements.length} rank-up(s) to #rank-ups`);
    } catch (error) {
        console.error(`${logPrefix} Error broadcasting to rank-ups channel:`, error);
    }
}

module.exports = { broadcastRankUps };
