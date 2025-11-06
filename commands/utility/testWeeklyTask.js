const { SlashCommandBuilder } = require('discord.js');
const { getWeeklyTaskAndMove } = require('../fun/weeklyTask.js');
const config = require('../../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('testweeklytask')
        .setDescription('(Admin Only) Test the weekly task functionality'),

    async execute(interaction) {
        const member = interaction.member;
        const allowedRoleId = config.ADMIN_ROLE_IDS[0];

        if (!member.roles.cache.has(allowedRoleId)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: false });

        try {
            const task = await getWeeklyTaskAndMove();

            if (!task) {
                return interaction.editReply({ content: 'No tasks available in the database!' });
            }

            const weeklyTaskRoleID = config.weeklyTaskRoleID;
            const taskSubmissionChannelID = config.WEEKLY_CHALLENGE_SUBMISSION_CHANNEL_ID;
            const deadline = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

            let message = `<@&${weeklyTaskRoleID}>\n**Task:** ${task}\n`;
            message += `**Duration:** Starting now until <t:${deadline}:F>.\n`;
            message += `Please post your evidence in **one message** in <#${taskSubmissionChannelID}>.`;

            await interaction.editReply(message);

        } catch (error) {
            console.error('Error testing weekly task:', error);
            await interaction.editReply({ content: 'Error testing weekly task. Check console for details.' });
        }
    },
};
