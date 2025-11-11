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

            // Create channel name with unverified emoji and unclaimed emoji
            // Use displayName (server nickname) or globalName (new display name) as fallback to username
            const displayName = member.displayName || member.user.globalName || member.user.username;
            const channelName = `${config.UNVERIFIED_EMOJI}・join-${displayName}・${config.UNCLAIMED_EMOJI}`.toLowerCase();

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
                    `**Joining as Guest?**\n` +
                    `If you have a friend or main account in the clan, click **Join as Guest** instead!\n\n` +
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

            // Create guest join button
            const guestButton = new ButtonBuilder()
                .setCustomId('guest_join_start')
                .setLabel('Join as Guest')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('👋');

            const row = new ActionRowBuilder().addComponents(verifyButton, guestButton);

            // Send admin control panel first
            const claimButton = new ButtonBuilder()
                .setCustomId('ticket_claim')
                .setLabel('Claim Ticket')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('👤');

            const closeButton = new ButtonBuilder()
                .setCustomId('ticket_close')
                .setLabel('Close Ticket')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🔒');

            const softCloseButton = new ButtonBuilder()
                .setCustomId('ticket_soft_close')
                .setLabel('Soft Close')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('⏰');

            const adminRow = new ActionRowBuilder().addComponents(claimButton, closeButton, softCloseButton);

            await ticketChannel.send({
                content: '**Admin Controls** (Admin only)',
                components: [adminRow]
            });

            // Send welcome message to user
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
