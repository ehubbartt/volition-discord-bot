/**
 * Site → Bot Webhook Bridge
 *
 * The Volition site (volition-site) can't assign Discord roles directly. When a
 * player rolls something that needs a Discord-side action (e.g. the ultra-rare
 * "King Gamba" role from a gamba crate), the site POSTs a structured message to a
 * webhook pointing at a private staff-only bridge channel. This module consumes
 * those messages and performs the requested action.
 *
 * Trust model: we ONLY act on messages that are (a) in BRIDGE_CHANNEL_ID and
 * (b) posted by BRIDGE_WEBHOOK_ID. The webhook id is the security boundary — a
 * normal user (whose messages have webhookId === null) can never forge a request.
 *
 * Message contract (set by the site's src/lib/server/botBridge.ts):
 *   - message.content holds the authoritative payload as JSON inside a ```json
 *     fenced code block.
 *   - message.embeds[0].fields carries the same data as a human-readable audit
 *     copy, used as a fallback if the fenced JSON fails to parse.
 *
 * Add new bridge actions by adding an entry to the `typeHandlers` map below.
 */

const config = require('../config.json');

const SUCCESS_EMOJI = '✅';
const FAILURE_EMOJI = '❌';

// Resolved at call time (not module load) so dotenv ordering and tests both work.
// The bridge reuses the existing bot test channel by default; only the webhook id
// (the public middle segment of the site's webhook URL — NOT the secret token) is
// required, and it comes from the BRIDGE_WEBHOOK_ID env var / Fly secret.
function getBridgeIds () {
    return {
        channelId: process.env.BRIDGE_CHANNEL_ID || config.BRIDGE_CHANNEL_ID || config.TEST_CHANNEL_ID || null,
        webhookId: process.env.BRIDGE_WEBHOOK_ID || config.BRIDGE_WEBHOOK_ID || null,
    };
}

/**
 * Extract the bridge payload. Prefers the authoritative JSON inside the ```json
 * fence in message.content; falls back to reconstructing it from the embed's
 * name→value fields. Returns null if neither source yields anything.
 */
function parsePayload (message) {
    const match = message.content?.match(/```json\s*([\s\S]*?)```/);
    if (match) {
        try {
            return JSON.parse(match[1].trim());
        } catch {
            // Malformed fenced JSON — fall through to the embed audit copy.
        }
    }

    const fields = message.embeds?.[0]?.fields;
    if (fields?.length) {
        return Object.fromEntries(fields.map(f => [f.name, f.value]));
    }

    return null;
}

/**
 * Action handlers keyed by payload.type. Each throws on any failure (unknown
 * member, invalid role, missing permission / hierarchy) so the caller can react
 * ❌ and log. Return a short string describing what was done (for logging).
 */
const typeHandlers = {
    async grant_role (payload, message) {
        if (!payload.discord_id || !payload.role_id) {
            throw new Error('missing discord_id or role_id');
        }
        const member = await message.guild.members.fetch(payload.discord_id);
        await member.roles.add(payload.role_id, payload.reason ?? 'site bridge');
        return `granted role ${payload.role_id} to ${member.user.tag} (${payload.discord_id})`;
    },
};

/**
 * Trust filter: is this a genuine bridge message we should act on?
 * Both the channel and the webhook id must match. If the bridge isn't configured
 * yet (ids missing), we treat nothing as a bridge message — a safe no-op.
 */
function isBridgeMessage (message) {
    const { channelId, webhookId } = getBridgeIds();
    if (!channelId || !webhookId) return false;
    if (message.channelId !== channelId) return false;
    if (message.webhookId !== webhookId) return false; // the trust boundary
    return true;
}

// Idempotency: a message we've already completed carries our ✅ reaction. This
// prevents the startup backfill (or a duplicate gateway delivery) from re-acting.
function alreadyHandled (message) {
    return message.reactions.cache.some(r => r.me && r.emoji.name === SUCCESS_EMOJI);
}

/**
 * Core entry point — run a single message through the bridge. Safe to call on
 * ANY message; it filters internally. Never throws (failures react ❌ + log).
 */
async function processBridgeMessage (message) {
    if (!isBridgeMessage(message)) return;
    if (alreadyHandled(message)) return;

    const payload = parsePayload(message);
    try {
        if (!payload?.type) throw new Error('payload missing or has no type');

        const handler = typeHandlers[payload.type];
        if (!handler) throw new Error(`unknown bridge type: ${payload.type}`);

        const result = await handler(payload, message);
        console.log(`[bridge] ✅ ${payload.type} — ${result}`);
        await message.react(SUCCESS_EMOJI);
    } catch (err) {
        console.error('[bridge] ❌ failed:', err.message, payload);
        await message.react(FAILURE_EMOJI).catch(() => {});
    }
}

/**
 * Startup backfill. Webhook delivery is realtime, so any bridge message that
 * arrives while the bot is offline is missed. On ready we replay the last ~50
 * messages of the bridge channel; idempotency (the ✅ check) makes this safe to
 * run on every restart without double-granting.
 */
async function runBridgeBackfill (client) {
    const { channelId, webhookId } = getBridgeIds();
    if (!channelId || !webhookId) {
        console.log('[bridge] backfill skipped — BRIDGE_CHANNEL_ID / BRIDGE_WEBHOOK_ID not configured');
        return;
    }

    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel?.isTextBased()) {
            console.log('[bridge] backfill skipped — bridge channel not found or not text-based');
            return;
        }

        const messages = await channel.messages.fetch({ limit: 50 });
        const pending = [...messages.values()]
            .filter(m => m.webhookId === webhookId)
            .reverse(); // process oldest → newest

        for (const message of pending) {
            await processBridgeMessage(message);
        }

        console.log(`[bridge] backfill complete — checked ${pending.length} webhook message(s)`);
    } catch (err) {
        console.error('[bridge] backfill error:', err.message);
    }
}

module.exports = {
    processBridgeMessage,
    runBridgeBackfill,
    parsePayload,
    typeHandlers,
};
