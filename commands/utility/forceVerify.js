const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('forceverify')
        .setDescription('(Admin Only) Force verify a user and give them verified role')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to force verify')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('guest')
                .setDescription('Is this user a guest? (guests do not get intro message)')
                .setRequired(false)),

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

        const targetUser = interaction.options.getUser('user');
        const isGuest = interaction.options.getBoolean('guest') || false;
        const member = await interaction.guild.members.fetch(targetUser.id);

        await interaction.deferReply({ ephemeral: true });

        try {
            // Remove unverified role
            if (config.unverifiedRoleID && member.roles.cache.has(config.unverifiedRoleID)) {
                await member.roles.remove(config.unverifiedRoleID);
                console.log(`[ForceVerify] Removed unverified role from ${targetUser.tag}`);
            }

            // Add verified role
            if (config.verifiedRoleID) {
                await member.roles.add(config.verifiedRoleID);
                console.log(`[ForceVerify] Added verified role to ${targetUser.tag}`);
            }

            // Update ticket name if in a ticket channel
            const ticketCategories = [
                config.TICKET_JOIN_CATEGORY_ID,
                config.TICKET_GENERAL_CATEGORY_ID,
                config.TICKET_SHOP_CATEGORY_ID
            ];

            if (ticketCategories.includes(interaction.channel.parentId)) {
                const ticketManager = require('../../utils/ticketManager');
                ticketManager.markVerified(interaction.channel.id);

                const newName = interaction.channel.name.replace(config.UNVERIFIED_EMOJI, config.VERIFIED_EMOJI);
                try {
                    await interaction.channel.setName(newName);
                    console.log(`[ForceVerify] Updated ticket channel name to: ${newName}`);
                } catch (error) {
                    console.error('[ForceVerify] Failed to update channel name:', error);
                }
            }

            // Send confirmation to admin
            if (isGuest) {
                await interaction.editReply({
                    content: `✅ Force verified ${targetUser} as a **guest** (${targetUser.tag})\n\n` +
                        `Roles updated:\n` +
                        `• Removed: Unverified\n` +
                        `• Added: Verified\n\n` +
                        `**Note:** No introduction required for guests.`
                });
            } else {
                await interaction.editReply({
                    content: `✅ Force verified ${targetUser} (${targetUser.tag})\n\n` +
                        `Roles updated:\n` +
                        `• Removed: Unverified\n` +
                        `• Added: Verified\n\n` +
                        `**Note:** Introduction message sent in ticket channel.`
                });
            }

            // Send intro button ONLY if NOT a guest and in a ticket channel
            if (!isGuest && ticketCategories.includes(interaction.channel.parentId)) {
                const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
                const vpEmoji = `<:VP:${config.VP_EMOJI_ID}>`;

                const welcomeMessage =
                    `## You've been verified! ${vpEmoji}\n\n` +
                    `We ask you kindly that __your discord name on this server matches your in game name__.\n\n` +
                    `* Make sure you can see all channels by clicking ''Volition'' in the top left corner and then ticking the ''Show All Channels'' box!\n` +
                    `* Use the button below to send an introductory message in <#1350979144950743161>.\n\n` +
                    `Once this is done we will help you join the clan in game.`;

                const introButton = new ButtonBuilder()
                    .setCustomId('intro_start')
                    .setLabel('Fill Out Introduction')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('📝');

                const row = new ActionRowBuilder().addComponents(introButton);

                await interaction.channel.send({
                    content: `${targetUser} ${welcomeMessage}`,
                    components: [row]
                });
            } else if (isGuest && ticketCategories.includes(interaction.channel.parentId)) {
                // Send simple welcome for guest
                await interaction.channel.send({
                    content: `${targetUser} Welcome to Volition! 🎉 You've been verified as a guest. No introduction needed - enjoy your stay!`
                });
            }

            console.log(`[ForceVerify] ${interaction.user.tag} force verified ${targetUser.tag}${isGuest ? ' (guest)' : ''}`);

        } catch (error) {
            console.error('[ForceVerify] Error during force verify:', error);

            await interaction.editReply({
                content: `❌ Failed to force verify ${targetUser}:\n\`\`\`${error.message}\`\`\``
            });
        }
    }
};
