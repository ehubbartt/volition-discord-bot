const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const axios = require('axios');
const { isAdmin } = require('../../utils/permissions');
const config = require('../../utils/config');
const eventsDb = require('../../db/events');
const db = require('../../db/supabase');
const { womApi } = require('../../utils/api');

// Temporary cache for slash command options while the modal is open
const pendingEvents = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('event')
        .setDescription('(Admin Only) Manage events and challenges')
        .addSubcommand(sub =>
            sub.setName('task')
                .setDescription('Create a submission-based task event')
                .addStringOption(opt => opt.setName('title').setDescription('Event title').setRequired(true))
                .addIntegerOption(opt => opt.setName('vp_reward').setDescription('VP per approved submission (default: 5)').setRequired(false))
                .addStringOption(opt => opt.setName('duration').setDescription('Duration (e.g. 7d, 3d, 24h, 12h)').setRequired(false))
                .addIntegerOption(opt => opt.setName('first_place').setDescription('Bonus VP for 1st place').setRequired(false))
                .addIntegerOption(opt => opt.setName('second_place').setDescription('Bonus VP for 2nd place').setRequired(false))
                .addIntegerOption(opt => opt.setName('third_place').setDescription('Bonus VP for 3rd place').setRequired(false))
                .addBooleanOption(opt => opt.setName('leagues').setDescription('Post to Leagues channel instead').setRequired(false))
                .addBooleanOption(opt => opt.setName('checklist').setDescription('Enable checklist mode with individual claimable tasks').setRequired(false))
                .addBooleanOption(opt => opt.setName('shared_checklist').setDescription('Checklist where multiple people can complete each task').setRequired(false))
        )
        .addSubcommand(sub =>
            sub.setName('competition')
                .setDescription('Create a SOTW/BOTW competition event (tracked by WOM)')
                .addStringOption(opt =>
                    opt.setName('type')
                        .setDescription('Competition type')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Skill of the Week', value: 'sotw' },
                            { name: 'Boss of the Week', value: 'botw' }
                        ))
                .addStringOption(opt => opt.setName('title').setDescription('Competition title').setRequired(true))
                .addIntegerOption(opt => opt.setName('competition_id').setDescription('WiseOldMan competition ID').setRequired(true))
                .addIntegerOption(opt => opt.setName('first_place').setDescription('VP for 1st place (default: 50)').setRequired(false))
                .addIntegerOption(opt => opt.setName('second_place').setDescription('VP for 2nd place (default: 30)').setRequired(false))
                .addIntegerOption(opt => opt.setName('third_place').setDescription('VP for 3rd place (default: 20)').setRequired(false))
                .addStringOption(opt => opt.setName('duration').setDescription('Duration (e.g. 7d, 3d) - overrides WOM end date').setRequired(false))
                .addBooleanOption(opt => opt.setName('leagues').setDescription('Post to Leagues channel instead').setRequired(false))
        )
        .addSubcommand(sub =>
            sub.setName('custom')
                .setDescription('Create a custom one-off event')
                .addStringOption(opt => opt.setName('title').setDescription('Event title').setRequired(true))
                .addIntegerOption(opt => opt.setName('vp_reward').setDescription('VP per approved submission (default: 5)').setRequired(false))
                .addStringOption(opt => opt.setName('duration').setDescription('Duration (e.g. 7d, 3d, 24h, 12h)').setRequired(false))
                .addIntegerOption(opt => opt.setName('first_place').setDescription('Bonus VP for 1st place').setRequired(false))
                .addIntegerOption(opt => opt.setName('second_place').setDescription('Bonus VP for 2nd place').setRequired(false))
                .addIntegerOption(opt => opt.setName('third_place').setDescription('Bonus VP for 3rd place').setRequired(false))
                .addBooleanOption(opt => opt.setName('leagues').setDescription('Post to Leagues channel instead').setRequired(false))
                .addBooleanOption(opt => opt.setName('checklist').setDescription('Enable checklist mode with individual claimable tasks').setRequired(false))
                .addBooleanOption(opt => opt.setName('shared_checklist').setDescription('Checklist where multiple people can complete each task').setRequired(false))
        )
        .addSubcommand(sub =>
            sub.setName('end')
                .setDescription('End an active event')
                .addIntegerOption(opt => opt.setName('event_id').setDescription('Event ID to end').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('List all active events')
        ),

    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'task' || subcommand === 'custom') {
            return showDescriptionModal(interaction, subcommand);
        } else if (subcommand === 'competition') {
            return handleCreateCompetition(interaction);
        } else if (subcommand === 'end') {
            return handleEndEvent(interaction);
        } else if (subcommand === 'list') {
            return handleListEvents(interaction);
        }
    },

    async handleEventDescriptionModal(interaction) {
        return handleDescriptionModalSubmit(interaction);
    },
};

// ----------------------------------------------------------------------------
// Parse duration string (e.g. "7d", "24h", "3d12h") into milliseconds

function parseDuration(str) {
    if (!str) return null;
    let ms = 0;
    const days = str.match(/(\d+)\s*d/i);
    const hours = str.match(/(\d+)\s*h/i);
    if (days) ms += parseInt(days[1]) * 24 * 60 * 60 * 1000;
    if (hours) ms += parseInt(hours[1]) * 60 * 60 * 1000;
    return ms > 0 ? ms : null;
}

// ----------------------------------------------------------------------------
// Show description modal for task/custom events

