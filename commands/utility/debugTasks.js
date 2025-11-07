const { SlashCommandBuilder } = require('discord.js');
const db = require('../../db/supabase');
const { isAdmin } = require('../../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('debugtasks')
        .setDescription('(Admin Only) Debug task database'),

    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const { data: tasks, error } = await db.supabase
                .from('tasks')
                .select('*');

            if (error) {
                return interaction.editReply({ content: `Error: ${error.message}` });
            }

            if (!tasks || tasks.length === 0) {
                return interaction.editReply({ content: 'No tasks found in database!' });
            }

            let message = `Found ${tasks.length} tasks:\n\n`;
            tasks.slice(0, 3).forEach((task, index) => {
                message += `Task ${index + 1}:\n`;
                message += `Raw data: ${JSON.stringify(task, null, 2)}\n\n`;
            });

            await interaction.editReply({ content: message.slice(0, 2000) });

        } catch (error) {
            console.error('Error debugging tasks:', error);
            await interaction.editReply({ content: `Error: ${error.message}` });
        }
    },
};
