const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../db/supabase');
const { isAdmin } = require('../../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('(Admin Only) Add a user to the server ban list')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to ban')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the ban')
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
            // Check if already banned
            const existingBan = await db.getBan(targetUser.id);
            if (existingBan) {
                return interaction.editReply({ content: `<@${targetUser.id}> is already on the ban list.\n**Reason:** ${existingBan.reason}` });
            }

            await db.createBan({
                discord_id: targetUser.id,
                username: targetUser.username,
                reason,
                banned_by: interaction.user.id,
                banned_by_tag: interaction.user.username,
            });

            // DM the user before kicking
            try {
                await targetUser.send(
                    `You have been banned from **${interaction.guild.name}**.\n**Reason:** ${reason}`
                );
            } catch {
                // User may have DMs disabled
            }

            // Kick the user if they're in the server
            const member = interaction.guild.members.cache.get(targetUser.id);
            if (member) {
                try {
                    await member.kick(`Banned: ${reason}`);
                } catch (err) {
                    console.error('Error kicking banned user:', err);
                }
            }

            const embed = new EmbedBuilder()
                .setColor('Red')
                .setTitle('User Banned')
                .setDescription(
                    `**User:** <@${targetUser.id}>\n` +
                    `**Reason:** ${reason}\n` +
                    `**Banned by:** <@${interaction.user.id}>`
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Error banning user:', error);
            await interaction.editReply({ content: 'An error occurred while banning the user.' });
        }
    },
};
