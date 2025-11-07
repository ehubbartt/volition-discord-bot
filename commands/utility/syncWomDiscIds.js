const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const axios = require('axios');
const db = require('../../db/supabase');
const { isAdmin } = require('../../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('syncwomids')
    .setDescription('(Admin Only) Sync WOM IDs for all clan members'),

  async execute(interaction) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: false });

    try {
      const clanId = config.clanId;

      const existingPlayers = await db.getAllPlayers();
      console.log("Fetched existing data:", existingPlayers);

      const existingRSNs = new Set(existingPlayers.map(p => p.rsn?.toLowerCase()));
      const existingWOMIds = new Map(existingPlayers.map(p => [p.wom_id?.toString(), p]));

      const womApiUrl = `https://api.wiseoldman.net/v2/groups/${clanId}`;
      const womResponse = await axios.get(womApiUrl);
      const clanData = womResponse.data;

      if (!clanData || !clanData.memberships) {
        return interaction.editReply('Failed to retrieve clan data or no members found.');
      }

      const clanMembers = clanData.memberships;
      const discordMembers = await interaction.guild.members.fetch();
      const humanMembers = discordMembers.filter(member => !member.user.bot);

      let output = '';
      const playersToCreate = [];
      const nameChanges = [];
      const leavers = [];
      const nicknameFixAttempts = [];
      let successfulPairingsCount = 0;
      let failedPairingsCount = 0;
      let skippedPairingCount = 0;

      for (let i = 0; i < clanMembers.length; i++) {
        const member = clanMembers[i];
        const memberName = member.player.username.toLowerCase();
        const memberId = member.player.id.toString();

        if (existingWOMIds.has(memberId)) {
          const existingPlayer = existingWOMIds.get(memberId);
          const existingRSN = existingPlayer.rsn?.toLowerCase();
          if (existingRSN !== memberName) {
            nameChanges.push({
              oldName: existingRSN,
              newName: member.player.username,
              womId: memberId,
            });
          }

          // Nickname auto-fix disabled
          // if (existingPlayer.discord_id) {
          //   const discordMember = humanMembers.find(dm => dm.id === existingPlayer.discord_id);
          //   if (discordMember && discordMember.displayName !== member.player.username) {
          //     nicknameFixAttempts.push({
          //       discordId: existingPlayer.discord_id,
          //       currentNickname: discordMember.displayName,
          //       correctRSN: member.player.username,
          //       member: discordMember
          //     });
          //   }
          // }

          skippedPairingCount++;
          continue;
        }

        if (existingRSNs.has(memberName)) {
          skippedPairingCount++;
          continue;
        }

        const discordMatch = humanMembers.find(discordMember => discordMember.displayName.toLowerCase() === memberName);

        const discordId = discordMatch ? discordMatch.id : null;
        const matchStatus = discordMatch ? `✅ Pairing Successful (Discord ID: ${discordId})` : '❌ Failed';

        if (discordMatch) {
          successfulPairingsCount++;
        } else {
          failedPairingsCount++;
        }

        playersToCreate.push({
          rsn: member.player.username,
          wom_id: memberId,
          discord_id: discordId || null
        });

        output += `**${member.player.username}** - WOM ID: ${memberId}, ${matchStatus}\n`;

        if (output.length > 1800) {
          await interaction.followUp({ content: output, ephemeral: false });
          output = '';
        }
      }

      const currentWOMIds = new Set(clanMembers.map(member => member.player.id.toString()));
      for (const player of existingPlayers) {
        const womId = player.wom_id?.toString();
        if (womId && !currentWOMIds.has(womId)) {
          leavers.push({
            rsn: player.rsn,
            womId: womId,
          });
        }
      }

      if (output.length > 0) {
        await interaction.followUp({ content: output, ephemeral: false });
      }

      for (const change of nameChanges) {
        try {
          await db.updatePlayerRsnByWomId(change.womId, change.newName);
          console.log(`Successfully updated RSN for WOM ID ${change.womId}: ${change.oldName} -> ${change.newName}`);
        } catch (error) {
          console.error(`Error updating RSN for WOM ID ${change.womId}:`, error.message);
        }
      }

      // Nickname auto-fix disabled
      // if (nicknameFixAttempts.length > 0) {
      //   let fixOutput = '\n**🔧 Auto-fixing mismatched nicknames:**\n';
      //   let fixedCount = 0;
      //   let failedCount = 0;

      //   for (const fix of nicknameFixAttempts) {
      //     try {
      //       await fix.member.setNickname(fix.correctRSN);
      //       fixOutput += `✅ Updated <@${fix.discordId}> nickname: ${fix.currentNickname} → ${fix.correctRSN}\n`;
      //       fixedCount++;
      //       console.log(`Auto-fixed nickname for ${fix.discordId}: ${fix.currentNickname} -> ${fix.correctRSN}`);
      //     } catch (error) {
      //       fixOutput += `❌ Failed to update <@${fix.discordId}> nickname: ${error.message}\n`;
      //       failedCount++;
      //       console.error(`Failed to auto-fix nickname for ${fix.discordId}:`, error.message);
      //     }
      //   }

      //   fixOutput += `\nFixed: ${fixedCount} | Failed: ${failedCount}\n`;
      //   await interaction.followUp({ content: fixOutput, ephemeral: false });
      // }

      if (leavers.length > 0) {
        try {
          for (const leaver of leavers) {
            await db.deletePlayerByWomId(leaver.womId);
            console.log(`Removed leaver: RSN: ${leaver.rsn} - WOM ID: ${leaver.womId}`);
          }
        } catch (deleteError) {
          console.error('Error removing leavers:', deleteError.message);
          await interaction.followUp('Failed to remove leavers. Check the console for debug logs.');
        }
      }

      if (playersToCreate.length > 0) {
        try {
          for (const playerData of playersToCreate) {
            await db.createPlayer(playerData, 0);
          }

          console.log(`Successfully created ${playersToCreate.length} new players`);
        } catch (createError) {
          console.error('Error creating players:', createError.message);
          await interaction.followUp('Failed to create new players. Check the console for debug logs.');
        }
      } else {
        await interaction.followUp('No **NEW** members to capture. All current clan members are already captured.');
      }

      if (leavers.length > 0) {
        let leaversOutput = '**Detected and Updated Leavers:**\n';
        for (const leaver of leavers) {
          leaversOutput += `**RSN:** ${leaver.rsn} - WOM ID: ${leaver.womId}\n`;
        }
        await interaction.followUp({ content: leaversOutput, ephemeral: false });
      }

      if (nameChanges.length > 0) {
        let nameChangeOutput = '**Detected and Updated Name Changes:**\n';
        for (const change of nameChanges) {
          nameChangeOutput += `**Old RSN:** ${change.oldName}, **New RSN:** ${change.newName} - WOM ID: ${change.womId}\n`;
        }
        await interaction.followUp({ content: nameChangeOutput, ephemeral: false });
      }

      const summaryEmbed = new EmbedBuilder()
      .setTitle('WOM & Discord Sync Summary')
      .setColor('White')
      .addFields(
        { name: 'Clan Member Count', value: `${clanMembers.length}`, inline: true },
        { name: 'Successful Pairings', value: `${successfulPairingsCount}`, inline: true },
        { name: 'Failed Pairings', value: `${failedPairingsCount}`, inline: true },
        { name: 'Skipped Members', value: `${skippedPairingCount}`, inline: true },
        { name: 'Name Changes', value: `${nameChanges.length}`, inline: true },
        { name: 'Leavers', value: `${leavers.length}`, inline: true }
      );

    await interaction.followUp({ embeds: [summaryEmbed] });

    } catch (error) {
      console.error('Error fetching clan data:', error);
      return interaction.editReply('There was an error while fetching the clan data.');
    }
  },
};
