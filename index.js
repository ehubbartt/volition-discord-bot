const fs = require('node:fs');
const path = require('node:path');
const {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  Partials,
} = require('discord.js');
const config = require('./utils/config');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.User,
    Partials.GuildMember,
  ],
});

// Used for tracking shop-related messages and loaded commands
client.activeShopMessages = new Collection();
client.commands = new Collection();

// ----------------------------------------------------------------------------
// Dynamic command loading

const commandsPath = path.join(__dirname, 'commands');
const commandFolders = fs
  .readdirSync(commandsPath)
  .filter(folder => fs.statSync(path.join(commandsPath, folder)).isDirectory());

for (const folder of commandFolders) {
  const folderPath = path.join(commandsPath, folder);
  const commandFiles = fs.readdirSync(folderPath).filter(f => f.endsWith('.js'));

  for (const file of commandFiles) {
    const filePath = path.join(folderPath, file);
    const command = require(filePath);

    if ('data' in command && 'execute' in command) {
      client.commands.set(command.data.name, command);
    }
  }
}

// ----------------------------------------------------------------------------
// Dynamic event loading

const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));

for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file);
  const event = require(filePath);

  console.log(`🔹 Loading event: ${event.name}`);

  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
}

// ----------------------------------------------------------------------------
// On Ready: Init caches and schedule tasks

const { getWeeklyTaskAndMove } = require('./commands/fun/weeklyTask.js');
const { startSoftCloseChecker } = require('./jobs/softCloseChecker.js');
const { startVoiceTracker } = require('./jobs/voiceTracker.js');
const { startLfgExpiryChecker } = require('./jobs/lfgExpiry.js');
const { startEventLifecycle } = require('./jobs/eventLifecycle.js');
const { postWeeklySokCompetitions } = require('./jobs/sokScheduler.js');
const {
  postWeeklyVoiceLeaderboard,
  startVoiceLeaderboardRefresh,
} = require('./jobs/voiceLeaderboard.js');
const { createTaskEvent } = require('./commands/admin/event.js');

const TEST_CHANNEL_ID = config.TEST_CHANNEL_ID;

let lastTaskSentDate = null;
let lastRankUpdateDate = null;
let lastSokRunDate = null;

client.once(Events.ClientReady, async () => {
  console.log(`${client.user.tag} is online.`);
  client.user.setActivity({ name: 'Old School RuneScape' });

  // Start soft-close checker (runs on startup + every hour)
  startSoftCloseChecker(client);

  // Start voice activity tracker (runs every 5 minutes)
  startVoiceTracker(client);

  // Start LFG party expiry checker (runs every 5 minutes)
  startLfgExpiryChecker(client);

  // Start event lifecycle checker (close expired events, update leaderboards)
  startEventLifecycle(client);

  // Start weekly voice leaderboard refresh (runs on startup + every 15 minutes)
  startVoiceLeaderboardRefresh(client);

  setInterval(async () => {
    const now = new Date();
    const today = now.toDateString();

    // 02:00 SWE — Weekly task + voice rewards + voice leaderboard reset
    const isMondayMidnight = now.getDay() === 1 && now.getHours() === 0 && now.getMinutes() === 0;
    if (isMondayMidnight && lastTaskSentDate !== today) {
      await sendWeeklyTask();
      await awardWeeklyVoiceRewards();
      await resetVoiceLeaderboard();
      lastTaskSentDate = today;
    }

    // 05:00 SWE — Daily rank update
    const isThreeAM = now.getHours() === 3 && now.getMinutes() === 0;
    if (isThreeAM && lastRankUpdateDate !== today) {
      await runDailyRankUpdate();
      lastRankUpdateDate = today;
    }

    // Sunday 23:00 UTC — post the new week's Skill or Kill competitions
    const isSundayElevenUtc = now.getUTCDay() === 0 && now.getUTCHours() === 23 && now.getUTCMinutes() === 0;
    if (isSundayElevenUtc && lastSokRunDate !== today) {
      await runSokScheduler();
      lastSokRunDate = today;
    }
  }, 60000);
});

// ----------------------------------------------------------------------------
// Helpers

// Monday 02:00 SWE — close last week's voice leaderboard and post a fresh one
async function resetVoiceLeaderboard() {
  try {
    const { messageUrl } = await postWeeklyVoiceLeaderboard(client);
    const testChannel = client.channels.cache.get(TEST_CHANNEL_ID);
    if (testChannel) {
      await testChannel.send(`✅ **[Auto-Run]** Voice leaderboard reset at ${new Date().toLocaleString()} — ${messageUrl}`);
    }
  } catch (err) {
    console.error('[VoiceLeaderboard] Reset error:', err);
    const testChannel = client.channels.cache.get(TEST_CHANNEL_ID);
    if (testChannel) {
      await testChannel.send(`❌ **[Auto-Run]** Voice leaderboard reset failed: ${err.message}`);
    }
  }
}

