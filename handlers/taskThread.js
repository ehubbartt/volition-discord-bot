// Shared logic for posting / refreshing a Discord submission thread for a vs_tasks
// instance. Used by the /sendweeklytask command AND the taskSyncPoller job, so a task
// activated on the site (weekly OR custom) gets a thread automatically and stays in
// sync when edited. Posting an image in the thread is handled by eventSubmission.js,
// which routes it to the linked vs_tasks instance via events.vs_task_id.

const { EmbedBuilder } = require('discord.js');
const config = require('../utils/config');
const eventsDb = require('../db/events');

const SITE_TASKS_URL = 'https://volition-osrs.com/tasks/weekly';

function kindLabel(kind) {
    if (kind === 'daily_task') return 'Daily Task';
    if (kind === 'custom_task') return 'Task';
    return 'Weekly Task';
}

// Role to @ when a task is first posted: weekly tasks ping the weekly role, custom
// tasks ping the events role. Daily/other don't ping. Returns the content string or undefined.
function taskPingContent(kind) {
    if (kind === 'weekly_task' && config.weeklyTaskRoleID) return `<@&${config.weeklyTaskRoleID}>`;
    if (kind === 'custom_task' && config.eventsRoleID) return `<@&${config.eventsRoleID}>`;
    return undefined;
}

function rewardValue(task) {
    const parts = [];
    if (task.pack_reward) parts.push(`🎴 1× **${task.pack_reward}**`);
    if (Number(task.vp_reward) > 0) parts.push(`${task.vp_reward} VP`);
    return parts.length ? parts.join(' + ') : 'No reward';
}

function buildTaskEmbed(task) {
    const ts = task.ends_at ? Math.floor(new Date(task.ends_at).getTime() / 1000) : null;
    return new EmbedBuilder()
        .setColor('Blue')
        .setTitle(`📋 ${kindLabel(task.kind)} — ${task.name}`)
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
}

// Did the task change vs. what the linked bot event has cached? (title/description/
// deadline/reward — reward is mirrored onto the bot event purely for this comparison.)
function taskChanged(task, ev) {
    return (
        (task.name || '') !== (ev.title || '') ||
        (task.description || '') !== (ev.description || '') ||
        (task.ends_at || null) !== (ev.ends_at || null) ||
        (task.pack_reward || null) !== (ev.pack_reward_name || null) ||
        Number(task.vp_reward || 0) !== Number(ev.vp_reward || 0)
    );
}

async function getEventsChannel(client) {
    return (
        client.channels.cache.get(config.EVENTS_CHANNEL_ID) ||
        (await client.channels.fetch(config.EVENTS_CHANNEL_ID).catch(() => null))
    );
}

// Ensure an active vs_tasks instance has a Discord submission thread, kept in sync.
//  - existing active thread + task changed → edit the embed + update the cached fields
//  - existing active thread + unchanged    → no-op
//  - no thread (e.g. activated on the site) → post embed + open thread + link the event
// Returns { threadId, created, refreshed } or { error }.
async function ensureTaskThread(client, task) {
    const existing = await eventsDb.getEventByVsTaskId(task.id);

    if (existing && existing.status === 'active' && existing.thread_id) {
        if (!taskChanged(task, existing)) {
            return { threadId: existing.thread_id, created: false, refreshed: false };
        }
        try {
            const ch =
                client.channels.cache.get(existing.channel_id) ||
                (existing.channel_id ? await client.channels.fetch(existing.channel_id) : null);
            if (ch && existing.message_id) {
                const msg = await ch.messages.fetch(existing.message_id);
                await msg.edit({ embeds: [buildTaskEmbed(task)] });
            }
        } catch (err) {
            console.warn('[TaskThread] embed refresh failed:', err.message);
        }
        try {
            await eventsDb.updateEvent(existing.id, {
                title: task.name,
                description: task.description,
                ends_at: task.ends_at || null,
                pack_reward_name: task.pack_reward || null,
                vp_reward: Number(task.vp_reward || 0)
            });
        } catch (err) {
            console.warn('[TaskThread] event update failed:', err.message);
        }
        return { threadId: existing.thread_id, created: false, refreshed: true };
    }

    const channel = await getEventsChannel(client);
    if (!channel) return { error: 'events channel not found' };

    const message = await channel.send({
        content: taskPingContent(task.kind),
        embeds: [buildTaskEmbed(task)]
    });

    const thread = await message.startThread({
        name: `${kindLabel(task.kind)} — ${task.name}`.slice(0, 90),
        autoArchiveDuration: 10080
    });

    await thread.send({
        content:
            '📸 **Post your screenshot proof here.** Every image in your message is submitted to this task and reviewed on the site.\n' +
            '> Only messages with image attachments are tracked as submissions.'
    });

    // Link the thread to the vs_tasks instance (events.vs_task_id) so posted images
    // route to it. Reward is mirrored onto the bot event for edit-detection; the pack
    // payout itself is granted from vs_tasks.pack_reward by the submission poller.
    await eventsDb.createEvent({
        type: 'task',
        title: task.name,
        description: task.description,
        created_by: null,
        vp_reward: Number(task.vp_reward || 0),
        pack_reward_name: task.pack_reward || null,
        vs_task_id: task.id,
        message_id: message.id,
        thread_id: thread.id,
        channel_id: channel.id,
        ends_at: task.ends_at || null
    });

    return { threadId: thread.id, created: true };
}

module.exports = { ensureTaskThread, buildTaskEmbed, rewardValue, SITE_TASKS_URL };
