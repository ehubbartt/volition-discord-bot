const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../db/supabase');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('checkpoints')
        .setDescription('Check VP points for a player')
        .addStringOption(option =>
            option.setName('player')
                .setDescription('RSN or @mention a Discord user')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const playerInput = interaction.options.getString('player');
        let player = null;
        let displayName = '';

        try {
            // If no input provided, check the command user's points
            if (!playerInput) {
                player = await db.getPlayerByDiscordId(interaction.user.id);
                displayName = interaction.user.tag;

                if (!player) {
                    return interaction.editReply({
                        content: `No player found linked to your Discord account. Please verify your account first.`
                    });
                }
            } else {
                // Check if input is a Discord mention (starts with <@)
                const mentionMatch = playerInput.match(/^<@!?(\d+)>$/);

                if (mentionMatch) {
                    // It's a Discord mention
                    const userId = mentionMatch[1];
                    player = await db.getPlayerByDiscordId(userId);

                    if (!player) {
                        return interaction.editReply({
                            content: `No player found linked to <@${userId}>. They may need to verify their account first.`
                        });
                    }

                    try {
                        const user = await interaction.client.users.fetch(userId);
                        displayName = user.tag;
                    } catch {
                        displayName = `User ID: ${userId}`;
                    }
                } else {
                    // Treat as RSN
                    player = await db.getPlayerByRSN(playerInput);
                    displayName = playerInput;

                    if (!player) {
                        return interaction.editReply({
                            content: `**${playerInput}** not found in the clan database.`
                        });
                    }
                }
            }

            // Get points
            const points = player.player_points?.points || 0;
            const rsn = player.rsn;

            const embed = new EmbedBuilder()
                .setColor('Blue')
                .setTitle('Volition Points')
                .setThumbnail('https://cdn.discordapp.com/icons/571389228806570005/ff45546375fe88eb358088dc1fd4c28b.png?size=480&quality=lossless')
                .addFields(
                    { name: 'Player', value: rsn, inline: true },
                    { name: 'VP Points', value: `${points}`, inline: true }
                )
                .setTimestamp();

            if (player.discord_id) {
                embed.addFields({ name: 'Discord', value: `<@${player.discord_id}>`, inline: true });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error checking points:', error);
            await interaction.editReply({ content: 'Error checking points. Please try again.' });
        }
    },
};
