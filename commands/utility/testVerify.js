const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const axios = require('axios');
const db = require('../../db/supabase');
const config = require('../../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('testverifyself')
        .setDescription('Test the verification flow')
        .addStringOption(option =>
            option.setName('rsn')
                .setDescription('Your RuneScape username (in-game name)')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('user')
                .setDescription('(Admin only) User to verify - leave blank to verify yourself')
                .setRequired(false)),

    async execute (interaction) {
        await interaction.deferReply({ ephemeral: false });

        const rsn = interaction.options.getString('rsn');
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const isAdmin = interaction.member.roles.cache.has(config.ADMIN_ROLE_IDS[0]);

        if (targetUser.id !== interaction.user.id && !isAdmin) {
            return interaction.editReply({ content: 'You can only verify yourself unless you are an admin.' });
        }

        try {
            const clanId = config.clanId;

            await interaction.editReply({ content: `Verifying **${rsn}** for <@${targetUser.id}>...\n\nStep 1/5: Checking Wise Old Man clan membership...` });

            const womResponse = await axios.get(`https://api.wiseoldman.net/v2/groups/${clanId}`);
            const clanData = womResponse.data;

            if (!clanData || !clanData.memberships) {
                return interaction.editReply({ content: 'Failed to retrieve clan data from Wise Old Man.' });
            }

            const playerInClan = clanData.memberships.find(
                member => member.player.username.toLowerCase() === rsn.toLowerCase()
            );

            if (!playerInClan) {
                const errorEmbed = new EmbedBuilder()
                    .setColor('Red')
                    .setTitle('Verification Failed')
                    .setDescription(
                        `**${rsn}** is not found in the Volition clan on Wise Old Man.\n\n` +
                        `Please make sure:\n` +
                        `1. You are added to the WOM clan\n` +
                        `2. You spelled your RSN correctly\n` +
                        `3. Your RSN matches your in-game name exactly`
                    )
                    .setTimestamp();

                return interaction.editReply({ content: null, embeds: [errorEmbed] });
            }

            const womId = playerInClan.player.id;
            const actualRsn = playerInClan.player.username;
            const ehb = Math.round(playerInClan.player.ehb || 0);
            const totalLevel = playerInClan.player.combatLevel || 0;

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
                .setTitle('Verification Successful!')
                .setDescription(
                    `<@${targetUser.id}> has been verified and linked to **${actualRsn}**`
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
                content: `✅ Verification complete for <@${targetUser.id}>!`,
                embeds: [successEmbed]
            });

        } catch (error) {
            console.error('Error during verification:', error);

            const errorEmbed = new EmbedBuilder()
                .setColor('Red')
                .setTitle('Verification Error')
                .setDescription(
                    `An error occurred during verification:\n\`\`\`${error.message}\`\`\``
                )
                .setTimestamp();

            await interaction.editReply({ content: null, embeds: [errorEmbed] });
        }
    },
};
