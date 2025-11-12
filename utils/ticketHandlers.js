const { EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const config = require('../config.json');
const ticketManager = require('./ticketManager');

/**
 * Handle ticket claim button
 */
async function handleTicketClaim (interaction) {
    // Check if user is admin
    const isAdmin = config.ADMIN_ROLE_IDS.some(roleId =>
        interaction.member.roles.cache.has(roleId)
    );

    if (!isAdmin) {
        return interaction.reply({
            content: '❌ Only admins can claim tickets.',
            ephemeral: true
        });
    }

    const channelId = interaction.channel.id;
    const state = ticketManager.getTicketState(channelId);

    // Get previous claimer if exists
    const previousClaimer = state.claimedBy;

    // Check if same person is trying to claim again
    if (state.claimed && previousClaimer === interaction.user.id) {
        return interaction.reply({
            content: `⚠️ You have already claimed this ticket.`,
            ephemeral: true
        });
    }

    // Claim the ticket (or re-claim from another admin)
    ticketManager.claimTicket(channelId, interaction.user.id, interaction.user.tag);

    // Update channel name - replace unclaimed emoji with claimed emoji
    // Also replace verified emoji (green circle) with claimed emoji, but NOT unverified (red circle)
    const channel = interaction.channel;
    let newName = channel.name
        .replace(config.UNCLAIMED_EMOJI, config.CLAIMED_EMOJI)
        .replace(config.VERIFIED_EMOJI, config.CLAIMED_EMOJI);

    try {
        await channel.setName(newName);
        console.log(`[TicketClaim] Updated channel name to: ${newName}`);
    } catch (error) {
        console.error('[TicketClaim] Failed to update channel name:', error);
    }

    // Update permissions: Only the claimer (and ticket creator) can send messages
    const { PermissionFlagsBits } = require('discord.js');
    try {
        // Remove send permission from previous claimer if exists
        if (previousClaimer && previousClaimer !== interaction.user.id) {
            await channel.permissionOverwrites.edit(previousClaimer, {
                SendMessages: false
            });
            console.log(`[TicketClaim] Removed send permissions from previous claimer`);
        }

        // Remove send permission from all admin roles
        for (const roleId of config.ADMIN_ROLE_IDS) {
            await channel.permissionOverwrites.edit(roleId, {
                SendMessages: false
            });
        }

        // Give send permission to new claimer
        await channel.permissionOverwrites.edit(interaction.user.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
        });

        console.log(`[TicketClaim] Set exclusive send permissions for ${interaction.user.tag}`);
    } catch (error) {
        console.error('[TicketClaim] Failed to update permissions:', error);
    }

    // Send claim message
    const claimEmbed = new EmbedBuilder()
        .setColor('Green')
        .setTimestamp();

    if (previousClaimer && previousClaimer !== interaction.user.id) {
        // Re-claim from another admin
        claimEmbed.setDescription(
            `🎫 Ticket re-claimed by ${interaction.user}\n` +
            `(Previously claimed by <@${previousClaimer}>)`);
    } else {
        // First claim
        claimEmbed.setDescription(
            `🎫 Ticket claimed by ${interaction.user}`);
    }

    await interaction.reply({
        embeds: [claimEmbed]
    });

    console.log(`[TicketClaim] ${interaction.user.tag} ${previousClaimer ? 're-' : ''}claimed ticket ${channel.name}${previousClaimer ? ` from ${state.claimHistory[state.claimHistory.length - 2]?.adminTag}` : ''}`);
}

/**
 * Handle ticket close button - shows modal for summary
 */
