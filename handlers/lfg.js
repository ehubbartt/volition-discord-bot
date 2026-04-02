const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const chrono = require('chrono-node');
const config = require('../config.json');
const bosses = require('../config/bosses.json');
const lfgDb = require('../db/lfg');

const MAX_ACTIVE_PARTIES = 3;

// Map common timezone abbreviations to IANA zones so DST is handled correctly.
// "EST" is always UTC-5, but users mean "Eastern Time" which is EDT (UTC-4) in summer.
const TIMEZONE_ALIASES = {
  'EST':  'America/New_York',
  'EDT':  'America/New_York',
  'ET':   'America/New_York',
  'EASTERN': 'America/New_York',
  'CST':  'America/Chicago',
  'CDT':  'America/Chicago',
  'CT':   'America/Chicago',
  'CENTRAL': 'America/Chicago',
  'MST':  'America/Denver',
  'MDT':  'America/Denver',
  'MT':   'America/Denver',
  'MOUNTAIN': 'America/Denver',
  'PST':  'America/Los_Angeles',
  'PDT':  'America/Los_Angeles',
  'PT':   'America/Los_Angeles',
  'PACIFIC': 'America/Los_Angeles',
  'AKST': 'America/Anchorage',
  'AKDT': 'America/Anchorage',
  'HST':  'Pacific/Honolulu',
  'GMT':  'Etc/GMT',
  'UTC':  'Etc/UTC',
  'BST':  'Europe/London',
  'CET':  'Europe/Berlin',
  'CEST': 'Europe/Berlin',
  'EET':  'Europe/Helsinki',
  'EEST': 'Europe/Helsinki',
  'AEST': 'Australia/Sydney',
  'AEDT': 'Australia/Sydney',
  'ACST': 'Australia/Adelaide',
  'ACDT': 'Australia/Adelaide',
  'AWST': 'Australia/Perth',
  'NZST': 'Pacific/Auckland',
  'NZDT': 'Pacific/Auckland',
  'IST':  'Asia/Kolkata',
  'JST':  'Asia/Tokyo',
  'KST':  'Asia/Seoul',
  'SGT':  'Asia/Singapore',
  'HKT':  'Asia/Hong_Kong',
  'SWE':  'Europe/Stockholm',
  'SWEDISH': 'Europe/Stockholm'
};

/**
 * Parse a time string with a timezone abbreviation into a Date.
 * Uses IANA timezone lookup to handle DST correctly.
 */
function parseCustomTime(rawTime, rawTz) {
  const tzKey = rawTz.trim().toUpperCase();
  const ianaZone = TIMEZONE_ALIASES[tzKey];

  if (ianaZone) {
    // Get the current UTC offset for this IANA zone (DST-aware)
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: ianaZone,
      timeZoneName: 'shortOffset'
    });
    // Extract offset like "GMT-4" or "GMT+10"
    const parts = formatter.formatToParts(now);
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    // tzPart.value is like "GMT-4" or "GMT+5:30"
    const offsetStr = tzPart ? tzPart.value.replace('GMT', 'GMT') : rawTz;

    // Replace the user's abbreviation with the numeric offset for chrono
    const combined = `${rawTime} ${offsetStr}`;
    return chrono.parseDate(combined, now, { forwardDate: true });
  }

  // If not in our alias map, pass through as-is (chrono may still understand it)
  const combined = `${rawTime} ${rawTz}`;
  return chrono.parseDate(combined, new Date(), { forwardDate: true });
}

// Pending party creation state (userId → { bossKey, experience, time, timeLabel })
// Entries are cleaned up after modal submit or after 10 minutes
const pendingParties = new Map();

