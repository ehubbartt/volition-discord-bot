const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const axios = require('axios');
const db = require('../../db/supabase');
const config = require('../../config.json');
const { determineRank } = require('./sync');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('testpostverify')
        .setDescription('(Admin Only) Test post-clan verification sync')
        .addStringOption(option =>
            option.setName('mode')
                .setDescription('Sync mode')
                .setRequired(false)
                .addChoices(
                    { name: 'Sync Me (automatic)', value: 'auto' },
                    { name: 'Sync Specific User', value: 'manual' },
                    { name: 'Sync All Members', value: 'all' }
                )),

    async execute(interaction) {
        const isAdmin = interaction.member.roles.cache.has(config.ADMIN_ROLE_IDS[0]);

        if (!isAdmin) {
            return interaction.reply({ content: 'Admin only command.', ephemeral: true });
        }

        const mode = interaction.options.getString('mode') || 'auto';

        if (mode === 'auto') {
            // Automatically sync the user who ran the command
            await handleAutoSync(interaction);
        } else if (mode === 'all') {
            // Sync all clan members
            await handleSyncAll(interaction);
        } else {
            // Manual mode - show button with modal
            const syncButton = new ButtonBuilder()
                .setCustomId('postverify_start')
                .setLabel('Sync Specific User')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🔄');

            const row = new ActionRowBuilder().addComponents(syncButton);

            await interaction.reply({
                content: 'Click the button to sync a specific user:',
                components: [row]
            });
        }
    },
};

async function handlePostVerifyButton(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('postverify_modal')
        .setTitle('Complete Clan Sync');

    const rsnInput = new TextInputBuilder()
        .setCustomId('rsn_input')
        .setLabel('Enter RSN to sync:')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter RSN')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(12);

    const firstRow = new ActionRowBuilder().addComponents(rsnInput);
    modal.addComponents(firstRow);

    await interaction.showModal(modal);
}

