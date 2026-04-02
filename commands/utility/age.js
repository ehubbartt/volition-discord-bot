const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../db/supabase');
const config = require('../../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('age')
        .setDescription('Check how long a player has been in the clan')
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
            if (!playerInput) {
                player = await db.getPlayerByDiscordId(interaction.user.id);
                displayName = interaction.user.tag;

                if (!player) {
                    return interaction.editReply({
                        content: `No player found linked to your Discord account. Please verify your account first.`
                    });
                }
            } else {
                const mentionMatch = playerInput.match(/^<@!?(\d+)>$/);

                if (mentionMatch) {
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
                    player = await db.getPlayerByRSN(playerInput);
                    displayName = playerInput;

                    if (!player) {
                        return interaction.editReply({
                            content: `**${playerInput}** not found in the clan database.`
                        });
                    }
                }
            }

            if (!player.clan_joined_at) {
                return interaction.editReply({
                    content: `No clan join date found for **${player.rsn}**. They may need to be synced.`
                });
            }

            const joinDate = new Date(player.clan_joined_at);
            const now = new Date();
            const diffMs = now - joinDate;

            const years = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 365));
            const months = Math.floor((diffMs % (1000 * 60 * 60 * 24 * 365)) / (1000 * 60 * 60 * 24 * 30.44));
            const days = Math.floor((diffMs % (1000 * 60 * 60 * 24 * 30.44)) / (1000 * 60 * 60 * 24));

            let timeString = '';
            if (years > 0) {
                timeString += `${years} year${years !== 1 ? 's' : ''}`;
            }
            if (months > 0) {
                if (timeString) timeString += ', ';
                timeString += `${months} month${months !== 1 ? 's' : ''}`;
            }
            if (days > 0 || !timeString) {
                if (timeString) timeString += ', ';
                timeString += `${days} day${days !== 1 ? 's' : ''}`;
            }

            const embed = new EmbedBuilder()
                .setColor('Green')
                .setTitle('Clan Membership Duration')
                .setThumbnail(config.CLAN_ICON_URL)
                .addFields(
                    { name: 'Player', value: player.rsn, inline: true },
                    { name: 'Joined', value: `<t:${Math.floor(joinDate.getTime() / 1000)}:D>`, inline: true },
                    { name: 'Time in Clan', value: timeString, inline: false }
                )
                .setTimestamp();

            if (player.discord_id) {
                embed.addFields({ name: 'Discord', value: `<@${player.discord_id}>`, inline: true });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error checking clan age:', error);
            await interaction.editReply({ content: 'Error checking clan age. Please try again.' });
        }
    },
};
