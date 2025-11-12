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

    async execute (interaction) {
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

async function handleVerifyButton (interaction) {
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

async function handleVerifySubmit (interaction) {
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

        // If requirements not met, send admin ping BEFORE the embed (pings don't work in editReply)
        if (!meetsRequirements) {
            const adminsToPing = config.ADMINS_TO_PING || config.ADMIN_ROLE_IDS;
            const adminMentions = adminsToPing.map(roleId => `<@&${roleId}>`).join(' ');

            // Send ping message first (this will actually ping)
            await interaction.channel.send({
                content: `${adminMentions} - User needs assistance with requirements`,
                allowedMentions: { roles: adminsToPing }
            });
        }

        // Send the result embed with Force Verify button if needed
        const replyOptions = {
            embeds: [statsEmbed]
        };

        if (!meetsRequirements) {
            const forceVerifyButton = new ButtonBuilder()
                .setCustomId(`force_verify_${interaction.user.id}_${actualRsn}`)
                .setLabel('Force Verify (Admin Only)')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🔓');

            replyOptions.components = [new ActionRowBuilder().addComponents(forceVerifyButton)];
        }

        await interaction.editReply(replyOptions);

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
                const newName = interaction.channel.name.replace(config.UNVERIFIED_EMOJI, config.VERIFIED_EMOJI);

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
                `## You meet the requirements! ${vpEmoji}\n\n` +
                `We ask you kindly that __your discord name on this server matches your in game name__, the clan bot will have already adjusted this for you.\n\n` +
                `* Make sure you can see all channels by clicking ''Volition'' in the top left corner and then ticking the ''Show All Channels'' box!\n` +
                `* Use the button below to send an introductory message in <#1350979144950743161>.\n\n` +
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

async function handleGuestJoinButton (interaction) {
    // Ask if they know someone in the clan
    const knowSomeoneEmbed = new EmbedBuilder()
        .setColor('Blue')
        .setTitle('👋 Join as Guest')
        .setDescription(
            'Do you know someone in the Volition clan?\n\n' +
            '• **Yes** - You can provide their RSN to verify\n' +
            '• **No** - An admin will review your request'
        );

    const yesButton = new ButtonBuilder()
        .setCustomId('guest_knows_someone')
        .setLabel('Yes, I know someone')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅');

    const noButton = new ButtonBuilder()
        .setCustomId('guest_knows_nobody')
        .setLabel('No, I don\'t know anyone')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('❌');

    const row = new ActionRowBuilder().addComponents(yesButton, noButton);

    await interaction.reply({
        embeds: [knowSomeoneEmbed],
        components: [row],
        ephemeral: true
    });
}

async function handleGuestJoinSubmit (interaction) {
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
            const adminMentions = config.ADMINS_TO_PING.map(roleId => `<@&${roleId}>`).join(' ');

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

            // Add Force Verify button for guest (admin only)
            const forceVerifyGuestButton = new ButtonBuilder()
                .setCustomId(`force_verify_guest_${guestUser.id}`)
                .setLabel('Force Verify Guest (Admin Only)')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🔓');

            const buttonRow = new ActionRowBuilder().addComponents(forceVerifyGuestButton);

            await interaction.editReply({
                //separate owners and admins and fix pings for red dot
                content: `${adminMentions} - Guest verification needed`,
                embeds: [errorEmbed],
                components: [buttonRow],
                allowedMentions: { roles: config.ADMIN_ROLE_IDS }
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
        const adminMentions = config.ADMINS_TO_PING.map(roleId => `<@&${roleId}>`).join(' ');

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
            embeds: [welcomeEmbed],
            allowedMentions: { roles: config.ADMIN_ROLE_IDS }
        });

        console.log(`[GuestJoin] ${guestUser.tag} joined as guest (connected to ${actualRsn})`);

    } catch (error) {
        console.error('[GuestJoin] Error during guest join:', error);

        const adminMentions = config.ADMINS_TO_PING.map(roleId => `<@&${roleId}>`).join(' ');

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
            embeds: [errorEmbed],
            allowedMentions: { roles: config.ADMIN_ROLE_IDS }
        });
    }
}