async function showDescriptionModal(interaction, type) {
    const modalId = `event_desc_${type}_${interaction.user.id}_${Date.now()}`;

    const isChecklist = interaction.options.getBoolean('checklist') ?? false;
    const isSharedChecklist = interaction.options.getBoolean('shared_checklist') ?? false;

    if (isChecklist && isSharedChecklist) {
        return interaction.reply({ content: '❌ Cannot use both `checklist` and `shared_checklist` at the same time.', ephemeral: true });
    }

    // Cache the slash command options
    pendingEvents.set(modalId, {
        type,
        title: interaction.options.getString('title'),
        vpReward: interaction.options.getInteger('vp_reward') ?? 5,
        durationStr: interaction.options.getString('duration'),
        first: interaction.options.getInteger('first_place'),
        second: interaction.options.getInteger('second_place'),
        third: interaction.options.getInteger('third_place'),
        isLeagues: interaction.options.getBoolean('leagues') ?? false,
        isChecklist,
        isSharedChecklist,
    });

    // Auto-clean after 5 minutes
    setTimeout(() => pendingEvents.delete(modalId), 5 * 60 * 1000);

    const modal = new ModalBuilder()
        .setCustomId(modalId)
        .setTitle(`Create ${type === 'task' ? 'Task' : 'Custom'} Event`);

    const descriptionInput = new TextInputBuilder()
        .setCustomId('event_description')
        .setLabel('Event Description')
        .setPlaceholder('Describe the event... Use line breaks and bullet points freely!')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(4000);

    modal.addComponents(new ActionRowBuilder().addComponents(descriptionInput));

    if (isChecklist || isSharedChecklist) {
        const tasksInput = new TextInputBuilder()
            .setCustomId('event_tasks')
            .setLabel('Tasks (one per line)')
            .setPlaceholder('Get a fire cape\nComplete 50 laps of agility\nDefeat Zulrah 10 times')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(4000);

        modal.addComponents(new ActionRowBuilder().addComponents(tasksInput));
    }

    return interaction.showModal(modal);
}

// ----------------------------------------------------------------------------
// Checklist helpers

function buildTaskChecklist(tasks) {
    return tasks.map((task) => {
        if (task.shared) {
            const count = task.completions?.length || 0;
            const countText = count > 0 ? ` (${count} completed)` : '';
            return `• ${task.text}${countText}`;
        }

        // Standard checklist (single claim)
        if (task.status === 'complete') {
            return `~~${task.text}~~ ✅ **${task.claimed_by_name}**`;
        } else if (task.status === 'pending') {
            return `🔄 ${task.text} — <@${task.claimed_by}> *(pending)*`;
        }
        return `⬜ ${task.text}`;
    }).join('\n');
}

function buildTaskSelectMenu(tasks, eventId) {
    // For shared tasks: always show all tasks
    // For standard tasks: show only open tasks
    const availableTasks = tasks
        .map((task, i) => ({ ...task, index: i }))
        .filter(t => t.shared ? true : t.status === 'open');

    if (availableTasks.length === 0) return null;

    const select = new StringSelectMenuBuilder()
        .setCustomId(`event_task_claim_${eventId}`)
        .setPlaceholder('Claim a task...')
        .addOptions(availableTasks.map(t => {
            const count = t.shared && t.completions?.length ? ` (${t.completions.length} done)` : '';
            const labelText = `${t.text}${count}`;
            return {
                label: labelText.length > 100 ? labelText.slice(0, 97) + '...' : labelText,
                value: String(t.index),
            };
        }));

    return new ActionRowBuilder().addComponents(select);
}

// Helper to rebuild and edit the event embed with updated checklist
async function updateChecklistEmbed(client, event) {
    try {
        const channel = client.channels.cache.get(event.channel_id) || await client.channels.fetch(event.channel_id);
        if (!channel) {
            console.error('[Event] Checklist embed update: channel not found', event.channel_id);
            return;
        }

        const message = await channel.messages.fetch(event.message_id);
        if (!message) {
            console.error('[Event] Checklist embed update: message not found', event.message_id);
            return;
        }

        const embed = EmbedBuilder.from(message.embeds[0]);

        // Update the Tasks field
        const taskFieldIndex = embed.data.fields.findIndex(f => f.name === 'Tasks');
        if (taskFieldIndex !== -1) {
            embed.data.fields[taskFieldIndex].value = buildTaskChecklist(event.tasks);
        }

        const components = [];
        const selectRow = buildTaskSelectMenu(event.tasks, event.id);
        if (selectRow) components.push(selectRow);

        await message.edit({ embeds: [embed], components });
    } catch (err) {
        console.error('[Event] Failed to update checklist embed:', err);
    }
}

// ----------------------------------------------------------------------------
// Handle description modal submission