// Time options for the select menu (value → { label, description, offsetMs, expiryMs })
const TIME_OPTIONS = [
  { value: 'now',     label: 'Right now',       description: 'Starting immediately',            offsetMs: 0,                expiryMs: 2 * 60 * 60 * 1000 },
  { value: '15min',   label: 'In 15 minutes',   description: 'Starting in about 15 min',        offsetMs: 15 * 60 * 1000,   expiryMs: 2.25 * 60 * 60 * 1000 },
  { value: '30min',   label: 'In 30 minutes',   description: 'Starting in about 30 min',        offsetMs: 30 * 60 * 1000,   expiryMs: 2.5 * 60 * 60 * 1000 },
  { value: '1hr',     label: 'In 1 hour',       description: 'Starting in about 1 hour',        offsetMs: 60 * 60 * 1000,   expiryMs: 3 * 60 * 60 * 1000 },
  { value: '2hr',     label: 'In 2 hours',      description: 'Starting in about 2 hours',       offsetMs: 2 * 60 * 60 * 1000, expiryMs: 4 * 60 * 60 * 1000 },
  { value: '3hr',     label: 'In 3 hours',      description: 'Starting in about 3 hours',       offsetMs: 3 * 60 * 60 * 1000, expiryMs: 5 * 60 * 60 * 1000 },
  { value: '4hr',     label: 'In 4 hours',      description: 'Starting in about 4 hours',       offsetMs: 4 * 60 * 60 * 1000, expiryMs: 6 * 60 * 60 * 1000 },
  { value: 'flexible', label: 'Flexible',       description: "No set time — whenever we're ready", offsetMs: 0,              expiryMs: 8 * 60 * 60 * 1000 },
  { value: 'custom',   label: 'Custom time...',  description: 'Type a specific date/time (e.g. tomorrow 8pm EST)', offsetMs: 0,  expiryMs: 0 }
];

// Experience options for the select menu
const EXPERIENCE_OPTIONS = [
  { value: 'any',         label: 'All welcome',                   description: 'Any experience level can join',                         emoji: '🟢' },
  { value: 'learner',     label: 'I need a teacher',              description: "I'm new to this boss and looking for someone to teach me", emoji: '📚' },
  { value: 'teaching',    label: "I'll teach — learners welcome",  description: "I'm experienced and happy to guide newer players",        emoji: '🎓' },
  { value: 'experienced', label: 'Experienced only',              description: 'Looking for players who already know the boss',          emoji: '⚡' }
];

// Experience level display mapping (for embeds)
const EXPERIENCE_DISPLAY = {
  any:         { emoji: '🟢', label: 'All welcome', detail: 'Any experience level' },
  learner:     { emoji: '📚', label: 'Looking for a teacher', detail: 'New to this boss — need someone to show the ropes' },
  teaching:    { emoji: '🎓', label: 'Teaching run', detail: 'Experienced player offering to teach' },
  experienced: { emoji: '⚡', label: 'Experienced only', detail: 'Know the boss already' }
};

/**
 * Format experience level for party embed
 */
function formatExperience(level) {
  const exp = EXPERIENCE_DISPLAY[level] || EXPERIENCE_DISPLAY.any;
  return `${exp.emoji} **${exp.label}**\n${exp.detail}`;
}

/**
 * Get the time display string for a party
 * For preset options, show the label. For custom times, show a Discord timestamp.
 */
/**
 * Format time for display in embeds.
 * Preset values like "now", "1hr" show their label.
 * ISO date strings (from custom input) show as Discord timestamps.
 */
function formatTimeDisplay(timeValue) {
  if (!timeValue) return 'Flexible';

  // Check if it's an ISO date string (custom time)
  const asDate = new Date(timeValue);
  if (!isNaN(asDate.getTime()) && timeValue.includes('-')) {
    const unix = Math.floor(asDate.getTime() / 1000);
    return `<t:${unix}:F> (<t:${unix}:R>)`;
  }

  const option = TIME_OPTIONS.find(t => t.value === timeValue);
  return option ? option.label : timeValue;
}

/**
 * Calculate expiry timestamp from a time option value
 * For custom times, expire 2 hours after the scheduled time.
 */
