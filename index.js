const fs = require('node:fs');
const path = require('node:path');
const {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  Partials,
  ChannelType,
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
const { getDailyWordleAndMove } = require('./commands/fun/dailyWordle.js');
const { startSoftCloseChecker } = require('./jobs/softCloseChecker.js');

const weeklyTaskRoleID = config.weeklyTaskRoleID; // used for push notifications
const taskSubmissionChannelID = config.WEEKLY_CHALLENGE_SUBMISSION_CHANNEL_ID;
const wordleSubmissionChannelID = config.DAILY_CHALLENGE_SUBMISSION_CHANNEL_ID;
const WEEKLY_CHANNEL_ID = config.WEEKLY_TASK_ANNOUNCEMENT_CHANNEL_ID;
const DAILY_CHANNEL_ID = config.DAILY_WORDLE_ANNOUNCEMENT_CHANNEL_ID;
const TEST_CHANNEL_ID = config.TEST_CHANNEL_ID;

let lastTaskSentDate = null;
let lastWordleSentDate = null;
let lastRankUpdateDate = null;

client.once(Events.ClientReady, async () => {
  console.log(`${client.user.tag} is online.`);
  client.user.setActivity({ name: 'Old School RuneScape' });

  await cacheOldMessages();

  // Start soft-close checker (runs on startup + every hour)
  startSoftCloseChecker(client);

  setInterval(async () => {
    const now = new Date();
    const today = now.toDateString();

    // 02:00 SWE
    const isMondayMidnight = now.getDay() === 1 && now.getHours() === 0 && now.getMinutes() === 0;
    if (isMondayMidnight && lastTaskSentDate !== today) {
      await sendWeeklyTask();
      lastTaskSentDate = today;
    }

    // 05:00 SWE
    const isThreeAM = now.getHours() === 3 && now.getMinutes() === 0;
    if (isThreeAM && lastWordleSentDate !== today) {
      await sendDailyWordle();
      lastWordleSentDate = today;
    }

    // 05:00 SWE (same time as daily wordle)
    if (isThreeAM && lastRankUpdateDate !== today) {
      await runDailyRankUpdate();
      lastRankUpdateDate = today;
    }
  }, 60000);
});

// ----------------------------------------------------------------------------
// Helpers

// Weekly task
async function sendWeeklyTask() {
  const channel = client.channels.cache.get(WEEKLY_CHANNEL_ID);
  if (!channel) {
    console.log('[Weekly Task] Channel not found');
    return;
  }

  const task = await getWeeklyTaskAndMove();
  const deadline = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

  await channel.send(`<@&${weeklyTaskRoleID}>\n**Task:** ${task}`);
  await channel.send(`**Duration:** Starting now until <t:${deadline}:F>.`);
  await channel.send(`Please post your evidence in **one message** in <#${taskSubmissionChannelID}>.`);

  // Log to test channel
  const testChannel = client.channels.cache.get(TEST_CHANNEL_ID);
  if (testChannel) {
    await testChannel.send(`✅ **[Auto-Run]** Weekly task posted at ${new Date().toLocaleString()}\nTask: ${task}`);
  }
}

// Daily Wordle
async function sendDailyWordle() {
  const channel = client.channels.cache.get(DAILY_CHANNEL_ID);
  if (!channel) {
    console.log('[Daily Wordle] Channel not found');
    return;
  }

  const wordleUrl = await getDailyWordleAndMove();
  if (!wordleUrl) {
    console.log('No Wordle URL found.');
    return;
  }

  await channel.send(`**Daily Wordle:**\n${wordleUrl}`);
  await channel.send(`Share your result in <#${wordleSubmissionChannelID}>.`);

  // Log to test channel
  const testChannel = client.channels.cache.get(TEST_CHANNEL_ID);
  if (testChannel) {
    await testChannel.send(`✅ **[Auto-Run]** Daily Wordle posted at ${new Date().toLocaleString()}\nURL: ${wordleUrl}`);
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
    const axios = require('axios');
    const db = require('./db/supabase');
    const { RANK_ROLES, determineRank, isRankUpgrade } = require('./commands/utility/sync');
    const { EmbedBuilder } = require('discord.js');

    const clanId = config.clanId;

    // Fetch clan data from WOM API
    const womApiUrl = `https://api.wiseoldman.net/v2/groups/${clanId}`;
    const womResponse = await axios.get(womApiUrl);
    const clanData = womResponse.data;

    if (!clanData || !clanData.memberships) {
      console.log('[Daily Rank Update] Failed to retrieve clan data or no members found.');
      return;
    }

    const clanMembers = clanData.memberships;
    const allRankRoleIds = Object.values(RANK_ROLES).filter(id => id !== null);
    const existingPlayers = await db.getAllPlayers();

    const discordIdToRsnMap = {};
    existingPlayers.forEach(player => {
      if (player.discord_id && player.rsn) {
        discordIdToRsnMap[player.discord_id] = player.rsn;
      }
    });

    // Fetch all members of server
    await guild.members.fetch();
    const allMembers = guild.members.cache;

    // Map of rank names to their respective emojis
    const rankEmojiMap = {
      'Sweat': '<:Sweat:1339598866818793505>',
      'Master General': '<:MasterGeneral:1339598851304063077>',
      'Touch Grass': '<:TouchGrass:1339598837110669354>',
      'Wrath': '<:WR:1239257793199083580>',
      'Top Dawgs': '<:TZ:1309544425298329681>',
      'Mind Goblin': '<:GO:1213799278150164490>',
      'Holy': '<:SA:1309547678694248488>',
      'Skull': '<:S_:1239658968654282863>',
      'SLAAAAAY': '<:SL:1309544667561459712>',
      'Guthixian': '<:GU:1213799334773129236>',
      'Black Hearts': '<:de:1341120690325028865>',
      'Discord Kitten': '<:HE:1213787848088494100>',
      'Brewaholic': '<:AP:1213784678419406858>',
    };

    let mismatchOutput = [];
    let userMentions = [];

    for (const discordId in discordIdToRsnMap) {
      const member = allMembers.get(discordId);
      if (member) {
        const rsn = discordIdToRsnMap[discordId];
        const clanMember = clanMembers.find(m => m.player.username === rsn);
        const ehb = clanMember ? Math.round(clanMember.player.ehb || 0) : 0;

        const calculatedRank = determineRank(ehb, member.joinedTimestamp);
        const calculatedRankId = RANK_ROLES[calculatedRank];
        const memberRoles = member.roles.cache;

        const currentRankRole = memberRoles.find(role => allRankRoleIds.includes(role.id));
        const currentRank = currentRankRole
          ? Object.keys(RANK_ROLES).find(key => RANK_ROLES[key] === currentRankRole.id)
          : 'None';
        const currentRankEmoji = rankEmojiMap[currentRank] || '';

        const hasCorrectRank = memberRoles.some(role => role.id === calculatedRankId);

        // Only upgrade ranks, never downgrade
        if (!hasCorrectRank && (!currentRank || currentRank === 'None' || isRankUpgrade(currentRank, calculatedRank))) {
          if (currentRankRole) {
            await member.roles.remove(currentRankRole, 'Removing old rank role');
          }

          if (calculatedRankId) {
            await member.roles.add(calculatedRankId, 'Adding correct EHB role');
            const calculatedRankEmoji = rankEmojiMap[calculatedRank] || '';

            userMentions.push(`<@${member.id}>`);

            if (currentRank == "None") {
              mismatchOutput.push(
                `RSN: **${rsn}** - EHB: **${ehb}** - Old Rank: **${currentRank}** - Updated to: ${calculatedRankEmoji} **${calculatedRank}**`
              );
            } else {
              mismatchOutput.push(
                `RSN: **${rsn}** - EHB: **${ehb}** - Old Rank: ${currentRankEmoji} **${currentRank}** - Upgraded to: ${calculatedRankEmoji} **${calculatedRank}**`
              );
            }
          }
        } else if (!hasCorrectRank) {
          console.log(`[Daily Rank Update] ⏭️ Skipped downgrade for ${rsn}: keeping ${currentRank} (earned rank: ${calculatedRank}, ${ehb} EHB)`);
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

    console.log(`[Daily Rank Update] Completed. ${mismatchOutput.length} rank(s) updated.`);

  } catch (error) {
    console.error('[Daily Rank Update] Error during automated rank update:', error);
    const testChannel = client.channels.cache.get(TEST_CHANNEL_ID);
    if (testChannel) {
      await testChannel.send(`❌ **[Auto-Run]** Daily rank update failed at ${new Date().toLocaleString()}\nError: ${error.message}`);
    }
  }
}

// ----------------------------------------------------------------------------
// Cache messages from weekly task submission channel

async function cacheOldMessages() {
  const challengeChannel = client.channels.cache.get(taskSubmissionChannelID);
  if (!challengeChannel) return;

  try {
    console.log('Fetching recent messages in the weekly submission channel...');
    const messages = await challengeChannel.messages.fetch({ limit: 50 });
    console.log(`Cached ${messages.size} recent messages.`);
  } catch (error) {
    console.error('Failed to cache messages:', error);
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
