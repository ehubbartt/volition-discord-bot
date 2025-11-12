const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../db/supabase');
const { isAdmin } = require('../../utils/permissions');
const config = require('../../utils/config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('adjustpoints')
        .setDescription('(Admin Only) Adjust VP points for players')
        .addStringOption(option =>
            option.setName('player')
                .setDescription("RSN or @mention (comma separated for multiple)")
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName('points')
                .setDescription('Positive or negative integers only.')
                .setRequired(true)
        ),

    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: false });

        const playerInput = interaction.options.getString('player');
        const pointsToAdd = interaction.options.getInteger('points');

        if (isNaN(pointsToAdd)) {
            return interaction.editReply({ content: 'Invalid points input. Please enter a valid number.' });
        }

        // Split by comma and trim
        const playerList = playerInput.split(',').map(p => p.trim()).filter(p => p.length > 0);

        let results = [];

        try {
            for (const playerEntry of playerList) {
                let player = null;
                let displayName = '';

                // Check if it's a Discord mention
                const mentionMatch = playerEntry.match(/^<@!?(\d+)>$/);

                if (mentionMatch) {
                    // It's a Discord mention
                    const userId = mentionMatch[1];
                    player = await db.getPlayerByDiscordId(userId);

                    if (!player) {
                        results.push(`<@${userId}>: Not found in the clan database.`);
                        continue;
                    }

                    displayName = `<@${userId}> (${player.rsn})`;
                } else {
                    // Treat as RSN
                    player = await db.getPlayerByRSN(playerEntry);
                    displayName = playerEntry;

                    if (!player) {
                        results.push(`**${playerEntry}**: Not found in the clan database.`);
                        continue;
                    }
                }

                // Adjust points
                const existingPoints = player.points || 0;
                const newTotalPoints = existingPoints + pointsToAdd;

                await db.addPoints(player.rsn, pointsToAdd);

                // Log to payout channel
                const logChannel = interaction.client.channels.cache.get(config.PAYOUT_LOG_CHANNEL_ID);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setColor(pointsToAdd < 0 ? 'Red' : 'Green')
                        .setTitle(pointsToAdd < 0 ? 'Points Removed' : 'Points Added')
                        .setDescription(
                            `**Player:** ${displayName}\n` +
                            `**Change:** ${pointsToAdd > 0 ? '+' : ''}${pointsToAdd} VP\n` +
                            `**New Total:** ${newTotalPoints} VP\n` +
                            `**Adjusted by:** <@${interaction.user.id}>`
                        )
                        .setTimestamp();

                    await logChannel.send({ embeds: [logEmbed] });
                }

                results.push(pointsToAdd < 0
                    ? `Removed **${Math.abs(pointsToAdd)}** points from ${displayName}. New total: **${newTotalPoints}**.`
                    : `Added **${pointsToAdd}** points to ${displayName}. New total: **${newTotalPoints}**.`);
            }

            const embed = new EmbedBuilder()
                .setColor('White')
                .setTitle('Volition Points Adjusted')
                .setThumbnail('https://cdn.discordapp.com/icons/571389228806570005/ff45546375fe88eb358088dc1fd4c28b.png?size=480&quality=lossless')
                .setDescription(results.join('\n').slice(0, 4096));

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error adjusting points:', error.message);

            await interaction.editReply({ content: 'Error adjusting points. Check console for help with debugging.' });
        }
    },
};