function calculateExpiry(timeValue, customTimestamp) {
  if (timeValue === 'custom' && customTimestamp) {
    const scheduledMs = new Date(customTimestamp).getTime();
    return new Date(scheduledMs + 2 * 60 * 60 * 1000);
  }
  const option = TIME_OPTIONS.find(t => t.value === timeValue);
  if (option && option.expiryMs > 0) {
    return new Date(Date.now() + option.expiryMs);
  }
  return new Date(Date.now() + 8 * 60 * 60 * 1000);
}

/**
 * Clean up stale pending party entries (older than 10 min)
 */
function cleanupPending() {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [userId, data] of pendingParties) {
    if (data.createdAt < cutoff) {
      pendingParties.delete(userId);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistent embed (posted once by admin)
// ─────────────────────────────────────────────────────────────────────────────

function buildPersistentEmbed() {
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle('Party Finder')
    .setDescription(
      'Looking for a group to raid or boss with? Create a party and find clanmates to join you!\n\n' +
      'Click the button below to get started.'
    )
    .setThumbnail(config.CLAN_ICON_URL);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('lfg_create')
      .setLabel('Create Party')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('⚔️')
  );

  return { embed, row };
}

async function postPersistentEmbed(channel) {
  const { embed, row } = buildPersistentEmbed();
  return channel.send({ embeds: [embed], components: [row] });
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: Boss select menu
// ─────────────────────────────────────────────────────────────────────────────

function buildBossSelectMenu() {
  const categories = {};
  for (const [key, boss] of Object.entries(bosses)) {
    if (!categories[boss.category]) categories[boss.category] = [];
    categories[boss.category].push({ key, ...boss });
  }

  const options = [];
  for (const [category, bossesInCategory] of Object.entries(categories)) {
    for (const boss of bossesInCategory) {
      options.push({
        label: boss.name,
        description: category,
        value: boss.key
      });
    }
  }

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('lfg_boss_select')
    .setPlaceholder('Choose a boss or raid...')
    .addOptions(options.slice(0, 25));

  return new ActionRowBuilder().addComponents(selectMenu);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: Experience + Time selects with Next button
// ─────────────────────────────────────────────────────────────────────────────

function buildOptionsMessage(bossKey, selectedExp = null, selectedTime = null) {
  const boss = bosses[bossKey];

  const experienceSelect = new StringSelectMenuBuilder()
    .setCustomId('lfg_exp_select')
    .setPlaceholder('What kind of group is this?')
    .addOptions(
      EXPERIENCE_OPTIONS.map(opt => ({
        label: opt.label,
        description: opt.description,
        value: opt.value,
        emoji: opt.emoji,
        default: opt.value === selectedExp
      }))
    );

  const timeSelect = new StringSelectMenuBuilder()
    .setCustomId('lfg_time_select')
    .setPlaceholder('When are you starting?')
    .addOptions(
      TIME_OPTIONS.map(opt => ({
        label: opt.label,
        description: opt.description,
        value: opt.value,
        default: opt.value === selectedTime
      }))
    );

  const nextButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`lfg_next_${bossKey}`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Primary)
  );

  return {
    content: `**${boss.name}** — Set up your party details:`,
    components: [
      new ActionRowBuilder().addComponents(experienceSelect),
      new ActionRowBuilder().addComponents(timeSelect),
      nextButton
    ]
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: Modal (party size + notes only)
// ─────────────────────────────────────────────────────────────────────────────

function buildPartyModal(bossKey, includeCustomTime = false) {
  const boss = bosses[bossKey];

  const modal = new ModalBuilder()
    .setCustomId(`lfg_modal_${bossKey}`)
    .setTitle(`${boss.name} — Final Details`);

  const sizeInput = new TextInputBuilder()
    .setCustomId('lfg_party_size')
    .setLabel('Party Size (total including you)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g. 3, 4, 5')
    .setRequired(true)
    .setMaxLength(3);

  const rows = [new ActionRowBuilder().addComponents(sizeInput)];

  if (includeCustomTime) {
    const timeInput = new TextInputBuilder()
      .setCustomId('lfg_custom_time')
      .setLabel('When is the event?')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. tomorrow 8pm, Saturday 3pm, April 10 7:30pm')
      .setRequired(true)
      .setMaxLength(60);

    const tzInput = new TextInputBuilder()
      .setCustomId('lfg_custom_tz')
      .setLabel('Your timezone')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. EST, CST, PST, GMT, CET, AEST')
      .setRequired(true)
      .setMaxLength(10);

    rows.push(new ActionRowBuilder().addComponents(timeInput));
    rows.push(new ActionRowBuilder().addComponents(tzInput));
  }

  const notesInput = new TextInputBuilder()
    .setCustomId('lfg_notes')
    .setLabel('Notes (optional)')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('e.g. Bring BGS for spec, must have 80+ combat')
    .setRequired(false)
    .setMaxLength(200);

  rows.push(new ActionRowBuilder().addComponents(notesInput));

  modal.addComponents(...rows);

  return modal;
}

// ─────────────────────────────────────────────────────────────────────────────
// Party listing embed + buttons
// ─────────────────────────────────────────────────────────────────────────────

function buildPartyEmbed(party, members) {
  const boss = bosses[party.boss_key];
  const joinedMembers = members.filter(m => m.status === 'joined');
  const waitlistedMembers = members.filter(m => m.status === 'waitlisted');
  const isFull = joinedMembers.length >= party.group_size;

  let color;
  if (party.status === 'expired' || party.status === 'cancelled') {
    color = 0x95a5a6;
  } else if (party.experience_level === 'teaching') {
    color = 0x9b59b6; // purple for teaching runs
  } else if (party.experience_level === 'learner') {
    color = 0xe67e22; // orange for learner runs
  } else if (isFull) {
    color = 0x2ecc71;
  } else {
    color = 0x3498db;
  }

  let title = boss ? boss.name : party.boss_key;
  if (party.experience_level === 'teaching') title = `🎓 ${title} — Teaching Run`;
  else if (party.experience_level === 'learner') title = `📚 ${title} — Looking for Teacher`;

  if (party.status === 'expired') title = `[EXPIRED] ${title}`;
  if (party.status === 'cancelled') title = `[CANCELLED] ${title}`;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title);

  if (boss && boss.image) {
    embed.setThumbnail(boss.image);
  }

  // Party Leader
  embed.addFields({ name: 'Party Leader', value: `<@${party.creator_id}>`, inline: true });

  // Size
  const sizeDisplay = isFull
    ? `${joinedMembers.length}/${party.group_size} ✅ FULL`
    : `${joinedMembers.length}/${party.group_size}`;
  embed.addFields({ name: 'Size', value: sizeDisplay, inline: true });

  // Time
  embed.addFields({ name: 'Time', value: formatTimeDisplay(party.scheduled_time), inline: true });

  // Experience
  embed.addFields({ name: 'Experience', value: formatExperience(party.experience_level) });

  // Notes
  if (party.notes) {
    embed.addFields({ name: 'Notes', value: party.notes });
  }

  // Party members list
  if (joinedMembers.length > 0) {
    const memberList = joinedMembers
      .map((m, i) => `${i + 1}. <@${m.user_id}>`)
      .join('\n');
    embed.addFields({ name: `Party (${joinedMembers.length}/${party.group_size})`, value: memberList });
  }

  // Waitlist
  if (waitlistedMembers.length > 0) {
    const waitlist = waitlistedMembers
      .map((m, i) => `${i + 1}. <@${m.user_id}>`)
      .join('\n');
    embed.addFields({ name: `Waitlist (${waitlistedMembers.length})`, value: waitlist });
  }

  // Expiry footer
  if (party.expires_at) {
    embed.setFooter({ text: 'Expires' });
    embed.setTimestamp(new Date(party.expires_at));
  }

  return embed;
}

function buildPartyButtons(party, members) {
  const joinedMembers = members.filter(m => m.status === 'joined');
  const isFull = joinedMembers.length >= party.group_size;
  const isEnded = party.status === 'expired' || party.status === 'cancelled';

  const row = new ActionRowBuilder();

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`lfg_join_${party.message_id}`)
      .setLabel(isFull ? 'Join Waitlist' : 'Join')
      .setStyle(isFull ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(isEnded)
  );

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`lfg_leave_${party.message_id}`)
      .setLabel('Leave')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isEnded)
  );

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`lfg_cancel_${party.message_id}`)
      .setLabel('Cancel Party')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(isEnded)
  );

  return row;
}

