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

module.exports = {
    data: new SlashCommandBuilder()
        .setName('testverifyflow')
        .setDescription('(Admin Only) Test the full verification welcome flow'),

    async execute (interaction) {
        const isAdmin = interaction.member.roles.cache.has(config.ADMIN_ROLE_IDS[0]);

        if (!isAdmin) {
            return interaction.reply({ content: 'Admin only command.', ephemeral: true });
        }

        const welcomeEmbed = new EmbedBuilder()
            .setColor('Blue')
            .setTitle('Welcome to Volition!')
            .setDescription(
                'Thank you for joining our clan Discord!\n\n' +
                'To get started and access all features, please verify your RuneScape account.\n\n' +
                '**What happens when you verify?**\n' +
                '• Your Discord nickname will be set to your RSN\n' +
                '• You\'ll be synced with our Wise Old Man clan\n' +
                '• You\'ll gain access to points, loot crates, and clan features\n\n' +
                'Click the button below to begin!'
            )
            .setThumbnail('https://i.imgur.com/BJJpBj2.png')
            .setTimestamp();

        const verifyButton = new ButtonBuilder()
            .setCustomId('start_verification')
            .setLabel('Verify My Account')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅');

        const row = new ActionRowBuilder().addComponents(verifyButton);

        await interaction.reply({
            content: 'This is what new members would see:',
            embeds: [welcomeEmbed],
            components: [row]
        });
    },
};

async function handleVerificationButton (interaction) {
    const modal = new ModalBuilder()
        .setCustomId('verification_modal')
        .setTitle('Verify Your Account');

    const rsnInput = new TextInputBuilder()
        .setCustomId('rsn_input')
        .setLabel('Enter your RSN exactly as it appears in game:')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter your exact in-game name')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(12);

    const firstRow = new ActionRowBuilder().addComponents(rsnInput);
    modal.addComponents(firstRow);

    await interaction.showModal(modal);
}