async function handleDescriptionModalSubmit(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const opts = pendingEvents.get(interaction.customId);
    if (!opts) {
        return interaction.editReply({ content: '❌ Event session expired. Please run the command again.' });
    }
    pendingEvents.delete(interaction.customId);

    const { type, title, vpReward, durationStr, first, second, third, isLeagues, isChecklist, isSharedChecklist } = opts;
    const description = interaction.fields.getTextInputValue('event_description');

    // Parse checklist tasks if in checklist or shared checklist mode
    let tasks = null;
    if (isChecklist || isSharedChecklist) {
        const tasksRaw = interaction.fields.getTextInputValue('event_tasks');
        tasks = tasksRaw.split('\n').map(line => line.trim()).filter(Boolean)
            .map(text => ({
                text,
                claimed_by: null,
                claimed_by_name: null,
                status: 'open',
                ...(isSharedChecklist ? { shared: true, completions: [], pending_claims: [] } : {}),
            }));

        if (tasks.length === 0) {
            return interaction.editReply({ content: '❌ Checklist mode requires at least one task.' });
        }
        if (tasks.length > 25) {
            return interaction.editReply({ content: '❌ Maximum 25 tasks allowed (select menu limit).' });
        }
    }

    const durationMs = parseDuration(durationStr);
    const endsAt = durationMs ? new Date(Date.now() + durationMs) : null;

    const placeRewards = (first || second || third)
        ? [first || 0, second || 0, third || 0]
        : null;

    const eventsChannelId = isLeagues ? config.LEAGUES_EVENTS_CHANNEL_ID : config.EVENTS_CHANNEL_ID;
    const channel = interaction.client.channels.cache.get(eventsChannelId);
    if (!channel) {
        return interaction.editReply({ content: '❌ Events channel not found. Make sure `EVENTS_CHANNEL_ID` is configured.' });
    }

    // Build the event embed
    const vpEmoji = config.VP_EMOJI_ID ? `<:vp:${config.VP_EMOJI_ID}>` : '🪙';
    const embed = new EmbedBuilder()
        .setColor(type === 'task' ? 'Blue' : 'Purple')
        .setTitle(`📋 ${title}`)
        .setDescription(description)
        .setThumbnail(config.CLAN_ICON_URL)
        .addFields(
            { name: 'Reward', value: `${vpReward} ${vpEmoji} VP per completion`, inline: true },
            { name: 'Type', value: type === 'task' ? 'Weekly Task' : 'Custom Event', inline: true },
        )
        .setTimestamp();

    if (endsAt) {
        const timestamp = Math.floor(endsAt.getTime() / 1000);
        embed.addFields({ name: 'Deadline', value: `<t:${timestamp}:F> (<t:${timestamp}:R>)`, inline: false });
    }

    if (placeRewards) {
        const placementText = [];
        if (placeRewards[0]) placementText.push(`🥇 1st: +${placeRewards[0]} ${vpEmoji} VP`);
        if (placeRewards[1]) placementText.push(`🥈 2nd: +${placeRewards[1]} ${vpEmoji} VP`);
        if (placeRewards[2]) placementText.push(`🥉 3rd: +${placeRewards[2]} ${vpEmoji} VP`);
        embed.addFields({ name: 'Placement Bonuses', value: placementText.join('\n'), inline: false });
    }

    if (tasks) {
        // Checklist mode
        embed.addFields({ name: 'Tasks', value: buildTaskChecklist(tasks), inline: false });
        embed.setFooter({ text: 'Claim a task from the dropdown below!' });
    } else {
        embed.setFooter({ text: 'Submit your proof in the thread below!' });
    }

    // Select menu for checklist is added after DB insert (need event ID)
    let selectRow = null;

    // Send the embed
    const message = await channel.send({
        embeds: [embed]
    });

    // Create a thread for submissions/approvals
    const thread = await message.startThread({
        name: tasks ? `${title} — Task Approvals` : `${title} — Submissions`,
        autoArchiveDuration: 10080, // 7 days
    });

    if (tasks) {
        await thread.send({
            content: '📋 **Task claims will appear here for admin approval.**\n\n' +
                '> Claim a task from the dropdown on the event embed. An admin will approve or reject it.'
        });
    } else {
        await thread.send({
            content: '📸 **Post your screenshot proof here!** An admin will review and approve submissions.\n\n' +
                '> Only messages with image attachments will be tracked as submissions.'
        });
    }

    // Save to database
    const event = await eventsDb.createEvent({
        type,
        title,
        description,
        created_by: interaction.user.id,
        vp_reward: vpReward,
        place_rewards: placeRewards,
        tasks,
        message_id: message.id,
        thread_id: thread.id,
        channel_id: channel.id,
        ends_at: endsAt ? endsAt.toISOString() : null,
    });

    // Now that we have the event ID, add the select menu for checklist events
    if (tasks) {
        selectRow = buildTaskSelectMenu(tasks, event.id);
        if (selectRow) {
            await message.edit({ embeds: [embed], components: [selectRow] });
        }
    }

    await interaction.editReply({
        content: `✅ Event **${title}** created! (ID: ${event.id})\nEmbed: ${message.url}`
    });
}

// ----------------------------------------------------------------------------
// Create a WOM competition event (SOTW/BOTW)

async function handleCreateCompetition(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const type = interaction.options.getString('type');
    const title = interaction.options.getString('title');
    const competitionId = interaction.options.getInteger('competition_id');
    const durationStr = interaction.options.getString('duration');
    const first = interaction.options.getInteger('first_place') ?? config.pointsAward?.[0] ?? 50;
    const second = interaction.options.getInteger('second_place') ?? config.pointsAward?.[1] ?? 30;
    const third = interaction.options.getInteger('third_place') ?? config.pointsAward?.[2] ?? 20;

    const placeRewards = [first, second, third];

    // Verify the competition exists on WOM
    let competitionData;
    try {
        const res = await womApi.get(`/competitions/${competitionId}`);
        competitionData = res.data;
    } catch (err) {
        return interaction.editReply({ content: `❌ Could not find WOM competition with ID ${competitionId}. Check the ID and try again.` });
    }

    const isLeagues = interaction.options.getBoolean('leagues') ?? false;

    const durationMs = parseDuration(durationStr);
    let endsAt;
    if (durationMs) {
        endsAt = new Date(Date.now() + durationMs);
    } else if (competitionData.endsAt) {
        endsAt = new Date(competitionData.endsAt);
    } else {
        endsAt = null;
    }

    const eventsChannelId = isLeagues ? config.LEAGUES_EVENTS_CHANNEL_ID : config.EVENTS_CHANNEL_ID;
    const channel = interaction.client.channels.cache.get(eventsChannelId);
    if (!channel) {
        return interaction.editReply({ content: '❌ Events channel not found. Make sure `EVENTS_CHANNEL_ID` is configured.' });
    }

    // Build leaderboard from current competition data
    const leaderboardText = buildLeaderboardText(competitionData);

    const vpEmoji = config.VP_EMOJI_ID ? `<:vp:${config.VP_EMOJI_ID}>` : '🪙';
    const typeLabel = type === 'sotw' ? 'Skill of the Week' : 'Boss of the Week';
    const typeEmoji = type === 'sotw' ? '⭐' : '⚔️';

    // Get wiki image for the competition metric
    const metricImage = await getMetricImageUrl(competitionData.metric);

    const embed = new EmbedBuilder()
        .setColor(type === 'sotw' ? 'Gold' : 'Red')
        .setTitle(`${typeEmoji} ${title}`)
        .setDescription(`**${typeLabel}**\nTracked via [WiseOldMan Competition](https://wiseoldman.net/competitions/${competitionId})`)
        .setThumbnail(metricImage || config.CLAN_ICON_URL)
        .addFields(
            {
                name: 'Prizes',
                value: `🥇 1st: ${placeRewards[0]} ${vpEmoji} VP\n🥈 2nd: ${placeRewards[1]} ${vpEmoji} VP\n🥉 3rd: ${placeRewards[2]} ${vpEmoji} VP`,
                inline: true
            },
        )
        .setFooter({ text: `WOM Competition #${competitionId} • Updates every 15 min` })
        .setTimestamp();

    if (endsAt) {
        const timestamp = Math.floor(endsAt.getTime() / 1000);
        embed.addFields({ name: 'Ends', value: `<t:${timestamp}:F> (<t:${timestamp}:R>)`, inline: true });
    }

    embed.addFields({ name: 'Leaderboard', value: leaderboardText || 'No participants yet.', inline: false });

    const message = await channel.send({ embeds: [embed] });

    // Save to database
    const event = await eventsDb.createEvent({
        type,
        title,
        created_by: interaction.user.id,
        vp_reward: 0,
        place_rewards: placeRewards,
        wom_competition_id: competitionId,
        message_id: message.id,
        channel_id: channel.id,
        ends_at: endsAt ? endsAt.toISOString() : null,
    });

    await interaction.editReply({
        content: `✅ Competition **${title}** created! (ID: ${event.id})\nEmbed: ${message.url}`
    });
}