// ─────────────────────────────────────────────────────────────────────────────
// Interaction handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle the "Create Party" button click → show boss select
 */
async function handleCreateButton(interaction) {
  try {
    const activeParties = await lfgDb.getActivePartiesByUser(interaction.user.id);
    if (activeParties.length >= MAX_ACTIVE_PARTIES) {
      return interaction.reply({
        content: `You already have ${MAX_ACTIVE_PARTIES} active parties. Cancel or wait for one to expire before creating another.`,
        ephemeral: true
      });
    }

    const row = buildBossSelectMenu();
    await interaction.reply({
      content: 'Select a boss or raid for your party:',
      components: [row],
      ephemeral: true
    });
  } catch (error) {
    console.error('[LFG] Error handling create button:', error);
    await interaction.reply({ content: 'Something went wrong. Please try again.', ephemeral: true }).catch(() => {});
  }
}

/**
 * Handle boss selection → show experience + time selects
 */
async function handleBossSelect(interaction) {
  try {
    const bossKey = interaction.values[0];
    if (!bosses[bossKey]) {
      return interaction.reply({ content: 'Invalid boss selection.', ephemeral: true });
    }

    cleanupPending();

    // Store boss selection in pending state
    pendingParties.set(interaction.user.id, {
      bossKey,
      experience: null,
      time: null,
      createdAt: Date.now()
    });

    const msg = buildOptionsMessage(bossKey, null, null);
    await interaction.update(msg);
  } catch (error) {
    console.error('[LFG] Error handling boss select:', error);
    await interaction.reply({ content: 'Something went wrong. Please try again.', ephemeral: true }).catch(() => {});
  }
}

