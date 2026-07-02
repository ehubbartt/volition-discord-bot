/**
 * Event Announce Poller Test Suite
 * Covers the safety model added after the announce-churn incident: the manual
 * bot_config toggle, error-vs-empty handling on the active-events fetch, per-close
 * DB re-verification, and the circuit breaker (auto-disable + staff alert).
 */

jest.mock('../../db/siteSubmissions', () => ({
    listActiveSiteEvents: jest.fn(),
    getSiteEventById: jest.fn(),
}));
jest.mock('../../db/events', () => ({
    getActiveEvents: jest.fn(),
}));
jest.mock('../../handlers/eventAnnounce', () => ({
    ensureEventAnnounce: jest.fn(),
    closeEventAnnounce: jest.fn(),
}));
jest.mock('../../utils/hybridConfig', () => ({
    isEventEnabled: jest.fn(),
    updateConfig: jest.fn(),
}));
jest.mock('../../utils/config', () => ({
    TEST_CHANNEL_ID: 'test-channel-1',
}));

const siteSubs = require('../../db/siteSubmissions');
const eventsDb = require('../../db/events');
const hybridConfig = require('../../utils/hybridConfig');
const { ensureEventAnnounce, closeEventAnnounce } = require('../../handlers/eventAnnounce');
const { runOnce, MAX_CREATES_PER_CYCLE, MAX_CLOSES_PER_CYCLE } = require('../../jobs/eventAnnouncePoller');

function makeClient() {
    const send = jest.fn().mockResolvedValue({});
    return {
        channels: {
            cache: { get: jest.fn().mockReturnValue({ send }) },
            fetch: jest.fn().mockResolvedValue({ send }),
        },
        _alertSend: send,
    };
}

const siteEvent = (id, name = `Event ${id}`) => ({ id, name, kind: 'bingo', status: 'open' });
const botRow = (vsEventId, title = `Row ${vsEventId}`) => ({
    id: `bot-${vsEventId}`,
    type: 'site_event',
    vs_event_id: vsEventId,
    title,
});

