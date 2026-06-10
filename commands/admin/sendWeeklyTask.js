const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { isAdmin } = require('../../utils/permissions');
const config = require('../../utils/config');
const siteSubs = require('../../db/siteSubmissions');

// The website page where players submit proof for the active weekly tasks.
const SITE_TASKS_URL = 'https://volition-osrs.com/tasks/weekly';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sendweeklytask')
        .setDescription('(Admin Only) Announce the currently active weekly task(s)'),

    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // Announce what's ALREADY active (vs_events instances) — do NOT pick a
            // random task or create a new one. Rotation/creation is the weekly cron
            // (createTaskEvent) or /event task.
            const active = await siteSubs.listActiveInstancesOfKind('weekly_task');

            if (active.length === 0) {
                await interaction.editReply({
                    content:
                        '⚠️ No active weekly task right now. Create one with `/event task` (or wait for the weekly rotation).'
                });
                return;
            }

            const channel = interaction.client.channels.cache.get(config.EVENTS_CHANNEL_ID);
            if (!channel) {
                await interaction.editReply({ content: '❌ Events channel not found.' });
                return;
            }

            const fields = active.map((t) => {
                const deadline = t.ends_at
                    ? `\nDeadline: <t:${Math.floor(new Date(t.ends_at).getTime() / 1000)}:R>`
                    : '';
                const reward = Number(t.vp_reward) > 0 ? `\nReward: ${t.vp_reward} VP` : '';
                return {
                    name: t.name,
                    value: `${t.description || 'Submit your proof.'}${reward}${deadline}`,
                    inline: false
                };
            });

            const embed = new EmbedBuilder()
                .setColor('Blue')
                .setTitle(active.length === 1 ? '📋 Active Weekly Task' : `📋 Active Weekly Tasks (${active.length})`)
                .setDescription(`Submit your proof on the site — an admin reviews it there.\n**[Submit a task →](${SITE_TASKS_URL})**`)
                .addFields(fields)
                .setThumbnail(config.CLAN_ICON_URL)
                .setTimestamp();

            await channel.send({ embeds: [embed] });

            await interaction.editReply({
                content: `✅ Announced ${active.length} active weekly task${active.length === 1 ? '' : 's'} in <#${config.EVENTS_CHANNEL_ID}>.`
            });
        } catch (error) {
            console.error('[SendWeeklyTask] Error:', error);
            await interaction.editReply({ content: `❌ Error: ${error.message}` });
        }
    },
};