/**
 * Handle experience select menu
 */
async function handleExpSelect(interaction) {
  try {
    const pending = pendingParties.get(interaction.user.id);
    if (!pending) {
      return interaction.reply({ content: 'Session expired. Please start over by clicking **Create Party**.', ephemeral: true });
    }

    pending.experience = interaction.values[0];
    const expOption = EXPERIENCE_OPTIONS.find(o => o.value === pending.experience);
    const timeOption = pending.time ? TIME_OPTIONS.find(t => t.value === pending.time) : null;

    // Show current selections and keep the menus
    let status = `**${bosses[pending.bossKey].name}** — Set up your party details:\n\n`;
    status += `> Group type: ${expOption.emoji} **${expOption.label}**\n`;
    status += timeOption ? `> Time: **${timeOption.label}**` : '> Time: *not selected yet*';

    const msg = buildOptionsMessage(pending.bossKey, pending.experience, pending.time);
    msg.content = status;

    await interaction.update(msg);
  } catch (error) {
    console.error('[LFG] Error handling exp select:', error);
    await interaction.reply({ content: 'Something went wrong. Please try again.', ephemeral: true }).catch(() => {});
  }
}

/**
 * Handle time select menu
 */
async function handleTimeSelect(interaction) {
  try {
    const pending = pendingParties.get(interaction.user.id);
    if (!pending) {
      return interaction.reply({ content: 'Session expired. Please start over by clicking **Create Party**.', ephemeral: true });
    }

    const selected = interaction.values[0];

    pending.time = selected;
    pending.customTimestamp = null;
    const timeOption = TIME_OPTIONS.find(t => t.value === pending.time);
    const expOption = pending.experience ? EXPERIENCE_OPTIONS.find(o => o.value === pending.experience) : null;

    let status = `**${bosses[pending.bossKey].name}** — Set up your party details:\n\n`;
    status += expOption ? `> Group type: ${expOption.emoji} **${expOption.label}**\n` : '> Group type: *not selected yet*\n';
    status += `> Time: **${timeOption.label}**`;

    const msg = buildOptionsMessage(pending.bossKey, pending.experience, pending.time);
    msg.content = status;

    await interaction.update(msg);
  } catch (error) {
    console.error('[LFG] Error handling time select:', error);
    await interaction.reply({ content: 'Something went wrong. Please try again.', ephemeral: true }).catch(() => {});
  }
}

