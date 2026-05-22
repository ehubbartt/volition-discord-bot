// Posts the new week's Skill or Kill (SoK) competitions to SOK_EVENTS_CHANNEL_ID
// every Sunday at 23:00 UTC as a single combined embed (skill + boss). The
// 15-min updater in jobs/eventLifecycle.js groups events by message_id and
// refreshes the combined leaderboard in place; runLifecycleCheck closes them
// when ends_at fires.
//
// Note: VP payout on close is still manual via /event end <id>.

const { EmbedBuilder } = require('discord.js');
const eventsDb = require('../db/events');
const { womApi } = require('../utils/api');
const config = require('../utils/config');
const hybridConfig = require('../utils/hybridConfig');
const { isSkillMetric } = require('../commands/admin/event');

function getThisSunday23UTC(now = new Date()) {
    // The Sunday 23:00 UTC anchoring the *current* SoK week.
    // On Sunday before 23:00, the new week hasn't started yet — return last week's.
    // On Sunday at/after 23:00 and on weekdays, return the most recent Sunday 23:00.
    const day = now.getUTCDay();
    const hour = now.getUTCHours();
    const daysSince = day === 0 ? (hour < 23 ? 7 : 0) : day;
    return new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - daysSince,
        23, 0, 0, 0
    ));
}

async function isMessageAlive(client, channelId, messageId) {
    if (!channelId || !messageId) return false;
    const ch = client.channels.cache.get(channelId);
    if (!ch) return false;
    try {
        await ch.messages.fetch(messageId);
        return true;
    } catch (err) {
        if (err?.code === 10008 || err?.code === 10003) return false;
        return true;
    }
}

function sortSkillFirst(comps) {
    return [...comps].sort((a, b) => {
        const aSkill = isSkillMetric(a.metric);
        const bSkill = isSkillMetric(b.metric);
        return aSkill === bSkill ? 0 : aSkill ? -1 : 1;
    });
}

function buildSokLeaderboardFields(competitions, topN = 5) {
    return sortSkillFirst(competitions).map(comp => {
        const isSkill = isSkillMetric(comp.metric || '');
        const emoji = isSkill ? '⭐' : '⚔️';
        const label = (comp.title || '').replace(/^SoK\s+Week\s+\d+\s*/i, '').trim() || comp.metric || '';
        const link = `https://wiseoldman.net/competitions/${comp.id}`;

        const sorted = (comp.participations || [])
            .slice()
            .sort((a, b) => b.progress.gained - a.progress.gained)
            .slice(0, topN);

        const rows = sorted.length === 0
            ? ['_No participants yet._']
            : sorted.map((p, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
                const gained = p.progress.gained;
                const display = isSkill ? `${gained.toLocaleString()} XP` : `${gained} KC`;
                return `${medal} **${p.player.displayName}** — ${display}`;
            });

        return {
            name: `${emoji} ${label}`,
            value: [`[View on WOM](${link})`, ...rows].join('\n'),
            inline: true,
        };
    });
}

function buildSokWeekTitle(competitions) {
    const wk = competitions
        .map(c => (c.title || '').match(/Week\s+(\d+)/i))
        .find(m => m);
    return `🗓️ Skill or Kill${wk ? ` — Week ${wk[1]}` : ''}`;
}

async function postWeeklySokCompetitions(client) {
    const target = getThisSunday23UTC();
    const targetMs = target.getTime();

    const res = await womApi.get(`/groups/${config.clanId}/competitions`, { params: { limit: 20 } });
    const all = res.data || [];
    const matches = all.filter(c =>
        typeof c.title === 'string' &&
        c.title.startsWith('SoK') &&
        new Date(c.startsAt).getTime() === targetMs
    );

    const skipped = [];
    const errors = [];

    if (matches.length === 0) {
        return { posted: [], skipped, errors };
    }

    const active = await eventsDb.getActiveCompetitionEvents();
    const activeByWomId = new Map(active.map(e => [e.wom_competition_id, e]));

    const toPost = [];
    for (const comp of matches) {
        const existing = activeByWomId.get(comp.id);
        if (existing) {
            const stillThere = await isMessageAlive(client, existing.channel_id, existing.message_id);
            if (stillThere) {
                skipped.push(comp.id);
                continue;
            }
            try {
                await eventsDb.markEventDeleted(existing.id);
            } catch (err) {
                console.error(`[SoK] Failed to mark stale event ${existing.id} as deleted:`, err);
            }
        }
        toPost.push(comp);
    }

    if (toPost.length === 0) {
        return { posted: [], skipped, errors };
    }

    const placeRewards = await hybridConfig.getConfigGroup(
        'sok_place_rewards',
        config.pointsAward || [50, 30, 20]
    );

    const channel = client.channels.cache.get(config.SOK_EVENTS_CHANNEL_ID);
    if (!channel) throw new Error('SOK_EVENTS_CHANNEL_ID channel not found in cache');

    const details = [];
    for (const comp of toPost) {
        try {
            const r = await womApi.get(`/competitions/${comp.id}`);
            details.push(r.data);
        } catch (err) {
            console.error(`[SoK] WOM detail fetch failed for #${comp.id}:`, err.message);
            errors.push({ id: comp.id, message: err.message });
        }
    }

    if (details.length === 0) {
        return { posted: [], skipped, errors };
    }

    const sorted = sortSkillFirst(details);
    const vpEmoji = config.VP_EMOJI_ID ? `<:vp:${config.VP_EMOJI_ID}>` : '🪙';
    const endsAtMs = Math.min(...sorted.map(d => new Date(d.endsAt).getTime()).filter(n => Number.isFinite(n)));
    const endsTs = Number.isFinite(endsAtMs) ? Math.floor(endsAtMs / 1000) : null;

    const metaParts = [`🥇 ${placeRewards[0]} ${vpEmoji} • 🥈 ${placeRewards[1]} ${vpEmoji} • 🥉 ${placeRewards[2]} ${vpEmoji}`];
    if (endsTs) metaParts.push(`Ends <t:${endsTs}:R>`);

    const embed = new EmbedBuilder()
        .setColor('Blue')
        .setTitle(buildSokWeekTitle(sorted))
        .setDescription(metaParts.join('  •  '))
        .addFields(...buildSokLeaderboardFields(sorted))
        .setFooter({ text: `WOM ${sorted.map(d => '#' + d.id).join(', ')}` })
        .setTimestamp();

    let message;
    try {
        message = await channel.send({ embeds: [embed] });
    } catch (err) {
        console.error('[SoK] Failed to send combined embed:', err);
        for (const d of sorted) errors.push({ id: d.id, message: err.message });
        return { posted: [], skipped, errors };
    }

    const posted = [];
    for (const detail of sorted) {
        try {
            const type = isSkillMetric(detail.metric) ? 'sotw' : 'botw';
            const endsAtIso = detail.endsAt ? new Date(detail.endsAt).toISOString() : null;
            await eventsDb.createEvent({
                type,
                title: detail.title,
                vp_reward: 0,
                place_rewards: placeRewards,
                wom_competition_id: detail.id,
                message_id: message.id,
                channel_id: channel.id,
                ends_at: endsAtIso,
            });
            posted.push({ id: detail.id, title: detail.title, messageUrl: message.url });
        } catch (err) {
            console.error(`[SoK] Failed to persist event row for #${detail.id}:`, err);
            errors.push({ id: detail.id, message: err.message });
        }
    }

    return { posted, skipped, errors };
}

module.exports = {
    postWeeklySokCompetitions,
    getThisSunday23UTC,
    buildSokLeaderboardFields,
};
