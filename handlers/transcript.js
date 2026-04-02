const { EmbedBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const config = require('../config.json');

async function handleButton (interaction) {
  const isAdmin = config.ADMIN_ROLE_IDS.some(roleId =>
    interaction.member.roles.cache.has(roleId)
  );

  if (!isAdmin) {
    return interaction.reply({
      content: '❌ Only admins can create transcripts.',
      ephemeral: true
    });
  }

  const modal = new ModalBuilder()
    .setCustomId('transcript_modal')
    .setTitle('Ticket Transcript');

  const descriptionInput = new TextInputBuilder()
    .setCustomId('transcript_description')
    .setLabel('Brief Description')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Provide a brief summary of this ticket...')
    .setRequired(true)
    .setMaxLength(500);

  const row = new ActionRowBuilder().addComponents(descriptionInput);
  modal.addComponents(row);

  await interaction.showModal(modal);
}

async function handleModal (interaction) {
  const isAdmin = config.ADMIN_ROLE_IDS.some(roleId =>
    interaction.member.roles.cache.has(roleId)
  );

  if (!isAdmin) {
    return interaction.reply({
      content: '❌ Only admins can create transcripts.',
      ephemeral: true
    });
  }

  const description = interaction.fields.getTextInputValue('transcript_description');
  const channel = interaction.channel;

  // Determine which archive channel to use based on ticket category
  const ticketCategories = {
    [config.TICKET_JOIN_CATEGORY_ID]: config.TICKET_JOIN_ARCHIVE_ID,
    [config.TICKET_GENERAL_CATEGORY_ID]: config.TICKET_GENERAL_ARCHIVE_ID,
    [config.TICKET_SHOP_CATEGORY_ID]: config.TICKET_SHOP_ARCHIVE_ID
  };

  const archiveChannelId = ticketCategories[channel.parentId];

  if (!archiveChannelId) {
    return interaction.reply({
      content: '❌ Could not determine archive channel for this ticket.',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    // Fetch all messages from the ticket channel
    const messages = [];
    let lastId;

    while (true) {
      const options = { limit: 100 };
      if (lastId) options.before = lastId;

      const fetchedMessages = await channel.messages.fetch(options);
      if (fetchedMessages.size === 0) break;

      messages.push(...fetchedMessages.values());
      lastId = fetchedMessages.last().id;

      if (fetchedMessages.size < 100) break;
    }

    // Sort messages chronologically (oldest first)
    messages.reverse();

    // Count messages per user and attachments
    const userMessageCount = {};
    let totalAttachments = 0;
    let skippedAttachments = 0;

    messages.forEach(msg => {
      const userKey = `${msg.author.tag} (${msg.author.id})`;
      userMessageCount[userKey] = (userMessageCount[userKey] || 0) + 1;

      if (msg.attachments.size > 0) {
        msg.attachments.forEach(att => {
          totalAttachments++;
          // Consider attachments over 8MB as skipped (Discord's limit)
          if (att.size > 8388608) {
            skippedAttachments++;
          }
        });
      }
    });

    // Sort users by message count
    const sortedUsers = Object.entries(userMessageCount)
      .sort((a, b) => b[1] - a[1])
      .map(([user, count]) => `    ${count} - ${user}`)
      .join('\n');

    // Build server info section
    const serverInfo =
      `<Server-Info>\n` +
      `    Server: ${interaction.guild.name} (${interaction.guild.id})\n` +
      `    Channel: ${channel.name} (${channel.id})\n` +
      `    Messages: ${messages.length}\n` +
      `    Attachments Saved: ${totalAttachments - skippedAttachments}\n` +
      (skippedAttachments > 0 ? `    Attachments Skipped: ${skippedAttachments} (due to maximum file size limits.)\n` : '') +
      `\n` +
      `<User-Info>\n` +
      `${sortedUsers}\n` +
      `\n` +
      `<Admin-Summary>\n` +
      `    ${description}\n`;

    // Format readable transcript
    const transcriptLines = messages.map(msg => {
      const timestamp = msg.createdAt.toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });

      const username = msg.author.tag;
      let content = msg.content || '';

      // Add embed info if present
      if (msg.embeds.length > 0) {
        msg.embeds.forEach(embed => {
          if (embed.title || embed.description) {
            content += `\n[Embed: ${embed.title || ''} ${embed.description || ''}]`;
          }
        });
      }

      // Add attachment info if present
      if (msg.attachments.size > 0) {
        msg.attachments.forEach(att => {
          content += `\n[Attachment: ${att.name} (${att.url})]`;
        });
      }

      return `[${timestamp}] ${username}: ${content || '[No content]'}`;
    });

    const fullTranscript = serverInfo + '\n\n' + transcriptLines.join('\n');

    // Get archive channel
    const archiveChannel = await interaction.guild.channels.fetch(archiveChannelId);

    if (!archiveChannel) {
      return await interaction.editReply({
        content: '❌ Archive channel not found.'
      });
    }

    // Create transcript embed
    const transcriptEmbed = new EmbedBuilder()
      .setColor('Blue')
      .setTitle(`📋 Ticket Transcript: ${channel.name}`)
      .setDescription(
        `**Closed by:** ${interaction.user}\n` +
        `**Summary:** ${description}\n` +
        `**Closed at:** <t:${Math.floor(Date.now() / 1000)}:F>\n` +
        `**Total Messages:** ${messages.length}\n` +
        `**Participants:** ${Object.keys(userMessageCount).length}`
      )
      .setTimestamp();

    // Create buffer for file attachment
    const buffer = Buffer.from(fullTranscript, 'utf-8');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `transcript-${channel.name}-${timestamp}.txt`;

    // Send embed with file attachment
    await archiveChannel.send({
      embeds: [transcriptEmbed],
      files: [{
        attachment: buffer,
        name: filename
      }]
    });

    console.log(`[Transcript] Created transcript for ${channel.name} in ${archiveChannel.name}`);

    await interaction.editReply({
      content: `✅ Transcript created in ${archiveChannel}. Deleting channel...`
    });

    // Delete the ticket channel after 3 seconds
    setTimeout(async () => {
      try {
        await channel.delete();
        console.log(`[Transcript] Deleted ticket channel: ${channel.name}`);
      } catch (error) {
        console.error('[Transcript] Error deleting channel:', error);
      }
    }, 3000);

  } catch (error) {
    console.error('[Transcript] Error creating transcript:', error);
    await interaction.editReply({
      content: '❌ Failed to create transcript. Please try again.'
    });
  }
}

module.exports = { handleButton, handleModal };