// ----------------------------------------------------------------------------
// End an event

async function handleEndEvent(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const eventId = interaction.options.getInteger('event_id');
    const event = await eventsDb.getEvent(eventId);

    if (!event) {
        return interaction.editReply({ content: `❌ Event with ID ${eventId} not found.` });
    }
    if (event.status !== 'active') {
        return interaction.editReply({ content: `❌ Event **${event.title}** is already ${event.status}.` });
    }

    // For WOM competitions, auto-award placement VP
    if (event.type === 'sotw' || event.type === 'botw') {
        await endCompetitionEvent(interaction, event);
    } else {
        // For submission events with placement rewards, let admin pick winners
        if (event.place_rewards && event.place_rewards.some(r => r > 0)) {
            await endSubmissionEventWithPlacements(interaction, event);
        } else {
            await endSubmissionEvent(interaction, event);
        }
    }
}

async function endCompetitionEvent(interaction, event) {
    try {
        const res = await womApi.get(`/competitions/${event.wom_competition_id}`);
        const competitionData = res.data;
        const placeRewards = event.place_rewards || [50, 30, 20];

        const participants = (competitionData.participations || [])
            .map(p => ({ rsn: p.player.displayName, gained: p.progress.gained }))
            .sort((a, b) => b.gained - a.gained);

        const topParticipants = participants.slice(0, 3);
        const vpEmoji = config.VP_EMOJI_ID ? `<:vp:${config.VP_EMOJI_ID}>` : '🪙';
        const awardResults = [];

        for (let i = 0; i < topParticipants.length; i++) {
            const { rsn } = topParticipants[i];
            const vp = placeRewards[i] || 0;
            if (vp <= 0) continue;

            try {
                const player = await db.getPlayerByRSN(rsn);
                if (player) {
                    await db.addPoints(rsn, vp);
                    awardResults.push({ rsn, vp, place: i + 1, discordId: player.discord_id });
                } else {
                    await db.createPlayer({ rsn }, vp);
                    awardResults.push({ rsn, vp, place: i + 1, discordId: null });
                }
            } catch (err) {
                console.error(`[Event] Failed to award VP to ${rsn}:`, err);
            }
        }

        // Log awards to payout channel
        const logChannel = interaction.client.channels.cache.get(config.PAYOUT_LOG_CHANNEL_ID);
        if (logChannel && awardResults.length > 0) {
            for (const result of awardResults) {
                const suffix = result.place === 1 ? 'st' : result.place === 2 ? 'nd' : 'rd';
                const logEmbed = new EmbedBuilder()
                    .setColor('Green')
                    .setTitle('Competition Points Awarded')
                    .setDescription(
                        `**Player:** ${result.rsn}\n` +
                        `**Change:** +${result.vp} VP\n` +
                        `**Reason:** ${result.place}${suffix} Place - ${event.title}\n` +
                        `**Ended by:** <@${interaction.user.id}>`
                    )
                    .setTimestamp();

                const mention = result.discordId ? `<@${result.discordId}>` : `**${result.rsn}**`;
                await logChannel.send({ content: mention, embeds: [logEmbed] });
            }
        }

        // Update the embed to show final results
        const channel = interaction.client.channels.cache.get(event.channel_id);
        if (channel) {
            try {
                const message = await channel.messages.fetch(event.message_id);
                const finalLeaderboard = buildLeaderboardText(competitionData);
                const typeEmoji = event.type === 'sotw' ? '⭐' : '⚔️';

                const embed = new EmbedBuilder()
                    .setColor('DarkGrey')
                    .setTitle(`${typeEmoji} ${event.title} — ENDED`)
                    .setDescription(message.embeds[0]?.description || '')
                    .setThumbnail(config.CLAN_ICON_URL)
                    .addFields(
                        { name: 'Final Standings', value: finalLeaderboard || 'No participants.', inline: false },
                    )
                    .setFooter({ text: 'This event has ended • Embed will be removed in 12 hours' })
                    .setTimestamp();

                if (awardResults.length > 0) {
                    const awardsText = awardResults.map(r => {
                        const medal = r.place === 1 ? '🥇' : r.place === 2 ? '🥈' : '🥉';
                        return `${medal} **${r.rsn}** — +${r.vp} ${vpEmoji} VP`;
                    }).join('\n');
                    embed.addFields({ name: 'VP Awarded', value: awardsText, inline: false });
                }

                await message.edit({ embeds: [embed] });
            } catch (err) {
                console.error('[Event] Failed to update competition embed:', err);
            }
        }

        await eventsDb.closeEvent(event.id);
        await interaction.editReply({ content: `✅ Competition **${event.title}** ended. VP awarded to top ${awardResults.length} players.` });
    } catch (err) {
        console.error('[Event] Error ending competition:', err);
        await interaction.editReply({ content: `❌ Error ending competition: ${err.message}` });
    }
}

