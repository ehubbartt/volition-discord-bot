const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const config = require('../config.json');

/**
 * Update ticket channel name to mark as verified (shared helper for both guest and regular verify)
 */
async function updateTicketNameIfNeeded (interaction) {
  const ticketCategories = [
    config.TICKET_JOIN_CATEGORY_ID,
    config.TICKET_GENERAL_CATEGORY_ID,
    config.TICKET_SHOP_CATEGORY_ID
  ];

  if (ticketCategories.includes(interaction.channel.parentId)) {
    const ticketManager = require('../utils/ticketManager');
    ticketManager.markVerified(interaction.channel.id);

    const newName = interaction.channel.name.replace(config.UNVERIFIED_EMOJI, config.VERIFIED_EMOJI);
    try {
      await interaction.channel.setName(newName);
    } catch (error) {
      console.error('[ForceVerify] Failed to update channel name:', error);
    }
  }
}

async function handleButton (interaction) {
  const isAdmin = config.ADMIN_ROLE_IDS.some(roleId =>
    interaction.member.roles.cache.has(roleId)
  );

  if (!isAdmin) {
    return interaction.reply({
      content: '❌ Only admins can force verify users.',
      ephemeral: true
    });
  }

  try {
    if (interaction.customId.startsWith('force_verify_guest_')) {
      // Force verify guest
      const userId = interaction.customId.replace('force_verify_guest_', '');
      const member = await interaction.guild.members.fetch(userId);

      await interaction.deferReply({ ephemeral: false });

      // Remove unverified role and add verified role
      if (config.unverifiedRoleID && member.roles.cache.has(config.unverifiedRoleID)) {
        await member.roles.remove(config.unverifiedRoleID);
      }
      if (config.verifiedRoleID) {
        await member.roles.add(config.verifiedRoleID);
      }

      // Update ticket name if in a ticket channel
      await updateTicketNameIfNeeded(interaction);

      // Send success message (NO intro button for guests)
      const successEmbed = new EmbedBuilder()
        .setColor('Green')
        .setTitle('✅ Guest Force Verified')
        .setDescription(
          `${member} has been manually verified as a **guest** by ${interaction.user}.\n\n` +
          `**Roles Updated:**\n` +
          `• Removed: Unverified\n` +
          `• Added: Verified\n\n` +
          `Welcome to Volition! 🎉\n\n` +
          `**Note:** As a guest, no introduction is required.`
        )
        .setTimestamp();

      await interaction.editReply({
        embeds: [successEmbed]
      });

      // Disable the button
      await interaction.message.edit({ components: [] });

      console.log(`[ForceVerify] ${interaction.user.tag} force verified guest ${member.user.tag} (no intro required)`);

    } else {
      // Force verify regular user (format: force_verify_userId_rsn)
      const parts = interaction.customId.split('_');
      const userId = parts[2];
      const rsn = parts.slice(3).join('_');
      const member = await interaction.guild.members.fetch(userId);

      await interaction.deferReply({ ephemeral: false });

      // Remove unverified role and add verified role
      if (config.unverifiedRoleID && member.roles.cache.has(config.unverifiedRoleID)) {
        await member.roles.remove(config.unverifiedRoleID);
      }
      if (config.verifiedRoleID) {
        await member.roles.add(config.verifiedRoleID);
      }

      // Set nickname to RSN
      let nicknameChanged = false;
      try {
        await member.setNickname(rsn);
        nicknameChanged = true;
        console.log(`[ForceVerify] Updated nickname for ${member.user.tag} to ${rsn}`);
      } catch (error) {
        console.log(`[ForceVerify] Could not set nickname for ${member.user.tag}: ${error.message}`);
      }

      // WOM lookup + DB save (same as normal verify flow)
      let dbSaved = false;
      try {
        const { womApi } = require('../utils/api');
        const db = require('../db/supabase');
        const response = await womApi.get(
          `/players/${encodeURIComponent(rsn)}`
        );
        const playerData = response.data;

        const existingPlayer = await db.getPlayerByWomId(playerData.id);
        if (existingPlayer) {
          await db.updatePlayer(existingPlayer.id, {
            discord_id: userId,
            rsn: playerData.username,
            wom_id: playerData.id
          });
        } else {
          await db.createPlayer({
            discord_id: userId,
            rsn: playerData.username,
            wom_id: playerData.id,
            clan_joined_at: null
          }, 0);
        }
        dbSaved = true;
        console.log(`[ForceVerify] Saved ${member.user.tag} to database (WOM ID: ${playerData.id})`);
      } catch (error) {
        console.error('[ForceVerify] WOM/DB save error:', error.message);
      }

      // Update ticket name if in a ticket channel
      await updateTicketNameIfNeeded(interaction);

      // Send success message
      const successEmbed = new EmbedBuilder()
        .setColor('Green')
        .setTitle('✅ User Force Verified')
        .setDescription(
          `${member} has been manually verified by ${interaction.user}.\n\n` +
          `**RSN:** ${rsn}\n` +
          `**Roles Updated:**\n` +
          `• Removed: Unverified\n` +
          `• Added: Verified\n` +
          `**Nickname:** ${nicknameChanged ? `✅ Updated to ${rsn}` : '⚠️ Could not update'}\n` +
          `**Database:** ${dbSaved ? '✅ Saved' : '⚠️ Could not save'}`
        )
        .setTimestamp();

      await interaction.editReply({
        embeds: [successEmbed]
      });

      // Disable the button and send intro flow
      await interaction.message.edit({ components: [] });

      // Continue with intro flow
      const vpEmoji = `<:VP:${config.VP_EMOJI_ID}>`;
      const welcomeMessage =
        `## You've been verified! ${vpEmoji}\n\n` +
        `We ask you kindly that __your discord name on this server matches your in game name__.\n\n` +
        `* Make sure you can see all channels by clicking ''Volition'' in the top left corner and then ticking the ''Show All Channels'' box!\n` +
        `* Use the button below to send an introductory message in ${`<#${config.INTRO_THREAD_ID}>`}.\n\n` +
        `Once this is done we will help you join the clan in game.`;

      const introButton = new ButtonBuilder()
        .setCustomId('intro_start')
        .setLabel('Fill Out Introduction')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📝');

      const row = new ActionRowBuilder().addComponents(introButton);

      await interaction.channel.send({
        content: `${member} ${welcomeMessage}`,
        components: [row]
      });

      console.log(`[ForceVerify] ${interaction.user.tag} force verified ${member.user.tag} (RSN: ${rsn})`);
    }

  } catch (error) {
    console.error('[ForceVerify] Error during force verify:', error);
    if (interaction.deferred) {
      await interaction.editReply({ content: `❌ Error: ${error.message}` });
    } else {
      await interaction.reply({ content: `❌ Error: ${error.message}`, ephemeral: true });
    }
  }
}

module.exports = { handleButton };
