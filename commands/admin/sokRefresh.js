const { SlashCommandBuilder } = require('discord.js');
const { isAdmin } = require('../../utils/permissions');
const { postWeeklySokCompetitions } = require('../../jobs/sokScheduler');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sok-refresh')
        .setDescription('(Admin Only) Post this week\'s Skill or Kill competitions (skips ones already posted)'),

    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const result = await postWeeklySokCompetitions(interaction.client);

            const lines = [];
            if (result.posted.length === 0 && result.skipped.length === 0 && result.errors.length === 0) {
                lines.push('No SoK competitions found for this week on WOM.');
            }
            if (result.posted.length > 0) {
                lines.push(`✅ Posted ${result.posted.length}:`);
                for (const p of result.posted) lines.push(`• [${p.title}](${p.messageUrl})`);
            }
            if (result.skipped.length > 0) {
                lines.push(`⏭️ Skipped (already posted): ${result.skipped.join(', ')}`);
            }
            if (result.errors.length > 0) {
                lines.push(`❌ Errors:`);
                for (const e of result.errors) lines.push(`• #${e.id} — ${e.message}`);
            }

            await interaction.editReply({ content: lines.join('\n') });
        } catch (err) {
            console.error('[SoK Refresh] Failed:', err);
            await interaction.editReply({ content: `❌ Error running SoK refresh: ${err.message}` });
        }
    },
};
