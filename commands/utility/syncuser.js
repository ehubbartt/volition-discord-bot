const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const axios = require('axios');
const db = require('../../db/supabase');
const config = require('../../config.json');
const { RANK_ROLES, determineRank } = require('./sync');
const { isAdmin } = require('../../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('syncuser')
        .setDescription('(Admin Only) Sync a specific user to database and Discord ranks')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The Discord user to sync')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('rsn')
                .setDescription('Their RuneScape name')
                .setRequired(true)),

    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'Admin only command.', ephemeral: true });
        }

        const targetUser = interaction.options.getUser('user');
        const rsn = interaction.options.getString('rsn');
        const clanId = config.clanId;

        await interaction.deferReply({ ephemeral: false });

        await syncUser(interaction, targetUser, rsn, clanId);
    },
};

async function syncUser(interaction, targetUser, rsn, clanId) {
    try {
        await interaction.editReply({
            content: `🔄 Syncing **${rsn}** for <@${targetUser.id}>...\n\nStep 1/5: Checking WOM clan membership...`
        });

        // Fetch clan data
        const womResponse = await axios.get(`https://api.wiseoldman.net/v2/groups/${clanId}`);
        const clanData = womResponse.data;

        if (!clanData || !clanData.memberships) {
            return interaction.editReply({ content: '❌ Failed to retrieve clan data from Wise Old Man.' });
        }

        // Check if player is in clan
        const playerInClan = clanData.memberships.find(
            member => member.player.username.toLowerCase() === rsn.toLowerCase()
        );

        if (!playerInClan) {
            // Player not in clan - check if they exist in database and remove them
            await interaction.editReply({
                content: `⚠️ **${rsn}** is not in the WOM clan...\n\nChecking database...`
            });

            // Try to find player in database by RSN
            const existingPlayer = await db.getPlayerByRSN(rsn);

            if (existingPlayer) {
                // Player exists in database but not in clan - remove them
                await interaction.editReply({
                    content: `⚠️ **${rsn}** is not in the WOM clan...\n\n` +
                        `Found in database - removing...`
                });

                try {
                    await db.deletePlayerByWomId(existingPlayer.wom_id);

                    const removedEmbed = new EmbedBuilder()
                        .setColor('Orange')
                        .setTitle('🗑️ Player Removed from Database')
                        .setDescription(
                            `**${rsn}** was not found in the Volition clan on WOM and has been removed from the database.\n\n` +
                            `**Removed Player:**\n` +
                            `• RSN: ${existingPlayer.rsn}\n` +
                            `• Discord: ${existingPlayer.discord_id ? `<@${existingPlayer.discord_id}>` : 'Not linked'}\n` +
                            `• VP Balance: ${existingPlayer.player_points?.points || 0}\n` +
                            `• WOM ID: ${existingPlayer.wom_id}\n\n` +
                            `**Reason:** Player is no longer in the WOM clan\n\n` +
                            `If this was a mistake, please:\n` +
                            `1. Add the player back to the WOM clan\n` +
                            `2. Run \`/syncuser\` again to re-add them`
                        )
                        .setTimestamp();

                    return interaction.editReply({ content: null, embeds: [removedEmbed] });
                } catch (error) {
                    console.error('[SyncUser] Error removing player from database:', error);
                    const errorEmbed = new EmbedBuilder()
                        .setColor('Red')
                        .setTitle('❌ Database Error')
                        .setDescription(
                            `**${rsn}** is not in the WOM clan, but there was an error removing them from the database.\n\n` +
                            `Error: \`${error.message}\``
                        )
                        .setTimestamp();

                    return interaction.editReply({ content: null, embeds: [errorEmbed] });
                }
            }

            // Player not in clan and not in database
            const errorEmbed = new EmbedBuilder()
                .setColor('Red')
                .setTitle('❌ Not In Clan')
                .setDescription(
                    `**${rsn}** is not found in the Volition clan on Wise Old Man.\n\n` +
                    `The player is also not in the bot's database.\n\n` +
                    `Please make sure:\n` +
                    `1. The player has been added to the WOM clan\n` +
                    `2. The RSN is spelled correctly\n` +
                    `3. WOM clan data is up to date`
                )
                .setTimestamp();

            return interaction.editReply({ content: null, embeds: [errorEmbed] });
        }

        const womId = playerInClan.player.id;
        const actualRsn = playerInClan.player.username;
        const ehb = Math.round(playerInClan.player.ehb || 0);

        await interaction.editReply({
            content: `🔄 Syncing **${rsn}** for <@${targetUser.id}>...\n\n` +
                `✅ Step 1/5: Found in WOM clan\n` +
                `Step 2/5: Fetching detailed stats...`
        });

        // Fetch detailed player stats
        const playerDetailsResponse = await axios.get(`https://api.wiseoldman.net/v2/players/${encodeURIComponent(actualRsn)}`);
        const playerData = playerDetailsResponse.data;

        // Get total level
        let totalLevel = 0;
        if (playerData.latestSnapshot?.data?.skills?.overall) {
            totalLevel = playerData.latestSnapshot.data.skills.overall.level || 0;
        }

        const ehp = Math.round(playerData.ehp || 0);

        await interaction.editReply({
            content: `🔄 Syncing **${rsn}** for <@${targetUser.id}>...\n\n` +
                `✅ Step 1/5: Found in WOM clan\n` +
                `✅ Step 2/5: Stats retrieved (${ehb} EHB, ${totalLevel} Total)\n` +
                `Step 3/5: Checking database...`
        });

        // Check if player already exists
        const existingPlayer = await db.getPlayerByWomId(womId.toString());

        if (existingPlayer && existingPlayer.discord_id && existingPlayer.discord_id !== targetUser.id) {
            // Player exists but linked to different Discord account - offer override
            const overrideButton = new ButtonBuilder()
                .setCustomId(`override_sync_${womId}_${targetUser.id}`)
                .setLabel('Override and Re-link')
                .setStyle(ButtonStyle.Danger);

            const ignoreButton = new ButtonBuilder()
                .setCustomId('ignore_sync')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary);

            const row = new ActionRowBuilder().addComponents(overrideButton, ignoreButton);

            const warningEmbed = new EmbedBuilder()
                .setColor('Orange')
                .setTitle('⚠️ Already Linked')
                .setDescription(
                    `**${actualRsn}** is already linked to <@${existingPlayer.discord_id}>.\n\n` +
                    `Do you want to override and re-link to <@${targetUser.id}>?`
                )
                .setTimestamp();

            return interaction.editReply({ content: null, embeds: [warningEmbed], components: [row] });
        }

        await interaction.editReply({
            content: `🔄 Syncing **${rsn}** for <@${targetUser.id}>...\n\n` +
                `✅ Step 1/5: Found in WOM clan\n` +
                `✅ Step 2/5: Stats retrieved (${ehb} EHB, ${totalLevel} Total)\n` +
                `✅ Step 3/5: Database check passed\n` +
                `Step 4/5: Assigning Discord rank...`
        });

        // Fetch member to get join timestamp for time-based ranks
        const member = await interaction.guild.members.fetch(targetUser.id);

        // Determine and assign rank (with time-based consideration)
        const rank = determineRank(ehb, member.joinedTimestamp, interaction.guild);
        let rankAssigned = false;
        let rankError = null;

        try {
            // Get current rank role (if any)
            const allRankRoleIds = Object.values(RANK_ROLES).filter(id => id !== null);
            const currentRankRole = member.roles.cache.find(role => allRankRoleIds.includes(role.id));

            // Only remove the current rank role, not all roles
            if (currentRankRole) {
                await member.roles.remove(currentRankRole);
                console.log(`[SyncUser] Removed old rank role: ${currentRankRole.name}`);
            }

            // Add new rank role if it exists
            const newRoleId = RANK_ROLES[rank];
            if (newRoleId) {
                await member.roles.add(newRoleId);
                rankAssigned = true;
                console.log(`[SyncUser] Assigned rank ${rank} to ${targetUser.tag}`);
            } else {
                rankError = 'Role ID not configured in bot';
                console.warn(`[SyncUser] Role ID not configured for rank: ${rank}`);
            }
        } catch (error) {
            rankError = error.message;
            console.error('[SyncUser] Failed to assign rank:', error);
        }

        await interaction.editReply({
            content: `🔄 Syncing **${rsn}** for <@${targetUser.id}>...\n\n` +
                `✅ Step 1/5: Found in WOM clan\n` +
                `✅ Step 2/5: Stats retrieved (${ehb} EHB, ${totalLevel} Total)\n` +
                `✅ Step 3/5: Database check passed\n` +
                `${rankAssigned ? '✅' : '⚠️'} Step 4/5: Discord rank ${rankAssigned ? 'assigned' : 'assignment failed'}\n` +
                `Step 5/5: Syncing to database...`
        });

        // Sync to database
        if (existingPlayer) {
            await db.updatePlayer(existingPlayer.id, {
                discord_id: targetUser.id,
                rsn: actualRsn,
                wom_id: womId.toString()
            });
            console.log(`[SyncUser] Updated existing player in database`);
        } else {
            await db.createPlayer({
                rsn: actualRsn,
                discord_id: targetUser.id,
                wom_id: womId.toString()
            }, 0);
            console.log(`[SyncUser] Created new player in database`);
        }

        // Success embed
        const successEmbed = new EmbedBuilder()
            .setColor('Green')
            .setTitle('✅ Sync Complete!')
            .setDescription(
                `<@${targetUser.id}> has been successfully synced!\n\n` +
                `**Assigned Rank:** ${rank}\n\n` +
                `**Completed:**\n` +
                `• ${rankAssigned ? '✅' : '⚠️'} Discord rank ${rankAssigned ? 'assigned' : 'failed'}\n` +
                `• ✅ Database synced\n\n` +
                `**Next Steps:**\n` +
                `• ${rankAssigned ? '✅ Discord rank assigned' : '⚠️ Manually assign Discord rank'}\n` +
                `• Verify in-game rank matches (${rank})`
            )
            .addFields(
                { name: 'Discord User', value: `<@${targetUser.id}>`, inline: true },
                { name: 'RSN', value: actualRsn, inline: true },
                { name: 'WOM ID', value: womId.toString(), inline: true },
                { name: 'Total Level', value: totalLevel.toString(), inline: true },
                { name: 'EHB', value: ehb.toString(), inline: true },
                { name: 'EHP', value: ehp.toString(), inline: true },
                { name: 'Rank', value: rank, inline: true },
                { name: '\u200B', value: '\u200B', inline: true },
                { name: '\u200B', value: '\u200B', inline: true }
            );

        if (!rankAssigned && rankError) {
            successEmbed.addFields({ name: 'Rank Error', value: rankError, inline: false });
        }

        successEmbed.addFields({ name: 'WOM Profile', value: `[View Profile](https://wiseoldman.net/players/${womId})`, inline: false });
        successEmbed.setThumbnail('https://cdn.discordapp.com/icons/571389228806570005/ff45546375fe88eb358088dc1fd4c28b.png?size=480&quality=lossless');
        successEmbed.setTimestamp();

        await interaction.editReply({
            content: null,
            embeds: [successEmbed],
            components: []
        });

    } catch (error) {
        console.error('Error during sync:', error);

        const errorEmbed = new EmbedBuilder()
            .setColor('Red')
            .setTitle('Sync Error')
            .setDescription(
                `An error occurred during sync:\n\`\`\`${error.message}\`\`\`\n\n` +
                `Please contact a senior admin for assistance.`
            )
            .setTimestamp();

        await interaction.editReply({ content: null, embeds: [errorEmbed] });
    }
}

