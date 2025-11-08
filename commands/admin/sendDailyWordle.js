const { SlashCommandBuilder } = require('discord.js');
const { isAdmin } = require('../../utils/permissions');
const { getDailyWordleAndMove } = require('../../commands/fun/dailyWordle.js');
const config = require('../../utils/config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('senddailywordle')
        .setDescription('(Admin Only) Manually trigger the daily wordle post'),

    async execute (interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: false });

        try {
            const channel = interaction.client.channels.cache.get(config.DAILY_WORDLE_ANNOUNCEMENT_CHANNEL_ID);
            if (!channel) {
                return interaction.editReply({ content: '❌ Daily Wordle announcement channel not found!' });
            }

            const wordleUrl = await getDailyWordleAndMove();
            if (!wordleUrl) {
                return interaction.editReply({ content: '❌ No Wordle URL found in database!' });
            }

            await channel.send(`**Daily Wordle:**\n${wordleUrl}`);
            await channel.send(`Share your result in <#${config.DAILY_CHALLENGE_SUBMISSION_CHANNEL_ID}>.`);

            // Log to test channel
            const testChannel = interaction.client.channels.cache.get(config.TEST_CHANNEL_ID);
            if (testChannel) {
                await testChannel.send(`✅ **[Manual Trigger]** Daily Wordle posted at ${new Date().toLocaleString()}\nURL: ${wordleUrl}\nTriggered by: <@${interaction.user.id}>`);
            }

            await interaction.editReply({ content: `✅ Daily Wordle posted successfully!\n**URL:** ${wordleUrl}` });

        } catch (error) {
            console.error('Error sending daily wordle:', error);
            await interaction.editReply({ content: `❌ Error sending daily wordle: ${error.message}` });
        }
    },
};