/**
 * Handle "Next" button → validate selects and open modal
 */
async function handleNext(interaction) {
  try {
    const bossKey = interaction.customId.replace('lfg_next_', '');
    const pending = pendingParties.get(interaction.user.id);

    if (!pending || pending.bossKey !== bossKey) {
      return interaction.reply({ content: 'Session expired. Please start over by clicking **Create Party**.', ephemeral: true });
    }

    if (!pending.experience) {
      return interaction.reply({ content: 'Please select a **group type** before continuing.', ephemeral: true });
    }

    if (!pending.time) {
      return interaction.reply({ content: 'Please select a **time** before continuing.', ephemeral: true });
    }

    const modal = buildPartyModal(bossKey, pending.time === 'custom');
    await interaction.showModal(modal);
  } catch (error) {
    console.error('[LFG] Error handling next button:', error);
    await interaction.reply({ content: 'Something went wrong. Please try again.', ephemeral: true }).catch(() => {});
  }
}

/**
 * Handle modal submission → create the party
 */
async function handleModalSubmit(interaction) {
  try {
    const bossKey = interaction.customId.replace('lfg_modal_', '');
    const boss = bosses[bossKey];
    if (!boss) {
      return interaction.reply({ content: 'Invalid boss selection.', ephemeral: true });
    }

    const pending = pendingParties.get(interaction.user.id);
    if (!pending || pending.bossKey !== bossKey) {
      return interaction.reply({ content: 'Session expired. Please start over by clicking **Create Party**.', ephemeral: true });
    }

    // Parse modal fields
    const sizeRaw = interaction.fields.getTextInputValue('lfg_party_size');
    const notes = interaction.fields.getTextInputValue('lfg_notes') || null;

    // If custom time was selected, parse the time + timezone from the modal
    if (pending.time === 'custom') {
      const rawTime = interaction.fields.getTextInputValue('lfg_custom_time');
      const rawTz = interaction.fields.getTextInputValue('lfg_custom_tz').trim();

      const parsed = parseCustomTime(rawTime, rawTz);

      if (!parsed) {
        return interaction.reply({
          content: `Couldn't understand "${rawTime}" in timezone **${rawTz}**. Try something like **tomorrow 8pm** with **EST**, or **Saturday 3pm** with **PST**.`,
          ephemeral: true
        });
      }

      if (parsed.getTime() < Date.now() - 5 * 60 * 1000) {
        return interaction.reply({
          content: 'That time is in the past. Please pick a future time.',
          ephemeral: true
        });
      }

      pending.customTimestamp = parsed.toISOString();
    }

    // Validate party size
    const groupSize = parseInt(sizeRaw, 10);
    if (isNaN(groupSize) || groupSize < 2 || groupSize > (boss.maxSize || 100)) {
      return interaction.reply({
        content: `Party size must be a number between 2 and ${boss.maxSize || 100}.`,
        ephemeral: true
      });
    }

    // Re-check active party limit
    const activeParties = await lfgDb.getActivePartiesByUser(interaction.user.id);
    if (activeParties.length >= MAX_ACTIVE_PARTIES) {
      return interaction.reply({
        content: `You already have ${MAX_ACTIVE_PARTIES} active parties.`,
        ephemeral: true
      });
    }

    await interaction.deferReply();

    const experienceLevel = pending.experience;
    const timeValue = pending.time;
    const customTimestamp = pending.customTimestamp || null;
    const expiresAt = calculateExpiry(timeValue, customTimestamp);

    // Clean up pending state
    pendingParties.delete(interaction.user.id);

    // Store the custom timestamp in scheduled_time for display, or the preset value
    const scheduledTime = timeValue === 'custom' ? customTimestamp : timeValue;

    // Build initial embed with creator as first member
    const partyData = {
      creator_id: interaction.user.id,
      boss_key: bossKey,
      group_size: groupSize,
      experience_level: experienceLevel,
      scheduled_time: scheduledTime,
      notes,
      message_id: 'pending',
      channel_id: interaction.channelId,
      expires_at: expiresAt.toISOString(),
      status: 'active'
    };

    const tempEmbed = buildPartyEmbed(partyData, [{ user_id: interaction.user.id, status: 'joined' }]);
    const tempButtons = buildPartyButtons(partyData, [{ user_id: interaction.user.id, status: 'joined' }]);

    const message = await interaction.editReply({
      embeds: [tempEmbed],
      components: [tempButtons]
    });

    // Create party in DB
    const party = await lfgDb.createParty({
      creatorId: interaction.user.id,
      bossKey,
      groupSize,
      experienceLevel,
      scheduledTime: scheduledTime,
      notes,
      messageId: message.id,
      channelId: interaction.channelId,
      expiresAt: expiresAt.toISOString()
    });

    // Add creator as first member
    await lfgDb.addMember(party.id, interaction.user.id, 'joined');

    // Re-build with correct message ID for button routing
    const members = await lfgDb.getMembers(party.id);
    const updatedParty = { ...party, message_id: message.id };
    const embed = buildPartyEmbed(updatedParty, members);
    const buttons = buildPartyButtons(updatedParty, members);

    await interaction.editReply({ embeds: [embed], components: [buttons] });

    console.log(`[LFG] Party created by ${interaction.user.tag} for ${boss.name} (${groupSize} players, ${experienceLevel})`);
  } catch (error) {
    console.error('[LFG] Error handling modal submit:', error);
    const msg = { content: 'Something went wrong creating your party. Please try again.' };
    if (interaction.deferred) {
      await interaction.editReply(msg).catch(() => {});
    } else {
      await interaction.reply({ ...msg, ephemeral: true }).catch(() => {});
    }
  }
}

