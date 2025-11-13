/**
 * Soft Close Checker Job
 * Checks all soft-closing tickets and closes them if they've been inactive for 24+ hours
 * Runs on startup and every hour via cron
 */

const config = require('../config.json');
const ticketManager = require('../utils/ticketManager');
const ticketHandlers = require('../utils/ticketHandlers');

/**
 * Check all soft-closing tickets and close expired ones
 * @param {Client} client - Discord client
 */
async function checkSoftClosingTickets(client) {
    console.log('[SoftCloseChecker] Starting check for expired soft-closing tickets...');

    try {
        const guild = await client.guilds.fetch(config.guildId);

        const ticketCategories = [
            config.TICKET_JOIN_CATEGORY_ID,
            config.TICKET_GENERAL_CATEGORY_ID,
            config.TICKET_SHOP_CATEGORY_ID
        ];

        let checkedCount = 0;
        let closedCount = 0;

        // Check each ticket category
        for (const categoryId of ticketCategories) {
            const category = await guild.channels.fetch(categoryId);
            if (!category) {
                console.log(`[SoftCloseChecker] Category ${categoryId} not found`);
                continue;
            }

            // Get all channels in this category
            const channels = guild.channels.cache.filter(
                channel => channel.parentId === categoryId &&
                          channel.name.includes(config.SOFT_CLOSE_EMOJI)
            );

            for (const [channelId, channel] of channels) {
                checkedCount++;

                try {
                    // Fetch the last message in the channel
                    const messages = await channel.messages.fetch({ limit: 1 });

                    if (messages.size === 0) {
                        console.log(`[SoftCloseChecker] ${channel.name} has no messages, skipping`);
                        continue;
                    }

                    const lastMessage = messages.first();
                    const lastMessageTime = lastMessage.createdTimestamp;
                    const now = Date.now();
                    const hoursSinceLastMessage = (now - lastMessageTime) / (1000 * 60 * 60);

                    console.log(`[SoftCloseChecker] ${channel.name}: Last message ${hoursSinceLastMessage.toFixed(1)} hours ago`);

                    // If last message was more than 24 hours ago, close the ticket
                    if (hoursSinceLastMessage >= 24) {
                        console.log(`[SoftCloseChecker] Closing ${channel.name} (inactive for ${hoursSinceLastMessage.toFixed(1)} hours)`);

                        // Get ticket state (or create empty one)
                        const state = ticketManager.getTicketState(channelId);
                        const summary = state.softCloseSummary || 'Auto-closed after 24 hours of inactivity';

                        // Close the ticket
                        await ticketHandlers.createTranscriptAndClose(
                            channel,
                            guild,
                            client.user,
                            summary,
                            state
                        );

                        closedCount++;
                    }
                } catch (error) {
                    console.error(`[SoftCloseChecker] Error checking channel ${channel.name}:`, error.message);
                }
            }
        }

        console.log(`[SoftCloseChecker] Check complete. Checked ${checkedCount} tickets, closed ${closedCount} tickets.`);
    } catch (error) {
        console.error('[SoftCloseChecker] Error during soft-close check:', error);
    }
}

/**
 * Schedule the soft-close checker to run every hour
 * @param {Client} client - Discord client
 */
function startSoftCloseChecker(client) {
    console.log('[SoftCloseChecker] Starting soft-close checker job...');

    // Run immediately on startup
    setTimeout(() => {
        checkSoftClosingTickets(client).catch(error => {
            console.error('[SoftCloseChecker] Error during startup check:', error);
        });
    }, 5000); // Wait 5 seconds after bot is ready

    // Run every hour (3600000 ms)
    setInterval(() => {
        checkSoftClosingTickets(client).catch(error => {
            console.error('[SoftCloseChecker] Error during scheduled check:', error);
        });
    }, 3600000); // 1 hour

    console.log('[SoftCloseChecker] ✅ Scheduled to run every hour + on startup');
}

module.exports = {
    startSoftCloseChecker,
    checkSoftClosingTickets
};
