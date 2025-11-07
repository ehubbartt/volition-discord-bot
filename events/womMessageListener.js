const { Events, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const db = require('../db/supabase');
const config = require('../config.json');
const { RANK_ROLES, determineRank } = require('../commands/utility/sync');

// Parse and handle join messages
async function handleJoinMessage(description, originalMessage) {
    try {
        // Extract RSNs from description
        // WOM format can be: "🔷 PlayerName" OR ":emoji: PlayerName" OR "<:emoji:ID> PlayerName"
        console.log('[JOIN] =====================================');
        console.log('[JOIN] Raw description:', description);
        console.log('[JOIN] Description length:', description.length);
        console.log('[JOIN] =====================================');

        let rsns = [];

        // Try different patterns:
        // 1. Custom Discord emoji format: <:feeder:1159532437412515860> PlayerName
        const customEmojiMatches = description.match(/<a?:[a-z_0-9]+:\d+>\s*([a-zA-Z0-9\s_-]+)/gi);
        if (customEmojiMatches && customEmojiMatches.length > 0) {
            console.log('[JOIN] Found custom emoji format matches:', customEmojiMatches);
            for (const match of customEmojiMatches) {
                // Extract username after the emoji
                const rsn = match.replace(/<a?:[a-z_0-9]+:\d+>/gi, '').trim();
                if (rsn && rsn.length > 0 && !rsn.match(/^\d+$/)) { // Make sure it's not just numbers
                    rsns.push(rsn);
                    console.log('[JOIN] ✅ Extracted RSN from custom emoji:', rsn);
                }
            }
        }

        // 2. Standard emoji format: :emoji: PlayerName
        if (rsns.length === 0) {
            const standardEmojiMatches = description.match(/:[a-z_]+:\s*([a-zA-Z0-9\s_-]+)/gi);
            if (standardEmojiMatches && standardEmojiMatches.length > 0) {
                console.log('[JOIN] Found standard emoji format matches:', standardEmojiMatches);
                for (const match of standardEmojiMatches) {
                    const rsn = match.replace(/:[a-z_]+:/gi, '').trim();
                    if (rsn && rsn.length > 0 && !rsn.match(/^\d+$/)) {
                        rsns.push(rsn);
                        console.log('[JOIN] ✅ Extracted RSN from standard emoji:', rsn);
                    }
                }
            }
        }

        // 3. Unicode emoji format: 🔷 PlayerName
        if (rsns.length === 0) {
            const unicodeEmojiMatches = description.match(/(?:🔷|▪️|•)\s*([a-zA-Z0-9\s_-]+)/g);
            if (unicodeEmojiMatches && unicodeEmojiMatches.length > 0) {
                console.log('[JOIN] Found unicode emoji format matches:', unicodeEmojiMatches);
                for (const match of unicodeEmojiMatches) {
                    const rsn = match.replace(/(?:🔷|▪️|•)\s*/, '').trim();
                    if (rsn && rsn.length > 0) {
                        rsns.push(rsn);
                        console.log('[JOIN] ✅ Extracted RSN from unicode emoji:', rsn);
                    }
                }
            }
        }

        if (rsns.length === 0) {
            console.log('[JOIN] ❌ Could not extract any RSNs from join message');
            console.log('[JOIN] Description was:', description);

            // Send notification to log channel
            await sendSyncErrorNotification(originalMessage, 'Could not parse player name from WOM message', description);
            return;
        }

        console.log('[JOIN] Final extracted RSNs:', rsns);
        console.log('[JOIN] Total RSNs to process:', rsns.length);

        for (const rsn of rsns) {
            console.log(`\n[JOIN] ======================================`);
            console.log(`[JOIN] Processing RSN: "${rsn}"`);
            console.log(`[JOIN] RSN length: ${rsn.length} characters`);
            console.log(`[JOIN] ======================================`);
            await processMemberJoin(rsn, originalMessage);
        }
    } catch (error) {
        console.error('[JOIN] ❌ Error handling join message:', error);
        await sendSyncErrorNotification(originalMessage, 'Error processing join message', error.message);
    }
}

// Parse and handle leave messages
async function handleLeaveMessage(description, originalMessage) {
    try {
        console.log('[LEAVE] =====================================');
        console.log('[LEAVE] Raw description:', description);
        console.log('[LEAVE] Description length:', description.length);
        console.log('[LEAVE] =====================================');

        let rsns = [];

        // Check for "left: RSN" format first (common in title)
        // Format: "👋 Group member left: bajjy"
        const leftColonMatch = description.match(/(?:left|member left):\s*([a-zA-Z0-9\s_-]+)/i);
        if (leftColonMatch && leftColonMatch[1]) {
            const rsn = leftColonMatch[1].trim();
            if (rsn && rsn.length > 0 && !rsn.match(/^\d+$/)) {
                rsns.push(rsn);
                console.log('[LEAVE] ✅ Extracted RSN from "left:" format:', rsn);
            }
        }

        // If that didn't work, try other patterns:
        if (rsns.length === 0) {
            // 1. Custom Discord emoji format: <:feeder:1159532437412515860> PlayerName
            const customEmojiMatches = description.match(/<a?:[a-z_0-9]+:\d+>\s*([a-zA-Z0-9\s_-]+)/gi);
            if (customEmojiMatches && customEmojiMatches.length > 0) {
                console.log('[LEAVE] Found custom emoji format matches:', customEmojiMatches);
                for (const match of customEmojiMatches) {
                    const rsn = match.replace(/<a?:[a-z_0-9]+:\d+>/gi, '').trim();
                    if (rsn && rsn.length > 0 && !rsn.match(/^\d+$/)) {
                        rsns.push(rsn);
                        console.log('[LEAVE] ✅ Extracted RSN from custom emoji:', rsn);
                    }
                }
            }
        }

        // 2. Standard emoji format: :emoji: PlayerName
        if (rsns.length === 0) {
            const standardEmojiMatches = description.match(/:[a-z_]+:\s*([a-zA-Z0-9\s_-]+)/gi);
            if (standardEmojiMatches && standardEmojiMatches.length > 0) {
                console.log('[LEAVE] Found standard emoji format matches:', standardEmojiMatches);
                for (const match of standardEmojiMatches) {
                    const rsn = match.replace(/:[a-z_]+:/gi, '').trim();
                    if (rsn && rsn.length > 0 && !rsn.match(/^\d+$/)) {
                        rsns.push(rsn);
                        console.log('[LEAVE] ✅ Extracted RSN from standard emoji:', rsn);
                    }
                }
            }
        }

        // 3. Unicode emoji format: 🔷 PlayerName
        if (rsns.length === 0) {
            const unicodeEmojiMatches = description.match(/(?:🔷|▪️|•|👋)\s*([a-zA-Z0-9\s_-]+)/g);
            if (unicodeEmojiMatches && unicodeEmojiMatches.length > 0) {
                console.log('[LEAVE] Found unicode emoji format matches:', unicodeEmojiMatches);
                for (const match of unicodeEmojiMatches) {
                    const rsn = match.replace(/(?:🔷|▪️|•|👋)\s*/, '').trim();
                    // Filter out common words that might match
                    if (rsn && rsn.length > 0 && !['group', 'member', 'left'].includes(rsn.toLowerCase())) {
                        rsns.push(rsn);
                        console.log('[LEAVE] ✅ Extracted RSN from unicode emoji:', rsn);
                    }
                }
            }
        }

        if (rsns.length === 0) {
            console.log('[LEAVE] ❌ Could not extract any RSNs from leave message');
            console.log('[LEAVE] Description was:', description);
            await sendSyncErrorNotification(originalMessage, 'Could not parse player name from WOM leave message', description);
            return;
        }

        console.log('[LEAVE] Final extracted RSNs:', rsns);
        console.log('[LEAVE] Total RSNs to process:', rsns.length);

        for (const rsn of rsns) {
            console.log(`\n[LEAVE] ======================================`);
            console.log(`[LEAVE] Processing RSN: "${rsn}"`);
            console.log(`[LEAVE] RSN length: ${rsn.length} characters`);
            console.log(`[LEAVE] ======================================`);
            await processMemberLeave(rsn, originalMessage);
        }
    } catch (error) {
        console.error('[LEAVE] ❌ Error handling leave message:', error);
        await sendSyncErrorNotification(originalMessage, 'Error processing leave message', error.message);
    }
}

// Process member join - Full sync with Discord and database
async function processMemberJoin(rsn, originalMessage) {
    console.log(`[JOIN] ======================================`);
    console.log(`[JOIN] Starting WOM API fetch for: "${rsn}"`);
    console.log(`[JOIN] Encoded URL parameter: ${encodeURIComponent(rsn)}`);
    console.log(`[JOIN] Full API URL: https://api.wiseoldman.net/v2/players/${encodeURIComponent(rsn)}`);
    console.log(`[JOIN] ======================================`);

    try {
        // Fetch player stats from WOM
        const playerResponse = await axios.get(
            `https://api.wiseoldman.net/v2/players/${encodeURIComponent(rsn)}`,
            {
                headers: {
                    'User-Agent': 'Volition-Discord-Bot',
                    'Accept': 'application/json'
                },
                timeout: 10000 // 10 second timeout
            }
        );

        console.log(`[JOIN] ✅ WOM API Response Status: ${playerResponse.status}`);
        console.log(`[JOIN] ✅ WOM API Response received successfully`);

        const playerData = playerResponse.data;

        const womId = playerData.id.toString();
        const ehb = Math.round(playerData.ehb || 0);
        const ehp = Math.round(playerData.ehp || 0);

        // Get total level
        let totalLevel = 0;
        if (playerData.latestSnapshot?.data?.skills?.overall) {
            totalLevel = playerData.latestSnapshot.data.skills.overall.level || 0;
        }

        console.log(`[JOIN] Stats: Total=${totalLevel}, EHB=${ehb}`);

        // Check requirements
        const MIN_TOTAL_LEVEL = 1750;
        const MIN_EHB = 50;
        const meetsRequirements = totalLevel >= MIN_TOTAL_LEVEL || ehb >= MIN_EHB;

        console.log(`[JOIN] Requirements check: ${meetsRequirements ? 'PASSED' : 'FAILED'}`);

        if (!meetsRequirements) {
            console.log(`[JOIN] ${rsn} does not meet requirements - sending admin notification`);
            await sendAdminNotification(rsn, totalLevel, ehb, originalMessage);
            return;
        }

        // Check if player exists in database and get their Discord ID
        const existingPlayer = await db.getPlayerByWomId(womId);
        let discordId = existingPlayer?.discord_id || null;

        // Try to find Discord member if we have their ID
        let member = null;
        let nicknameChanged = false;
        let rankAssigned = false;
        let rank = null;

        if (discordId) {
            try {
                member = await originalMessage.guild.members.fetch(discordId);
                console.log(`[JOIN] Found linked Discord user: ${member.user.tag}`);

                // Determine rank with time-based consideration
                rank = determineRank(ehb, member.joinedTimestamp, originalMessage.guild);
                console.log(`[JOIN] Assigned rank: ${rank}`);

                // Nickname changes disabled
                console.log(`[JOIN] Nickname update skipped (disabled)`);

                // Assign Discord rank
                try {
                    // Get current rank role (if any)
                    const allRankRoleIds = Object.values(RANK_ROLES).filter(id => id !== null);
                    const currentRankRole = member.roles.cache.find(role => allRankRoleIds.includes(role.id));

                    // Only remove the current rank role, not all roles
                    if (currentRankRole) {
                        await member.roles.remove(currentRankRole);
                        console.log(`[JOIN] Removed old rank role: ${currentRankRole.name}`);
                    }

                    // Add new rank role if it exists
                    const newRoleId = RANK_ROLES[rank];
                    if (newRoleId) {
                        await member.roles.add(newRoleId);
                        rankAssigned = true;
                        console.log(`[JOIN] ✅ Assigned rank ${rank}`);
                    } else {
                        console.warn(`[JOIN] ⚠️ Role ID not configured for rank: ${rank}`);
                    }
                } catch (error) {
                    console.error(`[JOIN] ⚠️ Failed to assign rank:`, error.message);
                }
            } catch (error) {
                console.log(`[JOIN] Could not fetch Discord member with ID ${discordId}`);
            }
        } else {
            console.log(`[JOIN] No Discord ID linked for this player`);
            // For non-linked players, determine rank without time consideration
            rank = determineRank(ehb, null, originalMessage.guild);
        }

        // Update or create player in database
        if (existingPlayer) {
            await db.updatePlayer(existingPlayer.id, {
                rsn: rsn,
                wom_id: womId,
                discord_id: discordId // Preserve existing discord_id
            });
            console.log(`[JOIN] ✅ Updated existing player in database`);
        } else {
            await db.createPlayer({
                rsn: rsn,
                wom_id: womId,
                discord_id: null
            }, 0);
            console.log(`[JOIN] ✅ Created new player in database`);
        }

        // Send custom notification with full stats
        await sendJoinNotification(rsn, totalLevel, ehb, ehp, rank, womId, originalMessage, nicknameChanged, rankAssigned, discordId);

        // Send confirmation to log channel
        const confirmDetails = `**Player:** ${rsn}\n` +
            `**Total Level:** ${totalLevel}\n` +
            `**EHB:** ${ehb} | **EHP:** ${ehp}\n` +
            `**Rank:** ${rank}\n` +
            `**Discord:** ${discordId ? `<@${discordId}>` : 'Not linked'}\n` +
            `**Database:** ✅ Synced`;
        await sendSyncConfirmation(originalMessage, 'Member Join Auto-Synced', confirmDetails);

        console.log(`[JOIN] ✅ Successfully processed ${rsn}`);
    } catch (error) {
        console.error(`[JOIN] ======================================`);
        console.error(`[JOIN] ❌ ERROR processing RSN: "${rsn}"`);
        console.error(`[JOIN] Error Type: ${error.constructor.name}`);
        console.error(`[JOIN] Error Message: ${error.message}`);

        if (error.response) {
            console.error(`[JOIN] HTTP Status: ${error.response.status}`);
            console.error(`[JOIN] HTTP Status Text: ${error.response.statusText}`);
            console.error(`[JOIN] Response Data:`, JSON.stringify(error.response.data, null, 2));
            console.error(`[JOIN] Request URL: ${error.config?.url}`);
        } else if (error.request) {
            console.error(`[JOIN] No response received from WOM API`);
            console.error(`[JOIN] Request Details:`, error.request);
        } else {
            console.error(`[JOIN] Error Details:`, error);
        }
        console.error(`[JOIN] Full Stack Trace:`, error.stack);
        console.error(`[JOIN] ======================================`);

        // Send error notification to log channel
        await sendSyncErrorNotification(
            originalMessage,
            `Failed to process member join for: ${rsn}`,
            error.response ? `HTTP ${error.response.status}: ${error.response.statusText}` : error.message
        );
    }
}

// Process member leave
async function processMemberLeave(rsn, originalMessage) {
    console.log(`[LEAVE] Looking up ${rsn} in database...`);

    try {
        // Try to get WOM ID from API
        let womId = null;
        let existingPlayer = null;

        try {
            const playerResponse = await axios.get(
                `https://api.wiseoldman.net/v2/players/${encodeURIComponent(rsn)}`
            );
            womId = playerResponse.data.id.toString();
            existingPlayer = await db.getPlayerByWomId(womId);
        } catch (error) {
            console.log(`[LEAVE] Could not fetch from WOM, checking database by RSN`);
            // Try finding by RSN if WOM lookup fails
            const allPlayers = await db.getAllPlayers();
            existingPlayer = allPlayers.find(p => p.rsn?.toLowerCase() === rsn.toLowerCase());
            if (existingPlayer) {
                womId = existingPlayer.wom_id;
            }
        }

        if (existingPlayer) {
            console.log(`[LEAVE] ✅ Found in database:`);
            console.log(`  - RSN: ${existingPlayer.rsn}`);
            console.log(`  - Discord ID: ${existingPlayer.discord_id || 'Not linked'}`);
            console.log(`  - VP Balance: ${existingPlayer.player_points?.points || 0}`);

            // Remove from database
            try {
                if (womId) {
                    await db.deletePlayerByWomId(womId);
                    console.log(`[LEAVE] ✅ Removed from database`);
                } else {
                    console.log(`[LEAVE] ⚠️ Could not remove - no WOM ID`);
                }
            } catch (error) {
                console.error(`[LEAVE] ❌ Error removing from database:`, error.message);
            }
        } else {
            console.log(`[LEAVE] ℹ️ Not found in database`);
        }

        // Send custom leave notification
        await sendLeaveNotification(rsn, womId, existingPlayer, originalMessage);

        // Send confirmation to log channel
        const confirmDetails = `**Player:** ${rsn}\n` +
            `**Discord:** ${existingPlayer?.discord_id ? `<@${existingPlayer.discord_id}>` : 'Not linked'}\n` +
            `**VP Balance:** ${existingPlayer?.player_points?.points || 0}\n` +
            `**Database:** ${existingPlayer ? '✅ Removed' : 'ℹ️ Was not in database'}`;
        await sendSyncConfirmation(originalMessage, 'Member Leave Auto-Synced', confirmDetails);

        console.log(`[LEAVE] ✅ Successfully processed ${rsn}`);
    } catch (error) {
        console.error(`[LEAVE] ❌ Error processing ${rsn}:`, error.message);
    }
}

// Send custom join notification (thread reply to WOM message)
async function sendJoinNotification(rsn, totalLevel, ehb, ehp, rank, womId, originalMessage, nicknameChanged, rankAssigned, discordId) {
    try {
        const hasDiscordLink = !!discordId;

        let description = `**${rsn}** has joined the clan and been synced to the database!\n\n`;

        if (hasDiscordLink) {
            description += `**Discord Account:** <@${discordId}>\n\n`;
            description += `**Discord Sync:**\n`;
            description += `• ${nicknameChanged ? '✅' : '⚠️'} Nickname ${nicknameChanged ? 'updated' : 'not updated'}\n`;
            description += `• ${rankAssigned ? '✅' : '⚠️'} Rank ${rankAssigned ? 'assigned' : 'not assigned'}\n`;
            description += `• ✅ Database synced`;
        } else {
            description += `**Discord Account:** Not linked\n\n`;
            description += `**Database:** ✅ Synced\n\n`;
            description += `Player should run \`/verify\` to link their Discord account.`;
        }

        const embed = new EmbedBuilder()
            .setColor('Green')
            .setTitle('✅ Member Auto-Synced')
            .setDescription(description)
            .addFields(
                { name: 'Total Level', value: totalLevel.toString(), inline: true },
                { name: 'EHB', value: ehb.toString(), inline: true },
                { name: 'EHP', value: ehp.toString(), inline: true },
                { name: 'Assigned Rank', value: rank, inline: false },
                { name: 'WOM Profile', value: `[View Profile](https://wiseoldman.net/players/${womId})`, inline: false }
            )
            .setThumbnail('https://cdn.discordapp.com/icons/571389228806570005/ff45546375fe88eb358088dc1fd4c28b.png?size=480&quality=lossless')
            .setTimestamp();

        if (!hasDiscordLink || !rankAssigned) {
            embed.setFooter({ text: hasDiscordLink ? 'Use /sync to manually complete the sync if needed' : 'User needs to verify their Discord account' });
        }

        // Reply in thread or same channel
        await originalMessage.reply({ embeds: [embed] });
        console.log(`[JOIN] ✅ Sent custom notification`);
    } catch (error) {
        console.error('[JOIN] ❌ Error sending notification:', error);
    }
}

// Send admin notification for players not meeting requirements
async function sendAdminNotification(rsn, totalLevel, ehb, originalMessage) {
    try {
        const embed = new EmbedBuilder()
            .setColor('Orange')
            .setTitle('⚠️ Admin Review Required')
            .setDescription(
                `**${rsn}** joined but does NOT meet requirements.`
            )
            .addFields(
                { name: 'Total Level', value: `${totalLevel} / 1750`, inline: true },
                { name: 'EHB', value: `${ehb} / 50`, inline: true },
                { name: 'Status', value: '❌ Does not meet requirements', inline: false }
            )
            .setTimestamp();

        await originalMessage.reply({ embeds: [embed] });
        console.log(`[JOIN] ✅ Sent admin notification`);
    } catch (error) {
        console.error('[JOIN] ❌ Error sending admin notification:', error);
    }
}

// Send custom leave notification
async function sendLeaveNotification(rsn, womId, playerData, originalMessage) {
    try {
        const embed = new EmbedBuilder()
            .setColor('Red')
            .setTitle('👋 Member Left and Auto-Synced')
            .setTimestamp();

        if (playerData) {
            embed.setDescription(`**${rsn}** has left the clan and been removed from the database.`);
            embed.addFields(
                { name: 'Discord Account', value: playerData.discord_id ? `<@${playerData.discord_id}>` : 'Not linked', inline: true },
                { name: 'Previous VP Balance', value: (playerData.player_points?.points || 0).toString(), inline: true },
                { name: 'Database Status', value: '✅ Removed from database', inline: false }
            );
        } else {
            embed.setDescription(`**${rsn}** has left the clan.`);
            embed.addFields(
                { name: 'Database Status', value: 'ℹ️ Was not in database', inline: false }
            );
        }

        if (womId) {
            embed.addFields(
                { name: 'WOM Profile', value: `[View Profile](https://wiseoldman.net/players/${womId})`, inline: false }
            );
        }

        await originalMessage.reply({ embeds: [embed] });
        console.log(`[LEAVE] ✅ Sent custom notification`);
    } catch (error) {
        console.error('[LEAVE] ❌ Error sending notification:', error);
    }
}

// Send error notification to log channel
async function sendSyncErrorNotification(originalMessage, errorTitle, errorDetails) {
    try {
        const LOG_CHANNEL_ID = config.PAYOUT_LOG_CHANNEL_ID;

        if (!LOG_CHANNEL_ID) {
            console.error('[SYNC ERROR] No log channel configured in config.PAYOUT_LOG_CHANNEL_ID');
            return;
        }

        const logChannel = await originalMessage.guild.channels.fetch(LOG_CHANNEL_ID);

        if (!logChannel) {
            console.error('[SYNC ERROR] Could not find log channel');
            return;
        }

        const embed = new EmbedBuilder()
            .setColor('Red')
            .setTitle('❌ Auto-Sync Error')
            .setDescription(errorTitle)
            .addFields(
                { name: 'Error Details', value: errorDetails.slice(0, 1024), inline: false },
                { name: 'WOM Message Link', value: `[Jump to Message](${originalMessage.url})`, inline: false }
            )
            .setFooter({ text: 'Check console logs for full details' })
            .setTimestamp();

        await logChannel.send({ embeds: [embed] });
        console.log('[SYNC ERROR] ✅ Sent error notification to log channel');
    } catch (error) {
        console.error('[SYNC ERROR] ❌ Failed to send error notification:', error.message);
    }
}

// Send sync confirmation to log channel
async function sendSyncConfirmation(originalMessage, action, details) {
    try {
        const LOG_CHANNEL_ID = config.PAYOUT_LOG_CHANNEL_ID;

        if (!LOG_CHANNEL_ID) {
            console.log('[SYNC CONFIRM] No log channel configured, skipping confirmation');
            return;
        }

        const logChannel = await originalMessage.guild.channels.fetch(LOG_CHANNEL_ID);

        if (!logChannel) {
            console.error('[SYNC CONFIRM] Could not find log channel');
            return;
        }

        const embed = new EmbedBuilder()
            .setColor('Green')
            .setTitle(`✅ ${action}`)
            .setDescription(details)
            .addFields(
                { name: 'WOM Message', value: `[View Original](${originalMessage.url})`, inline: false }
            )
            .setTimestamp();

        await logChannel.send({ embeds: [embed] });
        console.log('[SYNC CONFIRM] ✅ Sent sync confirmation to log channel');
    } catch (error) {
        console.error('[SYNC CONFIRM] ❌ Failed to send confirmation:', error.message);
    }
}

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        // Get WOM Bot ID from environment or config
        const WOM_BOT_ID = process.env.WOM_BOT_ID || config.WISE_OLD_MAN_BOT_ID;
        const WOM_NOTIFICATION_CHANNEL_ID = process.env.WOM_NOTIFICATION_CHANNEL_ID || config.WISE_OLD_MAN_CHANNEL_ID;

        // Debug: Log all messages in the monitored channel (comment out after testing)
        if (WOM_NOTIFICATION_CHANNEL_ID && message.channelId === WOM_NOTIFICATION_CHANNEL_ID) {
            console.log(`[DEBUG] Message in monitored channel from: ${message.author.tag} (ID: ${message.author.id})`);
        }

        // Ignore messages not from WOM bot
        if (message.author.id !== WOM_BOT_ID) return;

        console.log('[WOM MESSAGE] ✅ Message from WOM bot detected!');

        // Optionally filter to specific channel
        if (WOM_NOTIFICATION_CHANNEL_ID && message.channelId !== WOM_NOTIFICATION_CHANNEL_ID) {
            console.log('[WOM MESSAGE] ⚠️ Message is not in monitored channel, skipping');
            return;
        }

        // Check if message has embeds (WOM bot uses embeds)
        if (message.embeds.length === 0) {
            console.log('[WOM MESSAGE] ⚠️ Message has no embeds, skipping');
            return;
        }

        const embed = message.embeds[0];
        const title = embed.title?.toLowerCase() || '';
        const description = embed.description || '';

        console.log('\n=================================================');
        console.log('[WOM MESSAGE] 📨 WOM BOT MESSAGE RECEIVED');
        console.log('[WOM MESSAGE] Title (original):', embed.title);
        console.log('[WOM MESSAGE] Title (lowercase):', title);
        console.log('[WOM MESSAGE] Description preview:', description.substring(0, 100));
        console.log('[WOM MESSAGE] Full description length:', description.length);
        console.log('[WOM MESSAGE] Embed color:', embed.color);
        console.log('[WOM MESSAGE] Embed fields count:', embed.fields?.length || 0);
        console.log('=================================================');

        // Detect join messages
        if (title.includes('joined') || title.includes('new group member')) {
            console.log('[WOM MESSAGE] ✅ Detected JOIN notification - processing...');
            await handleJoinMessage(description, message);
        }
        // Detect leave messages
        else if (title.includes('left') || title.includes('member left')) {
            console.log('[WOM MESSAGE] ✅ Detected LEAVE notification - processing...');
            // For leave messages, the RSN might be in the title instead of description
            // Title format: "👋 Group member left: bajjy"
            if (title && (title.includes('left:') || title.includes('member left:'))) {
                console.log('[LEAVE] Extracting RSN from title instead of description');
                await handleLeaveMessage(title, message);
            } else {
                await handleLeaveMessage(description, message);
            }
        }
        else {
            console.log('[WOM MESSAGE] ⚠️ Message title does not match join/leave patterns');
            console.log('[WOM MESSAGE] ⚠️ This message will NOT be processed');
            console.log('[WOM MESSAGE] ⚠️ Please check the title format above to update the detection logic');
        }
    },
};
