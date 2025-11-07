const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../../config.json');
const hybridConfig = require('../../utils/hybridConfig');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('syncconfig')
        .setDescription('(Admin Only) Sync local features.json to remote database'),

    async execute(interaction) {
        // Check admin permissions
        const isAdmin = config.ADMIN_ROLE_IDS.some(roleId =>
            interaction.member.roles.cache.has(roleId)
        );

        if (!isAdmin) {
            return interaction.reply({
                content: '❌ Admin only command.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: false });

        try {
            // Get current config source
            const currentSource = hybridConfig.getConfigSource();

            // Sync local to remote
            const result = await hybridConfig.syncLocalToRemote();

            if (!result.success) {
                const errorEmbed = new EmbedBuilder()
                    .setColor('Red')
                    .setTitle('❌ Sync Failed')
                    .setDescription(
                        `Failed to sync local configuration to remote database.\n\n` +
                        `**Error:**\n\`\`\`${result.error}\`\`\`\n\n` +
                        `**Possible causes:**\n` +
                        `• Database migration not run yet\n` +
                        `• Supabase connection issue\n` +
                        `• Missing bot_config table\n\n` +
                        `**To fix:**\n` +
                        `1. Run the SQL migration in Supabase:\n` +
                        `   \`db/migrations/create_bot_config_table.sql\`\n` +
                        `2. Check Supabase connection in \`.env\`\n` +
                        `3. Try again`
                    )
                    .setTimestamp();

                return interaction.editReply({ embeds: [errorEmbed] });
            }

            // Success
            const successEmbed = new EmbedBuilder()
                .setColor('Green')
                .setTitle('✅ Configuration Synced')
                .setDescription(
                    `Successfully synced local \`features.json\` to remote database!`
                )
                .addFields(
                    { name: 'Previous Source', value: currentSource, inline: true },
                    { name: 'New Source', value: 'remote (Supabase)', inline: true },
                    { name: '\u200B', value: '\u200B', inline: true },
                    { name: '✨ What This Means', value:
                        `• All future config changes saved to database\n` +
                        `• Bot automatically loads from database\n` +
                        `• Changes apply within 1 minute (no restart needed)\n` +
                        `• Admin dashboard will work when you build it\n` +
                        `• Local \`features.json\` remains as fallback backup`,
                        inline: false
                    },
                    { name: '🎯 Next Steps', value:
                        `1. Use \`/updateconfig\` to change settings remotely\n` +
                        `2. Changes saved to database automatically\n` +
                        `3. Bot picks up changes within 60 seconds\n` +
                        `4. Build admin dashboard when ready (optional)`,
                        inline: false
                    }
                )
                .setFooter({ text: 'Remote config is now active!' })
                .setTimestamp();

            await interaction.editReply({ embeds: [successEmbed] });

            console.log(`[SyncConfig] ${interaction.user.tag} synced local config to remote database`);

        } catch (error) {
            console.error('[SyncConfig] Error:', error);

            const errorEmbed = new EmbedBuilder()
                .setColor('Red')
                .setTitle('❌ Sync Error')
                .setDescription(
                    `An unexpected error occurred:\n\`\`\`${error.message}\`\`\``
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [errorEmbed] });
        }
    },
};
