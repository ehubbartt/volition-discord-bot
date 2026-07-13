// Keep Discord in sync with the site's running events (vs_events, status='open').
// Every cycle it:
//   • posts a describe-and-link embed for any open site event that doesn't have one
//     yet (pinging the events role ONCE per event, ever), refreshes it when the event
//     is edited, and reopens the original embed in place if it was ended by mistake,
//   • marks the announcement ENDED when its event is no longer 'open' — but only
//     after re-checking that specific event in the DB, never on a failed query.
// Unlike tasks there is NO submission thread — players submit on the site; the embed
// just links there. ensureEventAnnounce() is idempotent so re-running is cheap.
//
// Safety model (added after an incident where a transient DB error emptied the "open"
// list, the close-sweep ENDED every announcement, and the next cycle re-posted them
// all, re-pinging the events role each time):
//   1. Manual toggle — features.events.siteEventAnnouncements in bot_config (editable
//      live from the site's /admin/config; ~60s to take effect). Checked every cycle.
//   2. Error ≠ empty — a failed listActiveSiteEvents() skips the WHOLE cycle.
//   3. Verified closes — each close candidate is re-fetched by id first; an
//      announcement is only ended when the DB confirms its event is not open.
//   4. Circuit breaker — more than MAX_CREATES or MAX_CLOSES mutations in one cycle
//      aborts the cycle, flips the toggle OFF in bot_config (so it stays off until an
//      admin re-enables it), and posts a no-ping alert to the staff test channel.

const siteSubs = require('../db/siteSubmissions');
const eventsDb = require('../db/events');
const hybridConfig = require('../utils/hybridConfig');
const config = require('../utils/config');
const { EmbedBuilder } = require('discord.js');
const { ensureEventAnnounce, closeEventAnnounce } = require('../handlers/eventAnnounce');

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const TOGGLE_KEY = 'siteEventAnnouncements'; // features.events.siteEventAnnouncements

// Per-cycle mutation caps. The clan rarely runs more than 2-3 site events at once, so
// exceeding these in a single 5-minute cycle means something upstream is wrong (query
// flapping, duplicate bot instances, bad data) — stop and ask a human instead of
// spamming the events channel. Creates counts fresh posts + reopens; refreshes are
// silent edits and don't count.
const MAX_CREATES_PER_CYCLE = 5;
const MAX_CLOSES_PER_CYCLE = 3;

let pollInterval = null;

// Trip the breaker: persist the toggle OFF in bot_config (visible — and re-enablable —
// in the site's /admin/config) and alert staff. Never pings anyone.
async function tripBreaker(client, reason, details) {
    console.error(`[EventAnnounce] CIRCUIT BREAKER TRIPPED: ${reason}`);
    try {
        await hybridConfig.updateConfig(`events.${TOGGLE_KEY}`, false, `circuit breaker: ${reason}`);
    } catch (err) {
        console.error('[EventAnnounce] breaker failed to disable toggle:', err.message);
    }
    try {
        const ch =
            client.channels.cache.get(config.TEST_CHANNEL_ID) ||
            (await client.channels.fetch(config.TEST_CHANNEL_ID).catch(() => null));
        if (ch) {
            const embed = new EmbedBuilder()
                .setColor('Red')
                .setTitle('⚠️ Event announcements auto-disabled')
                .setDescription(
                    `The site-event announce poller hit its safety limit and shut itself off.\n\n` +
                    `**Reason:** ${reason}\n${details ? `${details}\n` : ''}\n` +
                    `No further announcements will be posted or ended until an admin re-enables ` +
                    `**Features → events → ${TOGGLE_KEY}** on the site's /admin/config page.`
                )
                .setTimestamp();
            await ch.send({ embeds: [embed] });
        }
    } catch (err) {
        console.error('[EventAnnounce] breaker alert failed:', err.message);
    }
}

