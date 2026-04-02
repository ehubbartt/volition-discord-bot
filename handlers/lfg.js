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
const config = require('../config.json');
const bosses = require('../config/bosses.json');
const lfgDb = require('../db/lfg');

const MAX_ACTIVE_PARTIES = 3;

// Experience level display mapping
const EXPERIENCE_LABELS = {
  any: { emoji: '🟢', label: 'Any experience' },
  learner: { emoji: '📚', label: 'Learner — Looking for teacher' },
  teaching: { emoji: '🎓', label: 'Teaching — Happy to guide' },
  experienced: { emoji: '⚡', label: 'Experienced only' }
};

/**
 * Parse experience level input, normalizing to a known key
 */
function parseExperienceLevel(input) {
  if (!input) return 'any';
  const lower = input.trim().toLowerCase();
  if (lower.includes('learn')) return 'learner';
  if (lower.includes('teach') || lower.includes('guide')) return 'teaching';
  if (lower.includes('exp') || lower.includes('only')) return 'experienced';
  return 'any';
}

/**
 * Format experience level for display
 */
function formatExperience(level) {
  const exp = EXPERIENCE_LABELS[level] || EXPERIENCE_LABELS.any;
  return `${exp.emoji} ${exp.label}`;
}

/**
 * Build the persistent "Party Finder" embed with Create Party button
 */
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

/**
 * Post the persistent embed in a channel
 */
async function postPersistentEmbed(channel) {
  const { embed, row } = buildPersistentEmbed();
  return channel.send({ embeds: [embed], components: [row] });
}

/**
 * Build the boss select menu (ephemeral)
 */
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
        description: `${category} — Default size: ${boss.defaultSize}`,
        value: boss.key
      });
    }
  }

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('lfg_boss_select')
    .setPlaceholder('Choose a boss or raid...')
    .addOptions(options.slice(0, 25)); // Discord limit

  return new ActionRowBuilder().addComponents(selectMenu);
}

/**
 * Build the party details modal
 */
function buildPartyModal(bossKey) {
  const boss = bosses[bossKey];

  const modal = new ModalBuilder()
    .setCustomId(`lfg_modal_${bossKey}`)
    .setTitle(`${boss.name} — Party Details`);

  const sizeInput = new TextInputBuilder()
    .setCustomId('lfg_party_size')
    .setLabel('Party Size (how many total including you)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(`e.g. ${boss.defaultSize}`)
    .setRequired(true)
    .setMaxLength(3);

  const timeInput = new TextInputBuilder()
    .setCustomId('lfg_time')
    .setLabel('Time (optional)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g. 8pm EST, now, in 30 min')
    .setRequired(false)
    .setMaxLength(50);

  const experienceInput = new TextInputBuilder()
    .setCustomId('lfg_experience')
    .setLabel('Experience Level')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('any / learner / teaching / experienced')
    .setRequired(false)
    .setMaxLength(30);

  const notesInput = new TextInputBuilder()
    .setCustomId('lfg_notes')
    .setLabel('Notes (optional)')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('e.g. Bring BGS for spec, must have 80+ combat')
    .setRequired(false)
    .setMaxLength(200);

  modal.addComponents(
    new ActionRowBuilder().addComponents(sizeInput),
    new ActionRowBuilder().addComponents(timeInput),
    new ActionRowBuilder().addComponents(experienceInput),
    new ActionRowBuilder().addComponents(notesInput)
  );

  return modal;
}

/**
 * Build the party listing embed
 */
function buildPartyEmbed(party, members) {
  const boss = bosses[party.boss_key];
  const joinedMembers = members.filter(m => m.status === 'joined');
  const waitlistedMembers = members.filter(m => m.status === 'waitlisted');
  const isFull = joinedMembers.length >= party.group_size;

  let color;
  if (party.status === 'expired' || party.status === 'cancelled') {
    color = 0x95a5a6; // grey
  } else if (isFull) {
    color = 0x2ecc71; // green
  } else {
    color = 0x3498db; // blue
  }

  let title = boss ? boss.name : party.boss_key;
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
  const timeDisplay = party.scheduled_time || 'Not specified';
  embed.addFields({ name: 'Time', value: timeDisplay, inline: true });

  // Experience
  embed.addFields({ name: 'Experience', value: formatExperience(party.experience_level), inline: true });

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
    const expiryUnix = Math.floor(new Date(party.expires_at).getTime() / 1000);
    embed.setFooter({ text: `Expires` });
    embed.setTimestamp(new Date(party.expires_at));
  }

  return embed;
}

/**
 * Build the action buttons for a party listing
 */
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

/**
 * Handle the "Create Party" button click
 */
