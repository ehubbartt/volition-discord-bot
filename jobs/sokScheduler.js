// Posts the new week's Skill or Kill (SoK) competitions to EVENTS_CHANNEL_ID
// every Sunday at 23:00 UTC. The 15-min updater in jobs/eventLifecycle.js
// keeps the leaderboards fresh; runLifecycleCheck closes them when ends_at fires.
//
// Note: VP payout on close is still manual via /event end <id> — see plan.

const { EmbedBuilder } = require('discord.js');
const eventsDb = require('../db/events');
const { womApi } = require('../utils/api');
const config = require('../utils/config');
const hybridConfig = require('../utils/hybridConfig');
const {
    buildLeaderboardText,
    getMetricImageUrl,
    isSkillMetric,
} = require('../commands/admin/event');

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

    const active = await eventsDb.getActiveCompetitionEvents();
    const activeWomIds = new Set(active.map(e => e.wom_competition_id));

    const placeRewards = await hybridConfig.getConfigGroup(
        'sok_place_rewards',
        config.pointsAward || [50, 30, 20]
    );

    const channel = client.channels.cache.get(config.SOK_EVENTS_CHANNEL_ID);
    if (!channel) throw new Error('SOK_EVENTS_CHANNEL_ID channel not found in cache');

    const posted = [];
    const skipped = [];
    const errors = [];

    for (const comp of matches) {
        if (activeWomIds.has(comp.id)) {
            skipped.push(comp.id);
            continue;
        }

        try {
            const detail = await womApi.get(`/competitions/${comp.id}`);
            const competitionData = detail.data;

            const type = isSkillMetric(comp.metric) ? 'sotw' : 'botw';
            const typeLabel = type === 'sotw' ? 'Skill of the Week' : 'Boss of the Week';
            const typeEmoji = type === 'sotw' ? '⭐' : '⚔️';
            const vpEmoji = config.VP_EMOJI_ID ? `<:vp:${config.VP_EMOJI_ID}>` : '🪙';
            const metricImage = await getMetricImageUrl(comp.metric);
            const endsAt = comp.endsAt ? new Date(comp.endsAt) : null;
            const endsTs = endsAt ? Math.floor(endsAt.getTime() / 1000) : null;

            const embed = new EmbedBuilder()
                .setColor(type === 'sotw' ? 'Gold' : 'Red')
                .setTitle(`${typeEmoji} ${comp.title}`)
                .setDescription(`**${typeLabel}**\nTracked via [WiseOldMan Competition](https://wiseoldman.net/competitions/${comp.id})`)
                .setThumbnail(metricImage || config.CLAN_ICON_URL)
                .addFields({
                    name: 'Prizes',
                    value: `🥇 1st: ${placeRewards[0]} ${vpEmoji} VP\n🥈 2nd: ${placeRewards[1]} ${vpEmoji} VP\n🥉 3rd: ${placeRewards[2]} ${vpEmoji} VP`,
                    inline: true,
                })
                .setFooter({ text: `WOM Competition #${comp.id} • Updates every 15 min` })
                .setTimestamp();

            if (endsTs) {
                embed.addFields({ name: 'Ends', value: `<t:${endsTs}:F> (<t:${endsTs}:R>)`, inline: true });
            }

            embed.addFields({
                name: 'Leaderboard',
                value: buildLeaderboardText(competitionData) || 'No participants yet.',
                inline: false,
            });

            const message = await channel.send({ embeds: [embed] });

            await eventsDb.createEvent({
                type,
                title: comp.title,
                vp_reward: 0,
                place_rewards: placeRewards,
                wom_competition_id: comp.id,
                message_id: message.id,
                channel_id: channel.id,
                ends_at: endsAt ? endsAt.toISOString() : null,
            });

            posted.push({ id: comp.id, title: comp.title, messageUrl: message.url });
        } catch (err) {
            console.error(`[SoK] Failed to post competition ${comp.id}:`, err);
            errors.push({ id: comp.id, message: err.message });
        }
    }

    return { posted, skipped, errors };
}

module.exports = { postWeeklySokCompetitions, getThisSunday23UTC };
