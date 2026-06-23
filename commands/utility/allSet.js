const { SlashCommandBuilder } = require('discord.js');
const config = require('../../config.json');
const hybridConfig = require('../../utils/hybridConfig');
const { renderMessage } = require('../../utils/templateRenderer');
const commandMessages = require('../../config/commandMessages.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('allset')
        .setDescription('Send the "You\'re all set!" welcome message with server info'),

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

        // Load the editable template (bot_config → command_messages.allset). Defensively
        // fall back to the bundled JSON if the remote row is missing or malformed, so a
        // bad edit can never crash the command.
        let template = commandMessages.allset;
        try {
            const group = await hybridConfig.getConfigGroup('command_messages', commandMessages);
            if (group && typeof group === 'object' && group.allset && typeof group.allset === 'object') {
                template = group.allset;
            }
        } catch (err) {
            console.error('[allset] Failed to load command_messages, using local fallback:', err.message);
        }

        const ctx = {
            user: {
                id: interaction.user.id,
                displayName: interaction.member?.displayName ?? interaction.user.username
            }
        };

        let message;
        try {
            message = renderMessage(template, ctx);
        } catch (err) {
            console.error('[allset] Render failed, using local fallback template:', err.message);
            message = renderMessage(commandMessages.allset, ctx);
        }

        // Send the embed to the channel (explicit allowedMentions keeps DB-authored text
        // from pinging @everyone/@here or roles).
        await interaction.channel.send({
            embeds: message.embeds,
            allowedMentions: message.allowedMentions,
            ...(message.content ? { content: message.content } : {})
        });

        // Confirm to admin (ephemeral)
        await interaction.reply({
            content: '✅ "All set" message sent!',
            ephemeral: true
        });
    },
};