async function handlePostVerifySubmit(interaction) {
    const rsn = interaction.fields.getTextInputValue('rsn_input');
    const targetUser = interaction.user;

    await interaction.deferReply({ ephemeral: false });

    try {
        const clanId = config.clanId;

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
            const errorEmbed = new EmbedBuilder()
                .setColor('Red')
                .setTitle('❌ Not In Clan')
                .setDescription(
                    `**${rsn}** is not found in the Volition clan on Wise Old Man.\n\n` +
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
        const combatLevel = playerInClan.player.combatLevel || 0;

        await interaction.editReply({
            content: `🔄 Syncing **${rsn}** for <@${targetUser.id}>...\n\n` +
                `✅ Step 1/5: Found in WOM clan\n` +
                `Step 2/5: Fetching detailed stats...`
        });

        // Fetch detailed player stats for total level using RSN
        const playerDetailsResponse = await axios.get(`https://api.wiseoldman.net/v2/players/${encodeURIComponent(actualRsn)}`);
        const playerData = playerDetailsResponse.data;

        // Get total level from overall skill
        let totalLevel = 0;
        if (playerData.latestSnapshot && playerData.latestSnapshot.data && playerData.latestSnapshot.data.skills && playerData.latestSnapshot.data.skills.overall) {
            totalLevel = playerData.latestSnapshot.data.skills.overall.level || 0;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));

        await interaction.editReply({
            content: `🔄 Syncing **${rsn}** for <@${targetUser.id}>...\n\n` +
                `✅ Step 1/5: Found in WOM clan\n` +
                `✅ Step 2/5: Stats retrieved (${ehb} EHB, ${totalLevel} Total)\n` +
                `Step 3/5: Checking database...`
        });

        // Check if player already exists
        const existingPlayer = await db.getPlayerByWomId(womId.toString());

        if (existingPlayer && existingPlayer.discord_id && existingPlayer.discord_id !== targetUser.id) {
            const errorEmbed = new EmbedBuilder()
                .setColor('Red')
                .setTitle('❌ Verification Failed')
                .setDescription(
                    `**${actualRsn}** is already linked to another Discord account (<@${existingPlayer.discord_id}>).\n\n` +
                    `If this is your account and you need to re-link it, please contact an admin.`
                )
                .setTimestamp();

            return interaction.editReply({ content: null, embeds: [errorEmbed] });
        }

        await new Promise(resolve => setTimeout(resolve, 1000));

        await interaction.editReply({
            content: `🔄 Syncing **${rsn}** for <@${targetUser.id}>...\n\n` +
                `✅ Step 1/5: Found in WOM clan\n` +
                `✅ Step 2/5: Stats retrieved (${ehb} EHB, ${totalLevel} Total)\n` +
                `✅ Step 3/5: Database check passed\n` +
                `Step 4/5: Updating Discord nickname...`
        });

        // Update Discord nickname
        const member = await interaction.guild.members.fetch(targetUser.id);
        let nicknameChanged = false;
        let nicknameError = null;

        try {
            await member.setNickname(actualRsn);
            nicknameChanged = true;
        } catch (error) {
            nicknameError = error.message;
            console.error('Failed to change nickname:', error);
        }

        await new Promise(resolve => setTimeout(resolve, 1000));

        await interaction.editReply({
            content: `🔄 Syncing **${rsn}** for <@${targetUser.id}>...\n\n` +
                `✅ Step 1/5: Found in WOM clan\n` +
                `✅ Step 2/5: Stats retrieved (${ehb} EHB, ${totalLevel} Total)\n` +
                `✅ Step 3/5: Database check passed\n` +
                `${nicknameChanged ? '✅' : '⚠️'} Step 4/5: Nickname ${nicknameChanged ? 'updated' : 'update failed'}\n` +
                `Step 5/5: Syncing to database...`
        });

        // Sync to database
        if (existingPlayer) {
            await db.updatePlayer(existingPlayer.id, {
                discord_id: targetUser.id,
                rsn: actualRsn,
                wom_id: womId.toString()
            });
        } else {
            await db.createPlayer({
                rsn: actualRsn,
                discord_id: targetUser.id,
                wom_id: womId.toString()
            }, 0);
        }

        await new Promise(resolve => setTimeout(resolve, 1000));

        // Determine rank
        const rank = determineRank(ehb);

        // Success embed
        const successEmbed = new EmbedBuilder()
            .setColor('Green')
            .setTitle('✅ Clan Sync Complete!')
            .setDescription(
                `<@${targetUser.id}> has been successfully synced to the clan!\n\n` +
                `**Next Steps:**\n` +
                `• Give them the **${rank}** rank in Discord\n` +
                `• Give them the corresponding rank in-game\n\n` +
                `Welcome to Volition!`
            )
            .addFields(
                { name: 'RSN', value: actualRsn, inline: true },
                { name: 'WOM ID', value: womId.toString(), inline: true },
                { name: 'Total Level', value: totalLevel.toString(), inline: true },
                { name: 'EHB', value: ehb.toString(), inline: true },
                { name: 'Combat Level', value: combatLevel.toString(), inline: true },
                { name: 'Assigned Rank', value: rank, inline: true },
                { name: 'Discord Nickname', value: nicknameChanged ? `✅ Set to ${actualRsn}` : `⚠️ ${nicknameError || 'Could not update'}`, inline: false },
                { name: 'WOM Profile', value: `[View Profile](https://wiseoldman.net/players/${womId})`, inline: false }
            )
            .setThumbnail('https://i.imgur.com/BJJpBj2.png')
            .setTimestamp();

        await interaction.editReply({
            content: null,
            embeds: [successEmbed]
        });

    } catch (error) {
        console.error('Error during post-verification:', error);

        const errorEmbed = new EmbedBuilder()
            .setColor('Red')
            .setTitle('Sync Error')
            .setDescription(
                `An error occurred during sync:\n\`\`\`${error.message}\`\`\`\n\n` +
                `Please contact an admin for assistance.`
            )
            .setTimestamp();

        await interaction.editReply({ content: null, embeds: [errorEmbed] });
    }
}

