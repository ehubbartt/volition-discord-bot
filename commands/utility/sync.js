const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');
const axios = require('axios');
const db = require('../../db/supabase');
const config = require('../../config.json');
const { isAdmin } = require('../../utils/permissions');

// Role name to role ID mapping
const RANK_ROLES = {
    ':Sweat: Sweat': '1339599170394259517',
    ':MasterGeneral: Master General': '1339599293413068860',
    ':TouchGrass: Touch Grass': '1339599017813741652',
    ':WR: Wrath': '1238443298625159220',
    ':TZ: Top Dawgs': '1309545563498352772',
    ':GO: Mind Goblin': '1087162684602056775',
    ':SA: Holy': '1309547277966377050',
    ':S_~1: Skull': '1087485648832843796',
    ':SL: SLAAAAAY': '1309545367880208405',
    ':GU: Guthixian': '1087167843998650399',
    ':de: Black Hearts': '1309548746844930058',
    ':HE: Discord Kitten': '1087482275307978894',
    ':AP: Brewaholic': '1213921453762809886',
    ':OP: Unverified': null // Not provided
};

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
        const womResponse = await axios.get(`https://api.wiseoldman.net/v2/groups/${clanId}`);
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

        // Process each WOM clan member
        for (const member of clanMembers) {
            const womId = member.player.id.toString();
            const rsn = member.player.username;
            const ehb = Math.round(member.player.ehb || 0);

            const existingPlayer = existingWomIds.get(womId);

            if (!existingPlayer) {
                // New member - add to database
                try {
                    await db.createPlayer({
                        rsn: rsn,
                        discord_id: null,
                        wom_id: womId
                    }, 0);
                    newMembersAdded++;
                    const expectedRank = determineRank(ehb); // No join time for new members
                    newMembers.push({ rsn, womId, ehb, rank: expectedRank });
                    console.log(`[FullSync] Added new member: ${rsn} (${womId})`);
                } catch (error) {
                    console.error(`[FullSync] Failed to add ${rsn}:`, error.message);
                }
            } else {
                // Existing member - update RSN if it changed
                if (existingPlayer.rsn !== rsn) {
                    try {
                        await db.updatePlayer(existingPlayer.id, { rsn: rsn });
                        console.log(`[FullSync] Updated RSN: ${existingPlayer.rsn} -> ${rsn} (WOM ID: ${womId})`);
                    } catch (error) {
                        console.error(`[FullSync] Failed to update RSN for ${womId}:`, error.message);
                    }
                }

                // Existing member - check Discord rank if they have a discord_id
                if (existingPlayer.discord_id) {
                    try {
                        const discordMember = await interaction.guild.members.fetch(existingPlayer.discord_id);
                        const currentRankRole = getRankRole(discordMember);

                        // Pass the member's join timestamp for time-based ranks
                        const expectedRank = determineRank(ehb, discordMember.joinedTimestamp);

                        if (currentRankRole !== expectedRank) {
                            // ACTIVE MODE - Actually change ranks
                            const timeInClan = Date.now() - discordMember.joinedTimestamp;
                            const daysInClan = Math.floor(timeInClan / (1000 * 60 * 60 * 24));

                            try {
                                // Get all rank role IDs
                                const allRankRoleIds = Object.values(RANK_ROLES).filter(id => id !== null);
                                const currentRankRoleObj = discordMember.roles.cache.find(role => allRankRoleIds.includes(role.id));

                                // Remove old rank role if exists
                                if (currentRankRoleObj) {
                                    await discordMember.roles.remove(currentRankRoleObj);
                                    console.log(`[FullSync] Removed old rank role: ${currentRankRoleObj.name}`);
                                }

                                // Add new rank role
                                const newRoleId = RANK_ROLES[expectedRank];
                                if (newRoleId) {
                                    await discordMember.roles.add(newRoleId);
                                    ranksUpdated++;
                                    console.log(`[FullSync] Updated rank for ${rsn}: ${currentRankRole || 'None'} -> ${expectedRank} (${ehb} EHB, ${daysInClan} days)`);

                                    rankMismatches.push({
                                        rsn,
                                        currentRank: currentRankRole || 'None',
                                        expectedRank,
                                        ehb,
                                        daysInClan,
                                        issue: `Updated: ${currentRankRole || 'None'} -> ${expectedRank}`
                                    });
                                } else {
                                    console.warn(`[FullSync] Role ID not configured for rank: ${expectedRank}`);
                                }
                            } catch (roleError) {
                                rankUpdatesFailed++;
                                rankMismatches.push({ rsn, currentRank: currentRankRole || 'None', expectedRank, ehb, daysInClan, issue: `Failed: ${roleError.message}` });
                                console.error(`[FullSync] Failed to update rank for ${rsn}:`, roleError.message);
                            }
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
                            rankMismatches.push({ rsn, expectedRank: 'Error', issue: error.message });
                            console.error(`[FullSync] Failed to check rank for ${rsn}:`, error.message);
                        }
                    }
                } else {
                    // Player in clan but has no discord_id - they're not linked yet, just skip
                    console.log(`[FullSync] Skipped ${rsn} - in clan but not linked to Discord`);
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

        // Remove players who are no longer in the clan
        for (const player of existingPlayers) {
            const womId = player.wom_id?.toString();
            if (womId && !clanMemberWomIds.has(womId)) {
                try {
                    await db.deletePlayerByWomId(womId);
                    membersRemoved++;
                    removedMembers.push({ rsn: player.rsn, womId });
                    console.log(`[FullSync] Removed leaver: ${player.rsn} (${womId})`);
                } catch (error) {
                    console.error(`[FullSync] Failed to remove ${player.rsn}:`, error.message);
                }
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
            .setThumbnail('https://i.imgur.com/BJJpBj2.png')
            .setTimestamp();

        // Add new members details if any
        if (newMembers.length > 0) {
            let newMembersText = newMembers.slice(0, 10).map(m =>
                `• ${m.rsn} (${m.ehb} EHB - ${m.rank})`
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
                `• **${m.rsn}**: ${m.currentRank} -> ${m.expectedRank} (${m.ehb} EHB, ${m.daysInClan} days)`
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

function determineRank (ehb, memberJoinedTimestamp = null, guild = null) {
    // Calculate time in clan (in milliseconds)
    const timeInClan = memberJoinedTimestamp ? Date.now() - memberJoinedTimestamp : 0;
    const daysInClan = timeInClan / (1000 * 60 * 60 * 24);
    const monthsInClan = daysInClan / 30;
    const yearsInClan = daysInClan / 365;

    let rankName = '';
    let emojiName = '';

    // Check pure EHB ranks first (no time requirement)
    if (ehb >= 3000) {
        emojiName = 'Sweat';
        rankName = 'Sweat';
    } else if (ehb >= 2500) {
        emojiName = 'MasterGeneral';
        rankName = 'Master General';
    } else if (ehb >= 2000) {
        emojiName = 'TouchGrass';
        rankName = 'Touch Grass';
    } else if (ehb >= 1500) {
        emojiName = 'WR';
        rankName = 'Wrath';
    } else if (ehb >= 1250) {
        emojiName = 'TZ';
        rankName = 'Top Dawgs';
    } else if (ehb >= 1000) {
        emojiName = 'GO';
        rankName = 'Mind Goblin';
    } else if (ehb >= 900) {
        emojiName = 'SA';
        rankName = 'Holy';
    } else if (ehb >= 800) {
        emojiName = 'S_~1';
        rankName = 'Skull';
    } else if (ehb >= 650) {
        emojiName = 'SL';
        rankName = 'SLAAAAAY';
    } else if (ehb >= 500 || yearsInClan >= 2) {
        emojiName = 'GU';
        rankName = 'Guthixian';
    } else if (ehb >= 350 || yearsInClan >= 1) {
        emojiName = 'de';
        rankName = 'Black Hearts';
    } else if (ehb >= 200 || monthsInClan >= 6) {
        emojiName = 'HE';
        rankName = 'Discord Kitten';
    } else {
        emojiName = 'AP';
        rankName = 'Brewaholic';
    }

    // If guild is provided, try to find and use the actual emoji
    if (guild) {
        const emoji = guild.emojis.cache.find(e => e.name === emojiName);
        if (emoji) {
            return `${emoji} ${rankName}`;
        }
    }

    // Fallback to text format if guild not provided or emoji not found
    return `:${emojiName}: ${rankName}`;
}

function getRankRole (member) {
    const allRankRoleIds = Object.values(RANK_ROLES).filter(id => id !== null);
    const memberRankRole = member.roles.cache.find(role => allRankRoleIds.includes(role.id));

    if (!memberRankRole) return null;

    // Find the rank name by role ID
    for (const [rankName, roleId] of Object.entries(RANK_ROLES)) {
        if (roleId === memberRankRole.id) {
            return rankName;
        }
    }

    return null;
}

module.exports.fullClanSync = fullClanSync;
module.exports.determineRank = determineRank;
module.exports.RANK_ROLES = RANK_ROLES;
