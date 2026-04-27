const { SlashCommandBuilder } = require('discord.js');
const { isAdmin } = require('../../utils/permissions');
const { getWeeklyTaskAndMove } = require('../../commands/fun/weeklyTask.js');
const { createTaskEvent } = require('./event.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sendweeklytask')
        .setDescription('(Admin Only) Manually trigger the weekly task post'),

    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const taskText = await getWeeklyTaskAndMove();
            const event = await createTaskEvent(interaction.client, taskText);

            if (event) {
                await interaction.editReply({ content: `✅ Weekly task posted!\n**Task:** ${taskText}\n**Event ID:** ${event.id}` });
            } else {
                await interaction.editReply({ content: '❌ Failed — events channel not found.' });
            }
        } catch (error) {
            console.error('[SendWeeklyTask] Error:', error);
            await interaction.editReply({ content: `❌ Error: ${error.message}` });
        }
    },
};
