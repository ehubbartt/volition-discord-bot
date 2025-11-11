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
const config = require('../../config.json');
const { determineRank, formatRankWithEmoji } = require('./sync');
const { isAdmin } = require('../../utils/permissions');
const features = require('../../utils/features');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('createverifymessage')
        .setDescription('(Admin Only) Create a verification message with button for users to verify themselves'),

    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'Admin only command.', ephemeral: true });
        }

        // Create verification embed
        const verifyEmbed = new EmbedBuilder()
            .setColor('Blue')
            .setTitle('🎮 Verify Your RuneScape Account')
            .setDescription(
                'Click the button below to verify your RuneScape account and check if you meet clan requirements!\n\n' +
                '**Requirements:**\n' +
                '• 1750+ Total Level OR 50+ EHB\n\n' +
                'Your stats will be checked via Wise Old Man.'
            )
            .setThumbnail('https://cdn.discordapp.com/icons/571389228806570005/ff45546375fe88eb358088dc1fd4c28b.png?size=480&quality=lossless')
            .setFooter({ text: 'Volition Clan Verification' })
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

        // Send the message
        await interaction.channel.send({
            embeds: [verifyEmbed],
            components: [row]
        });

        // Confirm to admin
        await interaction.reply({
            content: 'Verification message created!',
            ephemeral: true
        });
    },
};

