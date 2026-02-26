const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../db/supabase');
const { isAdmin } = require('../../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warnings')
        .setDescription('View warnings for yourself or a user (admin only for others)')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to check (admin only)')
                .setRequired(false)
        ),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user');

        // If checking another user, require admin
        if (targetUser && targetUser.id !== interaction.user.id) {
            if (!isAdmin(interaction.member)) {
                return interaction.reply({ content: 'You do not have permission to view other users\' warnings.', ephemeral: true });
            }
        }

        const userId = targetUser ? targetUser.id : interaction.user.id;
        const displayUser = targetUser || interaction.user;

        await interaction.deferReply({ ephemeral: true });

        try {
            const allWarnings = await db.getAllWarnings(userId);
            const now = new Date();
            const activeWarnings = allWarnings.filter(w => new Date(w.expires_at) > now);
            const expiredWarnings = allWarnings.filter(w => new Date(w.expires_at) <= now);

            if (allWarnings.length === 0) {
                const embed = new EmbedBuilder()
                    .setColor('Green')
                    .setTitle(`Warnings for ${displayUser.username}`)
                    .setDescription('No warnings on record.')
                    .setTimestamp();

                return interaction.editReply({ embeds: [embed] });
            }

            let description = `**Active: ${activeWarnings.length}** | Expired: ${expiredWarnings.length} | Total: ${allWarnings.length}\n\n`;

            for (const warning of allWarnings) {
                const isActive = new Date(warning.expires_at) > now;
                const createdTs = Math.floor(new Date(warning.created_at).getTime() / 1000);
                const expiresTs = Math.floor(new Date(warning.expires_at).getTime() / 1000);

                description += `${isActive ? '🔴' : '⚪'} **${warning.reason}**\n`;
                description += `Issued by <@${warning.warned_by}> on <t:${createdTs}:d>`;
                description += isActive ? ` — expires <t:${expiresTs}:R>\n\n` : ` — **expired**\n\n`;
            }

            const embed = new EmbedBuilder()
                .setColor(activeWarnings.length >= 3 ? 'Red' : activeWarnings.length > 0 ? 'Orange' : 'Green')
                .setTitle(`Warnings for ${displayUser.username}`)
                .setDescription(description.slice(0, 4096))
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Error fetching warnings:', error);
            await interaction.editReply({ content: 'An error occurred while fetching warnings.' });
        }
    },
};