async function handleTicketClose (interaction) {
    // Check if user is admin
    const isAdmin = config.ADMIN_ROLE_IDS.some(roleId =>
        interaction.member.roles.cache.has(roleId)
    );

    if (!isAdmin) {
        return interaction.reply({
            content: '❌ Only admins can close tickets.',
            ephemeral: true
        });
    }

    // Show modal for summary
    const modal = new ModalBuilder()
        .setCustomId('ticket_close_modal')
        .setTitle('Close Ticket');

    const summaryInput = new TextInputBuilder()
        .setCustomId('close_summary')
        .setLabel('Ticket Summary')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Provide a brief summary of this ticket...')
        .setRequired(true)
        .setMaxLength(1000);

    const row = new ActionRowBuilder().addComponents(summaryInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
}

/**
 * Handle ticket close modal submission
 */
async function handleTicketCloseSubmit (interaction) {
    // Check if user is admin (double-check permissions)
    const isAdmin = config.ADMIN_ROLE_IDS.some(roleId =>
        interaction.member.roles.cache.has(roleId)
    );

    if (!isAdmin) {
        return interaction.reply({
            content: '❌ Only admins can close tickets.',
            ephemeral: true
        });
    }

    const summary = interaction.fields.getTextInputValue('close_summary');
    const channel = interaction.channel;

    console.log(`[TicketClose] Starting close process for ${channel.name} by ${interaction.user.tag}`);

    await interaction.deferReply({ ephemeral: true });

    try {
        console.log(`[TicketClose] Fetching ticket state and determining archive channel...`);
        // Get ticket state for transcript
        const state = ticketManager.getTicketState(channel.id);

        // Determine archive channel based on ticket category
        const ticketCategories = {
            [config.TICKET_JOIN_CATEGORY_ID]: config.TICKET_JOIN_ARCHIVE_ID,
            [config.TICKET_GENERAL_CATEGORY_ID]: config.TICKET_GENERAL_ARCHIVE_ID,
            [config.TICKET_SHOP_CATEGORY_ID]: config.TICKET_SHOP_ARCHIVE_ID
        };

        const archiveChannelId = ticketCategories[channel.parentId];

        if (!archiveChannelId) {
            console.error(`[TicketClose] No archive channel found for category ${channel.parentId}`);
            return await interaction.editReply({
                content: '❌ Could not determine archive channel for this ticket.'
            });
        }

        console.log(`[TicketClose] Archive channel ID: ${archiveChannelId}. Fetching messages...`);

        // Fetch all messages from the ticket channel with timeout protection
        const messages = [];
        let lastId;
        let fetchCount = 0;
        const maxFetches = 50; // Prevent infinite loops (50 * 100 = 5000 messages max)

        while (fetchCount < maxFetches) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            try {
                console.log(`[TicketClose] Fetching batch ${fetchCount + 1}...`);
                const fetchedMessages = await channel.messages.fetch(options);

                if (fetchedMessages.size === 0) break;

                messages.push(...fetchedMessages.values());
                lastId = fetchedMessages.last().id;
                fetchCount++;

                if (fetchedMessages.size < 100) break;

                // Small delay to avoid rate limits
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                console.error(`[TicketClose] Error fetching messages batch ${fetchCount + 1}:`, error);
                // Continue with what we have if fetch fails
                break;
            }
        }

        console.log(`[TicketClose] Fetched ${messages.length} messages in ${fetchCount} batches. Processing transcript...`);

        // Sort messages chronologically (oldest first)
        messages.reverse();

        // Count messages per user
        const userMessageCount = {};
        messages.forEach(msg => {
            const userKey = `${msg.author.tag} (${msg.author.id})`;
            userMessageCount[userKey] = (userMessageCount[userKey] || 0) + 1;
        });

        // Sort users by message count
        const sortedUsers = Object.entries(userMessageCount)
            .sort((a, b) => b[1] - a[1])
            .map(([user, count]) => `    ${count} - ${user}`)
            .join('\n');

        // Build server info section
        let serverInfo =
            `<Server-Info>\n` +
            `    Server: ${interaction.guild.name} (${interaction.guild.id})\n` +
            `    Channel: ${channel.name} (${channel.id})\n` +
            `    Messages: ${messages.length}\n\n`;

        // Add creator info
        if (state.createdBy) {
            serverInfo += `<Ticket-Creator>\n    Created by: ${state.createdByTag} (${state.createdBy}) - <@${state.createdBy}>\n\n`;
        }

        // Add claim info if claimed
        if (state.claimed) {
            serverInfo += `<Ticket-Claimed>\n    Claimed by: ${state.claimedByTag} (${state.claimedBy}) - <@${state.claimedBy}>\n    Claimed at: ${state.claimedAt}\n\n`;
        }

        serverInfo +=
            `<User-Info>\n` +
            `${sortedUsers}\n\n` +
            `<Admin-Summary>\n` +
            `    ${summary}\n`;

        // Format readable transcript
        const transcriptLines = messages.map(msg => {
            const timestamp = msg.createdAt.toLocaleString('en-US', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });

            const username = msg.author.tag;
            let content = msg.content || '';

            // Add embed info if present
            if (msg.embeds.length > 0) {
                msg.embeds.forEach(embed => {
                    if (embed.title || embed.description) {
                        content += `\n[Embed: ${embed.title || ''} ${embed.description || ''}]`;
                    }
                });
            }

            // Add attachment info if present
            if (msg.attachments.size > 0) {
                msg.attachments.forEach(att => {
                    content += `\n[Attachment: ${att.name} (${att.url})]`;
                });
            }

            return `[${timestamp}] ${username}: ${content || '[No content]'}`;
        });

        const fullTranscript = serverInfo + '\n\n' + transcriptLines.join('\n');

        console.log(`[TicketClose] Transcript processed. Fetching archive channel...`);

        // Get archive channel
        const archiveChannel = await interaction.guild.channels.fetch(archiveChannelId);

        if (!archiveChannel) {
            console.error(`[TicketClose] Archive channel ${archiveChannelId} not found`);
            return await interaction.editReply({
                content: '❌ Archive channel not found.'
            });
        }

        console.log(`[TicketClose] Archive channel found: ${archiveChannel.name}. Creating transcript embed...`);

        // Create transcript embed
        const transcriptEmbed = new EmbedBuilder()
            .setColor('Blue')
            .setTitle(`📋 Ticket Transcript: ${channel.name}`)
            .setDescription(
                `**Closed by:** ${interaction.user}\n` +
                `**Summary:** ${summary}\n` +
                `**Closed at:** <t:${Math.floor(Date.now() / 1000)}:F>\n` +
                `**Total Messages:** ${messages.length}\n` +
                `**Participants:** ${Object.keys(userMessageCount).length}`
            );

        if (state.claimed) {
            transcriptEmbed.addFields({
                name: 'Claimed By',
                value: `<@${state.claimedBy}> at <t:${Math.floor(new Date(state.claimedAt).getTime() / 1000)}:F>`,
                inline: false
            });
        }

        transcriptEmbed.setTimestamp();

        // Create buffer for file attachment
        const buffer = Buffer.from(fullTranscript, 'utf-8');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `transcript-${channel.name}-${timestamp}.txt`;

        console.log(`[TicketClose] Sending transcript to archive channel...`);

        // Send embed with file attachment
        await archiveChannel.send({
            embeds: [transcriptEmbed],
            files: [{
                attachment: buffer,
                name: filename
            }]
        });

        console.log(`[TicketClose] Created transcript for ${channel.name} in ${archiveChannel.name}`);

        await interaction.editReply({
            content: `✅ Transcript created in ${archiveChannel}. Deleting channel...`
        });

        // Clean up ticket state
        ticketManager.cleanupTicket(channel.id);

        // Delete the ticket channel after 3 seconds
        setTimeout(async () => {
            try {
                await channel.delete();
                console.log(`[TicketClose] Deleted ticket channel: ${channel.name}`);
            } catch (error) {
                console.error('[TicketClose] Error deleting channel:', error);
            }
        }, 3000);

    } catch (error) {
        console.error('[TicketClose] Error creating transcript:', error);
        console.error('[TicketClose] Error stack:', error.stack);
        try {
            await interaction.editReply({
                content: `❌ Failed to create transcript: ${error.message}`
            });
        } catch (editError) {
            console.error('[TicketClose] Failed to send error message:', editError);
        }
    }
}