/**
 * Handle "Join" / "Join Waitlist" button
 */
async function handleJoin(interaction) {
  try {
    const messageId = interaction.customId.replace('lfg_join_', '');
    const party = await lfgDb.getPartyByMessageId(messageId);

    if (!party || party.status === 'expired' || party.status === 'cancelled') {
      return interaction.reply({ content: 'This party is no longer active.', ephemeral: true });
    }

    const existingMember = await lfgDb.getMember(party.id, interaction.user.id);
    if (existingMember) {
      return interaction.reply({
        content: existingMember.status === 'joined'
          ? "You're already in this party."
          : "You're already on the waitlist.",
        ephemeral: true
      });
    }

    await interaction.deferUpdate();

    const members = await lfgDb.getMembers(party.id);
    const joinedCount = members.filter(m => m.status === 'joined').length;
    const isFull = joinedCount >= party.group_size;

    await lfgDb.addMember(party.id, interaction.user.id, isFull ? 'waitlisted' : 'joined');

    const updatedMembers = await lfgDb.getMembers(party.id);
    const newJoinedCount = updatedMembers.filter(m => m.status === 'joined').length;
    let updatedParty = party;

    if (newJoinedCount >= party.group_size && party.status === 'active') {
      updatedParty = await lfgDb.updatePartyStatus(party.id, 'full');
    }

    const embed = buildPartyEmbed(updatedParty, updatedMembers);
    const buttons = buildPartyButtons(updatedParty, updatedMembers);

    await interaction.editReply({ embeds: [embed], components: [buttons] });

    console.log(`[LFG] ${interaction.user.tag} joined party ${party.id} (${isFull ? 'waitlisted' : 'joined'})`);
  } catch (error) {
    console.error('[LFG] Error handling join:', error);
    await interaction.reply({ content: 'Something went wrong. Please try again.', ephemeral: true }).catch(() => {});
  }
}

