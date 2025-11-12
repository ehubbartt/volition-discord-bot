const { SlashCommandBuilder } = require('discord.js');
const config = require('../../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('fixarchiveperms')
        .setDescription('(Admin Only) Fix permissions on archive channels'),

    async execute (interaction) {
        // Check if user is admin
        const isAdmin = config.ADMIN_ROLE_IDS.some(roleId =>
            interaction.member.roles.cache.has(roleId)
        );

        if (!isAdmin) {
            return interaction.reply({
                content: '❌ Only admins can use this command.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const archiveIds = [
                config.TICKET_JOIN_ARCHIVE_ID,
                config.TICKET_GENERAL_ARCHIVE_ID,
                config.TICKET_SHOP_ARCHIVE_ID
            ];

            let fixed = 0;
            const results = [];

            for (const archiveId of archiveIds) {
                const channel = await interaction.guild.channels.fetch(archiveId);

                // Remove all user-specific permission overrides
                const overwrites = channel.permissionOverwrites.cache;
                let removedUsers = 0;
                for (const [id, overwrite] of overwrites) {
                    if (overwrite.type === 1) { // Type 1 = Member
                        await channel.permissionOverwrites.delete(id);
                        console.log(`[FixArchive] Removed permissions for user ${id} in ${channel.name}`);
                        removedUsers++;
                    }
                }

                // Restore admin role permissions
                for (const roleId of config.ADMIN_ROLE_IDS) {
                    await channel.permissionOverwrites.edit(roleId, {
                        ViewChannel: true,
                        SendMessages: true,
                        ReadMessageHistory: true
                    });
                }

                console.log(`[FixArchive] Fixed permissions for ${channel.name}`);
                results.push(`✅ **${channel.name}**: Removed ${removedUsers} user overrides, restored admin access`);
                fixed++;
            }

            await interaction.editReply({
                content: `**Archive Permissions Fixed!**\n\n${results.join('\n')}\n\n✅ All ${fixed} archive channels are now accessible to admins.`
            });

        } catch (error) {
            console.error('[FixArchive] Error:', error);
            await interaction.editReply({
                content: `❌ Error fixing permissions: ${error.message}`
            });
        }
    },
};