async function handleOverrideSync(interaction, womId, discordId) {
    try {
        await interaction.deferUpdate();

        // Update the player with new discord_id
        const existingPlayer = await db.getPlayerByWomId(womId);

        if (existingPlayer) {
            await db.updatePlayer(existingPlayer.id, {
                discord_id: discordId
            });

            const successEmbed = new EmbedBuilder()
                .setColor('Green')
                .setTitle('✅ Override Complete')
                .setDescription(
                    `Successfully re-linked **${existingPlayer.rsn}** to <@${discordId}>.\n\n` +
                    `Previous Discord link has been removed.`
                )
                .setTimestamp();

            await interaction.editReply({ content: null, embeds: [successEmbed], components: [] });
        }
    } catch (error) {
        console.error('Error during override:', error);
        await interaction.editReply({ content: `Error: ${error.message}`, components: [] });
    }
}

async function handleIgnoreSync(interaction) {
    const cancelEmbed = new EmbedBuilder()
        .setColor('Grey')
        .setTitle('Sync Cancelled')
        .setDescription('The sync operation has been cancelled.')
        .setTimestamp();

    await interaction.update({ content: null, embeds: [cancelEmbed], components: [] });
}

module.exports.syncUser = syncUser;
module.exports.handleOverrideSync = handleOverrideSync;
module.exports.handleIgnoreSync = handleIgnoreSync;
