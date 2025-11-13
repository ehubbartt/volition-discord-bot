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
            await markJoinTicketAsLeft(member, playerData);

        } catch (error) {
            console.error(`[MEMBER_LEAVE] Error processing member leave for ${member.user.tag}:`, error);
        }
    }
};

/**
 * Find and mark a user's join ticket when they leave Discord
 * @param {GuildMember} member - The member who left
 * @param {Object} playerData - Player data object (if registered)
 */
async function markJoinTicketAsLeft(member, playerData) {
    const userTag = member.user.tag;
    const discordId = member.id;

    console.log(`[MEMBER_LEAVE] Checking for open join ticket for ${userTag} (${discordId})...`);

    try {
        // Find join ticket category
        const joinCategory = await member.guild.channels.fetch(config.TICKET_JOIN_CATEGORY_ID);
        if (!joinCategory) {
            console.log(`[MEMBER_LEAVE] Join ticket category not found`);
            return;
        }

        // Get all channels in join ticket category
        const channels = member.guild.channels.cache.filter(
            channel => channel.parentId === config.TICKET_JOIN_CATEGORY_ID
        );

        // When user leaves Discord, their permissions are removed from channels
        // So we need to search by channel name pattern instead
        // Channel format: 🟢・join-displayname・📌 or 🔴・join-displayname・🆕
        // Note: displayName could be server nickname, globalName, or username

        // Try multiple search patterns in case user changed nickname after ticket creation
        const searchPatterns = [
            member.displayName,                    // Current server nickname or globalName
            member.user.globalName,                // Current global display name
            member.user.username,                  // Current username
        ].filter(Boolean).map(name => `join-${name.toLowerCase()}`);

        // Remove duplicates
        const uniquePatterns = [...new Set(searchPatterns)];

        let userTicket = null;

        // First, try to find by channel name patterns
        for (const pattern of uniquePatterns) {
            for (const [, channel] of channels) {
                if (channel.name.includes(pattern)) {
                    userTicket = channel;
                    console.log(`[MEMBER_LEAVE] Found open join ticket: ${channel.name} (matched pattern: ${pattern})`);
                    break;
                }
            }
            if (userTicket) break;
        }

        // If not found by name, try to find by checking first message author
        // This handles cases where nickname changed after ticket creation
        if (!userTicket) {
            console.log(`[MEMBER_LEAVE] Name-based search failed, checking message history...`);
            for (const [, channel] of channels) {
                try {
                    // Skip channels that don't look like join tickets
                    if (!channel.name.includes('join-')) continue;

                    // Fetch oldest messages
                    const messages = await channel.messages.fetch({ limit: 10 });
                    const messagesArray = Array.from(messages.values()).reverse(); // Oldest first

                    // Find first non-bot message
                    const firstUserMessage = messagesArray.find(msg => !msg.author.bot);
                    if (firstUserMessage && firstUserMessage.author.id === discordId) {
                        userTicket = channel;
                        console.log(`[MEMBER_LEAVE] Found open join ticket by message history: ${channel.name}`);
                        break;
                    }
                } catch (error) {
                    // Skip channels we can't access
                    continue;
                }
            }
        }

        if (!userTicket) {
            console.log(`[MEMBER_LEAVE] No open join ticket found for ${userTag} (tried patterns: ${uniquePatterns.join(', ')})`);
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
                member.guild,
                member.guild.members.me.user,
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