/**
 * Handle "Leave" button
 */
async function handleLeave(interaction) {
  try {
    const messageId = interaction.customId.replace('lfg_leave_', '');
    const party = await lfgDb.getPartyByMessageId(messageId);

    if (!party || party.status === 'expired' || party.status === 'cancelled') {
      return interaction.reply({ content: 'This party is no longer active.', ephemeral: true });
    }

    if (interaction.user.id === party.creator_id) {
      return interaction.reply({
        content: "As the party leader, use **Cancel Party** instead of Leave.",
        ephemeral: true
      });
    }

    const existingMember = await lfgDb.getMember(party.id, interaction.user.id);
    if (!existingMember) {
      return interaction.reply({ content: "You're not in this party.", ephemeral: true });
    }

    await interaction.deferUpdate();

    const wasJoined = existingMember.status === 'joined';
    await lfgDb.removeMember(party.id, interaction.user.id);

    if (wasJoined) {
      await lfgDb.promoteFirstWaitlisted(party.id);
    }

    const updatedMembers = await lfgDb.getMembers(party.id);
    const joinedCount = updatedMembers.filter(m => m.status === 'joined').length;
    let updatedParty = party;

    if (joinedCount < party.group_size && party.status === 'full') {
      updatedParty = await lfgDb.updatePartyStatus(party.id, 'active');
    }

    const embed = buildPartyEmbed(updatedParty, updatedMembers);
    const buttons = buildPartyButtons(updatedParty, updatedMembers);

    await interaction.editReply({ embeds: [embed], components: [buttons] });

    console.log(`[LFG] ${interaction.user.tag} left party ${party.id}`);
  } catch (error) {
    console.error('[LFG] Error handling leave:', error);
    await interaction.reply({ content: 'Something went wrong. Please try again.', ephemeral: true }).catch(() => {});
  }
}

/**
 * Handle "Cancel Party" button
 */
async function handleCancel(interaction) {
  try {
    const messageId = interaction.customId.replace('lfg_cancel_', '');
    const party = await lfgDb.getPartyByMessageId(messageId);

    if (!party) {
      return interaction.reply({ content: 'Party not found.', ephemeral: true });
    }

    if (party.status === 'expired' || party.status === 'cancelled') {
      return interaction.reply({ content: 'This party is already ended.', ephemeral: true });
    }

    if (interaction.user.id !== party.creator_id) {
      return interaction.reply({ content: 'Only the party leader can cancel.', ephemeral: true });
    }

    await interaction.deferUpdate();

    const updatedParty = await lfgDb.updatePartyStatus(party.id, 'cancelled');
    const members = await lfgDb.getMembers(party.id);

    const embed = buildPartyEmbed(updatedParty, members);
    const buttons = buildPartyButtons(updatedParty, members);

    await interaction.editReply({ embeds: [embed], components: [buttons] });

    console.log(`[LFG] Party ${party.id} cancelled by ${interaction.user.tag}`);
  } catch (error) {
    console.error('[LFG] Error handling cancel:', error);
    await interaction.reply({ content: 'Something went wrong. Please try again.', ephemeral: true }).catch(() => {});
  }
}

module.exports = {
  postPersistentEmbed,
  handleCreateButton,
  handleBossSelect,
  handleExpSelect,
  handleTimeSelect,
  handleNext,
  handleModalSubmit,
  handleJoin,
  handleLeave,
  handleCancel,
  buildPartyEmbed,
  buildPartyButtons
};
