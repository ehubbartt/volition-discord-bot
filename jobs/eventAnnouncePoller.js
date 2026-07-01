// Keep Discord in sync with the site's running events (vs_events, status='open').
// Every cycle it:
//   • posts a describe-and-link embed for any open site event that doesn't have one
//     yet (pinging the events role once), and refreshes it when the event is edited,
//   • marks the announcement ENDED when its event is no longer 'open'.
// Unlike tasks there is NO submission thread — players submit on the site; the embed
// just links there. ensureEventAnnounce() is idempotent so re-running is cheap.

const siteSubs = require('../db/siteSubmissions');
const eventsDb = require('../db/events');
const { ensureEventAnnounce, closeEventAnnounce } = require('../handlers/eventAnnounce');

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// KILL SWITCH: site-event announcement forwarding is temporarily disabled while a
// close/re-open churn bug is investigated. While true the poller does NOTHING — it
// posts nothing, refreshes nothing, and (critically) closes nothing, so existing
// announcements are left exactly as-is. Flip back to false to re-enable forwarding.
const FORWARDING_DISABLED = true;

let pollInterval = null;

async function runOnce(client) {
    if (FORWARDING_DISABLED) return;
    const open = await siteSubs.listActiveSiteEvents();
    const openIds = new Set(open.map((e) => e.id));

    for (const ev of open) {
        try {
            const r = await ensureEventAnnounce(client, ev);
            if (r?.created) console.log(`[EventAnnounce] posted embed for "${ev.name}"`);
            else if (r?.refreshed) console.log(`[EventAnnounce] refreshed "${ev.name}"`);
            else if (r?.error) console.warn(`[EventAnnounce] "${ev.name}": ${r.error}`);
        } catch (err) {
            console.error(`[EventAnnounce] "${ev.name}" error: ${err.message}`);
        }
    }

    // Close announcements whose site event is no longer open (and isn't being
    // auto-closed by its deadline via eventLifecycle).
    try {
        const active = await eventsDb.getActiveEvents();
        for (const row of active) {
            if (row.type !== 'site_event' || !row.vs_event_id) continue;
            if (openIds.has(row.vs_event_id)) continue;
            console.log(`[EventAnnounce] closing ended announcement "${row.title}"`);
            await closeEventAnnounce(client, row);
        }
    } catch (err) {
        console.error(`[EventAnnounce] close sweep error: ${err.message}`);
    }
}

function startEventAnnouncePoller(client) {
    if (FORWARDING_DISABLED) {
        console.log('[EventAnnounce] DISABLED (forwarding kill switch on) — not starting poller');
        return;
    }
    console.log('[EventAnnounce] Starting (every 5m)');
    runOnce(client).catch((err) => console.error('[EventAnnounce] startup run error:', err.message));
    pollInterval = setInterval(() => {
        runOnce(client).catch((err) => console.error('[EventAnnounce] poll error:', err.message));
    }, POLL_INTERVAL_MS);
}

module.exports = { startEventAnnouncePoller, runOnce };