async function handleIntroButton (interaction) {
    const modal = new ModalBuilder()
        .setCustomId('intro_modal')
        .setTitle('Introduce Yourself');

    // Input 1: Basic Info - More flexible format
    const basicInfoInput = new TextInputBuilder()
        .setCustomId('basic_info')
        .setLabel('RSN, Account Type & Age')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Example: Zezima, Main, 21 years old')
        .setRequired(true)
        .setMaxLength(100);

    // Input 2: Stats & Location - Flexible format
    const statsInput = new TextInputBuilder()
        .setCustomId('stats_info')
        .setLabel('Total Level & Time Zone')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Example: 2100 total, EST timezone')
        .setRequired(true)
        .setMaxLength(100);

    // Input 3: Clan History - Freeform paragraph
    const clanHistoryInput = new TextInputBuilder()
        .setCustomId('clan_history')
        .setLabel('Previous Clan & Why You Left (optional)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Share your clan history or just put "None" if this is your first clan')
        .setRequired(false)
        .setMaxLength(500);

    // Input 4: Goals & Favorites - Freeform paragraph
    const goalsInput = new TextInputBuilder()
        .setCustomId('goals_interests')
        .setLabel('Favorite Content & Current Goals')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Tell us about your favorite skills, bosses, and what you\'re working on!')
        .setRequired(true)
        .setMaxLength(500);

    // Input 5: What You're Looking For - Freeform paragraph
    const additionalInput = new TextInputBuilder()
        .setCustomId('additional_info')
        .setLabel('What Are You Looking For & Anything Else?')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('What do you hope to gain from joining? Any other info you\'d like to share?')
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

async function handleIntroSubmit (interaction) {
    const basicInfo = interaction.fields.getTextInputValue('basic_info');
    const statsInfo = interaction.fields.getTextInputValue('stats_info');
    const clanHistory = interaction.fields.getTextInputValue('clan_history') || 'None / First clan';
    const goalsInterests = interaction.fields.getTextInputValue('goals_interests');
    const additionalInfo = interaction.fields.getTextInputValue('additional_info');

    await interaction.deferReply({ ephemeral: true });

    try {
        console.log(`[Intro] Processing introduction for ${interaction.user.tag}`);
        console.log(`[Intro] Attempting to fetch intro channel: ${config.INTRO_THREAD_ID}`);

        // Fetch the intro channel (could be forum, text channel, or thread)
        const introChannel = await interaction.client.channels.fetch(config.INTRO_THREAD_ID);

        if (!introChannel) {
            console.error('[Intro] Intro channel not found!');
            return interaction.editReply({
                content: '❌ Could not find the introduction channel. Please contact an admin.'
            });
        }

        console.log(`[Intro] Found intro channel: ${introChannel.name} (Type: ${introChannel.type})`);

        // Format the intro message - simplified, more natural format
        const introMessage =
            `**Introduction from ${interaction.user}**\n\n` +
            `**Basic Info:** ${basicInfo}\n` +
            `**Stats & Location:** ${statsInfo}\n` +
            `**Previous Clan:** ${clanHistory}\n` +
            `**Favorites & Goals:** ${goalsInterests}\n` +
            `**What I'm Looking For:** ${additionalInfo}`;

        console.log(`[Intro] Attempting to send message to intro channel...`);

        // Handle different channel types and get the message/thread URL
        let introUrl = null;
        let targetChannel = null; // Channel where we'll send the "How to join" embed

        if (introChannel.isThread()) {
            // It's a thread - use send directly
            const sentMessage = await introChannel.send(introMessage);
            introUrl = sentMessage.url;
            targetChannel = introChannel;
        } else if (introChannel.type === 15) {
            // It's a forum channel (type 15) - create a new thread/post
            // Get member to access display name
            const member = await interaction.guild.members.fetch(interaction.user.id);
            const displayName = member.displayName || interaction.user.globalName || interaction.user.username;

            const thread = await introChannel.threads.create({
                name: `${displayName}'s Introduction`,
                message: { content: introMessage }
            });
            console.log(`[Intro] Created forum post: ${thread.name}`);
            introUrl = `https://discord.com/channels/${config.guildId}/${thread.id}`;
            targetChannel = thread; // Send follow-up messages to the thread, not the forum
        } else {
            // Regular text channel
            const sentMessage = await introChannel.send(introMessage);
            introUrl = sentMessage.url;
            targetChannel = introChannel;
        }

        console.log(`[Intro] ✅ Successfully posted introduction for ${interaction.user.tag}`);

        // Confirm to user (ephemeral in the ticket)
        await interaction.editReply({
            content: '✅ Your introduction has been posted! An admin will help you join the clan in-game shortly.'
        });

        // Send "How to join" embed and link in the ticket channel (if in a ticket)
        const ticketCategories = [
            config.TICKET_JOIN_CATEGORY_ID,
            config.TICKET_GENERAL_CATEGORY_ID,
            config.TICKET_SHOP_CATEGORY_ID
        ];

        if (interaction.channel && ticketCategories.includes(interaction.channel.parentId)) {
            // Ping admins in the join ticket
            const adminMentions = config.ADMINS_TO_PING.map(roleId => `<@&${roleId}>`).join(' ');
            await interaction.channel.send({
                content: `${adminMentions} - New member introduction posted!\n📝 **Introduction Posted!** ${interaction.user}'s introduction has been submitted: ${introUrl}`,
                allowedMentions: { roles: config.ADMIN_ROLE_IDS }
            });

            // Send "How to join" embed in the ticket
            // Fetch emojis from the guild to get the correct format
            let b1Emoji = '▪️'; // Fallback
            let checkEmoji = '✅'; // Fallback

            try {
                const guild = interaction.guild;
                const b1EmojiObj = guild.emojis.cache.get(config.B1_EMOJI_ID);
                const checkEmojiObj = guild.emojis.cache.get(config.CHECK_EMOJI_ID);

                if (b1EmojiObj) b1Emoji = `<:${b1EmojiObj.name}:${b1EmojiObj.id}>`;
                if (checkEmojiObj) checkEmoji = `<:${checkEmojiObj.name}:${checkEmojiObj.id}>`;
            } catch (error) {
                console.error('[Intro] Error fetching emojis:', error);
            }

            const howToJoinEmbed = new EmbedBuilder()
                .setColor('Blue')
                .setTitle('How to join.')
                .setDescription(
                    `${b1Emoji} Jump in the clan chat in game.\n` +
                    `${b1Emoji} Someone will help you in & rank you ${checkEmoji}`
                )
                .setImage('https://media.discordapp.net/attachments/1085149045456126064/1197653854859313284/Join_Volition_3.png?ex=6913aa92&is=69125912&hm=72f1a38dbc6f80e27af7667560ddb2e865056f0e585cc40c377b2945bf49176d&format=webp&quality=lossless&width=1242&height=936')
                .setTimestamp();

            await interaction.channel.send({ embeds: [howToJoinEmbed] });
        }

    } catch (error) {
        console.error('[Intro] Error posting introduction:', error);
        console.error('[Intro] Error details:', {
            name: error.name,
            message: error.message,
            code: error.code,
            stack: error.stack
        });

        await interaction.editReply({
            content: `❌ Failed to post your introduction. Please contact an admin for assistance.\n\nError: ${error.message}`
        });
    }
}

