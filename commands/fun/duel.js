const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../db/supabase');
const config = require('../../utils/config');
const analytics = require('../../db/gamification_analytics');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('duel')
        .setDescription('Challenge another player to a 50/50 duel for points')
        .addUserOption(option =>
            option.setName('opponent')
                .setDescription('The user you want to duel')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('points')
                .setDescription('Amount of points to wager (must be positive)')
                .setRequired(true)
                .setMinValue(1)),

    async execute (interaction) {
        await interaction.deferReply({ ephemeral: false });

        const challenger = interaction.user;
        const opponent = interaction.options.getUser('opponent');
        const wager = interaction.options.getInteger('points');

        if (opponent.bot) {
            return interaction.editReply({ content: 'You cannot duel a bot!' });
        }

        if (challenger.id === opponent.id) {
            return interaction.editReply({ content: 'You cannot duel yourself!' });
        }

        try {
            const challengerPlayer = await db.getPlayerByDiscordId(challenger.id);
            if (!challengerPlayer) {
                return interaction.editReply({ content: 'You are not registered in the system. Please contact an admin.' });
            }

            const opponentPlayer = await db.getPlayerByDiscordId(opponent.id);
            if (!opponentPlayer) {
                return interaction.editReply({ content: `<@${opponent.id}> is not registered in the system.` });
            }

            const challengerPoints = challengerPlayer.player_points?.points || 0;
            const opponentPoints = opponentPlayer.player_points?.points || 0;

            if (challengerPoints < wager) {
                return interaction.editReply({
                    content: `You don't have enough points! You have **${challengerPoints}** VP, but need **${wager}** VP to duel.`
                });
            }

            if (opponentPoints < wager) {
                return interaction.editReply({
                    content: `<@${opponent.id}> doesn't have enough points! They have **${opponentPoints}** VP, but need **${wager}** VP to accept this duel.`
                });
            }

            const acceptButton = new ButtonBuilder()
                .setCustomId('duel_accept')
                .setLabel('Accept Duel')
                .setStyle(ButtonStyle.Success);

            const declineButton = new ButtonBuilder()
                .setCustomId('duel_decline')
                .setLabel('Decline Duel')
                .setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder().addComponents(acceptButton, declineButton);

            const challengeEmbed = new EmbedBuilder()
                .setColor('Yellow')
                .setTitle('Duel Challenge!')
                .setDescription(
                    `<@${challenger.id}> has challenged <@${opponent.id}> to a duel!\n\n` +
                    `**Wager:** ${wager} VP\n` +
                    `**Type:** 50/50 chance\n\n` +
                    `<@${opponent.id}>, do you accept?`
                )
                .setThumbnail('https://cdn.discordapp.com/icons/571389228806570005/ff45546375fe88eb358088dc1fd4c28b.png?size=480&quality=lossless')
                .setTimestamp();

            const response = await interaction.editReply({
                content: `<@${opponent.id}>`,
                embeds: [challengeEmbed],
                components: [row]
            });

            const collector = response.createMessageComponentCollector({ time: 60000 });

            collector.on('collect', async (buttonInteraction) => {
                if (buttonInteraction.user.id !== opponent.id) {
                    return buttonInteraction.reply({ content: 'Only the challenged player can respond to this duel!', ephemeral: true });
                }

                await buttonInteraction.deferUpdate();

                if (buttonInteraction.customId === 'duel_decline') {
                    const declineEmbed = new EmbedBuilder()
                        .setColor('Red')
                        .setTitle('Duel Declined')
                        .setDescription(`<@${opponent.id}> has declined the duel challenge from <@${challenger.id}>.`)
                        .setTimestamp();

                    await interaction.editReply({ embeds: [declineEmbed], components: [] });
                    collector.stop();
                    return;
                }

                if (buttonInteraction.customId === 'duel_accept') {
                    const updatedChallengerPlayer = await db.getPlayerByDiscordId(challenger.id);
                    const updatedOpponentPlayer = await db.getPlayerByDiscordId(opponent.id);

                    const currentChallengerPoints = updatedChallengerPlayer.player_points?.points || 0;
                    const currentOpponentPoints = updatedOpponentPlayer.player_points?.points || 0;

                    if (currentChallengerPoints < wager) {
                        const errorEmbed = new EmbedBuilder()
                            .setColor('Red')
                            .setTitle('Duel Cancelled')
                            .setDescription(`<@${challenger.id}> no longer has enough points to complete this duel.`)
                            .setTimestamp();
                        await interaction.editReply({ embeds: [errorEmbed], components: [] });
                        collector.stop();
                        return;
                    }

                    if (currentOpponentPoints < wager) {
                        const errorEmbed = new EmbedBuilder()
                            .setColor('Red')
                            .setTitle('Duel Cancelled')
                            .setDescription(`<@${opponent.id}> no longer has enough points to complete this duel.`)
                            .setTimestamp();
                        await interaction.editReply({ embeds: [errorEmbed], components: [] });
                        collector.stop();
                        return;
                    }

                    const winner = Math.random() < 0.5 ? challenger : opponent;
                    const loser = winner.id === challenger.id ? opponent : challenger;
                    const winnerPlayer = winner.id === challenger.id ? updatedChallengerPlayer : updatedOpponentPlayer;
                    const loserPlayer = winner.id === challenger.id ? updatedOpponentPlayer : updatedChallengerPlayer;

                    await db.addPoints(winnerPlayer.rsn, wager);
                    await db.addPoints(loserPlayer.rsn, -wager);

                    const winnerNewPoints = (winnerPlayer.player_points?.points || 0) + wager;
                    const loserNewPoints = (loserPlayer.player_points?.points || 0) - wager;

                    // Log duel analytics
                    analytics.logDuel(
                        challenger.id,
                        opponent.id,
                        wager,
                        winner.id,
                        loser.id,
                        winner.username,
                        loser.username
                    ).catch(err => console.error('[Analytics] Failed to log duel:', err));

                    // Payout logs disabled for duels (player vs player transactions)

                    const resultEmbed = new EmbedBuilder()
                        .setColor(winner.id === challenger.id ? 'Green' : 'Red')
                        .setTitle('Duel Results')
                        .setDescription(
                            `<@${challenger.id}> vs <@${opponent.id}> dueled for **${wager}** VP!\n\n` +
                            `**Winner:** <@${winner.id}> (+${wager} VP)\n` +
                            `**Loser:** <@${loser.id}> (-${wager} VP)\n\n` +
                            `**New Balances:**\n` +
                            `<@${winner.id}>: **${winnerNewPoints}** VP\n` +
                            `<@${loser.id}>: **${loserNewPoints}** VP`
                        )
                        .setThumbnail('https://cdn.discordapp.com/icons/571389228806570005/ff45546375fe88eb358088dc1fd4c28b.png?size=480&quality=lossless')
                        .setTimestamp();

                    await interaction.editReply({ embeds: [resultEmbed], components: [] });
                    collector.stop();
                }
            });

            collector.on('end', async (collected) => {
                if (collected.size === 0) {
                    const timeoutEmbed = new EmbedBuilder()
                        .setColor('Grey')
                        .setTitle('Duel Expired')
                        .setDescription(`<@${opponent.id}> did not respond in time. The duel challenge has expired.`)
                        .setTimestamp();

                    await interaction.editReply({ embeds: [timeoutEmbed], components: [] });
                }
            });

        } catch (error) {
            console.error('Error executing duel command:', error);
            await interaction.editReply({ content: 'An error occurred while processing the duel. Please try again.', components: [] });
        }
    },
};
