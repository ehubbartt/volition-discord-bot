const { SlashCommandBuilder } = require('discord.js');
const { isAdmin } = require('../../utils/permissions');
const { getWeeklyTaskAndMove } = require('../../commands/fun/weeklyTask.js');
const config = require('../../utils/config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sendweeklytask')
        .setDescription('(Admin Only) Manually trigger the weekly task post'),

    async execute (interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: false });

        try {
            const channel = interaction.client.channels.cache.get(config.WEEKLY_TASK_ANNOUNCEMENT_CHANNEL_ID);
            if (!channel) {
                return interaction.editReply({ content: '❌ Weekly task announcement channel not found!' });
            }

            const task = await getWeeklyTaskAndMove();
            const deadline = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

            await channel.send(`<@&${config.weeklyTaskRoleID}>\n**Task:** ${task}`);
            await channel.send(`**Duration:** Starting now until <t:${deadline}:F>.`);
            await channel.send(`Please post your evidence in **one message** in <#${config.WEEKLY_CHALLENGE_SUBMISSION_CHANNEL_ID}>.`);

            // Log to test channel
            const testChannel = interaction.client.channels.cache.get(config.TEST_CHANNEL_ID);
            if (testChannel) {
                await testChannel.send(`✅ **[Manual Trigger]** Weekly task posted at ${new Date().toLocaleString()}\nTask: ${task}\nTriggered by: <@${interaction.user.id}>`);
            }

            await interaction.editReply({ content: `✅ Weekly task posted successfully!\n**Task:** ${task}` });

        } catch (error) {
            console.error('Error sending weekly task:', error);
            await interaction.editReply({ content: `❌ Error sending weekly task: ${error.message}` });
        }
    },
};
