const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../db/supabase');
const config = require('../../config.json');

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
        const member = interaction.member;
        const allowedRoleId = config.ADMIN_ROLE_IDS[0];

        if (!member.roles.cache.has(allowedRoleId)) {
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
                const existingPoints = player.player_points?.points || 0;
                const newTotalPoints = existingPoints + pointsToAdd;

                await db.addPoints(player.rsn, pointsToAdd);

                results.push(pointsToAdd < 0
                    ? `Removed **${Math.abs(pointsToAdd)}** points from ${displayName}. New total: **${newTotalPoints}**.`
                    : `Added **${pointsToAdd}** points to ${displayName}. New total: **${newTotalPoints}**.`);
            }

            const embed = new EmbedBuilder()
                .setColor('White')
                .setTitle('Volition Points Adjusted')
                .setThumbnail('https://i.imgur.com/BJJpBj2.png')
                .setDescription(results.join('\n').slice(0, 4096));

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error adjusting points:', error.message);

            await interaction.editReply({ content: 'Error adjusting points. Check console for help with debugging.' });
        }
    },
};
