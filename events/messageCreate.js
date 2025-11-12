const { Events } = require('discord.js');
const config = require('../config.json');
const ticketManager = require('../utils/ticketManager');
const { isAdmin, isHeadAdmin } = require('../utils/permissions');

module.exports = {
    name: Events.MessageCreate,

    async execute (message) {
        // Ignore bot messages
        if (message.author.bot) return;

        // Check if message is in a ticket channel
        const ticketCategories = [
            config.TICKET_JOIN_CATEGORY_ID,
            config.TICKET_GENERAL_CATEGORY_ID,
            config.TICKET_SHOP_CATEGORY_ID
        ];

        if (!ticketCategories.includes(message.channel.parentId)) {
            return; // Not in a ticket channel
        }

        // Check if ticket state exists
        const state = ticketManager.getTicketState(message.channel.id);

        // Auto-claim ticket when first admin responds
        if (!state.claimed) {
            // Check if message author is an admin
            const userIsAdmin = isAdmin(message.member);

            if (userIsAdmin) {
                // Claim the ticket for this admin
                ticketManager.claimTicket(message.channel.id, message.author.id, message.author.tag);

                // Update channel name - replace unclaimed emoji with claimed emoji
                // Also replace verified emoji (green circle) with claimed emoji, but NOT unverified (red circle)
                let newName = message.channel.name
                    .replace(config.UNCLAIMED_EMOJI, config.CLAIMED_EMOJI)
                    .replace(config.VERIFIED_EMOJI, config.CLAIMED_EMOJI);

                try {
                    await message.channel.setName(newName);
                    console.log(`[AutoClaim] ${message.author.tag} auto-claimed ticket ${message.channel.name}`);

                    // Update permissions: Only the claimer (and ticket creator) can send messages
                    // Head admins always have permission to bypass this restriction
                    const { PermissionFlagsBits } = require('discord.js');

                    // Remove send permission from all admin roles
                    for (const roleId of config.ADMIN_ROLE_IDS) {
                        await message.channel.permissionOverwrites.edit(roleId, {
                            SendMessages: false
                        });
                    }

                    // Small delay to ensure Discord processes role permissions
                    await new Promise(resolve => setTimeout(resolve, 200));

                    // Give send permission to the claimer (overrides role restrictions)
                    await message.channel.permissionOverwrites.edit(message.author.id, {
                        ViewChannel: true,
                        SendMessages: true,
                        ReadMessageHistory: true
                    });

                    // Give send permission to all head admin roles (bypass ticket lock)
                    for (const headAdminRoleId of config.HEAD_ADMIN_ROLE_IDS) {
                        await message.channel.permissionOverwrites.edit(headAdminRoleId, {
                            SendMessages: true
                        });
                    }

                    console.log(`[AutoClaim] Set exclusive send permissions for ${message.author.tag} (head admins can bypass)`);

                    // Send a subtle claim notification
                    const { EmbedBuilder } = require('discord.js');
                    const claimEmbed = new EmbedBuilder()
                        .setColor('Green')
                        .setDescription(`🎫 Ticket claimed by ${message.author}`)
                        .setTimestamp();

                    await message.channel.send({ embeds: [claimEmbed] });
                } catch (error) {
                    console.error('[AutoClaim] Failed to update channel name or permissions:', error);
                }
            }
        }

        // Check if ticket is soft-closing
        if (!state.softClosing) {
            return; // Not soft-closing
        }

        // Reset the soft-close timer
        const wasReset = ticketManager.resetSoftCloseTimer(message.channel.id, async () => {
            console.log(`[TicketSoftClose] Timer expired for ${message.channel.name}, auto-closing...`);

            const ticketHandlers = require('../utils/ticketHandlers');
            const finalSummary = state.softCloseSummary || 'Auto-closed after 24 hours of inactivity';

            // Create transcript and close
            await ticketHandlers.createTranscriptAndClose(
                message.channel,
                message.guild,
                message.client.user,
                finalSummary,
                state
            );
        });

        if (wasReset) {
            console.log(`[TicketSoftClose] Timer reset for ${message.channel.name} due to message from ${message.author.tag}`);
        }
    },
};
