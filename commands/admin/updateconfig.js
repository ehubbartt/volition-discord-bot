const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const hybridConfig = require('../../utils/hybridConfig');
const { isAdmin } = require('../../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('updateconfig')
        .setDescription('(Admin Only) Update bot configuration remotely')
        .addStringOption(option =>
            option.setName('feature')
                .setDescription('Feature path (e.g., events.autoJoinTickets)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('value')
                .setDescription('New value (true/false/number/string)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for this change')
                .setRequired(false)),

    async execute(interaction) {
        // Check admin permissions
        if (!isAdmin(interaction.member)) {
            return interaction.reply({
                content: '❌ Admin only command.',
                ephemeral: true
            });
        }

        const featurePath = interaction.options.getString('feature');
        const valueString = interaction.options.getString('value');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        await interaction.deferReply({ ephemeral: false });

        try {
            // Parse value
            let newValue;
            if (valueString === 'true') {
                newValue = true;
            } else if (valueString === 'false') {
                newValue = false;
            } else if (!isNaN(valueString)) {
                newValue = Number(valueString);
            } else {
                newValue = valueString;
            }

            // Get old value before updating
            const oldValue = await hybridConfig.get(featurePath);

            // Update configuration (hybrid system handles both local and remote)
            const result = await hybridConfig.updateConfig(featurePath, newValue, reason);

            if (!result.success) {
                return interaction.editReply({
                    content: `❌ Failed to update configuration: ${result.error}`
                });
            }

            // Get config source for feedback
            const source = hybridConfig.getConfigSource();
            const sourceEmoji = source.includes('remote') ? '☁️' : '📁';
            const takesEffect = source.includes('remote')
                ? 'Within 1 minute (cached)'
                : 'Immediately (requires bot restart for some features)';

            // Create success embed
            const embed = new EmbedBuilder()
                .setColor('Green')
                .setTitle('✅ Configuration Updated')
                .setDescription(`Successfully updated **${featurePath}**`)
                .addFields(
                    { name: 'Old Value', value: `\`${oldValue}\``, inline: true },
                    { name: 'New Value', value: `\`${newValue}\``, inline: true },
                    { name: '\u200B', value: '\u200B', inline: true },
                    { name: 'Reason', value: reason, inline: false },
                    { name: 'Updated By', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Saved To', value: `${sourceEmoji} ${source}`, inline: true },
                    { name: 'Takes Effect', value: takesEffect, inline: true }
                )
                .setFooter({ text: result.location === 'remote' ? 'Using remote config - changes apply automatically' : 'Using local config - restart may be required' })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

            console.log(`[UpdateConfig] ${interaction.user.tag} changed ${featurePath}: ${oldValue} → ${newValue} (${result.location})`);

        } catch (error) {
            console.error('[UpdateConfig] Error:', error);

            const errorEmbed = new EmbedBuilder()
                .setColor('Red')
                .setTitle('❌ Configuration Update Failed')
                .setDescription(
                    `Failed to update **${featurePath}**\n\n` +
                    `**Error:**\n\`\`\`${error.message}\`\`\``
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [errorEmbed] });
        }
    },
};
