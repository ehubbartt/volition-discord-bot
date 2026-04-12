const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType } = require('discord.js');
const { isAdmin } = require('../../utils/permissions');
const config = require('../../utils/config');
const eventsDb = require('../../db/events');
const db = require('../../db/supabase');
const { womApi } = require('../../utils/api');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('event')
        .setDescription('(Admin Only) Manage events and challenges')
        .addSubcommand(sub =>
            sub.setName('task')
                .setDescription('Create a submission-based task event')
                .addStringOption(opt => opt.setName('title').setDescription('Event title').setRequired(true))
                .addStringOption(opt => opt.setName('description').setDescription('Task description / what players need to do').setRequired(true))
                .addIntegerOption(opt => opt.setName('vp_reward').setDescription('VP per approved submission (default: 5)').setRequired(false))
                .addStringOption(opt => opt.setName('duration').setDescription('Duration (e.g. 7d, 3d, 24h, 12h)').setRequired(false))
                .addIntegerOption(opt => opt.setName('first_place').setDescription('Bonus VP for 1st place').setRequired(false))
                .addIntegerOption(opt => opt.setName('second_place').setDescription('Bonus VP for 2nd place').setRequired(false))
                .addIntegerOption(opt => opt.setName('third_place').setDescription('Bonus VP for 3rd place').setRequired(false))
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
        )
        .addSubcommand(sub =>
            sub.setName('custom')
                .setDescription('Create a custom one-off event')
                .addStringOption(opt => opt.setName('title').setDescription('Event title').setRequired(true))
                .addStringOption(opt => opt.setName('description').setDescription('Event description / what players need to do').setRequired(true))
                .addIntegerOption(opt => opt.setName('vp_reward').setDescription('VP per approved submission (default: 5)').setRequired(false))
                .addStringOption(opt => opt.setName('duration').setDescription('Duration (e.g. 7d, 3d, 24h, 12h)').setRequired(false))
                .addIntegerOption(opt => opt.setName('first_place').setDescription('Bonus VP for 1st place').setRequired(false))
                .addIntegerOption(opt => opt.setName('second_place').setDescription('Bonus VP for 2nd place').setRequired(false))
                .addIntegerOption(opt => opt.setName('third_place').setDescription('Bonus VP for 3rd place').setRequired(false))
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
            return handleCreateSubmissionEvent(interaction, subcommand);
        } else if (subcommand === 'competition') {
            return handleCreateCompetition(interaction);
        } else if (subcommand === 'end') {
            return handleEndEvent(interaction);
        } else if (subcommand === 'list') {
            return handleListEvents(interaction);
        }
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
// Create a submission-based event (task or custom)

async function handleCreateSubmissionEvent(interaction, type) {
    await interaction.deferReply({ ephemeral: true });

    const title = interaction.options.getString('title');
    const description = interaction.options.getString('description');
    const vpReward = interaction.options.getInteger('vp_reward') ?? 5;
    const durationStr = interaction.options.getString('duration');
    const first = interaction.options.getInteger('first_place');
    const second = interaction.options.getInteger('second_place');
    const third = interaction.options.getInteger('third_place');

    const durationMs = parseDuration(durationStr);
    const endsAt = durationMs ? new Date(Date.now() + durationMs) : null;

    const placeRewards = (first || second || third)
        ? [first || 0, second || 0, third || 0]
        : null;

    const eventsChannelId = config.EVENTS_CHANNEL_ID;
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
        .setFooter({ text: 'Submit your proof in the thread below!' })
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

    // Send the embed
    const message = await channel.send({
        content: config.weeklyTaskRoleID ? `<@&${config.weeklyTaskRoleID}>` : undefined,
        embeds: [embed]
    });

    // Create a thread on the embed for submissions
    const thread = await message.startThread({
        name: `${title} — Submissions`,
        autoArchiveDuration: 10080, // 7 days
    });

    await thread.send({
        content: '📸 **Post your screenshot proof here!** An admin will review and approve submissions.\n\n' +
            '> Only messages with image attachments will be tracked as submissions.'
    });

    // Save to database
    const event = await eventsDb.createEvent({
        type,
        title,
        description,
        created_by: interaction.user.id,
        vp_reward: vpReward,
        place_rewards: placeRewards,
        message_id: message.id,
        thread_id: thread.id,
        channel_id: channel.id,
        ends_at: endsAt ? endsAt.toISOString() : null,
    });

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

    const durationMs = parseDuration(durationStr);
    let endsAt;
    if (durationMs) {
        endsAt = new Date(Date.now() + durationMs);
    } else if (competitionData.endsAt) {
        endsAt = new Date(competitionData.endsAt);
    } else {
        endsAt = null;
    }

    const eventsChannelId = config.EVENTS_CHANNEL_ID;
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
    const metricImage = getMetricImageUrl(competitionData.metric);

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
 * Build an OSRS wiki image URL for a WOM competition metric.
 * Skills use "{Skill}_icon.png", bosses use "{Boss}.png" with formatting.
 */
function getMetricImageUrl(metric) {
    if (!metric) return null;

    const formatted = metric
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join('_');

    if (isSkillMetric(metric)) {
        return `https://oldschool.runescape.wiki/images/${formatted}_icon.png`;
    }

    // Boss names — encode special characters
    const encoded = encodeURIComponent(formatted).replace(/%20/g, '_');
    return `https://oldschool.runescape.wiki/images/${encoded}.png`;
}

// Export for use in automated task creation and interaction routing
module.exports.handlePlacementSelect = handlePlacementSelect;
module.exports.handleSkipPlacements = handleSkipPlacements;
module.exports.buildLeaderboardText = buildLeaderboardText;
module.exports.getMetricImageUrl = getMetricImageUrl;

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
        content: config.weeklyTaskRoleID ? `<@&${config.weeklyTaskRoleID}>` : undefined,
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