/**
 * Handle ticket soft close button - shows modal for summary
 */
async function handleTicketSoftClose (interaction) {
    // Check if user is admin
    const isAdmin = config.ADMIN_ROLE_IDS.some(roleId =>
        interaction.member.roles.cache.has(roleId)
    );

    if (!isAdmin) {
        return interaction.reply({
            content: '❌ Only admins can soft close tickets.',
            ephemeral: true
        });
    }

    // Show modal for summary
    const modal = new ModalBuilder()
        .setCustomId('ticket_soft_close_modal')
        .setTitle('Soft Close Ticket');

    const summaryInput = new TextInputBuilder()
        .setCustomId('soft_close_summary')
        .setLabel('Ticket Summary (stored for later)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Provide a brief summary... This will be saved and used when the ticket auto-closes.')
        .setRequired(true)
        .setMaxLength(1000);

    const row = new ActionRowBuilder().addComponents(summaryInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
}

/**
 * Handle ticket soft close modal submission
 */
async function handleTicketSoftCloseSubmit (interaction) {
    const summary = interaction.fields.getTextInputValue('soft_close_summary');
    const channel = interaction.channel;

    await interaction.deferReply();

    try {
        // Start soft close timer
        const autoCloseCallback = async () => {
            console.log(`[TicketSoftClose] Timer expired for ${channel.name}, auto-closing...`);

            // Use the stored summary to close the ticket
            const state = ticketManager.getTicketState(channel.id);
            const finalSummary = state.softCloseSummary || 'Auto-closed after 24 hours of inactivity';

            // Create a mock interaction for the close handler
            // We'll handle the transcript creation directly here
            await createTranscriptAndClose(channel, interaction.guild, interaction.user, finalSummary, state);
        };

        ticketManager.startSoftClose(channel.id, summary, autoCloseCallback);

        // Update channel name to show soft-closing status
        let newName = channel.name;
        if (!newName.includes(config.SOFT_CLOSE_EMOJI)) {
            newName = `${config.SOFT_CLOSE_EMOJI}${newName}`;
            try {
                await channel.setName(newName);
                console.log(`[TicketSoftClose] Updated channel name to: ${newName}`);
            } catch (error) {
                console.error('[TicketSoftClose] Failed to update channel name:', error);
            }
        }

        // Send soft close message
        const softCloseEmbed = new EmbedBuilder()
            .setColor('Orange')
            .setTitle('⏰ Ticket Soft-Closing')
            .setDescription(
                `This ticket will automatically close in **24 hours** if there's no further activity.\n\n` +
                `**What happens next:**\n` +
                `• If you send any message, the 24-hour timer will reset\n` +
                `• If no messages are sent, the ticket will be archived automatically\n` +
                `• If you need help, just type in this ticket!\n\n` +
                `**Soft-closed by:** ${interaction.user}`
            )
            .setTimestamp();

        await interaction.editReply({
            embeds: [softCloseEmbed]
        });

        console.log(`[TicketSoftClose] ${interaction.user.tag} soft-closed ticket ${channel.name}`);

    } catch (error) {
        console.error('[TicketSoftClose] Error setting up soft close:', error);
        await interaction.editReply({
            content: '❌ Failed to soft close ticket. Please try again.'
        });
    }
}

/**
 * Create transcript and close channel (helper function)
 */
async function createTranscriptAndClose (channel, guild, closedBy, summary, state) {
    try {
        // Determine archive channel based on ticket category
        const ticketCategories = {
            [config.TICKET_JOIN_CATEGORY_ID]: config.TICKET_JOIN_ARCHIVE_ID,
            [config.TICKET_GENERAL_CATEGORY_ID]: config.TICKET_GENERAL_ARCHIVE_ID,
            [config.TICKET_SHOP_CATEGORY_ID]: config.TICKET_SHOP_ARCHIVE_ID
        };

        const archiveChannelId = ticketCategories[channel.parentId];

        if (!archiveChannelId) {
            console.error('[AutoClose] Could not determine archive channel');
            return;
        }

        // Fetch all messages from the ticket channel with timeout protection
        const messages = [];
        let lastId;
        let fetchCount = 0;
        const maxFetches = 50; // Prevent infinite loops (50 * 100 = 5000 messages max)

        while (fetchCount < maxFetches) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            try {
                const fetchedMessages = await channel.messages.fetch(options);

                if (fetchedMessages.size === 0) break;

                messages.push(...fetchedMessages.values());
                lastId = fetchedMessages.last().id;
                fetchCount++;

                if (fetchedMessages.size < 100) break;

                // Small delay to avoid rate limits
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                console.error(`[AutoClose] Error fetching messages batch ${fetchCount + 1}:`, error);
                // Continue with what we have if fetch fails
                break;
            }
        }

        // Sort messages chronologically (oldest first)
        messages.reverse();

        // Count messages per user
        const userMessageCount = {};
        messages.forEach(msg => {
            const userKey = `${msg.author.tag} (${msg.author.id})`;
            userMessageCount[userKey] = (userMessageCount[userKey] || 0) + 1;
        });

        // Sort users by message count
        const sortedUsers = Object.entries(userMessageCount)
            .sort((a, b) => b[1] - a[1])
            .map(([user, count]) => `    ${count} - ${user}`)
            .join('\n');

        // Build server info section
        let serverInfo =
            `<Server-Info>\n` +
            `    Server: ${guild.name} (${guild.id})\n` +
            `    Channel: ${channel.name} (${channel.id})\n` +
            `    Messages: ${messages.length}\n\n`;

        // Add creator info
        if (state.createdBy) {
            serverInfo += `<Ticket-Creator>\n    Created by: ${state.createdByTag} (${state.createdBy}) - <@${state.createdBy}>\n\n`;
        }

        // Add claim info if claimed
        if (state.claimed) {
            serverInfo += `<Ticket-Claimed>\n    Claimed by: ${state.claimedByTag} (${state.claimedBy}) - <@${state.claimedBy}>\n    Claimed at: ${state.claimedAt}\n\n`;
        }

        serverInfo +=
            `<User-Info>\n` +
            `${sortedUsers}\n\n` +
            `<Admin-Summary>\n` +
            `    ${summary}\n\n` +
            `<Auto-Closed>\n    Soft-closed and auto-archived after 24 hours of inactivity\n`;

        // Format readable transcript
        const transcriptLines = messages.map(msg => {
            const timestamp = msg.createdAt.toLocaleString('en-US', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });

            const username = msg.author.tag;
            let content = msg.content || '';

            // Add embed info if present
            if (msg.embeds.length > 0) {
                msg.embeds.forEach(embed => {
                    if (embed.title || embed.description) {
                        content += `\n[Embed: ${embed.title || ''} ${embed.description || ''}]`;
                    }
                });
            }

            // Add attachment info if present
            if (msg.attachments.size > 0) {
                msg.attachments.forEach(att => {
                    content += `\n[Attachment: ${att.name} (${att.url})]`;
                });
            }

            return `[${timestamp}] ${username}: ${content || '[No content]'}`;
        });

        const fullTranscript = serverInfo + '\n\n' + transcriptLines.join('\n');

        // Get archive channel
        const archiveChannel = await guild.channels.fetch(archiveChannelId);

        if (!archiveChannel) {
            console.error('[AutoClose] Archive channel not found');
            return;
        }

        // Create transcript embed
        const transcriptEmbed = new EmbedBuilder()
            .setColor('Orange')
            .setTitle(`📋 Ticket Transcript (Auto-Closed): ${channel.name}`)
            .setDescription(
                `**Auto-closed:** After 24 hours of inactivity\n` +
                `**Summary:** ${summary}\n` +
                `**Closed at:** <t:${Math.floor(Date.now() / 1000)}:F>\n` +
                `**Total Messages:** ${messages.length}\n` +
                `**Participants:** ${Object.keys(userMessageCount).length}`
            );

        if (state.claimed) {
            transcriptEmbed.addFields({
                name: 'Claimed By',
                value: `<@${state.claimedBy}> at <t:${Math.floor(new Date(state.claimedAt).getTime() / 1000)}:F>`,
                inline: false
            });
        }

        transcriptEmbed.setTimestamp();

        // Create buffer for file attachment
        const buffer = Buffer.from(fullTranscript, 'utf-8');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `transcript-${channel.name}-${timestamp}.txt`;

        // Send embed with file attachment
        await archiveChannel.send({
            embeds: [transcriptEmbed],
            files: [{
                attachment: buffer,
                name: filename
            }]
        });

        console.log(`[AutoClose] Created transcript for ${channel.name} in ${archiveChannel.name}`);

        // Clean up ticket state
        ticketManager.cleanupTicket(channel.id);

        // Delete the ticket channel
        await channel.delete();
        console.log(`[AutoClose] Deleted ticket channel: ${channel.name}`);

    } catch (error) {
        console.error('[AutoClose] Error creating transcript:', error);
    }
}

module.exports = {
    handleTicketClaim,
    handleTicketClose,
    handleTicketCloseSubmit,
    handleTicketSoftClose,
    handleTicketSoftCloseSubmit,
    createTranscriptAndClose
};
