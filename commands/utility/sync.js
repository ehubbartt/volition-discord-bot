const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const { womApi } = require('../../utils/api');
const db = require('../../db/supabase');
const clanLeavers = require('../../db/clanLeavers');
const dinkTokens = require('../../db/dinkTokens');
const dinkProxy = require('../../services/dinkProxy');
const config = require('../../config.json');
const { isAdmin } = require('../../utils/permissions');
const {
    formatRank,
    formatRoleById,
    applyEffectiveRank,
    getWomRole,
    ENTRY_RANK_INDEX
} = require('../../utils/ranks');
const { broadcastRankUps } = require('../../utils/rankAnnouncements');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sync')
        .setDescription('(Admin Only) Full clan sync - syncs all WOM clan members to database and Discord'),

    async execute (interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'Admin only command.', ephemeral: true });
        }

        const clanId = config.clanId;

        await interaction.deferReply({ ephemeral: false });

        await fullClanSync(interaction, clanId);
    },
};

async function fullClanSync (interaction, clanId) {
    try {
        await interaction.editReply({
            content: '🔄 Starting full clan sync...\n\nStep 1/4: Fetching WOM clan data...'
        });

        // Fetch clan data from WOM
        const womResponse = await womApi.get(`/groups/${clanId}`);
        const clanData = womResponse.data;

        if (!clanData || !clanData.memberships) {
            return interaction.editReply({ content: '❌ Failed to retrieve clan data from Wise Old Man.' });
        }

        const clanMembers = clanData.memberships;
        const clanMemberWomIds = new Set(clanMembers.map(m => m.player.id.toString()));

        await interaction.editReply({
            content: `🔄 Starting full clan sync...\n\n` +
                `✅ Step 1/4: Fetched ${clanMembers.length} clan members from WOM\n` +
                `Step 2/4: Loading database...`
        });

        // Get all existing players from database
        const existingPlayers = await db.getAllPlayers();
        const existingWomIds = new Map(existingPlayers.map(p => [p.wom_id?.toString(), p]));

        await interaction.editReply({
            content: `🔄 Starting full clan sync...\n\n` +
                `✅ Step 1/4: Fetched ${clanMembers.length} clan members from WOM\n` +
                `✅ Step 2/4: Loaded ${existingPlayers.length} players from database\n` +
                `Step 3/4: Processing new members and updates...`
        });

        // Track sync stats
        let newMembersAdded = 0;
        let membersRemoved = 0;
        let ranksUpdated = 0;
        let rankUpdatesFailed = 0;
        const newMembers = [];
        const removedMembers = [];
        const rankMismatches = [];
        const rankUpAnnouncements = [];

        // Process each WOM clan member
        for (const member of clanMembers) {
            const womId = member.player.id.toString();
            const rsn = member.player.username;
            const ehb = Math.round(member.player.ehb || 0);
            const clanJoinedAt = member.createdAt; // WOM clan join timestamp

            const existingPlayer = existingWomIds.get(womId);

            if (!existingPlayer) {
                // New member - add to database at the ENTRY rank. The bot never computes
                // rank; the site scores them later and writes players.rank, which the
                // daily sync then mirrors to their Discord role.
                try {
                    await db.createPlayer({
                        rsn: rsn,
                        discord_id: null,
                        wom_id: womId,
                        clan_joined_at: clanJoinedAt,
                        rank: getWomRole(ENTRY_RANK_INDEX)
                    }, 0);
                    newMembersAdded++;
                    newMembers.push({ rsn, womId, ehb, rankIndex: ENTRY_RANK_INDEX });
                    console.log(`[FullSync] Added new member: ${rsn} (${womId})`);

                    // Check if this is a returning former member
                    try {
                        const formerMember = await clanLeavers.getFormerMemberByWomId(womId);
                        if (formerMember) {
                            const logChannel = interaction.client.channels.cache.get(config.TEST_CHANNEL_ID);
                            if (logChannel) {
                                const adminMentions = config.ADMINS_TO_PING.map(roleId => `<@&${roleId}>`).join(' ');
                                const leftDate = formerMember.left_at
                                    ? `<t:${Math.floor(new Date(formerMember.left_at).getTime() / 1000)}:R>`
                                    : 'Unknown';

                                const returnEmbed = new EmbedBuilder()
                                    .setColor('Orange')
                                    .setTitle('🔄 Former Member Returning!')
                                    .setDescription(
                                        `**${rsn}** was previously in the clan and has rejoined via WOM sync.\n\n` +
                                        `**Previous Data:**\n` +
                                        `• RSN: ${formerMember.rsn}\n` +
                                        `• VP Balance: ${formerMember.points || 0}\n` +
                                        `• Lifetime VP: ${formerMember.lifetime_vp || 0}\n` +
                                        `• Discord: ${formerMember.discord_id ? `<@${formerMember.discord_id}>` : 'Not linked'}\n` +
                                        `• Left: ${leftDate}\n\n` +
                                        `Use the button below to restore their VP.`
                                    )
                                    .setTimestamp();

                                const restoreButton = new ButtonBuilder()
                                    .setCustomId(`restore_vp_${formerMember.id}`)
                                    .setLabel('Restore VP')
                                    .setStyle(ButtonStyle.Success)
                                    .setEmoji('💰');

                                const dismissButton = new ButtonBuilder()
                                    .setCustomId(`restore_vp_dismiss_${formerMember.id}`)
                                    .setLabel('Dismiss')
                                    .setStyle(ButtonStyle.Secondary);

                                const row = new ActionRowBuilder().addComponents(restoreButton, dismissButton);

                                await logChannel.send({
                                    content: `${adminMentions}`,
                                    embeds: [returnEmbed],
                                    components: [row],
                                    allowedMentions: { roles: config.ADMIN_ROLE_IDS }
                                });
                            }
                        }
                    } catch (leaverErr) {
                        console.error(`[FullSync] Error checking former member ${rsn}:`, leaverErr.message);
                    }
                } catch (error) {
                    console.error(`[FullSync] Failed to add ${rsn}:`, error.message);
                }
            } else {
                // Existing member - update RSN and clan join date. players.rank is NOT
                // touched: the site owns it (composite score), and writing an EHB-derived
                // value here would clobber it on every sync.
                const updates = {};
                if (existingPlayer.rsn !== rsn) {
                    updates.rsn = rsn;
                }
                if (clanJoinedAt && existingPlayer.clan_joined_at !== clanJoinedAt) {
                    updates.clan_joined_at = clanJoinedAt;
                }

                if (Object.keys(updates).length > 0) {
                    try {
                        await db.updatePlayer(existingPlayer.id, updates);
                        console.log(`[FullSync] Updated player ${rsn} (WOM ID: ${womId}):`, updates);
                    } catch (error) {
                        console.error(`[FullSync] Failed to update ${womId}:`, error.message);
                    }
                }

                // Existing member - mirror their stored (site-computed) rank to Discord
                // if they have a discord_id. No stored rank yet → leave the role alone.
                if (existingPlayer.discord_id && existingPlayer.rank) {
                    try {
                        const discordMember = await interaction.guild.members.fetch(existingPlayer.discord_id);
                        // Mirror the member's CHOSEN rank (signature when they opted in + earned
                        // one, else their composite ladder rank) to Discord.
                        const discordRankResult = await applyEffectiveRank({ player: existingPlayer, member: discordMember });

                        if (discordRankResult.changed) {
                            ranksUpdated++;
                            const arrow = discordRankResult.isUpgrade ? '⬆️' : '⬇️';
                            const action = discordRankResult.isUpgrade ? 'Upgraded' : 'Downgraded';
                            const oldStr = formatRoleById(interaction.guild, discordRankResult.oldRoleId);
                            const newStr = formatRoleById(interaction.guild, discordRankResult.newRoleId);
                            console.log(`[FullSync] ${arrow} ${action} rank for ${rsn}: ${oldStr} -> ${newStr} (${ehb} EHB)`);

                            rankMismatches.push({
                                rsn,
                                oldRoleId: discordRankResult.oldRoleId,
                                newRoleId: discordRankResult.newRoleId,
                                ehb,
                                issue: `${action}: ${oldStr} -> ${newStr}`
                            });

                            // Track rank-ups for announcement (signature unlocks included).
                            if (discordRankResult.isUpgrade) {
                                rankUpAnnouncements.push({
                                    member: discordMember,
                                    rsn,
                                    ehb,
                                    oldRoleId: discordRankResult.oldRoleId,
                                    newRoleId: discordRankResult.newRoleId,
                                    isInitial: discordRankResult.isInitial,
                                    isSignature: discordRankResult.isSignature
                                });
                            }
                        } else if (discordRankResult.error) {
                            rankUpdatesFailed++;
                            rankMismatches.push({ rsn, oldRoleId: discordRankResult.oldRoleId, newRoleId: discordRankResult.newRoleId, ehb, issue: `Failed: ${discordRankResult.error}` });
                            console.error(`[FullSync] Failed to update rank for ${rsn}:`, discordRankResult.error);
                        }
                    } catch (error) {
                        // Check if error is "Unknown Member" (Discord user no longer in server)
                        if (error.message === 'Unknown Member' || error.code === 10007) {
                            // User left Discord but is still in clan - clear their discord_id but keep them in database
                            try {
                                await db.updatePlayer(existingPlayer.id, {
                                    discord_id: null
                                });
                                console.log(`[FullSync] Cleared discord_id for ${rsn} (user left Discord but still in clan)`);
                            } catch (updateError) {
                                console.error(`[FullSync] Failed to clear discord_id for ${rsn}:`, updateError.message);
                                rankUpdatesFailed++;
                            }
                        } else {
                            rankUpdatesFailed++;
                            rankMismatches.push({ rsn, expectedRankIndex: -1, issue: error.message });
                            console.error(`[FullSync] Failed to check rank for ${rsn}:`, error.message);
                        }
                    }
                } else if (!existingPlayer.discord_id) {
                    // Player in clan but has no discord_id - they're not linked yet, just skip
                    console.log(`[FullSync] Skipped ${rsn} - in clan but not linked to Discord`);
                } else {
                    // Linked but the site hasn't computed a rank for them yet.
                    console.log(`[FullSync] Skipped ${rsn} - no site-computed rank yet`);
                }
            }
        }

        await interaction.editReply({
            content: `🔄 Starting full clan sync...\n\n` +
                `✅ Step 1/4: Fetched ${clanMembers.length} clan members from WOM\n` +
                `✅ Step 2/4: Loaded ${existingPlayers.length} players from database\n` +
                `✅ Step 3/4: Processed members (${newMembersAdded} new, ${ranksUpdated} ranks updated)\n` +
                `Step 4/4: Removing members who left...`
        });

        // Remove players who are no longer in the clan (archive first)
        let dinkRevokesMade = false;
        for (const player of existingPlayers) {
            const womId = player.wom_id?.toString();
            if (womId && !clanMemberWomIds.has(womId)) {
                try {
                    // Archive player data before deletion
                    await clanLeavers.archivePlayer(player);
                    await db.deletePlayerByWomId(womId);
                    membersRemoved++;
                    removedMembers.push({ rsn: player.rsn, womId });
                    console.log(`[FullSync] Archived & removed leaver: ${player.rsn} (${womId})`);

                    if (player.discord_id) {
                        try {
                            await dinkTokens.revokeTokensFor(player.discord_id);
                            dinkRevokesMade = true;
                        } catch (err) {
                            console.error(`[FullSync] Dink revoke failed for ${player.rsn}:`, err.message);
                        }
                    }
                } catch (error) {
                    console.error(`[FullSync] Failed to remove ${player.rsn}:`, error.message);
                }
            }
        }

        if (dinkRevokesMade) {
            try {
                await dinkProxy.syncWorker();
                console.log('[FullSync] ✅ Synced Dink proxy after batch revoke');
            } catch (err) {
                console.error('[FullSync] Dink proxy sync failed:', err.message);
            }
        }

        // Create summary embed
        const summaryEmbed = new EmbedBuilder()
            .setTitle('📋 Full Clan Sync Report')
            .setColor('Green')
            .setDescription(
                `**✅ Sync Complete!**\n\n` +
                `All clan members have been synced with the database and Discord ranks have been updated.\n\n` +
                `**Summary:**`
            )
            .addFields(
                { name: 'Total WOM Members', value: clanMembers.length.toString(), inline: true },
                { name: 'New Members Added', value: newMembersAdded.toString(), inline: true },
                { name: 'Members Removed', value: membersRemoved.toString(), inline: true },
                { name: 'Ranks Updated', value: ranksUpdated.toString(), inline: true },
                { name: 'Failed Updates', value: rankUpdatesFailed.toString(), inline: true },
                { name: '\u200B', value: '\u200B', inline: true }
            )
            .setThumbnail(config.CLAN_ICON_URL)
            .setTimestamp();

        // Add new members details if any
        if (newMembers.length > 0) {
            let newMembersText = newMembers.slice(0, 10).map(m =>
                `• ${m.rsn} (${m.ehb} EHB - ${formatRank(interaction.guild, m.rankIndex)})`
            ).join('\n');

            if (newMembers.length > 10) {
                newMembersText += `\n... and ${newMembers.length - 10} more`;
            }

            summaryEmbed.addFields({ name: 'New Members Added', value: newMembersText, inline: false });
        }

        // Add removed members details if any
        if (removedMembers.length > 0) {
            let removedMembersText = removedMembers.slice(0, 10).map(m =>
                `• ${m.rsn}`
            ).join('\n');

            if (removedMembers.length > 10) {
                removedMembersText += `\n... and ${removedMembers.length - 10} more`;
            }

            summaryEmbed.addFields({ name: 'Members Removed (Left Clan)', value: removedMembersText, inline: false });
        }

        // Add rank mismatch alerts if any
        if (rankMismatches.length > 0) {
            let mismatchText = rankMismatches.slice(0, 10).map(m =>
                `• **${m.rsn}**: ${formatRoleById(interaction.guild, m.oldRoleId)} -> ${formatRoleById(interaction.guild, m.newRoleId)} (${m.ehb} EHB)`
            ).join('\n');

            if (rankMismatches.length > 10) {
                mismatchText += `\n... and ${rankMismatches.length - 10} more (check console logs)`;
            }

            summaryEmbed.addFields({
                name: '🔄 Rank Changes Made',
                value: mismatchText,
                inline: false
            });
        }

        await interaction.editReply({
            content: null,
            embeds: [summaryEmbed]
        });

        // Broadcast rank-ups to #rank-ups channel
        await broadcastRankUps(interaction.guild, rankUpAnnouncements, '[FullSync]');

    } catch (error) {
        console.error('Error during full clan sync:', error);

        const errorEmbed = new EmbedBuilder()
            .setColor('Red')
            .setTitle('Sync Error')
            .setDescription(
                `An error occurred during full clan sync:\n\`\`\`${error.message}\`\`\`\n\n` +
                `Please contact a senior admin for assistance.`
            )
            .setTimestamp();

        await interaction.editReply({ content: null, embeds: [errorEmbed] });
    }
}

module.exports.fullClanSync = fullClanSync;