async function endSubmissionEvent(interaction, event) {
    // Close event and lock thread
    await eventsDb.closeEvent(event.id);

    const channel = interaction.client.channels.cache.get(event.channel_id);
    if (channel && event.thread_id) {
        try {
            const thread = await channel.threads.fetch(event.thread_id);
            if (thread) {
                await thread.setLocked(true);
                await thread.send('🔒 **This event has ended.** Submissions are no longer accepted.');
            }
        } catch (err) {
            console.error('[Event] Failed to lock thread:', err);
        }
    }

    // Update embed to show ended state
    if (channel && event.message_id) {
        try {
            const message = await channel.messages.fetch(event.message_id);
            const oldEmbed = message.embeds[0];
            const embed = EmbedBuilder.from(oldEmbed)
                .setColor('DarkGrey')
                .setTitle(`📋 ${event.title} — ENDED`)
                .setFooter({ text: 'This event has ended • Embed will be removed in 12 hours' });

            await message.edit({ embeds: [embed] });
        } catch (err) {
            console.error('[Event] Failed to update embed:', err);
        }
    }

    const submissions = await eventsDb.getApprovedSubmissions(event.id);
    await interaction.editReply({
        content: `✅ Event **${event.title}** ended. ${submissions.length} approved submission(s). Thread locked.`
    });
}

async function endSubmissionEventWithPlacements(interaction, event) {
    // Get approved submissions for the select menu
    const submissions = await eventsDb.getApprovedSubmissions(event.id);

    if (submissions.length === 0) {
        // No submissions, just close
        return endSubmissionEvent(interaction, event);
    }

    // Build select menu options from approved submitters
    const uniqueSubmitters = [...new Map(submissions.map(s => [s.discord_id, s])).values()];
    const guild = interaction.guild;

    const options = [];
    for (const sub of uniqueSubmitters.slice(0, 25)) {
        try {
            const member = await guild.members.fetch(sub.discord_id);
            options.push({
                label: member.displayName,
                value: sub.discord_id,
                description: `Submitted at ${new Date(sub.created_at).toLocaleDateString()}`
            });
        } catch {
            options.push({
                label: `User ${sub.discord_id}`,
                value: sub.discord_id,
            });
        }
    }

    if (options.length === 0) {
        return endSubmissionEvent(interaction, event);
    }

    const vpEmoji = config.VP_EMOJI_ID ? `<:vp:${config.VP_EMOJI_ID}>` : '🪙';
    const placeRewards = event.place_rewards;

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`event_place_select_${event.id}`)
        .setPlaceholder('Select 1st, 2nd, and 3rd place (in order)')
        .setMinValues(1)
        .setMaxValues(Math.min(3, options.length))
        .addOptions(options);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const skipButton = new ButtonBuilder()
        .setCustomId(`event_skip_placements_${event.id}`)
        .setLabel('Skip Placements')
        .setStyle(ButtonStyle.Secondary);

    const buttonRow = new ActionRowBuilder().addComponents(skipButton);

    await interaction.editReply({
        content: `**Select placement winners for ${event.title}**\n` +
            `🥇 1st: +${placeRewards[0]} ${vpEmoji} VP | 🥈 2nd: +${placeRewards[1]} ${vpEmoji} VP | 🥉 3rd: +${placeRewards[2]} ${vpEmoji} VP\n\n` +
            `Select winners in order (1st selection = 1st place, etc.)`,
        components: [row, buttonRow]
    });
}

// Handle placement select menu (called from interactionCreate)
async function handlePlacementSelect(interaction) {
    await interaction.deferUpdate();

    const eventId = parseInt(interaction.customId.replace('event_place_select_', ''));
    const event = await eventsDb.getEvent(eventId);

    if (!event || event.status !== 'active') {
        return interaction.followUp({ content: '❌ Event not found or already ended.', ephemeral: true });
    }

    const selectedIds = interaction.values;
    const placeRewards = event.place_rewards || [0, 0, 0];
    const vpEmoji = config.VP_EMOJI_ID ? `<:vp:${config.VP_EMOJI_ID}>` : '🪙';
    const awardResults = [];

    for (let i = 0; i < selectedIds.length && i < 3; i++) {
        const discordId = selectedIds[i];
        const vp = placeRewards[i] || 0;
        if (vp <= 0) continue;

        try {
            const player = await db.getPlayerByDiscordId(discordId);
            if (player) {
                await db.addPoints(player.rsn, vp);
                awardResults.push({ rsn: player.rsn, vp, place: i + 1, discordId });
            }
        } catch (err) {
            console.error(`[Event] Failed to award placement VP to ${discordId}:`, err);
        }
    }

    // Log placement awards
    const logChannel = interaction.client.channels.cache.get(config.PAYOUT_LOG_CHANNEL_ID);
    if (logChannel && awardResults.length > 0) {
        for (const result of awardResults) {
            const suffix = result.place === 1 ? 'st' : result.place === 2 ? 'nd' : 'rd';
            const logEmbed = new EmbedBuilder()
                .setColor('Gold')
                .setTitle('Event Placement Bonus Awarded')
                .setDescription(
                    `**Player:** ${result.rsn}\n` +
                    `**Change:** +${result.vp} VP\n` +
                    `**Reason:** ${result.place}${suffix} Place - ${event.title}\n` +
                    `**Awarded by:** <@${interaction.user.id}>`
                )
                .setTimestamp();

            await logChannel.send({ content: `<@${result.discordId}>`, embeds: [logEmbed] });
        }
    }

    // Now close the event
    await eventsDb.closeEvent(event.id);

    // Lock thread
    const channel = interaction.client.channels.cache.get(event.channel_id);
    if (channel && event.thread_id) {
        try {
            const thread = await channel.threads.fetch(event.thread_id);
            if (thread) {
                await thread.setLocked(true);
                await thread.send('🔒 **This event has ended.** Submissions are no longer accepted.');
            }
        } catch (err) {
            console.error('[Event] Failed to lock thread:', err);
        }
    }

    // Update embed
    if (channel && event.message_id) {
        try {
            const message = await channel.messages.fetch(event.message_id);
            const oldEmbed = message.embeds[0];
            const embed = EmbedBuilder.from(oldEmbed)
                .setColor('DarkGrey')
                .setTitle(`📋 ${event.title} — ENDED`)
                .setFooter({ text: 'This event has ended • Embed will be removed in 12 hours' });

            if (awardResults.length > 0) {
                const awardsText = awardResults.map(r => {
                    const medal = r.place === 1 ? '🥇' : r.place === 2 ? '🥈' : '🥉';
                    return `${medal} **${r.rsn}** — +${r.vp} ${vpEmoji} VP`;
                }).join('\n');
                embed.addFields({ name: 'Placement Winners', value: awardsText, inline: false });
            }

            await message.edit({ embeds: [embed] });
        } catch (err) {
            console.error('[Event] Failed to update embed:', err);
        }
    }

    const awardsText = awardResults.map(r => `${r.place}. ${r.rsn} — +${r.vp} VP`).join('\n');
    await interaction.followUp({
        content: `✅ Event **${event.title}** ended with placements:\n${awardsText || 'No placements awarded.'}`,
        ephemeral: true
    });
}

