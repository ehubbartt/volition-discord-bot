const { Events } = require('discord.js');
const config = require('../config.json');
const ticketManager = require('../utils/ticketManager');

module.exports = {
    name: Events.MessageCreate,

    async execute(message) {
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

        // Check if ticket is soft-closing
        const state = ticketManager.getTicketState(message.channel.id);

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
            // Send notification that timer was reset
            const resetMessage = await message.channel.send({
                content: `⏰ **Timer Reset:** Soft-close timer has been reset to 24 hours due to activity.`
            });

            // Delete the notification after 10 seconds
            setTimeout(() => {
                resetMessage.delete().catch(() => {});
            }, 10000);

            console.log(`[TicketSoftClose] Timer reset for ${message.channel.name} due to message from ${message.author.tag}`);
        }
    },
};
