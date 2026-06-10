const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { isAdmin } = require('../../utils/permissions');
const config = require('../../utils/config');
const siteSubs = require('../../db/siteSubmissions');
const eventsDb = require('../../db/events');

// The website page where players can alternatively submit proof.
const SITE_TASKS_URL = 'https://volition-osrs.com/tasks/weekly';

function rewardValue(task) {
    const parts = [];
    if (task.pack_reward) parts.push(`🎴 1× **${task.pack_reward}**`);
    if (Number(task.vp_reward) > 0) parts.push(`${task.vp_reward} VP`);
    return parts.length ? parts.join(' + ') : 'No reward';
}

// Ensure an active weekly task has a Discord submission thread. Reuses the existing
// thread if a bot event already links the task (e.g. created via /event task or the
// rotation); otherwise posts an embed + opens a thread + records the bot event so the
// thread-message handler routes posted images into the task. Returns the thread id.
async function ensureThread(client, channel, task) {
    const existing = await eventsDb.getEventByVsTaskId(task.id);
    if (existing && existing.status === 'active' && existing.thread_id) {
        return { threadId: existing.thread_id, created: false };
    }

    const ts = task.ends_at ? Math.floor(new Date(task.ends_at).getTime() / 1000) : null;
    const embed = new EmbedBuilder()
        .setColor('Blue')
        .setTitle(`📋 Weekly Task — ${task.name}`)
        .setDescription(
            `${task.description || 'Submit your proof.'}\n\n` +
            `📸 Post screenshots in the thread below — **every image in your message** is submitted to this task. ` +
            `Or submit on the [site](${SITE_TASKS_URL}). Either way an admin reviews it.`
        )
        .addFields(
            { name: 'Reward', value: rewardValue(task), inline: true },
            ...(ts ? [{ name: 'Deadline', value: `<t:${ts}:R>`, inline: true }] : [])
        )
        .setThumbnail(config.CLAN_ICON_URL)
        .setTimestamp();

    const message = await channel.send({
        content: config.weeklyTaskRoleID ? `<@&${config.weeklyTaskRoleID}>` : undefined,
        embeds: [embed]
    });

    const thread = await message.startThread({
        name: `Weekly Task — ${task.name}`.slice(0, 90),
        autoArchiveDuration: 10080
    });

    await thread.send({
        content:
            '📸 **Post your screenshot proof here.** Every image in your message is submitted to this task and reviewed on the site.\n' +
            '> Only messages with image attachments are tracked as submissions.'
    });

    // Link the thread to the vs_tasks instance so handleThreadMessage can route
    // posted images to it. Reward lives on vs_tasks, so no pack/vp on the bot event.
    await eventsDb.createEvent({
        type: 'task',
        title: task.name,
        description: task.description,
        created_by: null,
        vp_reward: 0,
        pack_reward_name: null,
        vs_task_id: task.id,
        message_id: message.id,
        thread_id: thread.id,
        channel_id: channel.id,
        ends_at: task.ends_at || null
    });

    return { threadId: thread.id, created: true };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sendweeklytask')
        .setDescription('(Admin Only) Open a Discord submission thread for each active weekly task'),

    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const active = await siteSubs.listActiveInstancesOfKind('weekly_task');
            if (active.length === 0) {
                await interaction.editReply({
                    content: '⚠️ No active weekly task right now. Create/activate one in the site admin or with `/event task`.'
                });
                return;
            }

            const channel = interaction.client.channels.cache.get(config.EVENTS_CHANNEL_ID);
            if (!channel) {
                await interaction.editReply({ content: '❌ Events channel not found.' });
                return;
            }

            const lines = [];
            for (const task of active) {
                const { threadId, created } = await ensureThread(interaction.client, channel, task);
                lines.push(`• **${task.name}** — <#${threadId}>${created ? ' (new thread)' : ' (existing)'}`);
            }

            await interaction.editReply({
                content: `✅ ${active.length} active weekly task${active.length === 1 ? '' : 's'} ready for Discord + site submission:\n${lines.join('\n')}`
            });
        } catch (error) {
            console.error('[SendWeeklyTask] Error:', error);
            await interaction.editReply({ content: `❌ Error: ${error.message}` });
        }
    }
};