// Handle skip placements button
async function handleSkipPlacements(interaction) {
    const eventId = parseInt(interaction.customId.replace('event_skip_placements_', ''));
    const event = await eventsDb.getEvent(eventId);

    if (!event || event.status !== 'active') {
        return interaction.reply({ content: '❌ Event not found or already ended.', ephemeral: true });
    }

    await interaction.update({ content: 'Closing event without placements...', components: [] });

    await eventsDb.closeEvent(event.id);

    const channel = interaction.client.channels.cache.get(event.channel_id);
    if (channel && event.thread_id) {
        try {
            const thread = await channel.threads.fetch(event.thread_id);
            if (thread) {
                await thread.setLocked(true);
                await thread.send('🔒 **This event has ended.** Submissions are no longer accepted.');
            }
        } catch (err) {
            console.error('[Event] Failed to lock thread:', err);
        }
    }

    if (channel && event.message_id) {
        try {
            const message = await channel.messages.fetch(event.message_id);
            const oldEmbed = message.embeds[0];
            const embed = EmbedBuilder.from(oldEmbed)
                .setColor('DarkGrey')
                .setTitle(`📋 ${event.title} — ENDED`)
                .setFooter({ text: 'This event has ended • Embed will be removed in 12 hours' });

            await message.edit({ embeds: [embed] });
        } catch (err) {
            console.error('[Event] Failed to update embed:', err);
        }
    }

    await interaction.followUp({ content: `✅ Event **${event.title}** ended without placements.`, ephemeral: true });
}

// ----------------------------------------------------------------------------
// List active events

async function handleListEvents(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const events = await eventsDb.getActiveEvents();

    if (events.length === 0) {
        return interaction.editReply({ content: 'No active events.' });
    }

    const vpEmoji = config.VP_EMOJI_ID ? `<:vp:${config.VP_EMOJI_ID}>` : '🪙';
    const lines = events.map(e => {
        const typeLabel = { task: '📋 Task', sotw: '⭐ SOTW', botw: '⚔️ BOTW', custom: '🎯 Custom' }[e.type] || e.type;
        const deadline = e.ends_at ? `<t:${Math.floor(new Date(e.ends_at).getTime() / 1000)}:R>` : 'No deadline';
        return `**ID: ${e.id}** | ${typeLabel} | ${e.title} | Ends: ${deadline}`;
    });

    const embed = new EmbedBuilder()
        .setColor('Blue')
        .setTitle('Active Events')
        .setDescription(lines.join('\n'))
        .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
}

// ----------------------------------------------------------------------------
// Build leaderboard text from WOM competition data

// OSRS skills list — used to determine if a WOM metric is a skill (XP) or boss (KC)
const OSRS_SKILLS = [
    'overall', 'attack', 'defence', 'strength', 'hitpoints', 'ranged', 'prayer',
    'magic', 'cooking', 'woodcutting', 'fletching', 'fishing', 'firemaking',
    'crafting', 'smithing', 'mining', 'herblore', 'agility', 'thieving',
    'slayer', 'farming', 'runecrafting', 'hunter', 'construction'
];

function isSkillMetric(metric) {
    return OSRS_SKILLS.includes(metric?.toLowerCase());
}

function buildLeaderboardText(competitionData) {
    if (!competitionData.participations || competitionData.participations.length === 0) {
        return 'No participants yet.';
    }

    const sorted = [...competitionData.participations]
        .sort((a, b) => b.progress.gained - a.progress.gained)
        .slice(0, 10);

    const metric = competitionData.metric || '';
    const isSkill = isSkillMetric(metric);

    return sorted.map((p, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
        const gained = p.progress.gained;
        const displayGained = isSkill ? `${gained.toLocaleString()} XP` : `${gained} KC`;
        return `${medal} **${p.player.displayName}** — ${displayGained}`;
    }).join('\n');
}

/**
 * Fetch the main image for an OSRS wiki page using the MediaWiki API.
 * Returns the thumbnail URL or null if not found.
 */
async function fetchWikiImage(pageTitle) {
    try {
        const res = await axios.get('https://oldschool.runescape.wiki/api.php', {
            params: {
                action: 'query',
                titles: pageTitle,
                prop: 'pageimages',
                format: 'json',
                pithumbsize: 256,
            },
            headers: { 'User-Agent': 'Volition-Discord-Bot' },
            timeout: 5000,
        });

        const pages = res.data?.query?.pages;
        if (!pages) return null;

        const page = Object.values(pages)[0];
        return page?.thumbnail?.source || null;
    } catch (err) {
        console.error(`[Wiki] Failed to fetch image for "${pageTitle}":`, err.message);
        return null;
    }
}

/**
 * Get a wiki image URL for a WOM competition metric.
 * Formats the metric name into a wiki page title and fetches the real image.
 */
async function getMetricImageUrl(metric) {
    if (!metric) return null;

    // Convert WOM metric (snake_case) to wiki page title (Title Case with spaces)
    const pageTitle = metric
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    return fetchWikiImage(pageTitle);
}

// ----------------------------------------------------------------------------
// Checklist: Player claims a task via select menu

