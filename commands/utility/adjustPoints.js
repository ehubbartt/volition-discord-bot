const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../db/supabase');
const { isAdmin } = require('../../utils/permissions');
const config = require('../../utils/config');

// Pending role payouts awaiting confirmation
const pendingRolePayouts = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('adjustpoints')
        .setDescription('(Admin Only) Adjust VP points for players')
        .addStringOption(option =>
            option.setName('player')
                .setDescription("RSN, @mention, or @role (comma separated for multiple)")
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName('points')
                .setDescription('Positive or negative integers only.')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the adjustment (shown in payout log)')
                .setRequired(false)
        ),

    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        const playerInput = interaction.options.getString('player');
        const pointsToAdd = interaction.options.getInteger('points');
        const reason = interaction.options.getString('reason') || 'Manual adjustment';

        if (isNaN(pointsToAdd)) {
            return interaction.reply({ content: 'Invalid points input. Please enter a valid number.', ephemeral: true });
        }

        // Check if input contains a role mention
        const roleMentionMatch = playerInput.match(/<@&(\d+)>/);

        if (roleMentionMatch) {
            return handleRolePayout(interaction, roleMentionMatch[1], pointsToAdd, reason);
        }

        // Original flow for individual players
        await interaction.deferReply({ ephemeral: false });
        await processPlayerAdjustments(interaction, playerInput, pointsToAdd, reason);
    },

    // Handle confirmation/cancel buttons
    async handleConfirm(interaction) {
        const payout = pendingRolePayouts.get(interaction.message.id);
        if (!payout) {
            return interaction.reply({ content: '❌ This confirmation has expired.', ephemeral: true });
        }

        if (interaction.user.id !== payout.adminId) {
            return interaction.reply({ content: '❌ Only the admin who initiated this can confirm.', ephemeral: true });
        }

        pendingRolePayouts.delete(interaction.message.id);

        await interaction.update({
            content: `Processing ${payout.players.length} payouts...`,
            embeds: [],
            components: []
        });

        const results = [];
        const logChannel = interaction.client.channels.cache.get(config.PAYOUT_LOG_CHANNEL_ID);

        for (const player of payout.players) {
            try {
                const existingPoints = player.points || 0;
                const newTotal = existingPoints + payout.pointsToAdd;
                await db.addPoints(player.rsn, payout.pointsToAdd);

                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setColor(payout.pointsToAdd < 0 ? 'Red' : 'Green')
                        .setTitle(payout.pointsToAdd < 0 ? 'Points Removed' : 'Points Added')
                        .setDescription(
                            `**Player:** <@${player.discord_id}> (${player.rsn})\n` +
                            `**Change:** ${payout.pointsToAdd > 0 ? '+' : ''}${payout.pointsToAdd} VP\n` +
                            `**New Total:** ${newTotal} VP\n` +
                            `**Reason:** ${payout.reason}\n` +
                            `**Adjusted by:** <@${payout.adminId}>`
                        )
                        .setTimestamp();

                    await logChannel.send({ content: `<@${player.discord_id}>`, embeds: [logEmbed] });
                }

                results.push(`<@${player.discord_id}> (${player.rsn}): **${existingPoints}** → **${newTotal}** VP`);
            } catch (err) {
                results.push(`<@${player.discord_id}> (${player.rsn}): ❌ Error — ${err.message}`);
            }
        }

        const embed = new EmbedBuilder()
            .setColor('White')
            .setTitle('Role VP Payout Complete')
            .setThumbnail(config.CLAN_ICON_URL)
            .setDescription(
                `**Role:** <@&${payout.roleId}>\n` +
                `**Amount:** ${payout.pointsToAdd > 0 ? '+' : ''}${payout.pointsToAdd} VP\n` +
                `**Reason:** ${payout.reason}\n\n` +
                results.join('\n').slice(0, 3800)
            )
            .setFooter({ text: `${results.length} player(s) adjusted` })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed], components: [] });
    },

    async handleCancel(interaction) {
        const payout = pendingRolePayouts.get(interaction.message.id);
        if (payout && interaction.user.id !== payout.adminId) {
            return interaction.reply({ content: '❌ Only the admin who initiated this can cancel.', ephemeral: true });
        }

        pendingRolePayouts.delete(interaction.message.id);
        await interaction.update({
            content: '❌ Role payout cancelled.',
            embeds: [],
            components: []
        });
    },
};

// ----------------------------------------------------------------------------
// Role payout — show confirmation first

