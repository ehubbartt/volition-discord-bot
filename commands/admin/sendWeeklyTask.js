const { SlashCommandBuilder } = require('discord.js');
const { isAdmin } = require('../../utils/permissions');
const siteSubs = require('../../db/siteSubmissions');
const { ensureTaskThread } = require('../../handlers/taskThread');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sendweeklytask')
        .setDescription('(Admin Only) Open/refresh a Discord submission thread for each active weekly task'),

    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const active = await siteSubs.listActiveInstancesOfKind('weekly_task');
            if (active.length === 0) {
                await interaction.editReply({
                    content: '⚠️ No active weekly task right now. Create/activate one in the site admin or with `/event task`.'
                });
                return;
            }

            const lines = [];
            for (const task of active) {
                const r = await ensureTaskThread(interaction.client, task);
                if (r.error) {
                    lines.push(`• ${task.name} — ❌ ${r.error}`);
                    continue;
                }
                const tag = r.created ? ' (new thread)' : r.refreshed ? ' (updated)' : ' (existing)';
                lines.push(`• **${task.name}** — <#${r.threadId}>${tag}`);
            }

            await interaction.editReply({
                content: `✅ ${active.length} active weekly task${active.length === 1 ? '' : 's'}:\n${lines.join('\n')}`
            });
        } catch (error) {
            console.error('[SendWeeklyTask] Error:', error);
            await interaction.editReply({ content: `❌ Error: ${error.message}` });
        }
    }
};