async function handleVerifyButton(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('createverify_modal')
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

async function handleVerifySubmit(interaction) {
    const rsn = interaction.fields.getTextInputValue('rsn_input');
    const targetUser = interaction.user;

    await interaction.deferReply({ ephemeral: false }); // PUBLIC response

    try {
        await interaction.editReply({
            content: `🔍 Looking up **${rsn}** on Wise Old Man...`
        });

        // Try to get player by username
        let playerData = null;
        let womId = null;
        let actualRsn = null;

        try {
            console.log(`[CreateVerify] Looking up WOM player: ${rsn}`);
            const directResponse = await axios.get(
                `https://api.wiseoldman.net/v2/players/${encodeURIComponent(rsn)}`
            );

            playerData = directResponse.data;
            womId = playerData.id;
            actualRsn = playerData.username;
            console.log(`[CreateVerify] Successfully found: ${actualRsn} (ID: ${womId})`);
        } catch (error) {
            console.error(`[CreateVerify] Error during player lookup:`, error.response?.status, error.message);

            const errorEmbed = new EmbedBuilder()
                .setColor('Red')
                .setTitle('❌ Player Not Found')
                .setDescription(
                    `**${rsn}** was not found on Wise Old Man.\n\n` +
                    `Please make sure:\n` +
                    `1. You spelled your RSN correctly\n` +
                    `2. Your account exists on Wise Old Man (search yourself on wiseoldman.net)\n` +
                    `3. Your RSN matches your in-game name exactly`
                )
                .setTimestamp();

            return interaction.editReply({ content: null, embeds: [errorEmbed] });
        }

        const ehb = Math.round(playerData.ehb || 0);
        const ehp = Math.round(playerData.ehp || 0);

        // Get total level
        let totalLevel = 0;
        if (playerData.latestSnapshot?.data?.skills?.overall) {
            totalLevel = playerData.latestSnapshot.data.skills.overall.level || 0;
        }

        // Check requirements
        const MIN_TOTAL_LEVEL = 1750;
        const MIN_EHB = 50;
        const meetsRequirements = totalLevel >= MIN_TOTAL_LEVEL || ehb >= MIN_EHB;

        // Determine rank
        const rank = determineRank(ehb, null);

        // Handle nickname change and role updates if requirements met
        let nicknameChanged = false;
        let nicknameError = null;
        let rolesUpdated = false;
        let roleError = null;
        const member = await interaction.guild.members.fetch(targetUser.id);

        if (meetsRequirements) {
            // Try to update nickname (skip if bot lacks permission)
            try {
                await member.setNickname(actualRsn);
                nicknameChanged = true;
                console.log(`[CreateVerify] Updated nickname for ${targetUser.tag} to ${actualRsn}`);
            } catch (error) {
                if (error.code === 50013) {
                    nicknameError = 'Bot lacks permission (user has higher role)';
                } else {
                    nicknameError = error.message;
                }
                console.log(`[CreateVerify] Could not update nickname for ${targetUser.tag}: ${nicknameError}`);
            }

            // Add verified role and remove unverified role
            try {
                if (config.verifiedRoleID) {
                    await member.roles.add(config.verifiedRoleID);
                    console.log(`[CreateVerify] Added verified role to ${targetUser.tag}`);
                }
                if (config.unverifiedRoleID && member.roles.cache.has(config.unverifiedRoleID)) {
                    await member.roles.remove(config.unverifiedRoleID);
                    console.log(`[CreateVerify] Removed unverified role from ${targetUser.tag}`);
                }
                rolesUpdated = true;
            } catch (error) {
                roleError = error.message;
                console.error('[CreateVerify] Failed to update roles:', error);
            }
        }

        // Create result embed
        const embedColor = meetsRequirements ? 'Green' : 'Orange';
        const statusIcon = meetsRequirements ? '✅' : '⚠️';

        let description = '';
        if (meetsRequirements) {
            description = `Verification complete for **${actualRsn}**\n\n` +
                `**Status:** ✅ APPROVED - You meet clan requirements!\n\n` +
                `**Requirements:**\n` +
                `• ${totalLevel >= MIN_TOTAL_LEVEL ? '✅' : '❌'} Total Level: ${totalLevel} / ${MIN_TOTAL_LEVEL}\n` +
                `• ${ehb >= MIN_EHB ? '✅' : '❌'} EHB: ${ehb} / ${MIN_EHB}\n\n` +
                `Next step: Join the clan in-game! An admin will complete your sync.`;
        } else {
            description = `Verification complete for **${actualRsn}**\n\n` +
                `**Status:** ⚠️ DOES NOT MEET REQUIREMENTS\n\n` +
                `**Requirements:**\n` +
                `• ${totalLevel >= MIN_TOTAL_LEVEL ? '✅' : '❌'} Total Level: ${totalLevel} / ${MIN_TOTAL_LEVEL}\n` +
                `• ${ehb >= MIN_EHB ? '✅' : '❌'} EHB: ${ehb} / ${MIN_EHB}\n\n` +
                `You need either 1750+ total level or 50+ EHB to join. An admin will be there soon to assist you.`;
        }

        const statsEmbed = new EmbedBuilder()
            .setColor(embedColor)
            .setTitle(`${statusIcon} Verification Results`)
            .setDescription(description)
            .addFields(
                { name: 'RSN', value: actualRsn, inline: true },
                { name: 'WOM ID', value: womId.toString(), inline: true },
                { name: '\u200B', value: '\u200B', inline: true },
                { name: 'Total Level', value: totalLevel.toString(), inline: true },
                { name: 'EHB', value: ehb.toString(), inline: true },
                { name: 'EHP', value: ehp.toString(), inline: true },
                { name: 'Expected Rank', value: formatRankWithEmoji(rank, interaction.guild), inline: false }
            );

        if (nicknameChanged) {
            statsEmbed.addFields({ name: 'Discord Nickname', value: `✅ Updated to ${actualRsn}`, inline: false });
        } else if (nicknameError && meetsRequirements) {
            statsEmbed.addFields({ name: 'Discord Nickname', value: `⚠️ ${nicknameError}`, inline: false });
        }

        statsEmbed.addFields({ name: 'WOM Profile', value: `[View Profile](https://wiseoldman.net/players/${womId})`, inline: false });
        statsEmbed.setThumbnail('https://cdn.discordapp.com/icons/571389228806570005/ff45546375fe88eb358088dc1fd4c28b.png?size=480&quality=lossless');
        statsEmbed.setTimestamp();

        // Send the result embed
        let replyContent = null;

        // If requirements not met, ping all admin roles
        if (!meetsRequirements) {
            const adminMentions = config.ADMIN_ROLE_IDS.map(roleId => `<@&${roleId}>`).join(' ');
            replyContent = `${adminMentions} - User needs assistance with requirements`;
        }

        await interaction.editReply({
            content: replyContent,
            embeds: [statsEmbed]
        });

        // Update ticket name if in a ticket channel (change unverified -> verified emoji)
        const ticketManager = require('../../utils/ticketManager');
        if (interaction.channel.parentId) {
            const ticketCategories = [
                config.TICKET_JOIN_CATEGORY_ID,
                config.TICKET_GENERAL_CATEGORY_ID,
                config.TICKET_SHOP_CATEGORY_ID
            ];

            if (ticketCategories.includes(interaction.channel.parentId)) {
                // Mark as verified in ticket state
                ticketManager.markVerified(interaction.channel.id);

                // Update channel name - replace unverified emoji with verified emoji
                const verifiedEmoji = interaction.guild.emojis.cache.find(e => e.name === config.VERIFIED_EMOJI_NAME);
                const unverifiedEmoji = interaction.guild.emojis.cache.find(e => e.name === config.UNVERIFIED_EMOJI_NAME);

                let newName = interaction.channel.name;

                if (unverifiedEmoji && verifiedEmoji) {
                    newName = newName.replace(unverifiedEmoji.toString(), verifiedEmoji.toString());
                } else {
                    // Fallback to text replacement if emojis not found
                    newName = newName.replace(':unverified:', ':verified:');
                }

                try {
                    await interaction.channel.setName(newName);
                    console.log(`[Verify] Updated ticket channel name to: ${newName}`);
                } catch (error) {
                    console.error('[Verify] Failed to update channel name:', error);
                }
            }
        }

        // If requirements met, send welcome message with intro button
        if (meetsRequirements) {
            const vpEmoji = `<:VP:${config.VP_EMOJI_ID}>`;

            const welcomeMessage =
                `## Welcome to Volition! ${vpEmoji}\n\n` +
                `We ask you kindly that __your discord name on this server matches your in game name__, the clan bot will have already adjusted this for you.\n\n` +
                `* Make sure you can see all channels by clicking ''Volition'' in the top left corner and then ticking the ''Show All Channels'' box!\n` +
                `* Head over to <#1350979144950743161> & fill out the pinned information.\n\n` +
                `Once this is done we will help you join the clan in game.`;

            // Check if intro modal is enabled
            const useIntroModal = await features.isEnabled('verification.useIntroModal');

            if (useIntroModal) {
                // Create intro button to open modal
                const introButton = new ButtonBuilder()
                    .setCustomId('intro_start')
                    .setLabel('Fill Out Introduction')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('📝');

                const row = new ActionRowBuilder().addComponents(introButton);

                await interaction.followUp({
                    content: welcomeMessage,
                    components: [row]
                });
            } else {
                // Create link button to intro thread
                const introLinkButton = new ButtonBuilder()
                    .setLabel('Go to Introduction Thread')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`https://discord.com/channels/${config.guildId}/${config.INTRO_THREAD_ID}`)
                    .setEmoji('📝');

                const row = new ActionRowBuilder().addComponents(introLinkButton);

                await interaction.followUp({
                    content: welcomeMessage,
                    components: [row]
                });
            }
        }

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

async function handleGuestJoinButton(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('guest_join_modal')
        .setTitle('Join as Guest');

    const rsnInput = new TextInputBuilder()
        .setCustomId('friend_rsn_input')
        .setLabel("Enter your friend/main's RSN:")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter the RSN of a clan member')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(12);

    const firstRow = new ActionRowBuilder().addComponents(rsnInput);
    modal.addComponents(firstRow);

    await interaction.showModal(modal);
}

async function handleGuestJoinSubmit(interaction) {
    const friendRsn = interaction.fields.getTextInputValue('friend_rsn_input');
    const guestUser = interaction.user;

    await interaction.deferReply({ ephemeral: false }); // PUBLIC response

    try {
        await interaction.editReply({
            content: `🔍 Checking if **${friendRsn}** is in the Volition clan...`
        });

        // Fetch clan data from WOM
        const clanId = config.clanId;
        const clanResponse = await axios.get(`https://api.wiseoldman.net/v2/groups/${clanId}`);
        const clanData = clanResponse.data;

        if (!clanData || !clanData.memberships) {
            throw new Error('Could not fetch clan data from Wise Old Man');
        }

        // Check if the friend's RSN is in the clan
        const friendInClan = clanData.memberships.find(
            member => member.player.username.toLowerCase() === friendRsn.toLowerCase()
        );

        if (!friendInClan) {
            // Friend NOT in clan - error and ping admins
            const adminMentions = config.ADMIN_ROLE_IDS.map(roleId => `<@&${roleId}>`).join(' ');

            const errorEmbed = new EmbedBuilder()
                .setColor('Red')
                .setTitle('❌ Player Not Found in Clan')
                .setDescription(
                    `**${friendRsn}** is not currently in the Volition clan.\n\n` +
                    `**Guest:** ${guestUser}\n` +
                    `**Claimed Friend/Main:** ${friendRsn}\n\n` +
                    `🚨 An admin will review your request shortly.`
                )
                .addFields(
                    { name: 'Next Steps', value: 'Please wait for an admin to assist you. They may need to verify your connection to the clan.', inline: false }
                )
                .setTimestamp();

            await interaction.editReply({
                content: `${adminMentions} - Guest verification needed`,
                embeds: [errorEmbed]
            });
            return;
        }

        // Friend IS in clan - give verified role and welcome
        const actualRsn = friendInClan.player.username;
        const member = await interaction.guild.members.fetch(guestUser.id);

        // Add verified role
        let roleAdded = false;
        let roleError = null;
        try {
            if (config.verifiedRoleID) {
                await member.roles.add(config.verifiedRoleID);
                roleAdded = true;
                console.log(`[GuestJoin] Added verified role to ${guestUser.tag}`);
            }
            if (config.unverifiedRoleID && member.roles.cache.has(config.unverifiedRoleID)) {
                await member.roles.remove(config.unverifiedRoleID);
                console.log(`[GuestJoin] Removed unverified role from ${guestUser.tag}`);
            }
        } catch (error) {
            roleError = error.message;
            console.error('[GuestJoin] Failed to update roles:', error);
        }

        // Send admin notification and welcome message
        const adminMentions = config.ADMIN_ROLE_IDS.map(roleId => `<@&${roleId}>`).join(' ');

        const welcomeEmbed = new EmbedBuilder()
            .setColor('Green')
            .setTitle('👋 Welcome to Volition!')
            .setDescription(
                `Hey ${guestUser}, welcome to the **Volition** Discord! 🎉\n\n` +
                `We've verified that **${actualRsn}** is a member of our clan. ` +
                `You're joining us as a **guest**, so feel free to browse around, hang out in chat, and get to know the community! 💬✨\n\n` +
                `**Please Note:**\n` +
                `• As a guest, you won't earn Volition Points (VP)\n` +
                `• You won't be synced to our member database\n` +
                `• If you'd like full member access, consider joining the clan in-game! 🎮\n\n` +
                `Enjoy your stay and don't be a stranger! 🍻`
            )
            .addFields(
                { name: '🎮 Guest User', value: `${guestUser}`, inline: true },
                { name: '⚔️ Clan Connection', value: actualRsn, inline: true },
                { name: '✅ Verified Role', value: roleAdded ? 'Added' : `⚠️ ${roleError || 'Failed'}`, inline: true }
            )
            .setThumbnail('https://cdn.discordapp.com/icons/571389228806570005/ff45546375fe88eb358088dc1fd4c28b.png?size=480&quality=lossless')
            .setFooter({ text: 'Welcome to the Volition family!' })
            .setTimestamp();

        await interaction.editReply({
            content: `${adminMentions} - New guest verified`,
            embeds: [welcomeEmbed]
        });

        console.log(`[GuestJoin] ${guestUser.tag} joined as guest (connected to ${actualRsn})`);

    } catch (error) {
        console.error('[GuestJoin] Error during guest join:', error);

        const adminMentions = config.ADMIN_ROLE_IDS.map(roleId => `<@&${roleId}>`).join(' ');

        const errorEmbed = new EmbedBuilder()
            .setColor('Red')
            .setTitle('⚠️ Guest Join Error')
            .setDescription(
                `An error occurred while processing the guest join request.\n\n` +
                `**Guest:** ${guestUser}\n` +
                `**Error:** \`${error.message}\`\n\n` +
                `An admin will assist you shortly.`
            )
            .setTimestamp();

        await interaction.editReply({
            content: `${adminMentions} - Guest join error`,
            embeds: [errorEmbed]
        });
    }
}

async function handleIntroButton(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('intro_modal')
        .setTitle('Introduce Yourself');

    // Input 1: RSN, Ironman Type, Age (combined to save space)
    const basicInfoInput = new TextInputBuilder()
        .setCustomId('basic_info')
        .setLabel('RSN | Ironman Type | 18+? (Yes/No)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Example: Zezima | Main | Yes')
        .setRequired(true)
        .setMaxLength(100);

    // Input 2: Total Level & Timezone
    const statsInput = new TextInputBuilder()
        .setCustomId('stats_info')
        .setLabel('Total Level | Time Zone')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Example: 2100 | EST (UTC-5)')
        .setRequired(true)
        .setMaxLength(50);

    // Input 3: Previous clan and reason for leaving
    const clanHistoryInput = new TextInputBuilder()
        .setCustomId('clan_history')
        .setLabel('Previous clan? Reason for leaving?')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Example: Was in XYZ clan but looking for more active community')
        .setRequired(false)
        .setMaxLength(500);

    // Input 4: Goals & Interests (combining favourite skill, boss, and goal)
    const goalsInput = new TextInputBuilder()
        .setCustomId('goals_interests')
        .setLabel('Fav Skill | Fav Boss | Current Goal')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Example: Slayer | Vorkath | Working on quest cape')
        .setRequired(true)
        .setMaxLength(500);

    // Input 5: What you're looking for and additional info
    const additionalInput = new TextInputBuilder()
        .setCustomId('additional_info')
        .setLabel('What are you looking to gain? + Extra info')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Example: Looking for PvM team and friendly community. I love pets!')
        .setRequired(true)
        .setMaxLength(1000);

    const row1 = new ActionRowBuilder().addComponents(basicInfoInput);
    const row2 = new ActionRowBuilder().addComponents(statsInput);
    const row3 = new ActionRowBuilder().addComponents(clanHistoryInput);
    const row4 = new ActionRowBuilder().addComponents(goalsInput);
    const row5 = new ActionRowBuilder().addComponents(additionalInput);

    modal.addComponents(row1, row2, row3, row4, row5);

    await interaction.showModal(modal);
}

async function handleIntroSubmit(interaction) {
    const basicInfo = interaction.fields.getTextInputValue('basic_info');
    const statsInfo = interaction.fields.getTextInputValue('stats_info');
    const clanHistory = interaction.fields.getTextInputValue('clan_history') || 'N/A';
    const goalsInterests = interaction.fields.getTextInputValue('goals_interests');
    const additionalInfo = interaction.fields.getTextInputValue('additional_info');

    await interaction.deferReply({ ephemeral: true });

    try {
        // Parse the basic info (RSN | Type | Age)
        const basicParts = basicInfo.split('|').map(s => s.trim());
        const rsn = basicParts[0] || 'Not provided';
        const ironmanType = basicParts[1] || 'Not provided';
        const age18Plus = basicParts[2] || 'Not provided';

        // Parse stats info (Total | Timezone)
        const statsParts = statsInfo.split('|').map(s => s.trim());
        const totalLevel = statsParts[0] || 'Not provided';
        const timezone = statsParts[1] || 'Not provided';

        // Parse goals/interests (Skill | Boss | Goal)
        const goalsParts = goalsInterests.split('|').map(s => s.trim());
        const favSkill = goalsParts[0] || 'Not provided';
        const favBoss = goalsParts[1] || 'Not provided';
        const currentGoal = goalsParts[2] || 'Not provided';

        // Post to intro thread
        const introThread = await interaction.client.channels.fetch(config.INTRO_THREAD_ID);

        if (!introThread) {
            return interaction.editReply({
                content: '❌ Could not find the introduction thread. Please contact an admin.'
            });
        }

        // Format the intro message
        const introMessage =
            `**Introduction from ${interaction.user}**\n\n` +
            `**RSN:** ${rsn}\n` +
            `**Ironman Type:** ${ironmanType}\n` +
            `**18+?:** ${age18Plus}\n` +
            `**Total Level:** ${totalLevel}\n` +
            `**Time Zone:** ${timezone}\n` +
            `**Previous Clan:** ${clanHistory}\n` +
            `**Favourite Skill:** ${favSkill}\n` +
            `**Favourite Boss/Content:** ${favBoss}\n` +
            `**Current Goal:** ${currentGoal}\n` +
            `**What I'm Looking For:** ${additionalInfo}`;

        // Post the intro
        await introThread.send(introMessage);

        // Confirm to user
        await interaction.editReply({
            content: '✅ Your introduction has been posted! An admin will help you join the clan in-game shortly.'
        });

        console.log(`[Intro] Posted introduction for ${interaction.user.tag} in intro thread`);

    } catch (error) {
        console.error('[Intro] Error posting introduction:', error);
        await interaction.editReply({
            content: '❌ Failed to post your introduction. Please contact an admin for assistance.'
        });
    }
}

module.exports.handleVerifyButton = handleVerifyButton;
module.exports.handleVerifySubmit = handleVerifySubmit;
module.exports.handleGuestJoinButton = handleGuestJoinButton;
module.exports.handleGuestJoinSubmit = handleGuestJoinSubmit;
module.exports.handleIntroButton = handleIntroButton;
module.exports.handleIntroSubmit = handleIntroSubmit;
