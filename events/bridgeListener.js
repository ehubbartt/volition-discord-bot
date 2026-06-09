/**
 * Bridge message listener.
 *
 * Registers a second messageCreate handler (alongside womMessageListener.js) that
 * forwards every message to the site→bot bridge handler. The handler filters
 * internally to the configured bridge channel + webhook, so this is a cheap no-op
 * for all other messages.
 *
 * See handlers/bridge.js for the trust model, payload contract, and dispatch.
 */

const { Events } = require('discord.js');
const { processBridgeMessage } = require('../handlers/bridge');

module.exports = {
    name: Events.MessageCreate,
    async execute (message) {
        await processBridgeMessage(message);
    },
};