async function handleVerificationSubmit (interaction) {
    const rsn = interaction.fields.getTextInputValue('rsn_input');
    const targetUser = interaction.user;

    await interaction.deferReply({ ephemeral: false });

    try {
        const clanId = config.clanId;

        await interaction.editReply({
            content: `Looking up **${rsn}** for <@${targetUser.id}>...\n\nStep 1/5: Searching Wise Old Man...`
        });

        let playerData = null;
        let womId = null;
        let actualRsn = null;
        let ehb = 0;
        let totalLevel = 0;
        let isInClan = false;

        const womResponse = await axios.get(`https://api.wiseoldman.net/v2/groups/${clanId}`);
        const clanData = womResponse.data;

        if (!clanData || !clanData.memberships) {
            return interaction.editReply({ content: 'Failed to retrieve clan data from Wise Old Man.' });
        }

        const playerInClan = clanData.memberships.find(
            member => member.player.username.toLowerCase() === rsn.toLowerCase()
        );

        if (playerInClan) {
            isInClan = true;
            womId = playerInClan.player.id;
            actualRsn = playerInClan.player.username;
            ehb = Math.round(playerInClan.player.ehb || 0);

            // Fetch detailed stats to get total level using RSN
            const detailsResponse = await axios.get(`https://api.wiseoldman.net/v2/players/${encodeURIComponent(actualRsn)}`);
            playerData = detailsResponse.data;
            if (playerData.latestSnapshot && playerData.latestSnapshot.data && playerData.latestSnapshot.data.skills && playerData.latestSnapshot.data.skills.overall) {
                totalLevel = playerData.latestSnapshot.data.skills.overall.level || 0;
            }
        } else {
            try {
                // Try direct username lookup (simpler and more reliable)
                const directResponse = await axios.get(
                    `https://api.wiseoldman.net/v2/players/${encodeURIComponent(rsn)}`
                );
                playerData = directResponse.data;
                womId = playerData.id;
                actualRsn = playerData.username;
                ehb = Math.round(playerData.ehb || 0);

                // Get total level from overall skill
                if (playerData.latestSnapshot && playerData.latestSnapshot.data && playerData.latestSnapshot.data.skills && playerData.latestSnapshot.data.skills.overall) {
                    totalLevel = playerData.latestSnapshot.data.skills.overall.level || 0;
                }
            } catch (error) {
                const errorEmbed = new EmbedBuilder()
                    .setColor('Red')
                    .setTitle('Player Not Found')
                    .setDescription(
                        `**${rsn}** was not found on Wise Old Man.\n\n` +
                        `Please make sure:\n` +
                        `1. You spelled your RSN correctly\n` +
                        `2. Your account exists on Wise Old Man (search yourself on wiseoldman.net)\n` +
                        `3. Your RSN matches your in-game name exactly\n\n` +
                        `Error: ${error.response?.status || error.message}`
                    )
                    .setTimestamp();

                return interaction.editReply({ content: null, embeds: [errorEmbed] });
            }
        }

        await interaction.editReply({
            content: `Verifying **${rsn}** for <@${targetUser.id}>...\n\n` +
                `✅ Step 1/5: Found in WOM clan\n` +
                `Step 2/5: Fetching player stats...`
        });

        await new Promise(resolve => setTimeout(resolve, 1000));

        await interaction.editReply({
            content: `Verifying **${rsn}** for <@${targetUser.id}>...\n\n` +
                `✅ Step 1/5: Found in WOM clan\n` +
                `✅ Step 2/5: Stats retrieved (${ehb} EHB)\n` +
                `Step 3/5: Checking database...`
        });

        const existingPlayer = await db.getPlayerByWomId(womId.toString());

        if (existingPlayer && existingPlayer.discord_id && existingPlayer.discord_id !== targetUser.id) {
            const errorEmbed = new EmbedBuilder()
                .setColor('Red')
                .setTitle('Verification Failed')
                .setDescription(
                    `**${actualRsn}** is already linked to another Discord account.\n\n` +
                    `If this is your account and you need to re-link it, please contact an admin.`
                )
                .setTimestamp();

            return interaction.editReply({ content: null, embeds: [errorEmbed] });
        }

        await new Promise(resolve => setTimeout(resolve, 1000));

        await interaction.editReply({
            content: `Verifying **${rsn}** for <@${targetUser.id}>...\n\n` +
                `✅ Step 1/5: Found in WOM clan\n` +
                `✅ Step 2/5: Stats retrieved (${ehb} EHB)\n` +
                `✅ Step 3/5: Database check passed\n` +
                `Step 4/5: Updating Discord nickname...`
        });

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
            content: `Verifying **${rsn}** for <@${targetUser.id}>...\n\n` +
                `✅ Step 1/5: Found in WOM clan\n` +
                `✅ Step 2/5: Stats retrieved (${ehb} EHB)\n` +
                `✅ Step 3/5: Database check passed\n` +
                `${nicknameChanged ? '✅' : '⚠️'} Step 4/5: Nickname ${nicknameChanged ? 'updated' : 'update failed'}\n` +
                `Step 5/5: Syncing to database...`
        });

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

        const successEmbed = new EmbedBuilder()
            .setColor('Green')
            .setTitle('✅ Verification Successful!')
            .setDescription(
                `<@${targetUser.id}>, you have been successfully verified!\n\n` +
                `You now have access to all clan features including:\n` +
                `• Daily loot crates\n` +
                `• Point system and leaderboards\n` +
                `• Duels and shop items\n` +
                `• Competition rewards\n\n` +
                `Welcome to Volition!`
            )
            .addFields(
                { name: 'RSN', value: actualRsn, inline: true },
                { name: 'WOM ID', value: womId.toString(), inline: true },
                { name: 'EHB', value: ehb.toString(), inline: true },
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
        console.error('Error during verification:', error);

        const errorEmbed = new EmbedBuilder()
            .setColor('Red')
            .setTitle('Verification Error')
            .setDescription(
                `An error occurred during verification:\n\`\`\`${error.message}\`\`\`\n\n` +
                `Please contact an admin for assistance.`
            )
            .setTimestamp();

        await interaction.editReply({ content: null, embeds: [errorEmbed] });
    }
}

module.exports.handleVerificationButton = handleVerificationButton;
module.exports.handleVerificationSubmit = handleVerificationSubmit;