async function runOnce(client) {
    // Manual kill switch, editable live from /admin/config (60s config cache).
    if (!(await hybridConfig.isEventEnabled(TOGGLE_KEY))) {
        console.log('[EventAnnounce] disabled via bot_config toggle — skipping cycle');
        return;
    }

    // Error ≠ "no open events". On a failed fetch skip the whole cycle — running the
    // close-sweep against an empty set is what mass-ended announcements before.
    const open = await siteSubs.listActiveSiteEvents();
    if (open === null) {
        console.warn('[EventAnnounce] active-events fetch failed — skipping cycle');
        return;
    }
    const openIds = new Set(open.map((e) => e.id));

    let creates = 0;
    for (const ev of open) {
        try {
            const r = await ensureEventAnnounce(client, ev);
            if (r?.created || r?.reopened) creates += 1;
            if (r?.created) console.log(`[EventAnnounce] posted embed for "${ev.name}"`);
            else if (r?.reopened) console.log(`[EventAnnounce] reopened embed for "${ev.name}"`);
            else if (r?.refreshed) console.log(`[EventAnnounce] refreshed "${ev.name}"`);
            else if (r?.error) console.warn(`[EventAnnounce] "${ev.name}": ${r.error}`);
            if (creates > MAX_CREATES_PER_CYCLE) {
                await tripBreaker(client, `more than ${MAX_CREATES_PER_CYCLE} announcements posted/reopened in one cycle`,
                    `Open events this cycle: ${open.map((e) => e.name).join(', ')}`);
                return;
            }
        } catch (err) {
            console.error(`[EventAnnounce] "${ev.name}" error: ${err.message}`);
        }
    }

    // Close announcements whose site event is no longer open. Each candidate is
    // re-verified against the DB by id — a row missing from the list could be a query
    // hiccup, and ending an announcement wrongly means a duplicate post later.
    try {
        const active = await eventsDb.getActiveEvents();
        let closes = 0;
        for (const row of active) {
            if (row.type !== 'site_event' || !row.vs_event_id) continue;
            if (openIds.has(row.vs_event_id)) continue;

            const check = await siteSubs.getSiteEventById(row.vs_event_id);
            if (check.error) {
                console.warn(`[EventAnnounce] skipping close of "${row.title}" — verify failed: ${check.error}`);
                continue;
            }
            const evRow = check.row;
            // An unlisted event (e.g. the permanent Dink self-test) counts as "not open"
            // for announce purposes even while its row is open — otherwise an existing
            // announcement for it could never be closed (the list excludes unlisted, so
            // this recheck would report "still open / list was stale" every cycle).
            const stillOpen =
                evRow &&
                evRow.status === 'open' &&
                evRow.unlisted !== true &&
                (!evRow.ends_at || new Date(evRow.ends_at).getTime() > Date.now());
            if (stillOpen) {
                console.warn(`[EventAnnounce] NOT closing "${row.title}" — event is still open (list was stale)`);
                continue;
            }

            closes += 1;
            if (closes > MAX_CLOSES_PER_CYCLE) {
                await tripBreaker(client, `more than ${MAX_CLOSES_PER_CYCLE} announcements ended in one cycle`,
                    `Last close candidate: "${row.title}"`);
                return;
            }
            console.log(`[EventAnnounce] closing ended announcement "${row.title}"`);
            await closeEventAnnounce(client, row);
        }
    } catch (err) {
        console.error(`[EventAnnounce] close sweep error: ${err.message}`);
    }
}

function startEventAnnouncePoller(client) {
    console.log('[EventAnnounce] Starting (every 5m)');
    runOnce(client).catch((err) => console.error('[EventAnnounce] startup run error:', err.message));
    pollInterval = setInterval(() => {
        runOnce(client).catch((err) => console.error('[EventAnnounce] poll error:', err.message));
    }, POLL_INTERVAL_MS);
}

module.exports = { startEventAnnouncePoller, runOnce, MAX_CREATES_PER_CYCLE, MAX_CLOSES_PER_CYCLE };
