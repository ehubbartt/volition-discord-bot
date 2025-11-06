const { Events, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const db = require('../db/supabase');
const config = require('../config.json');
const { RANK_ROLES, determineRank } = require('../commands/utility/sync');

// Parse and handle join messages
async function handleJoinMessage(description, originalMessage) {
    try {
        // Extract RSNs from description
        // WOM format can be: "🔷 PlayerName" OR ":emoji: PlayerName" (like :feeder: iAdren)
        console.log('[JOIN] Raw description:', description);

        // First try the :emoji: format (e.g., ":feeder: iAdren")
        let rsnMatches = description.match(/:[a-z_]+:\s*([a-zA-Z0-9\s_-]+)/gi);

        // If that doesn't work, try the Unicode emoji format
        if (!rsnMatches || rsnMatches.length === 0) {
            rsnMatches = description.match(/(?:🔷|▪️|•)\s*([a-zA-Z0-9\s_-]+)/g);
        }

        if (!rsnMatches || rsnMatches.length === 0) {
            console.log('[WOM MESSAGE] Could not extract RSNs from join message');
            console.log('[WOM MESSAGE] Description was:', description);
            return;
        }

        console.log('[JOIN] Found matches:', rsnMatches);

        for (const match of rsnMatches) {
            // Clean up RSN (remove emoji and whitespace)
            // Remove both :emoji: format and Unicode emojis
            const rsn = match.replace(/:[a-z_]+:/gi, '').replace(/(?:🔷|▪️|•)\s*/, '').trim();

            if (!rsn) continue;

            console.log(`\n[JOIN] Processing: ${rsn}`);
            await processMemberJoin(rsn, originalMessage);
        }
    } catch (error) {
        console.error('[WOM MESSAGE] Error handling join message:', error);
    }
}

// Parse and handle leave messages
async function handleLeaveMessage(description, originalMessage) {
    try {
        // Extract RSNs from description
        console.log('[LEAVE] Raw description:', description);

        // First try the :emoji: format (e.g., ":feeder: iAdren")
        let rsnMatches = description.match(/:[a-z_]+:\s*([a-zA-Z0-9\s_-]+)/gi);

        // If that doesn't work, try the Unicode emoji format
        if (!rsnMatches || rsnMatches.length === 0) {
            rsnMatches = description.match(/(?:🔷|▪️|•)\s*([a-zA-Z0-9\s_-]+)/g);
        }

        if (!rsnMatches || rsnMatches.length === 0) {
            console.log('[WOM MESSAGE] Could not extract RSNs from leave message');
            console.log('[WOM MESSAGE] Description was:', description);
            return;
        }

        console.log('[LEAVE] Found matches:', rsnMatches);

        for (const match of rsnMatches) {
            // Clean up RSN (remove emoji and whitespace)
            const rsn = match.replace(/:[a-z_]+:/gi, '').replace(/(?:🔷|▪️|•)\s*/, '').trim();

            if (!rsn) continue;

            console.log(`\n[LEAVE] Processing: ${rsn}`);
            await processMemberLeave(rsn, originalMessage);
        }
    } catch (error) {
        console.error('[WOM MESSAGE] Error handling leave message:', error);
    }
}

// Process member join - Full sync with Discord and database
async function processMemberJoin(rsn, originalMessage) {
    console.log(`[JOIN] Fetching stats for ${rsn}...`);

    try {
        // Fetch player stats from WOM
        const playerResponse = await axios.get(
            `https://api.wiseoldman.net/v2/players/${encodeURIComponent(rsn)}`
        );
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
                rank = determineRank(ehb, member.joinedTimestamp);
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
            rank = determineRank(ehb);
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

        console.log(`[JOIN] ✅ Successfully processed ${rsn}`);
    } catch (error) {
        console.error(`[JOIN] ❌ Error processing ${rsn}:`, error.message);
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
            .setThumbnail('https://i.imgur.com/BJJpBj2.png')
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
            await handleLeaveMessage(description, message);
        }
        else {
            console.log('[WOM MESSAGE] ⚠️ Message title does not match join/leave patterns');
            console.log('[WOM MESSAGE] ⚠️ This message will NOT be processed');
            console.log('[WOM MESSAGE] ⚠️ Please check the title format above to update the detection logic');
        }
    },
};
