const { Events, EmbedBuilder } = require('discord.js');
const db = require('../db/supabase');
const config = require('../config.json');
const features = require('../utils/features');

module.exports = {
    name: Events.MessageReactionAdd,

    async execute(reaction, user) {
        if (user.bot) return;

        // Check if reaction award points system is enabled
        if (!await features.isEventEnabled('reactionAwardPoints')) {
            return;
        }

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
            const player = await db.getPlayerByDiscordId(discordId);
            if (!player) return;

            const rsn = player.rsn;
            console.log(`Found RSN: ${rsn} for Discord ID: ${discordId}`);

            const guild = reaction.message.guild;
            if (user.id !== config.ADMIN_ROLE_IDS[0]) {
                console.log(`${user.tag} is not allowed to award points.`);
                return;
            }
            console.log(`${user.tag} is allowed to award points.`);

            const existingPoints = player.player_points?.points || 0;
            const newTotalPoints = existingPoints + pointsAwarded;

            console.log(`Updating points for ${rsn}: ${existingPoints} → ${newTotalPoints}`);
            try {
                await db.addPoints(rsn, pointsAwarded);
            } catch (err) {
                console.error('Failed to update points:', err);
            }

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
        } catch (error) {
            console.error('Error awarding points:', error.message);
        }
    }
};
