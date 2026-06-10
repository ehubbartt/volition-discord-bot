const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const eventsDb = require('../db/events');
const db = require('../db/supabase');
const cardPacks = require('../db/cardPacks');
const siteSubs = require('../db/siteSubmissions');
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

    const vpEmoji = config.VP_EMOJI_ID ? `<:vp:${config.VP_EMOJI_ID}>` : '🪙';

    // Checklist mode: match screenshot to pending task claim
    if (event.tasks) {
        let pendingIndex = -1;

        // Check shared tasks (pending_claims array, skip already-submitted) and standard tasks
        for (let i = 0; i < event.tasks.length; i++) {
            const t = event.tasks[i];
            if (t.shared) {
                if (t.pending_claims?.some(c => c.discord_id === message.author.id && !c.submitted)) {
                    pendingIndex = i;
                    break;
                }
            } else if (t.status === 'pending' && t.claimed_by === message.author.id && !t.submitted) {
                pendingIndex = i;
                break;
            }
        }

        if (pendingIndex === -1) {
            await message.reply({
                content: '⚠️ You don\'t have a pending task claim. Claim a task from the dropdown on the event embed first.',
                allowedMentions: { repliedUser: false }
            });
            return;
        }

        const task = event.tasks[pendingIndex];

        // Mark this claim as submitted so the next image matches the next task
        if (task.shared) {
            const claim = task.pending_claims.find(c => c.discord_id === message.author.id && !c.submitted);
            if (claim) claim.submitted = true;
        } else {
            task.submitted = true;
        }
        await eventsDb.updateEvent(event.id, { tasks: event.tasks });

        // For shared tasks, encode the user ID in the button so approve/reject knows who
        const buttonSuffix = task.shared
            ? `${event.id}_${pendingIndex}_${message.author.id}`
            : `${event.id}_${pendingIndex}`;

        const approveBtn = new ButtonBuilder()
            .setCustomId(`event_task_approve_${buttonSuffix}`)
            .setLabel('Approve')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅');

        const rejectBtn = new ButtonBuilder()
            .setCustomId(`event_task_reject_${buttonSuffix}`)
            .setLabel('Reject')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌');

        const row = new ActionRowBuilder().addComponents(approveBtn, rejectBtn);

        const embed = new EmbedBuilder()
            .setColor('Yellow')
            .setDescription(
                `**Proof submitted** by <@${message.author.id}>\n` +
                `**Task:** ${task.text}\n` +
                `**Reward:** ${event.vp_reward} ${vpEmoji} VP`
            )
            .setFooter({ text: `Event: ${event.title} • Task #${pendingIndex + 1}` });

        await message.reply({
            embeds: [embed],
            components: [row],
            allowedMentions: { repliedUser: false }
        });
        return;
    }

    // Standard submission flow (non-checklist events) — uploads proof to the
    // shared bucket and writes a vs_submissions row on the website. Review and
    // VP grant happen on the site at /admin/submissions. No Discord buttons.

    // If the bot event has no linked vs_events instance, we can't write a
    // canonical submission. Acknowledge with a warning and bail.
    if (!event.vs_event_id) {
        await message.reply({
            content: '⚠️ This event is missing its vs_events linkage and can\'t be submitted from Discord. Ping an admin.',
            allowedMentions: { repliedUser: false }
        });
        return;
    }

    const siteUser = await siteSubs.lookupSiteUser(message.author.id);
    const userId = siteUser?.id || null;

    let submitterName = siteUser?.rsn || null;
    if (!submitterName) {
        const player = await db.getPlayerByDiscordId(message.author.id);
        submitterName = player?.rsn || message.member?.displayName || message.author.username;
    }

    const { proof_urls, proof_paths } = await siteSubs.uploadAllProofs(
        message.attachments,
        { eventId: event.vs_event_id, discordId: message.author.id, targetId: event.vs_event_id }
    );

    if (proof_urls.length === 0) {
        await message.reply({
            content: '⚠️ Couldn\'t upload your proof image. Try again, and if it keeps failing, ping an admin.',
            allowedMentions: { repliedUser: false }
        });
        return;
    }

    const siteSubmissionId = await siteSubs.createSubmissionRow({
        eventId: event.vs_event_id,
        userId,
        discordId: message.author.id,
        submitterName,
        targetId: event.vs_event_id,
        targetLabel: event.title,
        proofUrls: proof_urls,
        proofPaths: proof_paths,
    });

    if (!siteSubmissionId) {
        await message.reply({
            content: '⚠️ Couldn\'t register your submission with the website. Try again, and if it keeps failing, ping an admin.',
            allowedMentions: { repliedUser: false }
        });
        return;
    }

    const embed = new EmbedBuilder()
        .setColor('Yellow')
        .setDescription(
            `📥 **Submission received** from <@${message.author.id}>\n` +
            `Your proof is queued for review on the **Volition site**. ` +
            `VP / rewards are granted there once an admin approves.`
        )
        .setFooter({ text: `Event: ${event.title}` });

    await message.reply({
        embeds: [embed],
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
    // Skip for leagues events — allow multiple approvals per player
    const isLeaguesEvent = event.channel_id === config.LEAGUES_EVENTS_CHANNEL_ID;
    if (!isLeaguesEvent) {
        const existingApproval = await eventsDb.getApprovedSubmission(event.id, submission.discord_id);
        if (existingApproval) {
            return interaction.reply({ content: '⚠️ This player already has an approved submission for this event.', ephemeral: true });
        }
    }

    const packRewardName = event.pack_reward_name || null;
    const vpReward = event.vp_reward || 0;
    let playerRsn = 'Unknown';

    // Award pack OR VP (pack replaces VP when set).
    if (packRewardName) {
        const res = await cardPacks.grantPackToDiscordId(submission.discord_id, packRewardName, 1);
        if (!res.ok) {
            const msg = {
                not_registered: `⚠️ <@${submission.discord_id}> hasn't signed into the Volition site yet — pack not awarded. Ask them to log in once, then re-approve.`,
                no_pack: `❌ No card pack matching **${packRewardName}** exists. Pack not awarded.`,
                db_error: `❌ Database error while granting pack. Try again.`,
            }[res.reason] || `❌ Failed to grant pack: ${res.reason}`;
            return interaction.reply({ content: msg, ephemeral: true });
        }
        const player = await db.getPlayerByDiscordId(submission.discord_id);
        if (player) playerRsn = player.rsn;
    } else if (vpReward > 0) {
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
    const awardLine = packRewardName
        ? `🎴 **1× ${packRewardName}** awarded by <@${interaction.user.id}>`
        : `**+${vpReward}** ${vpEmoji} VP awarded by <@${interaction.user.id}>`;

    const embed = new EmbedBuilder()
        .setColor('Green')
        .setDescription(
            `✅ **Approved** — <@${submission.discord_id}>\n` +
            awardLine
        )
        .setFooter({ text: `Submission #${submissionId} • ${event.title}` });

    await interaction.update({ embeds: [embed], components: [] });

    // Log to payout channel
    const logChannel = interaction.client.channels.cache.get(config.PAYOUT_LOG_CHANNEL_ID);
    if (logChannel && (packRewardName || vpReward > 0)) {
        const player = await db.getPlayerByDiscordId(submission.discord_id);
        const changeLine = packRewardName ? `+1 ${packRewardName}` : `+${vpReward} VP`;
        const totalLine = packRewardName ? '' : `\n**New Total:** ${player ? player.points : '?'} VP`;
        const logEmbed = new EmbedBuilder()
            .setColor('Green')
            .setTitle('Event Submission Approved')
            .setDescription(
                `**Player:** ${playerRsn}\n` +
                `**Change:** ${changeLine}` +
                `${totalLine}\n` +
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
