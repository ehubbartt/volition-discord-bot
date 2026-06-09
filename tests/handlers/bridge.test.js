/**
 * Site → Bot Bridge Handler Test Suite
 * Covers payload parsing, the webhook trust boundary, type dispatch,
 * idempotency, and graceful failure handling.
 */

const BRIDGE_CHANNEL_ID = 'bridge-channel-123';
const BRIDGE_WEBHOOK_ID = 'bridge-webhook-456';

process.env.BRIDGE_CHANNEL_ID = BRIDGE_CHANNEL_ID;
process.env.BRIDGE_WEBHOOK_ID = BRIDGE_WEBHOOK_ID;

const { processBridgeMessage, parsePayload } = require('../../handlers/bridge');

// Build a fenced ```json content block the way the site does.
function jsonBlock (obj) {
    return '```json\n' + JSON.stringify(obj) + '\n```';
}

// Minimal message double matching the discord.js surface the handler touches.
function makeMessage (overrides = {}) {
    const addRole = jest.fn().mockResolvedValue({});
    const fetchMember = jest.fn().mockResolvedValue({
        user: { tag: 'Target#0001' },
        roles: { add: addRole },
    });

    return {
        channelId: BRIDGE_CHANNEL_ID,
        webhookId: BRIDGE_WEBHOOK_ID,
        content: jsonBlock({
            type: 'grant_role',
            discord_id: '111',
            role_id: '222',
            reason: 'gamba crate',
        }),
        embeds: [],
        reactions: { cache: { some: () => false } },
        guild: { members: { fetch: fetchMember } },
        react: jest.fn().mockResolvedValue({}),
        _addRole: addRole,
        _fetchMember: fetchMember,
        ...overrides,
    };
}

describe('Bridge Handler', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('parsePayload', () => {
        it('parses the authoritative JSON from the fenced code block', () => {
            const message = { content: jsonBlock({ type: 'grant_role', role_id: '9' }), embeds: [] };
            expect(parsePayload(message)).toEqual({ type: 'grant_role', role_id: '9' });
        });

        it('falls back to embed fields when the fenced JSON is malformed', () => {
            const message = {
                content: '```json\n{ not valid json }\n```',
                embeds: [{ fields: [
                    { name: 'type', value: 'grant_role' },
                    { name: 'role_id', value: '222' },
                ] }],
            };
            expect(parsePayload(message)).toEqual({ type: 'grant_role', role_id: '222' });
        });

        it('returns null when there is no payload anywhere', () => {
            expect(parsePayload({ content: 'hello', embeds: [] })).toBeNull();
        });
    });

    describe('grant_role dispatch', () => {
        it('grants the role and reacts ✅ on success', async () => {
            const message = makeMessage();
            await processBridgeMessage(message);

            expect(message._fetchMember).toHaveBeenCalledWith('111');
            expect(message._addRole).toHaveBeenCalledWith('222', 'gamba crate');
            expect(message.react).toHaveBeenCalledWith('✅');
        });

        it('reacts ❌ when the member cannot be fetched', async () => {
            const message = makeMessage();
            message.guild.members.fetch = jest.fn().mockRejectedValue(new Error('Unknown Member'));

            await processBridgeMessage(message);

            expect(message.react).toHaveBeenCalledWith('❌');
            expect(message.react).not.toHaveBeenCalledWith('✅');
        });

        it('reacts ❌ when adding the role fails (invalid role / hierarchy)', async () => {
            const message = makeMessage();
            message._addRole.mockRejectedValue(new Error('Missing Permissions'));

            await processBridgeMessage(message);

            expect(message.react).toHaveBeenCalledWith('❌');
        });

        it('reacts ❌ on a payload missing required fields', async () => {
            const message = makeMessage({ content: jsonBlock({ type: 'grant_role' }) });
            await processBridgeMessage(message);
            expect(message._addRole).not.toHaveBeenCalled();
            expect(message.react).toHaveBeenCalledWith('❌');
        });

        it('reacts ❌ on an unknown type', async () => {
            const message = makeMessage({ content: jsonBlock({ type: 'launch_nukes' }) });
            await processBridgeMessage(message);
            expect(message.react).toHaveBeenCalledWith('❌');
        });
    });

    describe('trust boundary', () => {
        it('ignores messages from a different channel', async () => {
            const message = makeMessage({ channelId: 'some-other-channel' });
            await processBridgeMessage(message);
            expect(message.react).not.toHaveBeenCalled();
            expect(message._addRole).not.toHaveBeenCalled();
        });

        it('ignores non-webhook (forged) messages with identical content', async () => {
            const message = makeMessage({ webhookId: null });
            await processBridgeMessage(message);
            expect(message.react).not.toHaveBeenCalled();
            expect(message._addRole).not.toHaveBeenCalled();
        });

        it('ignores messages from a different webhook', async () => {
            const message = makeMessage({ webhookId: 'attacker-webhook' });
            await processBridgeMessage(message);
            expect(message.react).not.toHaveBeenCalled();
        });
    });

    describe('idempotency', () => {
        it('skips a message already carrying the bot ✅ reaction', async () => {
            const message = makeMessage({
                reactions: { cache: { some: pred => pred({ me: true, emoji: { name: '✅' } }) } },
            });
            await processBridgeMessage(message);
            expect(message._addRole).not.toHaveBeenCalled();
            expect(message.react).not.toHaveBeenCalled();
        });
    });
});
