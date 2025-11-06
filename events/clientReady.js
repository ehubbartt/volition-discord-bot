const { Events } = require('discord.js');
const config = require('../config.json');

module.exports = {
	name: Events.ClientReady,
	once: true,

	execute(client) {
		console.log(`Logged in as ${client.user.tag}.`);

		// Confirm WOM Message Listener is active
		const WOM_BOT_ID = process.env.WOM_BOT_ID || config.WISE_OLD_MAN_BOT_ID;
		const WOM_CHANNEL_ID = process.env.WOM_NOTIFICATION_CHANNEL_ID || config.WISE_OLD_MAN_CHANNEL_ID;

		console.log('\n✅ WOM Message Listener active');
		console.log(`🔍 Listening for WOM Bot (ID: ${WOM_BOT_ID})`);
		if (WOM_CHANNEL_ID) {
			console.log(`📺 Monitoring channel: ${WOM_CHANNEL_ID}`);
		} else {
			console.log(`📺 Monitoring all channels`);
		}
	},
};