// Sunday 23:00 UTC — post this week's SoK competitions
async function runSokScheduler() {
  try {
    const result = await postWeeklySokCompetitions(client);
    const testChannel = client.channels.cache.get(TEST_CHANNEL_ID);
    if (testChannel) {
      const summary = `posted=${result.posted.length}, skipped=${result.skipped.length}, errors=${result.errors.length}`;
      await testChannel.send(`✅ **[Auto-Run]** SoK scheduler ran at ${new Date().toUTCString()} — ${summary}`);
    }
  } catch (err) {
    console.error('[SoK] Scheduler error:', err);
    const testChannel = client.channels.cache.get(TEST_CHANNEL_ID);
    if (testChannel) {
      await testChannel.send(`❌ **[Auto-Run]** SoK scheduler failed: ${err.message}`);
    }
  }
}

// Weekly task — creates an event in the unified events channel
async function sendWeeklyTask() {
  try {
    const taskText = await getWeeklyTaskAndMove();
    const event = await createTaskEvent(client, taskText);

    const testChannel = client.channels.cache.get(TEST_CHANNEL_ID);
    if (testChannel) {
      if (event) {
        await testChannel.send(`✅ **[Auto-Run]** Weekly task event created at ${new Date().toLocaleString()}\nTask: ${taskText}\nEvent ID: ${event.id}`);
      } else {
        await testChannel.send(`⚠️ **[Auto-Run]** Weekly task failed — events channel not found`);
      }
    }
  } catch (error) {
    console.error('[Weekly Task] Error creating event:', error);
    const testChannel = client.channels.cache.get(TEST_CHANNEL_ID);
    if (testChannel) {
      await testChannel.send(`❌ **[Auto-Run]** Weekly task failed: ${error.message}`);
    }
  }
}