describe('eventAnnouncePoller.runOnce', () => {
    let client;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        client = makeClient();
        hybridConfig.isEventEnabled.mockResolvedValue(true);
        hybridConfig.updateConfig.mockResolvedValue({ success: true });
        ensureEventAnnounce.mockResolvedValue({});
        closeEventAnnounce.mockResolvedValue(undefined);
        eventsDb.getActiveEvents.mockResolvedValue([]);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('does nothing when the bot_config toggle is off', async () => {
        hybridConfig.isEventEnabled.mockResolvedValue(false);
        await runOnce(client);
        expect(siteSubs.listActiveSiteEvents).not.toHaveBeenCalled();
        expect(eventsDb.getActiveEvents).not.toHaveBeenCalled();
    });

    it('skips the entire cycle (no announces, no close-sweep) when the fetch errors', async () => {
        siteSubs.listActiveSiteEvents.mockResolvedValue(null);
        await runOnce(client);
        expect(ensureEventAnnounce).not.toHaveBeenCalled();
        expect(eventsDb.getActiveEvents).not.toHaveBeenCalled();
        expect(closeEventAnnounce).not.toHaveBeenCalled();
    });

    it('announces open events and closes rows whose event is confirmed not open', async () => {
        siteSubs.listActiveSiteEvents.mockResolvedValue([siteEvent('a')]);
        eventsDb.getActiveEvents.mockResolvedValue([botRow('a'), botRow('b')]);
        siteSubs.getSiteEventById.mockResolvedValue({ row: { id: 'b', status: 'closed', ends_at: null } });

        await runOnce(client);

        expect(ensureEventAnnounce).toHaveBeenCalledTimes(1);
        expect(ensureEventAnnounce).toHaveBeenCalledWith(client, expect.objectContaining({ id: 'a' }));
        // Row "a" is still open → untouched; row "b" re-verified then closed.
        expect(siteSubs.getSiteEventById).toHaveBeenCalledTimes(1);
        expect(siteSubs.getSiteEventById).toHaveBeenCalledWith('b');
        expect(closeEventAnnounce).toHaveBeenCalledTimes(1);
        expect(closeEventAnnounce).toHaveBeenCalledWith(client, expect.objectContaining({ vs_event_id: 'b' }));
    });

    it('never closes when the re-verify query fails', async () => {
        siteSubs.listActiveSiteEvents.mockResolvedValue([]);
        eventsDb.getActiveEvents.mockResolvedValue([botRow('b')]);
        siteSubs.getSiteEventById.mockResolvedValue({ error: 'timeout' });

        await runOnce(client);

        expect(closeEventAnnounce).not.toHaveBeenCalled();
    });

    it('never closes when the re-verify shows the event is still open (stale list)', async () => {
        siteSubs.listActiveSiteEvents.mockResolvedValue([]);
        eventsDb.getActiveEvents.mockResolvedValue([botRow('b')]);
        siteSubs.getSiteEventById.mockResolvedValue({ row: { id: 'b', status: 'open', ends_at: null } });

        await runOnce(client);

        expect(closeEventAnnounce).not.toHaveBeenCalled();
    });

    it('closes an announcement whose event row was deleted outright', async () => {
        siteSubs.listActiveSiteEvents.mockResolvedValue([]);
        eventsDb.getActiveEvents.mockResolvedValue([botRow('gone')]);
        siteSubs.getSiteEventById.mockResolvedValue({ row: null });

        await runOnce(client);

        expect(closeEventAnnounce).toHaveBeenCalledTimes(1);
    });

    it('trips the breaker instead of exceeding the per-cycle close cap', async () => {
        const rows = Array.from({ length: MAX_CLOSES_PER_CYCLE + 2 }, (_, i) => botRow(`e${i}`));
        siteSubs.listActiveSiteEvents.mockResolvedValue([]);
        eventsDb.getActiveEvents.mockResolvedValue(rows);
        siteSubs.getSiteEventById.mockResolvedValue({ row: { status: 'closed', ends_at: null } });

        await runOnce(client);

        // The cap-th close is allowed; the next candidate trips the breaker BEFORE closing.
        expect(closeEventAnnounce).toHaveBeenCalledTimes(MAX_CLOSES_PER_CYCLE);
        expect(hybridConfig.updateConfig).toHaveBeenCalledWith(
            'events.siteEventAnnouncements',
            false,
            expect.stringContaining('circuit breaker')
        );
        expect(client._alertSend).toHaveBeenCalledTimes(1);
        const alert = client._alertSend.mock.calls[0][0];
        expect(alert.content).toBeUndefined(); // staff alert never pings anyone
    });

    it('trips the breaker when a cycle posts/reopens too many announcements', async () => {
        const events = Array.from({ length: MAX_CREATES_PER_CYCLE + 3 }, (_, i) => siteEvent(`e${i}`));
        siteSubs.listActiveSiteEvents.mockResolvedValue(events);
        ensureEventAnnounce.mockResolvedValue({ created: true });

        await runOnce(client);

        // Breaker fires on the create AFTER the cap and aborts the rest of the cycle.
        expect(ensureEventAnnounce).toHaveBeenCalledTimes(MAX_CREATES_PER_CYCLE + 1);
        expect(hybridConfig.updateConfig).toHaveBeenCalledWith(
            'events.siteEventAnnouncements',
            false,
            expect.stringContaining('circuit breaker')
        );
        expect(eventsDb.getActiveEvents).not.toHaveBeenCalled();
    });

    it('refreshes do not count toward the create cap', async () => {
        const events = Array.from({ length: MAX_CREATES_PER_CYCLE + 3 }, (_, i) => siteEvent(`e${i}`));
        siteSubs.listActiveSiteEvents.mockResolvedValue(events);
        ensureEventAnnounce.mockResolvedValue({ refreshed: true });

        await runOnce(client);

        expect(ensureEventAnnounce).toHaveBeenCalledTimes(events.length);
        expect(hybridConfig.updateConfig).not.toHaveBeenCalled();
    });
});
