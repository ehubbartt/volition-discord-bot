const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../db/supabase');
const { isAdmin } = require('../../utils/permissions');
const config = require('../../utils/config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('(Admin Only) Issue a warning to a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to warn')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the warning')
                .setRequired(true)
        ),

    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        await interaction.deferReply();

        const targetUser = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');

        try {
            await db.createWarning({
                discord_id: targetUser.id,
                username: targetUser.username,
                reason,
                warned_by: interaction.user.id,
                warned_by_tag: interaction.user.username,
            });

            const activeWarnings = await db.getActiveWarnings(targetUser.id);

            const embed = new EmbedBuilder()
                .setColor('Orange')
                .setTitle('Warning Issued')
                .setDescription(
                    `**User:** <@${targetUser.id}>\n` +
                    `**Reason:** ${reason}\n` +
                    `**Issued by:** <@${interaction.user.id}>\n` +
                    `**Active warnings:** ${activeWarnings.length}\n` +
                    `**Expires:** <t:${Math.floor(Date.now() / 1000) + 6 * 30 * 24 * 60 * 60}:R>`
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

            // Alert admins if user has 3+ active warnings
            if (activeWarnings.length >= 3) {
                const alertChannel = interaction.client.channels.cache.get(config.TEST_CHANNEL_ID);
                if (alertChannel) {
                    const alertEmbed = new EmbedBuilder()
                        .setColor('Red')
                        .setTitle('Warning Threshold Reached')
                        .setDescription(
                            `<@${targetUser.id}> now has **${activeWarnings.length} active warnings**.\n\n` +
                            `**Recent warnings:**\n` +
                            activeWarnings.slice(0, 5).map((w, i) =>
                                `${i + 1}. ${w.reason} — by <@${w.warned_by}> on <t:${Math.floor(new Date(w.created_at).getTime() / 1000)}:d>`
                            ).join('\n') +
                            `\n\nAction should be taken.`
                        )
                        .setTimestamp();

                    const adminPings = config.ADMIN_ROLE_IDS.map(id => `<@&${id}>`).join(' ');
                    await alertChannel.send({ content: adminPings, embeds: [alertEmbed] });
                }
            }
        } catch (error) {
            console.error('Error issuing warning:', error);
            await interaction.editReply({ content: 'An error occurred while issuing the warning.' });
        }
    },
};
