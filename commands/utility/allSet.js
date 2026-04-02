const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../../config.json');

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

        // Build custom emojis
        const vpEmoji = `<:VP:${config.VP_EMOJI_ID}>`;
        const lcEmoji = config.LC_EMOJI_ID !== 'NEEDS_ID' ? `<:LC:${config.LC_EMOJI_ID}>` : ':package:';
        const alertEmoji = config.ALERT_2_EMOJI_ID !== 'NEEDS_ID' ? `<:ALERT_2:${config.ALERT_2_EMOJI_ID}>` : ':bell:';
        const hasbgrinEmoji = config.HASBGRIN_EMOJI_ID !== 'NEEDS_ID' ? `<:hasbgrin:${config.HASBGRIN_EMOJI_ID}>` : '😁';

        // Build channel mentions
        const vpChannel = config.VOLITION_POINTS_CHANNEL_ID !== 'NEEDS_ID' ? `<#${config.VOLITION_POINTS_CHANNEL_ID}>` : '⁠⚠️・volition-points';
        const lootCrateChannel = config.LOOT_CRATE_INFO_CHANNEL_ID !== 'NEEDS_ID' ? `<#${config.LOOT_CRATE_INFO_CHANNEL_ID}>` : '⁠📦・volition-loot-crate-info';
        const assignRolesChannel = config.ASSIGN_ROLES_CHANNEL_ID !== 'NEEDS_ID' ? `<#${config.ASSIGN_ROLES_CHANNEL_ID}>` : '⁠📧・assign-roles';

        const allSetEmbed = new EmbedBuilder()
            .setColor('Green')
            .setTitle('🎉 You\'re All Set!')
            .setDescription(
                `Welcome to Volition! Here are some areas of interest on this Discord server:\n\n` +
                `${vpChannel} - Gain an understanding of our Volition Points system ${vpEmoji}\n` +
                `${lootCrateChannel} - Claim your daily loot crate & see how you can win prizes! ${lcEmoji}\n` +
                `${assignRolesChannel} - Customise your pings according to your interests ${alertEmoji}\n\n` +
                `Welcome to Volition and happy scaping! 🥳${hasbgrinEmoji}`
            )
            .setThumbnail(config.CLAN_ICON_URL)
            .setFooter({ text: 'Enjoy your stay with us!' })
            .setTimestamp();

        // Send the embed to the channel
        await interaction.channel.send({ embeds: [allSetEmbed] });

        // Confirm to admin (ephemeral)
        await interaction.reply({
            content: '✅ "All set" message sent!',
            ephemeral: true
        });
    },
};
