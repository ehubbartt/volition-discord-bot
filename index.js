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

const weeklyTaskRoleID = config.weeklyTaskRoleID; // used for push notifications
const taskSubmissionChannelID = config.WEEKLY_CHALLENGE_SUBMISSION_CHANNEL_ID;
const wordleSubmissionChannelID = config.DAILY_CHALLENGE_SUBMISSION_CHANNEL_ID;
const WEEKLY_CHANNEL_ID = config.WEEKLY_TASK_ANNOUNCEMENT_CHANNEL_ID;
const DAILY_CHANNEL_ID = config.DAILY_WORDLE_ANNOUNCEMENT_CHANNEL_ID;
const TEST_CHANNEL_ID = config.TEST_CHANNEL_ID;

let lastTaskSentDate = null;
let lastWordleSentDate = null;

client.once(Events.ClientReady, async () => {
  console.log(`${client.user.tag} is online.`);
  client.user.setActivity({ name: 'Old School RuneScape' });

  await cacheOldMessages();

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
