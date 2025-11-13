const { Events } = require('discord.js');
const config = require('../config.json');

module.exports = {
    name: Events.GuildMemberUpdate,

    async execute(oldMember, newMember) {
        try {
            // Check if nickname/display name changed
            const oldDisplayName = oldMember.displayName || oldMember.user.globalName || oldMember.user.username;
            const newDisplayName = newMember.displayName || newMember.user.globalName || newMember.user.username;

            if (oldDisplayName === newDisplayName) {
                return; // No change to display name
            }

            console.log(`[MEMBER_UPDATE] ${newMember.user.tag} display name changed: ${oldDisplayName} → ${newDisplayName}`);

            // Find their join ticket if they have one
            await updateJoinTicketName(newMember, oldDisplayName, newDisplayName);

        } catch (error) {
            console.error(`[MEMBER_UPDATE] Error processing member update for ${newMember.user.tag}:`, error);
        }
    }
};

/**
 * Update join ticket channel name when user's display name changes
 * @param {GuildMember} member - The updated member
 * @param {string} oldDisplayName - Previous display name
 * @param {string} newDisplayName - New display name
 */
async function updateJoinTicketName(member, oldDisplayName, newDisplayName) {
    try {
        // Find join ticket category
        const joinCategory = await member.guild.channels.fetch(config.TICKET_JOIN_CATEGORY_ID);
        if (!joinCategory) {
            return;
        }

        // Get all channels in join ticket category
        const channels = member.guild.channels.cache.filter(
            channel => channel.parentId === config.TICKET_JOIN_CATEGORY_ID
        );

        // Search for ticket with old display name
        const oldPattern = `join-${oldDisplayName.toLowerCase()}`;
        let userTicket = null;

        for (const [, channel] of channels) {
            if (channel.name.includes(oldPattern)) {
                userTicket = channel;
                break;
            }
        }

        // If not found by old name, try searching by message history
        if (!userTicket) {
            for (const [, channel] of channels) {
                try {
                    if (!channel.name.includes('join-')) continue;

                    const messages = await channel.messages.fetch({ limit: 10 });
                    const messagesArray = Array.from(messages.values()).reverse();
                    const firstUserMessage = messagesArray.find(msg => !msg.author.bot);

                    if (firstUserMessage && firstUserMessage.author.id === member.id) {
                        userTicket = channel;
                        break;
                    }
                } catch (error) {
                    continue;
                }
            }
        }

        if (!userTicket) {
            // No open join ticket found - this is normal for verified users
            return;
        }

        // Build new channel name by replacing the display name part
        // Preserve all emojis and status indicators
        const newPattern = `join-${newDisplayName.toLowerCase()}`;
        let newChannelName = userTicket.name;

        // Replace the join-oldname part with join-newname
        newChannelName = newChannelName.replace(oldPattern, newPattern);

        // Only update if the name actually changed
        if (newChannelName !== userTicket.name) {
            await userTicket.setName(newChannelName);
            console.log(`[MEMBER_UPDATE] Updated ticket name: ${userTicket.name} → ${newChannelName}`);
        }

    } catch (error) {
        console.error(`[MEMBER_UPDATE] Error updating join ticket name:`, error);
    }
}