async function handleCreateButton(interaction) {
  try {
    // Check active party limit
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
 * Handle boss selection from the select menu
 */
async function handleBossSelect(interaction) {
  try {
    const bossKey = interaction.values[0];
    if (!bosses[bossKey]) {
      return interaction.reply({ content: 'Invalid boss selection.', ephemeral: true });
    }

    const modal = buildPartyModal(bossKey);
    await interaction.showModal(modal);
  } catch (error) {
    console.error('[LFG] Error handling boss select:', error);
    await interaction.reply({ content: 'Something went wrong. Please try again.', ephemeral: true }).catch(() => {});
  }
}

/**
 * Handle modal submission — create the party
 */
async function handleModalSubmit(interaction) {
  try {
    // Extract boss key from modal customId: lfg_modal_{bossKey}
    const bossKey = interaction.customId.replace('lfg_modal_', '');
    const boss = bosses[bossKey];
    if (!boss) {
      return interaction.reply({ content: 'Invalid boss selection.', ephemeral: true });
    }

    // Parse fields
    const sizeRaw = interaction.fields.getTextInputValue('lfg_party_size');
    const time = interaction.fields.getTextInputValue('lfg_time') || null;
    const experienceRaw = interaction.fields.getTextInputValue('lfg_experience') || 'any';
    const notes = interaction.fields.getTextInputValue('lfg_notes') || null;

    // Validate party size
    const groupSize = parseInt(sizeRaw, 10);
    if (isNaN(groupSize) || groupSize < 2 || groupSize > (boss.maxSize || 100)) {
      return interaction.reply({
        content: `Party size must be a number between 2 and ${boss.maxSize || 100}.`,
        ephemeral: true
      });
    }

    // Re-check active party limit (race condition guard)
    const activeParties = await lfgDb.getActivePartiesByUser(interaction.user.id);
    if (activeParties.length >= MAX_ACTIVE_PARTIES) {
      return interaction.reply({
        content: `You already have ${MAX_ACTIVE_PARTIES} active parties.`,
        ephemeral: true
      });
    }

    await interaction.deferReply();

    const experienceLevel = parseExperienceLevel(experienceRaw);

    // Calculate expiry time
    // If time provided: expires 2 hours after that time (but since we can't parse arbitrary time strings reliably, we use 8 hours from now as a safe default, and if the user wrote "now" we use 2 hours)
    let expiresAt;
    const timeStr = time ? time.trim().toLowerCase() : '';
    if (timeStr === 'now' || timeStr === 'asap') {
      // Event is now, expire in 2 hours
      expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    } else if (time) {
      // Time was specified but we can't reliably parse it — default 8 hours
      expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    } else {
      // No time specified — default 8 hours
      expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    }

    // Build initial embed and buttons (with creator as first member)
    const partyData = {
      creator_id: interaction.user.id,
      boss_key: bossKey,
      group_size: groupSize,
      experience_level: experienceLevel,
      scheduled_time: time,
      notes,
      message_id: 'pending', // placeholder until message is sent
      channel_id: interaction.channelId,
      expires_at: expiresAt.toISOString(),
      status: 'active'
    };

    // Send the party embed first to get the message ID
    const tempEmbed = buildPartyEmbed(partyData, [{ user_id: interaction.user.id, status: 'joined' }]);
    const tempButtons = buildPartyButtons(partyData, [{ user_id: interaction.user.id, status: 'joined' }]);

    const message = await interaction.editReply({
      embeds: [tempEmbed],
      components: [tempButtons]
    });

    // Now create the party in DB with the real message ID
    const party = await lfgDb.createParty({
      creatorId: interaction.user.id,
      bossKey,
      groupSize,
      experienceLevel,
      scheduledTime: time,
      notes,
      messageId: message.id,
      channelId: interaction.channelId,
      expiresAt: expiresAt.toISOString()
    });

    // Add creator as first member
    await lfgDb.addMember(party.id, interaction.user.id, 'joined');

    // Re-build embed and buttons with correct message ID for button routing
    const members = await lfgDb.getMembers(party.id);
    const updatedParty = { ...party, message_id: message.id };
    const embed = buildPartyEmbed(updatedParty, members);
    const buttons = buildPartyButtons(updatedParty, members);

    await interaction.editReply({ embeds: [embed], components: [buttons] });

    console.log(`[LFG] Party created by ${interaction.user.tag} for ${boss.name} (${groupSize} players)`);
  } catch (error) {
    console.error('[LFG] Error handling modal submit:', error);
    const msg = { content: 'Something went wrong creating your party. Please try again.', ephemeral: true };
    if (interaction.deferred) {
      await interaction.editReply(msg).catch(() => {});
    } else {
      await interaction.reply(msg).catch(() => {});
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

    // Check if already a member
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

    // Add as joined or waitlisted
    await lfgDb.addMember(party.id, interaction.user.id, isFull ? 'waitlisted' : 'joined');

    // Update party status if now full
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

    // Creator can't leave — they must cancel
    if (interaction.user.id === party.creator_id) {
      return interaction.reply({
        content: "As the party leader, use **Cancel Party** instead of Leave.",
        ephemeral: true
      });
    }

    // Check if actually in the party
    const existingMember = await lfgDb.getMember(party.id, interaction.user.id);
    if (!existingMember) {
      return interaction.reply({ content: "You're not in this party.", ephemeral: true });
    }

    await interaction.deferUpdate();

    const wasJoined = existingMember.status === 'joined';
    await lfgDb.removeMember(party.id, interaction.user.id);

    // If they were joined (not waitlisted), promote first waitlisted
    if (wasJoined) {
      await lfgDb.promoteFirstWaitlisted(party.id);
    }

    // Update party status if it was full and now has space
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

    // Only creator can cancel
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
  handleModalSubmit,
  handleJoin,
  handleLeave,
  handleCancel,
  buildPartyEmbed,
  buildPartyButtons
};
