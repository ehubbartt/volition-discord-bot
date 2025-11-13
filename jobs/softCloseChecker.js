/**
 * Soft Close Checker Job
 * Checks all soft-closing tickets and closes them if they've been inactive for 24+ hours
 * Runs on startup and every hour via cron
 */

const config = require('../config.json');
const ticketManager = require('../utils/ticketManager');
const ticketHandlers = require('../utils/ticketHandlers');

/**
 * Reconstruct ticket state from channel data (for when bot restarts and loses in-memory state)
 * @param {Channel} channel - Ticket channel
 * @param {Object} state - Ticket state object to populate
 */
async function reconstructTicketState (channel, state) {
    try {
        console.log(`[SoftCloseChecker] Reconstructing ticket state for ${channel.name}...`);

        // Fetch all messages to find the first user message (ticket creator)
        const allMessages = await channel.messages.fetch({ limit: 100 });
        const messagesArray = Array.from(allMessages.values()).reverse(); // Oldest first

        // Find first message from a non-bot user (ticket creator)
        const firstUserMessage = messagesArray.find(msg => !msg.author.bot);
        if (firstUserMessage && !state.createdBy) {
            state.createdBy = firstUserMessage.author.id;
            state.createdByTag = firstUserMessage.author.tag;
            console.log(`[SoftCloseChecker] Found ticket creator: ${state.createdByTag}`);
        }

        // Find ALL "Ticket claimed by" embeds to identify all claimers
        const claimMessages = messagesArray.filter(msg =>
            msg.embeds.length > 0 &&
            msg.embeds[0].description?.includes('Ticket claimed by')
        );

        if (claimMessages.length > 0) {
            // Initialize claim history if not exists
            if (!state.claimHistory) {
                state.claimHistory = [];
            }

            for (const claimMessage of claimMessages) {
                // Extract user ID from mention in embed description
                const mentionMatch = claimMessage.embeds[0].description.match(/<@(\d+)>/);
                if (mentionMatch) {
                    const claimerId = mentionMatch[1];

                    // Check if this claimer is already in history
                    const alreadyExists = state.claimHistory.some(entry => entry.adminId === claimerId);
                    if (!alreadyExists) {
                        const claimer = await channel.guild.members.fetch(claimerId).catch(() => null);
                        if (claimer) {
                            state.claimHistory.push({
                                adminId: claimerId,
                                adminTag: claimer.user.tag,
                                claimedAt: claimMessage.createdAt.toISOString()
                            });
                            console.log(`[SoftCloseChecker] Found ticket claimer: ${claimer.user.tag}`);
                        }
                    }
                }
            }

            // Set current claimed state to the last claimer
            if (state.claimHistory.length > 0) {
                const lastClaim = state.claimHistory[state.claimHistory.length - 1];
                state.claimed = true;
                state.claimedBy = lastClaim.adminId;
                state.claimedByTag = lastClaim.adminTag;
                state.claimedAt = lastClaim.claimedAt;
            }
        }

        // If still no claimer, check permissions for exclusive send access
        if (!state.claimed) {
            const permissionOverwrites = channel.permissionOverwrites.cache;
            for (const [id, overwrite] of permissionOverwrites) {
                // Type 1 = Member (not role)
                if (overwrite.type === 1 && overwrite.allow.has('SendMessages')) {
                    const member = await channel.guild.members.fetch(id).catch(() => null);
                    if (member && config.ADMIN_ROLE_IDS.some(roleId => member.roles.cache.has(roleId))) {
                        state.claimed = true;
                        state.claimedBy = id;
                        state.claimedByTag = member.user.tag;
                        state.claimedAt = channel.createdAt.toISOString(); // Fallback to channel creation
                        console.log(`[SoftCloseChecker] Inferred claimer from permissions: ${state.claimedByTag}`);
                        break;
                    }
                }
            }
        }

    } catch (error) {
        console.error('[SoftCloseChecker] Error reconstructing ticket state:', error);
    }
}

/**
 * Check all soft-closing tickets and close expired ones
 * @param {Client} client - Discord client
 */
async function checkSoftClosingTickets (client) {
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

                        // If state is missing creator/claimer info (bot restarted), try to reconstruct from channel
                        if (!state.createdBy || !state.claimed) {
                            await reconstructTicketState(channel, state);
                        }

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
function startSoftCloseChecker (client) {
    console.log('[SoftCloseChecker] Starting soft-close checker job...');

    // Run immediately on startup
    setTimeout(() => {
        checkSoftClosingTickets(client).catch(error => {
            console.error('[SoftCloseChecker] Error during startup check:', error);
        });
    }, 5000); // Wait 5 seconds after bot is ready

    //run every 10 minutes
    setInterval(() => {
        checkSoftClosingTickets(client).catch(error => {
            console.error('[SoftCloseChecker] Error during scheduled check:', error);
        });
    }, 600000);

    console.log('[SoftCloseChecker] ✅ Scheduled to run every hour + on startup');
}

module.exports = {
    startSoftCloseChecker,
    checkSoftClosingTickets
};