async function handleTaskClaim(interaction) {
    const eventId = parseInt(interaction.customId.replace('event_task_claim_', ''));
    const taskIndex = parseInt(interaction.values[0]);

    const event = await eventsDb.getEvent(eventId);
    if (!event || event.status !== 'active' || !event.tasks) {
        return interaction.reply({ content: '❌ Event not found or not active.', ephemeral: true });
    }

    const tasks = event.tasks;
    const task = tasks[taskIndex];

    if (taskIndex < 0 || taskIndex >= tasks.length) {
        return interaction.reply({ content: '⚠️ Invalid task.', ephemeral: true });
    }

    if (task.shared) {
        // Shared checklist: multiple people can claim simultaneously
        if (!task.pending_claims) task.pending_claims = [];

        if (task.pending_claims.some(c => c.discord_id === interaction.user.id)) {
            return interaction.reply({ content: '⚠️ You already have a pending claim on this task. Submit your proof first.', ephemeral: true });
        }
        if (task.completions?.some(c => c.discord_id === interaction.user.id)) {
            return interaction.reply({ content: '⚠️ You have already completed this task.', ephemeral: true });
        }

        task.pending_claims.push({
            discord_id: interaction.user.id,
            name: interaction.member?.displayName || interaction.user.username,
        });
    } else {
        // Standard checklist: one person at a time
        const existingPending = tasks.find(t => t.status === 'pending' && t.claimed_by === interaction.user.id);
        if (existingPending) {
            return interaction.reply({ content: '⚠️ You already have a pending task claim. Submit your proof first before claiming another.', ephemeral: true });
        }
        if (task.status !== 'open') {
            return interaction.reply({ content: '⚠️ This task is no longer available.', ephemeral: true });
        }

        tasks[taskIndex].status = 'pending';
        tasks[taskIndex].claimed_by = interaction.user.id;
        tasks[taskIndex].claimed_by_name = interaction.member?.displayName || interaction.user.username;
    }

    await eventsDb.updateEvent(eventId, { tasks });

    // Update the embed (only for standard checklist — shared doesn't change visually on claim)
    if (!task.shared) {
        await updateChecklistEmbed(interaction.client, { ...event, tasks });
    }

    // Notify in the thread — no approve/reject yet, wait for screenshot proof
    const thread = interaction.client.channels.cache.get(event.thread_id);
    if (thread) {
        await thread.send({
            content: `📋 <@${interaction.user.id}> claimed: **${tasks[taskIndex].text}**\n📸 Please post your screenshot proof below.`
        });
    }

    await interaction.reply({
        content: `You claimed: **${tasks[taskIndex].text}** — please post your screenshot proof in the event thread for admin approval.`,
        ephemeral: true
    });
}

// ----------------------------------------------------------------------------
// Checklist: Admin approves a task claim

async function handleTaskApprove(interaction) {
    if (!isAdmin(interaction.member)) {
        return interaction.reply({ content: '❌ Only admins can approve task claims.', ephemeral: true });
    }

    // Defer immediately so Discord doesn't time out during DB/API calls
    await interaction.deferUpdate();

    // Format: event_task_approve_{eventId}_{taskIndex} or event_task_approve_{eventId}_{taskIndex}_{userId}
    const parts = interaction.customId.replace('event_task_approve_', '').split('_');
    const eventId = parseInt(parts[0]);
    const taskIndex = parseInt(parts[1]);
    const targetUserId = parts[2] || null; // present for shared tasks

    const event = await eventsDb.getEvent(eventId);
    if (!event || !event.tasks) {
        return interaction.followUp({ content: '❌ Event not found.', ephemeral: true });
    }

    const tasks = event.tasks;
    if (taskIndex < 0 || taskIndex >= tasks.length) {
        return interaction.followUp({ content: '❌ Invalid task.', ephemeral: true });
    }

    let claimedBy;
    let claimedByName;

    if (tasks[taskIndex].shared) {
        // Shared: find the specific pending claim by user ID
        const claimIndex = tasks[taskIndex].pending_claims?.findIndex(c => c.discord_id === targetUserId);
        if (claimIndex === undefined || claimIndex === -1) {
            return interaction.followUp({ content: '⚠️ This claim is no longer pending.', ephemeral: true });
        }
        claimedBy = targetUserId;
        claimedByName = tasks[taskIndex].pending_claims[claimIndex].name;
    } else {
        if (tasks[taskIndex].status !== 'pending') {
            return interaction.followUp({ content: '⚠️ This task is not pending approval.', ephemeral: true });
        }
        claimedBy = tasks[taskIndex].claimed_by;
        claimedByName = tasks[taskIndex].claimed_by_name;
    }

    // Award VP
    const vpReward = event.vp_reward || 0;
    let playerRsn = 'Unknown';

    if (vpReward > 0) {
        try {
            const player = await db.getPlayerByDiscordId(claimedBy);
            if (player) {
                playerRsn = player.rsn;
                await db.addPoints(player.rsn, vpReward);
            } else {
                return interaction.followUp({
                    content: `⚠️ <@${claimedBy}> is not linked to a player in the database. VP not awarded. Please verify them first.`,
                    ephemeral: true
                });
            }
        } catch (err) {
            console.error('[Event] Failed to award VP for task:', err);
            return interaction.followUp({ content: `❌ Failed to award VP: ${err.message}`, ephemeral: true });
        }
    }

    // Update task status
    if (tasks[taskIndex].shared) {
        // Shared checklist: add to completions, remove from pending_claims
        if (!tasks[taskIndex].completions) tasks[taskIndex].completions = [];
        tasks[taskIndex].completions.push({
            discord_id: claimedBy,
            name: claimedByName,
        });
        tasks[taskIndex].pending_claims = tasks[taskIndex].pending_claims.filter(
            c => c.discord_id !== claimedBy
        );
    } else {
        // Standard checklist: mark complete
        tasks[taskIndex].status = 'complete';
    }
    await eventsDb.updateEvent(eventId, { tasks });

    // Update the event embed checklist
    await updateChecklistEmbed(interaction.client, { ...event, tasks });

    // Update the approve/reject button message in the thread
    const vpEmoji = config.VP_EMOJI_ID ? `<:vp:${config.VP_EMOJI_ID}>` : '🪙';
    const embed = new EmbedBuilder()
        .setColor('Green')
        .setDescription(
            `✅ **Approved** — <@${claimedBy}>\n` +
            `**Task:** ${tasks[taskIndex].text}\n` +
            `**+${vpReward}** ${vpEmoji} VP awarded by <@${interaction.user.id}>`
        )
        .setFooter({ text: `Event: ${event.title} • Task #${taskIndex + 1}` });

    await interaction.editReply({ embeds: [embed], components: [] });

    // Log to payout channel
    const logChannel = interaction.client.channels.cache.get(config.PAYOUT_LOG_CHANNEL_ID);
    if (logChannel && vpReward > 0) {
        const player = await db.getPlayerByDiscordId(claimedBy);
        const logEmbed = new EmbedBuilder()
            .setColor('Green')
            .setTitle('Event Task Approved')
            .setDescription(
                `**Player:** ${playerRsn}\n` +
                `**Task:** ${tasks[taskIndex].text}\n` +
                `**Change:** +${vpReward} VP\n` +
                `**New Total:** ${player ? player.points : '?'} VP\n` +
                `**Event:** ${event.title}\n` +
                `**Approved by:** <@${interaction.user.id}>`
            )
            .setTimestamp();

        await logChannel.send({ content: `<@${claimedBy}>`, embeds: [logEmbed] });
    }
}