// Daily Rank Update
async function runDailyRankUpdate() {
  console.log('[Daily Rank Update] Starting automated rank update...');

  try {
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) {
      console.log('[Daily Rank Update] Guild not found');
      return;
    }

    // Import the rank update logic
    const { womApi } = require('./utils/api');
    const db = require('./db/supabase');
    const {
      formatRank,
      getRankName,
      applyRank,
      getWomRole
    } = require('./utils/ranks');
    const { EmbedBuilder } = require('discord.js');

    const clanId = config.clanId;

    // Fetch clan data from WOM API
    const womResponse = await womApi.get(`/groups/${clanId}`);
    const clanData = womResponse.data;

    if (!clanData || !clanData.memberships) {
      console.log('[Daily Rank Update] Failed to retrieve clan data or no members found.');
      return;
    }

    const clanMembers = clanData.memberships;
    const existingPlayers = await db.getAllPlayers();

    const discordIdToRsnMap = {};
    const discordIdToPlayerIdMap = {};
    existingPlayers.forEach(player => {
      if (player.discord_id && player.rsn) {
        discordIdToRsnMap[player.discord_id] = player.rsn;
        discordIdToPlayerIdMap[player.discord_id] = player.id;
      }
    });

    // Fetch all members of server
    await guild.members.fetch();
    const allMembers = guild.members.cache;

    let mismatchOutput = [];
    let userMentions = [];
    let rankUpAnnouncements = [];

    for (const discordId in discordIdToRsnMap) {
      const member = allMembers.get(discordId);
      if (member) {
        const rsn = discordIdToRsnMap[discordId];
        const clanMember = clanMembers.find(m => m.player.username === rsn);

        // Skip players not in the WOM clan
        if (!clanMember) {
          console.log(`[Daily Rank Update] ⏭️ Skipped ${rsn} - not found in WOM clan data`);
          continue;
        }

        const ehb = Math.round(clanMember.player.ehb || 0);
        const rankResult = await applyRank({ ehb, member, allowDowngrade: false });

        if (rankResult.changed) {
          userMentions.push(`<@${member.id}>`);

          if (rankResult.oldRankIndex === -1) {
            mismatchOutput.push(
              `RSN: **${rsn}** - EHB: **${ehb}** - Old Rank: **None** - Updated to: ${formatRank(guild, rankResult.newRankIndex)}`
            );
            rankUpAnnouncements.push({
              member, rsn, ehb,
              oldRankIndex: rankResult.oldRankIndex,
              newRankIndex: rankResult.newRankIndex,
              isInitial: true
            });
          } else {
            mismatchOutput.push(
              `RSN: **${rsn}** - EHB: **${ehb}** - Old Rank: ${formatRank(guild, rankResult.oldRankIndex)} - Upgraded to: ${formatRank(guild, rankResult.newRankIndex)}`
            );
            rankUpAnnouncements.push({
              member, rsn, ehb,
              oldRankIndex: rankResult.oldRankIndex,
              newRankIndex: rankResult.newRankIndex,
              isInitial: false
            });
          }

          console.log(`[Daily Rank Update] ⬆️ Upgraded rank for ${rsn}: ${rankResult.oldRankIndex >= 0 ? getRankName(guild, rankResult.oldRankIndex) : 'None'} -> ${getRankName(guild, rankResult.newRankIndex)} (${ehb} EHB)`);

          // Persist rank to database
          const playerId = discordIdToPlayerIdMap[discordId];
          if (playerId) {
            await db.updatePlayer(playerId, { rank: getWomRole(rankResult.newRankIndex) });
          }
        } else if (rankResult.oldRankIndex !== rankResult.newRankIndex) {
          console.log(`[Daily Rank Update] ⏭️ Skipped downgrade for ${rsn}: keeping ${getRankName(guild, rankResult.oldRankIndex)} (earned rank: ${getRankName(guild, rankResult.newRankIndex)}, ${ehb} EHB)`);
        }
      }
    }

    // Log to test channel
    const testChannel = client.channels.cache.get(TEST_CHANNEL_ID);

    if (mismatchOutput.length > 0 && testChannel) {
      // Send user mentions first
      if (userMentions.length > 0) {
        const mentionMessage = userMentions.join('');
        await testChannel.send({ content: mentionMessage });
      }

      // Helper function for splitting long outputs
      const chunkArray = (array, chunkSize) => {
        const chunks = [];
        let currentChunk = '';
        for (const line of array) {
          if ((currentChunk + line + '\n').length > chunkSize) {
            chunks.push(currentChunk);
            currentChunk = line + '\n';
          } else {
            currentChunk += line + '\n';
          }
        }
        if (currentChunk) {
          chunks.push(currentChunk);
        }
        return chunks;
      };

      const chunkedMessages = chunkArray(mismatchOutput, 1000);

      for (let i = 0; i < chunkedMessages.length; i++) {
        const embed = new EmbedBuilder()
          .setColor('White')
          .setTitle(i === 0 ? `📊 Daily Rank Update Summary` : `📊 Daily Rank Update Summary (Part ${i + 1} of ${chunkedMessages.length})`)
          .addFields({ name: 'Changes Made:', value: chunkedMessages[i] });

        await testChannel.send({ embeds: [embed] });
      }

      await testChannel.send(`✅ **[Auto-Run]** Daily rank update completed at ${new Date().toLocaleString()}\nTotal ranks updated: ${mismatchOutput.length}`);
    } else if (testChannel) {
      await testChannel.send(`✅ **[Auto-Run]** Daily rank update completed at ${new Date().toLocaleString()}\nNo ranks were updated.`);
    }

    // Broadcast rank-ups to #rank-ups channel
    const { broadcastRankUps } = require('./utils/rankAnnouncements');
    await broadcastRankUps(guild, rankUpAnnouncements, '[Daily Rank Update]');

    console.log(`[Daily Rank Update] Completed. ${mismatchOutput.length} rank(s) updated.`);

  } catch (error) {
    console.error('[Daily Rank Update] Error during automated rank update:', error);
    const testChannel = client.channels.cache.get(TEST_CHANNEL_ID);
    if (testChannel) {
      await testChannel.send(`❌ **[Auto-Run]** Daily rank update failed at ${new Date().toLocaleString()}\nError: ${error.message}`);
    }
  }
}

// Weekly Voice Chat Rewards
async function awardWeeklyVoiceRewards() {
  try {
    const { calculateAndAwardVoiceRewards } = require('./utils/voiceRewards');
    const result = await calculateAndAwardVoiceRewards(config);

    if (!result) {
      console.log('[WeeklyVoiceRewards] No voice activity or not enabled, skipping');
      return;
    }

    const payoutChannel = client.channels.cache.get(config.PAYOUT_LOG_CHANNEL_ID);
    if (payoutChannel) {
      await payoutChannel.send({ content: result.mentions, embeds: [result.embed] });
    }

    console.log(`[WeeklyVoiceRewards] Awarded VP to ${result.awarded.length} user(s)`);
  } catch (error) {
    console.error('[WeeklyVoiceRewards] Error:', error);
    const testChannel = client.channels.cache.get(TEST_CHANNEL_ID);
    if (testChannel) {
      await testChannel.send(`❌ **[Auto-Run]** Weekly voice rewards failed: ${error.message}`);
    }
  }
}

// ----------------------------------------------------------------------------
// [DEBUG] Voice channel activity logging

// client.on(Events.VoiceStateUpdate, (oldState, newState) => {
//   if (!oldState.channel && newState.channel) {
//     console.log(`${newState.member.user.tag} joined VC: ${newState.channel.name}`);
//   }
// });

// ----------------------------------------------------------------------------
// Message create event (legacy message commands removed - all commands now use slash commands)
// Kept for future message-based features if needed

// client.on(Events.MessageCreate, async (message) => {
//   if (message.author.bot) return;
//   // Legacy message commands removed - use slash commands instead
// });

client.login(process.env.TOKEN);