async function handleGuestKnowsSomeone (interaction) {
    // User knows someone - show modal to enter their RSN
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

async function handleGuestKnowsNobody (interaction) {
    // User doesn't know anyone - ping admins for review
    const guestUser = interaction.user;

    await interaction.reply({
        content: '📝 Submitting your guest request to admins...',
        ephemeral: true
    });

    try {
        const adminMentions = config.ADMINS_TO_PING.map(roleId => `<@&${roleId}>`).join(' ');

        const reviewEmbed = new EmbedBuilder()
            .setColor('Orange')
            .setTitle('🔍 Guest Request - Manual Review Needed')
            .setDescription(
                `${guestUser} wants to join as a guest but doesn't know anyone in the clan.\n\n` +
                `**Action Required:**\n` +
                `An admin should review this request and use the Force Verify button below if approved.`
            )
            .addFields(
                { name: 'Guest User', value: `${guestUser} (${guestUser.tag})`, inline: false },
                { name: 'Status', value: 'Awaiting admin approval', inline: false }
            )
            .setTimestamp();

        // Add Force Verify button for guest (admin only)
        const forceVerifyGuestButton = new ButtonBuilder()
            .setCustomId(`force_verify_guest_${guestUser.id}`)
            .setLabel('Force Verify Guest (Admin Only)')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅');

        const buttonRow = new ActionRowBuilder().addComponents(forceVerifyGuestButton);

        // Check if in a ticket channel
        const ticketCategories = [
            config.TICKET_JOIN_CATEGORY_ID,
            config.TICKET_GENERAL_CATEGORY_ID,
            config.TICKET_SHOP_CATEGORY_ID
        ];

        if (ticketCategories.includes(interaction.channel.parentId)) {
            // In ticket - send to ticket channel
            await interaction.channel.send({
                content: `${adminMentions} - Guest verification needed`,
                embeds: [reviewEmbed],
                components: [buttonRow],
                allowedMentions: { roles: config.ADMIN_ROLE_IDS }
            });
        } else {
            // Not in ticket - send to general channel or reply
            await interaction.followUp({
                content: `${adminMentions} - Guest verification needed`,
                embeds: [reviewEmbed],
                components: [buttonRow],
                allowedMentions: { roles: config.ADMIN_ROLE_IDS }
            });
        }

        await interaction.editReply({
            content: '✅ Your guest request has been submitted! An admin will review it shortly.'
        });

        console.log(`[GuestJoin] ${guestUser.tag} requested guest access (knows nobody)`);

    } catch (error) {
        console.error('[GuestJoin] Error submitting guest request:', error);
        await interaction.editReply({
            content: `❌ Failed to submit guest request. Please contact an admin directly.\n\nError: ${error.message}`
        });
    }
}

module.exports.handleVerifyButton = handleVerifyButton;
module.exports.handleVerifySubmit = handleVerifySubmit;
module.exports.handleGuestJoinButton = handleGuestJoinButton;
module.exports.handleGuestJoinSubmit = handleGuestJoinSubmit;
module.exports.handleGuestKnowsSomeone = handleGuestKnowsSomeone;
module.exports.handleGuestKnowsNobody = handleGuestKnowsNobody;
module.exports.handleIntroButton = handleIntroButton;
module.exports.handleIntroSubmit = handleIntroSubmit;
