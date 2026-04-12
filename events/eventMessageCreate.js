const { Events } = require('discord.js');
const { handleThreadMessage } = require('../handlers/eventSubmission');
const features = require('../utils/features');

module.exports = {
    name: Events.MessageCreate,

    async execute(message) {
        // Only handle messages in threads
        if (!message.channel.isThread()) return;
        if (message.author.bot) return;

        // Check if the event submission system is enabled
        if (!await features.isEventEnabled('eventSubmissions')) return;

        try {
            await handleThreadMessage(message);
        } catch (error) {
            console.error('[EventMessageCreate] Error handling thread message:', error);
        }
    }
};
