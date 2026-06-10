// Post / refresh / close a Discord announcement for a SITE event (vs_events).
//
// Unlike tasks, events are NOT submitted in Discord — the embed just describes the
// event and links players to the site to submit. Used by jobs/eventAnnouncePoller.js
// so an event opened on the site shows up in the events channel automatically (with
// the events role pinged once), stays in sync when edited, and is marked ENDED when
// it leaves 'open'. Dedup + change-detection ride on the bot `events` table via the
// `vs_event_id` link (mirrors how tasks use `vs_task_id`).

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../utils/config');
const eventsDb = require('../db/events');

const SITE_URL = 'https://volition-osrs.com';

// Map a site event `kind` to its player-page path + a human label.
function eventLink(ev) {
    switch (ev.kind) {
        case 'bingo':
            return { url: `${SITE_URL}/bingo/${ev.slug}`, label: 'Bingo Event' };
        case 'duo':
            return { url: `${SITE_URL}/events/${ev.slug}`, label: 'Duo Event' };
        case 'simple':
        case 'sequential':
            return { url: `${SITE_URL}/event/${ev.slug}`, label: 'Event' };
        default: // custom / legacy signup events
            return { url: `${SITE_URL}/events/${ev.slug}`, label: 'Event' };
    }
}

// Trim markdown to a Discord-embed-friendly plain-ish blurb.
function blurb(description) {
    const text = (description || '').trim();
    if (!text) return 'A new Volition event is live — head to the site for details and to submit.';
    return text.length > 600 ? `${text.slice(0, 597)}…` : text;
}

function buildSiteEventEmbed(ev) {
    const { url, label } = eventLink(ev);
    const ts = ev.ends_at ? Math.floor(new Date(ev.ends_at).getTime() / 1000) : null;
    const embed = new EmbedBuilder()
        .setColor('Gold')
        .setTitle(`🎉 ${ev.name}`)
        .setDescription(
            `${blurb(ev.description)}\n\n` +
            `Complete the objectives and upload your proof on the **[Volition site](${url})** — ` +
            `an admin reviews each submission and rewards are paid out automatically.`
        )
        .addFields(
            { name: 'Type', value: label, inline: true },
            ...(ts ? [{ name: 'Ends', value: `<t:${ts}:R>`, inline: true }] : [])
        )
        .setThumbnail(config.CLAN_ICON_URL)
        .setTimestamp();
    return embed;
}

function linkRow(ev) {
    const { url } = eventLink(ev);
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open on the site →').setURL(url)
    );
}

// Did the event change vs. what the linked bot row cached? (title / description / deadline)
function eventChanged(ev, row) {
    return (
        (ev.name || '') !== (row.title || '') ||
        (ev.description || '') !== (row.description || '') ||
        (ev.ends_at || null) !== (row.ends_at || null)
    );
}

async function getEventsChannel(client) {
    return (
        client.channels.cache.get(config.EVENTS_CHANNEL_ID) ||
        (await client.channels.fetch(config.EVENTS_CHANNEL_ID).catch(() => null))
    );
}

// Ensure an open site event has a Discord announcement, kept in sync.
//   - linked + unchanged  → no-op
//   - linked + changed    → edit the embed + update cached fields
//   - not linked yet      → post embed (ping events role) + link the bot event row
// Returns { created } | { refreshed } | { error } | {}.
async function ensureEventAnnounce(client, ev) {
    const existing = await eventsDb.getEventByVsEventId(ev.id);

    if (existing && existing.status === 'active' && existing.message_id) {
        if (!eventChanged(ev, existing)) return {};
        try {
            const ch =
                client.channels.cache.get(existing.channel_id) ||
                (existing.channel_id ? await client.channels.fetch(existing.channel_id) : null);
            if (ch && existing.message_id) {
                const msg = await ch.messages.fetch(existing.message_id);
                await msg.edit({ embeds: [buildSiteEventEmbed(ev)], components: [linkRow(ev)] });
            }
        } catch (err) {
            console.warn('[EventAnnounce] embed refresh failed:', err.message);
        }
        try {
            await eventsDb.updateEvent(existing.id, {
                title: ev.name,
                description: ev.description,
                ends_at: ev.ends_at || null,
            });
        } catch (err) {
            console.warn('[EventAnnounce] event update failed:', err.message);
        }
        return { refreshed: true };
    }

    const channel = await getEventsChannel(client);
    if (!channel) return { error: 'events channel not found' };

    const message = await channel.send({
        content: config.eventsRoleID ? `<@&${config.eventsRoleID}>` : undefined,
        embeds: [buildSiteEventEmbed(ev)],
        components: [linkRow(ev)],
    });

    await eventsDb.createEvent({
        type: 'site_event',
        title: ev.name,
        description: ev.description,
        created_by: null,
        vp_reward: 0,
        vs_event_id: ev.id,
        message_id: message.id,
        channel_id: channel.id,
        ends_at: ev.ends_at || null,
    });

    return { created: true };
}

// A site event left 'open' (closed on the site without its deadline passing — the
// deadline case is handled by jobs/eventLifecycle.js). Grey the embed, drop the
// button, and close the bot row so eventLifecycle deletes it after 12h.
async function closeEventAnnounce(client, row) {
    try {
        const ch =
            client.channels.cache.get(row.channel_id) ||
            (row.channel_id ? await client.channels.fetch(row.channel_id).catch(() => null) : null);
        if (ch && row.message_id) {
            const msg = await ch.messages.fetch(row.message_id).catch(() => null);
            if (msg && msg.embeds[0]) {
                const embed = EmbedBuilder.from(msg.embeds[0])
                    .setColor('DarkGrey')
                    .setTitle(`${(msg.embeds[0].title || row.title || 'Event').replace(/ — ENDED$/, '')} — ENDED`)
                    .setFooter({ text: 'This event has ended • Embed will be removed in 12 hours' });
                await msg.edit({ embeds: [embed], components: [] });
            }
        }
    } catch (err) {
        console.warn('[EventAnnounce] close embed edit failed:', err.message);
    }
    await eventsDb.closeEvent(row.id).catch((err) => console.warn('[EventAnnounce] closeEvent failed:', err.message));
}

module.exports = { ensureEventAnnounce, closeEventAnnounce, buildSiteEventEmbed, eventLink, SITE_URL };