async function handleAutoSync(interaction) {
    await interaction.deferReply({ ephemeral: false });

    const targetUser = interaction.user;
    const clanId = config.clanId;

    try {
        // Get player from database by Discord ID
        const player = await db.getPlayerByDiscordId(targetUser.id);

        if (!player || !player.rsn) {
            return interaction.editReply({
                content: `❌ Could not find your account in the database. Please run \`/testpreverify\` first to get verified.`
            });
        }

        const rsn = player.rsn;

        await interaction.editReply({
            content: `🔄 Auto-syncing your account (**${rsn}**)...\n\nStep 1/3: Checking WOM clan membership...`
        });

        // Check if player is in clan by RSN
        const womResponse = await axios.get(`https://api.wiseoldman.net/v2/groups/${clanId}`);
        const clanData = womResponse.data;

        const playerInClan = clanData.memberships.find(
            member => member.player.username.toLowerCase() === rsn.toLowerCase()
        );

        if (!playerInClan) {
            return interaction.editReply({
                content: `❌ **${rsn}** is not in the WOM clan yet. Please add them to the clan first, then run this command again.`
            });
        }

        const actualRsn = playerInClan.player.username;
        const womId = playerInClan.player.id;
        const ehb = Math.round(playerInClan.player.ehb || 0);

        // Fetch detailed stats using RSN
        const playerDetailsResponse = await axios.get(`https://api.wiseoldman.net/v2/players/${encodeURIComponent(actualRsn)}`);
        const playerData = playerDetailsResponse.data;

        let totalLevel = 0;
        if (playerData.latestSnapshot && playerData.latestSnapshot.data && playerData.latestSnapshot.data.skills && playerData.latestSnapshot.data.skills.overall) {
            totalLevel = playerData.latestSnapshot.data.skills.overall.level || 0;
        }

        await interaction.editReply({
            content: `🔄 Auto-syncing your account (**${rsn}**)...\n\n` +
                `✅ Step 1/3: Found in WOM clan\n` +
                `Step 2/3: Updating Discord nickname...`
        });

        // Update nickname
        const member = await interaction.guild.members.fetch(targetUser.id);
        let nicknameChanged = false;

        try {
            await member.setNickname(actualRsn);
            nicknameChanged = true;
        } catch (error) {
            console.error('Failed to change nickname:', error);
        }

        await interaction.editReply({
            content: `🔄 Auto-syncing your account (**${rsn}**)...\n\n` +
                `✅ Step 1/3: Found in WOM clan\n` +
                `${nicknameChanged ? '✅' : '⚠️'} Step 2/3: Nickname ${nicknameChanged ? 'updated' : 'update failed'}\n` +
                `Step 3/3: Updating database...`
        });

        // Update database
        await db.updatePlayer(player.id, {
            rsn: actualRsn,
            wom_id: womId.toString()
        });

        const rank = determineRank(ehb);

        const successEmbed = new EmbedBuilder()
            .setColor('Green')
            .setTitle('✅ Auto-Sync Complete!')
            .setDescription(
                `Your account has been synced!\n\n` +
                `**Assigned Rank:** ${rank}\n` +
                `Give yourself this rank in Discord and in-game.`
            )
            .addFields(
                { name: 'RSN', value: actualRsn, inline: true },
                { name: 'Total Level', value: totalLevel.toString(), inline: true },
                { name: 'EHB', value: ehb.toString(), inline: true }
            )
            .setThumbnail('https://i.imgur.com/BJJpBj2.png')
            .setTimestamp();

        await interaction.editReply({ content: null, embeds: [successEmbed] });

    } catch (error) {
        console.error('Error during auto-sync:', error);
        await interaction.editReply({ content: `❌ Error during sync: ${error.message}` });
    }
}

async function handleSyncAll(interaction) {
    await interaction.deferReply({ ephemeral: false });

    const clanId = config.clanId;

    try {
        await interaction.editReply({ content: '🔄 Syncing all clan members...' });

        // Fetch clan data
        const womResponse = await axios.get(`https://api.wiseoldman.net/v2/groups/${clanId}`);
        const clanMembers = womResponse.data.memberships;

        let synced = 0;
        let updated = 0;
        let created = 0;
        let errors = 0;

        for (const member of clanMembers) {
            try {
                const womId = member.player.id.toString();
                const rsn = member.player.username;

                // Check if player exists
                const existingPlayer = await db.getPlayerByWomId(womId);

                if (existingPlayer) {
                    // Update existing player
                    await db.updatePlayer(existingPlayer.id, {
                        rsn: rsn,
                        wom_id: womId
                    });
                    updated++;
                } else {
                    // Create new player
                    await db.createPlayer({
                        rsn: rsn,
                        wom_id: womId,
                        discord_id: null
                    }, 0);
                    created++;
                }

                synced++;
            } catch (err) {
                console.error(`Error syncing ${member.player.username}:`, err);
                errors++;
            }
        }

        const resultEmbed = new EmbedBuilder()
            .setColor('Green')
            .setTitle('✅ Sync All Complete!')
            .setDescription(
                `Successfully synced ${synced}/${clanMembers.length} clan members\n\n` +
                `**Updated:** ${updated}\n` +
                `**Created:** ${created}\n` +
                `**Errors:** ${errors}`
            )
            .setTimestamp();

        await interaction.editReply({ content: null, embeds: [resultEmbed] });

    } catch (error) {
        console.error('Error during sync all:', error);
        await interaction.editReply({ content: `❌ Error during sync: ${error.message}` });
    }
}

module.exports.handlePostVerifyButton = handlePostVerifyButton;
module.exports.handlePostVerifySubmit = handlePostVerifySubmit;
