const { Events, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const config = require('../config.json');

module.exports = {
    name: Events.MessageReactionAdd,
    
    async execute(reaction, user) {
        if (user.bot) return;

        try {
            if (reaction.partial) await reaction.fetch();
            if (reaction.message?.partial) await reaction.message.fetch();
            if (reaction.users?.partial) await reaction.users.fetch();
        } catch (e) {
            console.warn('Could not fetch partial reaction/message:', e?.message || e);
            return;
        }

        const weeklyTaskChannelId = config.WEEKLY_CHALLENGE_SUBMISSION_CHANNEL_ID;
        const wordleChannelId = config.DAILY_CHALLENGE_SUBMISSION_CHANNEL_ID;

        if (!reaction.message || !reaction.message.channel) return;

        const channelId = reaction.message.channel.id;
        const emojiMatch = reaction.emoji.name === '✅';



        // Determine points reward
        let pointsAwarded = 0;

        if (channelId === weeklyTaskChannelId && emojiMatch) {
            pointsAwarded = config.POINTS_FOR_CHALLENGE || 5;
        } else if (channelId === wordleChannelId && emojiMatch) {
            pointsAwarded = 1;
        } else {
            return;
        }

        const discordId = reaction.message.author.id;

        try {
            const COLUMN_RSN = config.COLUMN_RSN;
            const COLUMN_DISCORD_ID = config.COLUMN_DISCORD_ID;
            const SHEETDB_API_URL = config.POINTS_SHEETDB_API_URL;
            const SYNC_SHEETDB_API_URL = config.SYNC_SHEETDB_API_URL;

            // Find RSN by Discord ID
            const syncResponse = await axios.get(`${SYNC_SHEETDB_API_URL}/search?${COLUMN_DISCORD_ID}=${discordId}`);
            if (syncResponse.data.length === 0) return;

            const rsn = syncResponse.data[0][COLUMN_RSN];
            console.log(`Found RSN: ${rsn} for Discord ID: ${discordId}`);

            // Admin check
            const guild = reaction.message.guild;
            if (user.id !== config.ADMIN_ROLE_IDS[0]) {
                console.log(`${user.tag} is not allowed to award points.`);
                return;
            }
            console.log(`${user.tag} is allowed to award points.`);

            // Fetch current points
            const searchResponse = await axios.get(`${SHEETDB_API_URL}/search?${COLUMN_RSN}=${rsn}`);
            if (searchResponse.data.length > 0) {
                const existingPoints = parseInt(searchResponse.data[0][config.COLUMN_POINTS], 10) || 0;
                const newTotalPoints = existingPoints + pointsAwarded;

                // Update points
                console.log(`Updating points for ${rsn}: ${existingPoints} → ${newTotalPoints}`);
                try {
                    await axios.put(`${SHEETDB_API_URL}/${COLUMN_RSN}/${rsn}`, {
                        data: { [COLUMN_RSN]: rsn, [config.COLUMN_POINTS]: newTotalPoints }
                    });
                } catch (err) {
                    console.error('Failed to update points:', err?.response?.data || err);
                }

                // Announce in #payouts
                const logChannel = guild.channels.cache.get(config.PAYOUT_LOG_CHANNEL_ID);
                if (logChannel) {
                    const embed = new EmbedBuilder()
                        .setColor(0xFFFFFF)
                        .setTitle('Volition Points Awarded')
                        .setDescription(
                            `Awarded **${pointsAwarded} points** to **${rsn}**.\n` +
                            `New total: **${newTotalPoints}**.\nAwarded by: <@${user.id}>`
                        );
                    logChannel.send({ embeds: [embed] });
                }
            } else {
                console.log(`RSN not found in points spreadsheet: ${rsn}`);
            }
        } catch (error) {
            console.error('Error interacting with SheetDB/Discord API:', error.message);
            if (error.response) console.error('Response:', error.response.data);
        }
    }
};
