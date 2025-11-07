const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const config = require('../config.json');
const features = require('../utils/features');

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        console.log(`[GuildMemberAdd] ${member.user.tag} joined the server`);

        // Check if guild member add handling is enabled
        if (!await features.isEventEnabled('handleGuildMemberAdd')) {
            console.log('[GuildMemberAdd] Handler disabled in features.json');
            return;
        }

        try {
            // Add unverified role
            if (await features.isEventEnabled('autoAddUnverifiedRole')) {
                const unverifiedRoleId = config.unverifiedRoleID;
                if (unverifiedRoleId) {
                    try {
                        await member.roles.add(unverifiedRoleId);
                        console.log(`[GuildMemberAdd] Added unverified role to ${member.user.tag}`);
                    } catch (error) {
                        console.error(`[GuildMemberAdd] Failed to add unverified role:`, error.message);
                    }
                }
            }

            // Create join ticket automatically
            if (!await features.isEventEnabled('autoJoinTickets')) {
                console.log('[GuildMemberAdd] Auto join tickets disabled in features.json');
                return;
            }

            const categoryId = config.TICKET_JOIN_CATEGORY_ID;
            if (!categoryId) {
                console.error('[GuildMemberAdd] TICKET_JOIN_CATEGORY_ID not configured');
                return;
            }

            // Create channel name
            const channelName = `join-ticket-${member.user.username}`.toLowerCase().replace(/[^a-z0-9-_]/g, '-');

            // Create the ticket channel
            const ticketChannel = await member.guild.channels.create({
                name: channelName,
                type: 0, // Text channel
                parent: categoryId,
                permissionOverwrites: [
                    {
                        id: member.guild.id,
                        deny: [PermissionFlagsBits.ViewChannel],
                    },
                    {
                        id: member.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory,
                        ],
                    },
                    // Add admin roles
                    ...config.ADMIN_ROLE_IDS.map(roleId => ({
                        id: roleId,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory,
                        ],
                    })),
                ],
            });

            console.log(`[GuildMemberAdd] Created ticket channel: ${ticketChannel.name}`);

            // Create welcome message with verify button
            const welcomeEmbed = new EmbedBuilder()
                .setColor('Blue')
                .setTitle('🔰 Welcome to Volition!')
                .setDescription(
                    `Welcome ${member}!\n\n` +
                    `Thank you for joining our Discord server. This is your personal join ticket.\n\n` +
                    `**Next Steps:**\n` +
                    `1. Click the **Verify My Account** button below\n` +
                    `2. Enter your RuneScape username\n` +
                    `3. We'll check if you meet our requirements\n` +
                    `4. If approved, join our clan in-game!\n\n` +
                    `**Requirements:**\n` +
                    `• 1750+ Total Level OR 50+ EHB\n\n` +
                    `An admin will be with you shortly if you have any questions!`
                )
                .setThumbnail('https://cdn.discordapp.com/icons/571389228806570005/ff45546375fe88eb358088dc1fd4c28b.png?size=480&quality=lossless')
                .setFooter({ text: 'Use /close to close this ticket' })
                .setTimestamp();

            // Create verify button
            const verifyButton = new ButtonBuilder()
                .setCustomId('createverify_start')
                .setLabel('Verify My Account')
                .setStyle(ButtonStyle.Success)
                .setEmoji('✅');

            const row = new ActionRowBuilder().addComponents(verifyButton);

            await ticketChannel.send({
                content: `${member}`,
                embeds: [welcomeEmbed],
                components: [row]
            });

            console.log(`[GuildMemberAdd] ✅ Sent welcome message to ${ticketChannel.name}`);

        } catch (error) {
            console.error('[GuildMemberAdd] Error creating join ticket:', error);
        }
    },
};
