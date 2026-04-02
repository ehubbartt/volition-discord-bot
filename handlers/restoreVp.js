const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');

async function handleButton (interaction) {
  const isAdmin = config.ADMIN_ROLE_IDS.some(roleId =>
    interaction.member.roles.cache.has(roleId)
  );

  if (!isAdmin) {
    return interaction.reply({
      content: '❌ Only admins can restore VP.',
      ephemeral: true
    });
  }

  try {
    const clanLeavers = require('../db/clanLeavers');

    // Handle dismiss button
    if (interaction.customId.startsWith('restore_vp_dismiss_')) {
      const leaverId = interaction.customId.replace('restore_vp_dismiss_', '');
      await clanLeavers.markRejoined(parseInt(leaverId));

      const dismissEmbed = new EmbedBuilder()
        .setColor('Grey')
        .setTitle('Dismissed')
        .setDescription('Former member notification dismissed. VP was not restored.')
        .setTimestamp();

      await interaction.update({ embeds: [dismissEmbed], components: [] });
      return;
    }

    // Handle restore button
    const leaverId = interaction.customId.replace('restore_vp_', '');
    const formerMember = await clanLeavers.getFormerMemberById(parseInt(leaverId));

    if (!formerMember) {
      return interaction.reply({ content: '❌ Former member record not found.', ephemeral: true });
    }

    if (formerMember.rejoined) {
      return interaction.reply({ content: '⚠️ VP has already been restored for this member.', ephemeral: true });
    }

    await interaction.deferUpdate();

    // Find the current player by WOM ID (they should exist after re-syncing)
    const db = require('../db/supabase');
    let currentPlayer = await db.getPlayerByWomId(formerMember.wom_id);

    if (!currentPlayer && formerMember.discord_id) {
      currentPlayer = await db.getPlayerByDiscordId(formerMember.discord_id);
    }

    if (!currentPlayer) {
      const errorEmbed = new EmbedBuilder()
        .setColor('Red')
        .setTitle('❌ Cannot Restore VP')
        .setDescription(
          `Could not find a current player record for **${formerMember.rsn}**.\n\n` +
          `They need to be synced to the database first (via \`/sync\` or \`/syncuser\`) before VP can be restored.`
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [errorEmbed], components: [] });
      return;
    }

    // Restore VP and lifetime VP
    await db.updatePlayer(currentPlayer.id, {
      points: (currentPlayer.points || 0) + (formerMember.points || 0),
      lifetime_vp: Math.max(currentPlayer.lifetime_vp || 0, formerMember.lifetime_vp || 0)
    });

    // Mark as rejoined
    await clanLeavers.markRejoined(formerMember.id);

    const successEmbed = new EmbedBuilder()
      .setColor('Green')
      .setTitle('✅ VP Restored!')
      .setDescription(
        `**${currentPlayer.rsn}**'s VP has been restored by ${interaction.user}.\n\n` +
        `**Restored:**\n` +
        `• VP: +${formerMember.points || 0} (now ${(currentPlayer.points || 0) + (formerMember.points || 0)})\n` +
        `• Lifetime VP: ${Math.max(currentPlayer.lifetime_vp || 0, formerMember.lifetime_vp || 0)}\n\n` +
        `Welcome back, ${currentPlayer.rsn}!`
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [successEmbed], components: [] });

    console.log(`[RestoreVP] ${interaction.user.tag} restored VP for ${currentPlayer.rsn} (+${formerMember.points} VP)`);

  } catch (error) {
    console.error('[RestoreVP] Error:', error);
    if (interaction.deferred) {
      await interaction.editReply({ content: `❌ Error: ${error.message}`, components: [] });
    } else {
      await interaction.reply({ content: `❌ Error: ${error.message}`, ephemeral: true });
    }
  }
}

module.exports = { handleButton };