// ----------------------------------------------------------------------------
// Checklist: Admin rejects a task claim

async function handleTaskReject(interaction) {
    if (!isAdmin(interaction.member)) {
        return interaction.reply({ content: '❌ Only admins can reject task claims.', ephemeral: true });
    }

    // Defer immediately so Discord doesn't time out during DB calls
    await interaction.deferUpdate();

    // Format: event_task_reject_{eventId}_{taskIndex} or event_task_reject_{eventId}_{taskIndex}_{userId}
    const parts = interaction.customId.replace('event_task_reject_', '').split('_');
    const eventId = parseInt(parts[0]);
    const taskIndex = parseInt(parts[1]);
    const targetUserId = parts[2] || null;

    const event = await eventsDb.getEvent(eventId);
    if (!event || !event.tasks) {
        return interaction.followUp({ content: '❌ Event not found.', ephemeral: true });
    }

    const tasks = event.tasks;
    if (taskIndex < 0 || taskIndex >= tasks.length) {
        return interaction.followUp({ content: '❌ Invalid task.', ephemeral: true });
    }

    let claimedBy;

    if (tasks[taskIndex].shared) {
        // Shared: remove the specific pending claim
        const claimIndex = tasks[taskIndex].pending_claims?.findIndex(c => c.discord_id === targetUserId);
        if (claimIndex === undefined || claimIndex === -1) {
            return interaction.followUp({ content: '⚠️ This claim is no longer pending.', ephemeral: true });
        }
        claimedBy = targetUserId;
        tasks[taskIndex].pending_claims.splice(claimIndex, 1);
    } else {
        if (tasks[taskIndex].status !== 'pending') {
            return interaction.followUp({ content: '⚠️ This task is not pending.', ephemeral: true });
        }
        claimedBy = tasks[taskIndex].claimed_by;

        // Reset task to open
        tasks[taskIndex].status = 'open';
        tasks[taskIndex].claimed_by = null;
        tasks[taskIndex].claimed_by_name = null;
    }

    await eventsDb.updateEvent(eventId, { tasks });

    // Update the embed
    await updateChecklistEmbed(interaction.client, { ...event, tasks });

    // Update the reject message
    const embed = new EmbedBuilder()
        .setColor('Red')
        .setDescription(
            `❌ **Rejected** — <@${claimedBy}>\n` +
            `**Task:** ${tasks[taskIndex].text}\n` +
            `Rejected by <@${interaction.user.id}>`
        )
        .setFooter({ text: `Event: ${event.title} • Task #${taskIndex + 1}` });

    await interaction.editReply({ embeds: [embed], components: [] });
}

// Export for use in automated task creation and interaction routing
module.exports.handlePlacementSelect = handlePlacementSelect;
module.exports.handleSkipPlacements = handleSkipPlacements;
module.exports.buildLeaderboardText = buildLeaderboardText;
module.exports.getMetricImageUrl = getMetricImageUrl;
module.exports.handleTaskClaim = handleTaskClaim;
module.exports.handleTaskApprove = handleTaskApprove;
module.exports.handleTaskReject = handleTaskReject;

// Export for automated weekly task creation (called from index.js)
module.exports.createTaskEvent = async function(client, taskText) {
    const eventsChannelId = config.EVENTS_CHANNEL_ID;
    const channel = client.channels.cache.get(eventsChannelId);
    if (!channel) {
        console.log('[Event] Events channel not found');
        return null;
    }

    const vpEmoji = config.VP_EMOJI_ID ? `<:vp:${config.VP_EMOJI_ID}>` : '🪙';
    const endsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const timestamp = Math.floor(endsAt.getTime() / 1000);

    const embed = new EmbedBuilder()
        .setColor('Blue')
        .setTitle(`📋 Weekly Task`)
        .setDescription(taskText)
        .setThumbnail(config.CLAN_ICON_URL)
        .addFields(
            { name: 'Reward', value: `5 ${vpEmoji} VP per completion`, inline: true },
            { name: 'Type', value: 'Weekly Task', inline: true },
            { name: 'Deadline', value: `<t:${timestamp}:F> (<t:${timestamp}:R>)`, inline: false },
        )
        .setFooter({ text: 'Submit your proof in the thread below!' })
        .setTimestamp();

    const message = await channel.send({
        embeds: [embed]
    });

    const thread = await message.startThread({
        name: 'Weekly Task — Submissions',
        autoArchiveDuration: 10080,
    });

    await thread.send({
        content: '📸 **Post your screenshot proof here!** An admin will review and approve submissions.\n\n' +
            '> Only messages with image attachments will be tracked as submissions.'
    });

    const event = await eventsDb.createEvent({
        type: 'task',
        title: 'Weekly Task',
        description: taskText,
        created_by: null,
        vp_reward: 5,
        message_id: message.id,
        thread_id: thread.id,
        channel_id: channel.id,
        ends_at: endsAt.toISOString(),
    });

    return event;
};
