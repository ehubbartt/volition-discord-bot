const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const eventsDb = require('../db/events');
const db = require('../db/supabase');
const config = require('../utils/config');
const { isAdmin } = require('../utils/permissions');

/**
 * Handle a new message in an event thread.
 * If the message has attachments and the thread belongs to an active event,
 * create a submission record and add an Approve button for admins.
 */
async function handleThreadMessage(message) {
    // Ignore bots and messages without attachments
    if (message.author.bot) return;
    if (!message.attachments.size) return;

    // Check if this thread belongs to an active event
    const threadId = message.channel.id;
    const event = await eventsDb.getEventByThreadId(threadId);
    if (!event) return;

    // Check for duplicate submission (already approved for this event)
    const existing = await eventsDb.getApprovedSubmission(event.id, message.author.id);
    if (existing) {
        await message.reply({
            content: '⚠️ You already have an approved submission for this event.',
            allowedMentions: { repliedUser: false }
        });
        return;
    }

    // Create submission record
    const submission = await eventsDb.createSubmission({
        event_id: event.id,
        discord_id: message.author.id,
        message_id: message.id,
    });

    // Build approve button
    const approveButton = new ButtonBuilder()
        .setCustomId(`event_approve_${submission.id}`)
        .setLabel('Approve')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅');

    const rejectButton = new ButtonBuilder()
        .setCustomId(`event_reject_${submission.id}`)
        .setLabel('Reject')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌');

    const row = new ActionRowBuilder().addComponents(approveButton, rejectButton);

    const vpEmoji = config.VP_EMOJI_ID ? `<:vp:${config.VP_EMOJI_ID}>` : '🪙';

    const embed = new EmbedBuilder()
        .setColor('Yellow')
        .setDescription(`**Submission by** <@${message.author.id}>\n**Reward:** ${event.vp_reward} ${vpEmoji} VP`)
        .setFooter({ text: `Submission #${submission.id} • Event: ${event.title}` });

    await message.reply({
        embeds: [embed],
        components: [row],
        allowedMentions: { repliedUser: false }
    });
}

/**
 * Handle the Approve button click on a submission.
 */
async function handleApprove(interaction) {
    const submissionId = parseInt(interaction.customId.replace('event_approve_', ''));
    const submission = await eventsDb.getSubmission(submissionId);

    if (!submission) {
        return interaction.reply({ content: '❌ Submission not found.', ephemeral: true });
    }

    if (submission.approved) {
        return interaction.reply({ content: '⚠️ This submission has already been approved.', ephemeral: true });
    }

    // Admin check
    if (!isAdmin(interaction.member)) {
        return interaction.reply({ content: '❌ Only admins can approve submissions.', ephemeral: true });
    }

    const event = await eventsDb.getEvent(submission.event_id);
    if (!event) {
        return interaction.reply({ content: '❌ Event not found.', ephemeral: true });
    }

    if (event.status !== 'active') {
        return interaction.reply({ content: '❌ This event has ended. Submissions can no longer be approved.', ephemeral: true });
    }

    // Check for duplicate approval (another submission by same user already approved)
    const existingApproval = await eventsDb.getApprovedSubmission(event.id, submission.discord_id);
    if (existingApproval) {
        return interaction.reply({ content: '⚠️ This player already has an approved submission for this event.', ephemeral: true });
    }

    // Award VP
    const vpReward = event.vp_reward || 0;
    let playerRsn = 'Unknown';

    if (vpReward > 0) {
        try {
            const player = await db.getPlayerByDiscordId(submission.discord_id);
            if (player) {
                playerRsn = player.rsn;
                await db.addPoints(player.rsn, vpReward);
            } else {
                return interaction.reply({
                    content: `⚠️ <@${submission.discord_id}> is not linked to a player in the database. VP not awarded. Please verify them first.`,
                    ephemeral: true
                });
            }
        } catch (err) {
            console.error('[EventSubmission] Failed to award VP:', err);
            return interaction.reply({ content: `❌ Failed to award VP: ${err.message}`, ephemeral: true });
        }
    }

    // Mark submission as approved
    await eventsDb.approveSubmission(submissionId, interaction.user.id, vpReward);

    // Update the button message to show approved state
    const vpEmoji = config.VP_EMOJI_ID ? `<:vp:${config.VP_EMOJI_ID}>` : '🪙';

    const embed = new EmbedBuilder()
        .setColor('Green')
        .setDescription(
            `✅ **Approved** — <@${submission.discord_id}>\n` +
            `**+${vpReward}** ${vpEmoji} VP awarded by <@${interaction.user.id}>`
        )
        .setFooter({ text: `Submission #${submissionId} • ${event.title}` });

    await interaction.update({ embeds: [embed], components: [] });

    // Log to payout channel
    const logChannel = interaction.client.channels.cache.get(config.PAYOUT_LOG_CHANNEL_ID);
    if (logChannel && vpReward > 0) {
        const player = await db.getPlayerByDiscordId(submission.discord_id);
        const logEmbed = new EmbedBuilder()
            .setColor('Green')
            .setTitle('Event Submission Approved')
            .setDescription(
                `**Player:** ${playerRsn}\n` +
                `**Change:** +${vpReward} VP\n` +
                `**New Total:** ${player ? player.points : '?'} VP\n` +
                `**Reason:** ${event.title}\n` +
                `**Approved by:** <@${interaction.user.id}>`
            )
            .setTimestamp();

        await logChannel.send({ content: `<@${submission.discord_id}>`, embeds: [logEmbed] });
    }
}

/**
 * Handle the Reject button click on a submission.
 */
async function handleReject(interaction) {
    const submissionId = parseInt(interaction.customId.replace('event_reject_', ''));
    const submission = await eventsDb.getSubmission(submissionId);

    if (!submission) {
        return interaction.reply({ content: '❌ Submission not found.', ephemeral: true });
    }

    if (submission.approved) {
        return interaction.reply({ content: '⚠️ This submission has already been approved and cannot be rejected.', ephemeral: true });
    }

    if (!isAdmin(interaction.member)) {
        return interaction.reply({ content: '❌ Only admins can reject submissions.', ephemeral: true });
    }

    const event = await eventsDb.getEvent(submission.event_id);

    const embed = new EmbedBuilder()
        .setColor('Red')
        .setDescription(
            `❌ **Rejected** — <@${submission.discord_id}>\n` +
            `Rejected by <@${interaction.user.id}>`
        )
        .setFooter({ text: `Submission #${submissionId} • ${event?.title || 'Unknown'}` });

    await interaction.update({ embeds: [embed], components: [] });
}

module.exports = {
    handleThreadMessage,
    handleApprove,
    handleReject,
};
