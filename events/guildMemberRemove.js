const { Events, EmbedBuilder } = require('discord.js');
const config = require('../config.json');
const ticketManager = require('../utils/ticketManager');
const db = require('../db/supabase');

module.exports = {
    name: Events.GuildMemberRemove,

    async execute(member) {
        console.log(`[MEMBER_LEAVE] User left Discord: ${member.user.tag} (${member.id})`);

        try {
            // Get player data from database (if they're registered)
            const playerData = await db.getPlayerByDiscordId(member.id);

            // Find and mark their join ticket if they have one
            await markJoinTicketAsLeft(member.guild, member.id, member.user.tag, playerData);

        } catch (error) {
            console.error(`[MEMBER_LEAVE] Error processing member leave for ${member.user.tag}:`, error);
        }
    }
};

/**
 * Find and mark a user's join ticket when they leave Discord
 * @param {Guild} guild - Discord guild
 * @param {string} discordId - User's Discord ID
 * @param {string} userTag - User's Discord tag
 * @param {Object} playerData - Player data object (if registered)
 */
async function markJoinTicketAsLeft(guild, discordId, userTag, playerData) {
    console.log(`[MEMBER_LEAVE] Checking for open join ticket for ${userTag} (${discordId})...`);

    try {
        // Find join ticket category
        const joinCategory = await guild.channels.fetch(config.TICKET_JOIN_CATEGORY_ID);
        if (!joinCategory) {
            console.log(`[MEMBER_LEAVE] Join ticket category not found`);
            return;
        }

        // Get all channels in join ticket category
        const channels = guild.channels.cache.filter(
            channel => channel.parentId === config.TICKET_JOIN_CATEGORY_ID
        );

        // Find channel where the user has permissions (they were added when ticket was created)
        let userTicket = null;
        for (const [channelId, channel] of channels) {
            const permissions = channel.permissionOverwrites.cache.get(discordId);
            if (permissions) {
                userTicket = channel;
                console.log(`[MEMBER_LEAVE] Found open join ticket: ${channel.name}`);
                break;
            }
        }

        if (!userTicket) {
            console.log(`[MEMBER_LEAVE] No open join ticket found for ${userTag}`);
            return;
        }

        // Replace verification emoji (🟢 or 🔴) with left Discord emoji (❌)
        let newName = userTicket.name
            .replace(config.VERIFIED_EMOJI, config.LEFT_CLAN_EMOJI)
            .replace(config.UNVERIFIED_EMOJI, config.LEFT_CLAN_EMOJI);

        await userTicket.setName(newName);
        console.log(`[MEMBER_LEAVE] Updated ticket name to: ${newName}`);

        // Build notification message
        let description = `**${userTag}** has left the Discord server.\n\n`;

        if (playerData) {
            description += `**RSN:** ${playerData.rsn}\n`;
            description += `**VP Balance:** ${playerData.points || 0}\n`;
            description += `**In Clan:** ${playerData.wom_id ? 'Yes' : 'Unknown'}\n\n`;
        }

        description += `This ticket will be automatically soft-closed.`;

        // Send notification in the ticket
        const leaveEmbed = new EmbedBuilder()
            .setColor('Red')
            .setTitle('❌ User Left Discord')
            .setDescription(description)
            .setTimestamp();

        await userTicket.send({ embeds: [leaveEmbed] });

        // Start soft close with summary
        const summary = playerData
            ? `User ${userTag} (RSN: ${playerData.rsn}) left Discord. VP balance: ${playerData.points || 0}`
            : `User ${userTag} left Discord (not registered in database)`;

        const autoCloseCallback = async () => {
            console.log(`[TicketSoftClose] Timer expired for ${userTicket.name}, auto-closing...`);

            const ticketHandlers = require('../utils/ticketHandlers');
            const state = ticketManager.getTicketState(userTicket.id);
            const finalSummary = state.softCloseSummary || summary;

            await ticketHandlers.createTranscriptAndClose(
                userTicket,
                guild,
                guild.members.me.user,
                finalSummary,
                state
            );
        };

        ticketManager.startSoftClose(userTicket.id, summary, autoCloseCallback);

        // Update channel name to show soft-closing status
        if (!newName.includes(config.SOFT_CLOSE_EMOJI)) {
            newName = `${config.SOFT_CLOSE_EMOJI}${newName}`;
            await userTicket.setName(newName);
            console.log(`[MEMBER_LEAVE] Added soft-close emoji to ticket: ${newName}`);
        }

        console.log(`[MEMBER_LEAVE] ✅ Marked and soft-closed join ticket for ${userTag}`);

    } catch (error) {
        console.error(`[MEMBER_LEAVE] Error marking join ticket:`, error);
        throw error;
    }
}