async function handleRolePayout(interaction, roleId, pointsToAdd, reason) {
    await interaction.deferReply({ ephemeral: false });

    const role = interaction.guild.roles.cache.get(roleId);
    if (!role) {
        return interaction.editReply({ content: '❌ Role not found.' });
    }

    // Fetch all members with this role
    await interaction.guild.members.fetch();
    const membersWithRole = role.members;

    if (membersWithRole.size === 0) {
        return interaction.editReply({ content: `❌ No members found with the <@&${roleId}> role.` });
    }

    // Look up which members are in the database
    const matchedPlayers = [];
    const notFound = [];

    for (const [memberId, member] of membersWithRole) {
        if (member.user.bot) continue;

        const player = await db.getPlayerByDiscordId(memberId);
        if (player) {
            matchedPlayers.push(player);
        } else {
            notFound.push(member.displayName);
        }
    }

    if (matchedPlayers.length === 0) {
        return interaction.editReply({ content: `❌ None of the members in <@&${roleId}> are linked in the database.` });
    }

    const vpEmoji = config.VP_EMOJI_ID ? `<:vp:${config.VP_EMOJI_ID}>` : '🪙';

    // Build confirmation list
    const playerLines = matchedPlayers.map(p =>
        `• <@${p.discord_id}> (${p.rsn}) — ${p.points || 0} VP → **${(p.points || 0) + pointsToAdd}** VP`
    );

    let description =
        `**Role:** <@&${roleId}>\n` +
        `**Amount:** ${pointsToAdd > 0 ? '+' : ''}${pointsToAdd} ${vpEmoji} VP per player\n` +
        `**Reason:** ${reason}\n` +
        `**Players (${matchedPlayers.length}):**\n` +
        playerLines.join('\n').slice(0, 3500);

    if (notFound.length > 0) {
        description += `\n\n⚠️ **Not in database (${notFound.length}):** ${notFound.slice(0, 10).join(', ')}${notFound.length > 10 ? '...' : ''}`;
    }

    const embed = new EmbedBuilder()
        .setColor('Yellow')
        .setTitle('Confirm Role VP Payout')
        .setDescription(description)
        .setFooter({ text: 'This will expire in 60 seconds' })
        .setTimestamp();

    const confirmBtn = new ButtonBuilder()
        .setCustomId('adjustpoints_role_confirm')
        .setLabel(`Confirm (${matchedPlayers.length} players)`)
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅');

    const cancelBtn = new ButtonBuilder()
        .setCustomId('adjustpoints_role_cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌');

    const row = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);

    const reply = await interaction.editReply({ embeds: [embed], components: [row] });

    // Store pending payout
    pendingRolePayouts.set(reply.id, {
        roleId,
        players: matchedPlayers,
        pointsToAdd,
        reason,
        adminId: interaction.user.id,
    });

    // Auto-expire after 60 seconds
    setTimeout(() => {
        if (pendingRolePayouts.has(reply.id)) {
            pendingRolePayouts.delete(reply.id);
            interaction.editReply({
                content: '⏰ Role payout confirmation expired.',
                embeds: [],
                components: []
            }).catch(() => {});
        }
    }, 60000);
}

// ----------------------------------------------------------------------------
// Original per-player adjustment logic

async function processPlayerAdjustments(interaction, playerInput, pointsToAdd, reason) {
    const playerList = playerInput.split(',').map(p => p.trim()).filter(p => p.length > 0);
    const results = [];

    try {
        for (const playerEntry of playerList) {
            let player = null;
            let displayName = '';

            const mentionMatch = playerEntry.match(/^<@!?(\d+)>$/);

            if (mentionMatch) {
                const userId = mentionMatch[1];
                player = await db.getPlayerByDiscordId(userId);

                if (!player) {
                    results.push(`<@${userId}>: Not found in the clan database.`);
                    continue;
                }

                displayName = `<@${userId}> (${player.rsn})`;
            } else {
                player = await db.getPlayerByRSN(playerEntry);
                displayName = playerEntry;

                if (!player) {
                    results.push(`**${playerEntry}**: Not found in the clan database.`);
                    continue;
                }
            }

            const existingPoints = player.points || 0;
            const newTotalPoints = existingPoints + pointsToAdd;

            await db.addPoints(player.rsn, pointsToAdd);

            const logChannel = interaction.client.channels.cache.get(config.PAYOUT_LOG_CHANNEL_ID);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setColor(pointsToAdd < 0 ? 'Red' : 'Green')
                    .setTitle(pointsToAdd < 0 ? 'Points Removed' : 'Points Added')
                    .setDescription(
                        `**Player:** ${displayName}\n` +
                        `**Change:** ${pointsToAdd > 0 ? '+' : ''}${pointsToAdd} VP\n` +
                        `**New Total:** ${newTotalPoints} VP\n` +
                        `**Reason:** ${reason}\n` +
                        `**Adjusted by:** <@${interaction.user.id}>`
                    )
                    .setTimestamp();

                const userPing = player.discord_id ? `<@${player.discord_id}>` : `**${player.rsn}**`;
                await logChannel.send({ content: userPing, embeds: [logEmbed] });
            }

            results.push(pointsToAdd < 0
                ? `Removed **${Math.abs(pointsToAdd)}** points from ${displayName}. New total: **${newTotalPoints}**.`
                : `Added **${pointsToAdd}** points to ${displayName}. New total: **${newTotalPoints}**.`);
        }

        const embed = new EmbedBuilder()
            .setColor('White')
            .setTitle('Volition Points Adjusted')
            .setThumbnail(config.CLAN_ICON_URL)
            .setDescription(results.join('\n').slice(0, 4096));

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('Error adjusting points:', error.message);
        await interaction.editReply({ content: 'Error adjusting points. Check console for help with debugging.' });
    }
}
