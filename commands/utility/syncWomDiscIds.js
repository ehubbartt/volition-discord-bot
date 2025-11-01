const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const axios = require('axios');
const config = require('../../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sync')
    .setDescription('(Admin Only)'),

  async execute(interaction) {
    const member = interaction.member;
    const allowedRoleId = config.ADMIN_ROLE_IDS[0];
    const hasRole = member.roles.cache.has(allowedRoleId);
    if (!hasRole) {
      return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }    

    await interaction.deferReply({ ephemeral: false });

    try {
      const clanId = config.clanId;

      // Fetch existing data from SheetDB (main)
      const SHEETDB_API_URL = config.SYNC_SHEETDB_API_URL;
      const sheetResponse = await axios.get(SHEETDB_API_URL);
      const existingData = sheetResponse.data;

      // Fetch existing data from SheetDB (points)
      const PUBLIC_SHEET_API_URL = config.POINTS_SHEETDB_API_URL;
      const publicSheetResponse = await axios.get(PUBLIC_SHEET_API_URL);
      const publicSheetData = publicSheetResponse.data;

      console.log("Fetched existing data:", existingData);

      // Build existing WOM IDs and RSN
      const existingRSNs = new Set(existingData.map(row => row[config.COLUMN_RSN]?.toLowerCase()));
      const existingWOMIds = new Map(existingData.map(row => [row[config.COLUMN_WOM_ID]?.toString(), row]));

      // Fetch clan data from WOM API
      const womApiUrl = `https://api.wiseoldman.net/v2/groups/${clanId}`;
      const womResponse = await axios.get(womApiUrl);
      const clanData = womResponse.data;

      if (!clanData || !clanData.memberships) {
        return interaction.editReply('Failed to retrieve clan data or no members found.');
      }

      const clanMembers = clanData.memberships;
      const discordMembers = await interaction.guild.members.fetch();
      const humanMembers = discordMembers.filter(member => !member.user.bot);

      const COLUMN_RSN = config.COLUMN_RSN;
      const COLUMN_WOM_ID = config.COLUMN_WOM_ID;
      const COLUMN_DISCORD_ID = config.COLUMN_DISCORD_ID;

      let output = '';
      const rowsToUpdate = [];
      const nameChanges = [];
      const leavers = [];
      let successfulPairingsCount = 0;
      let failedPairingsCount = 0;
      let skippedPairingCount = 0;
      const newMembersToAddToPublicSheet = [];

      // Check current clan members
      for (let i = 0; i < clanMembers.length; i++) {
        const member = clanMembers[i];
        const memberName = member.player.username.toLowerCase();
        const memberId = member.player.id.toString();

        // Check for duplicate WOM ID to determine namechanges
        if (existingWOMIds.has(memberId)) {
          const existingRow = existingWOMIds.get(memberId);
          const existingRSN = existingRow[COLUMN_RSN]?.toLowerCase();
          if (existingRSN !== memberName) {
            nameChanges.push({
              oldName: existingRSN,
              newName: member.player.username,
              womId: memberId,
            });
          }
          skippedPairingCount++;
          continue;
        }
        // Check for existing RSN in the spreadsheet
        if (existingRSNs.has(memberName)) {
          skippedPairingCount++;
          continue;
        }

        // --------------------------------------------
        // Sync new members
        const publicSheetRSNs = new Set(publicSheetData.map(row => row.RSN?.toLowerCase()));

        if (!publicSheetRSNs.has(memberName)) {
          newMembersToAddToPublicSheet.push({
            RSN: member.player.username,
            Points: 0
          });
        }
        // --------------------------------------------

        // Find matching Discord user
        const discordMatch = humanMembers.find(discordMember => discordMember.displayName.toLowerCase() === memberName);

        const discordId = discordMatch ? discordMatch.id : null;
        const matchStatus = discordMatch ? `✅ Pairing Successful (Discord ID: ${discordId})` : '❌ Failed';

        if (discordMatch) {
          successfulPairingsCount++;
        } else {
          failedPairingsCount++;
        }

        rowsToUpdate.push({
          [COLUMN_RSN]: memberName,
          [COLUMN_WOM_ID]: memberId,
          [COLUMN_DISCORD_ID]: discordId || '1'
        });

        output += `**${member.player.username}** - WOM ID: ${memberId}, ${matchStatus}\n`;

        if (output.length > 1800) {
          await interaction.followUp({ content: output, ephemeral: false });
          output = '';
        }
      }

      // Check for clan leavers
      const currentWOMIds = new Set(clanMembers.map(member => member.player.id.toString()));
      for (const row of existingData) {
        const womId = row[COLUMN_WOM_ID]?.toString();
        if (!currentWOMIds.has(womId)) {
          leavers.push({
            rsn: row[COLUMN_RSN],
            womId: womId,
          });
        }
      }

      if (output.length > 0) {
        await interaction.followUp({ content: output, ephemeral: false });
      }

      // Update spreadsheet for name changes specifically - ONLY update that supports both sheets currently! /!\
      for (const change of nameChanges) {
        try {
          // Main sheet (ranks)
          await axios.put(`${SHEETDB_API_URL}/${COLUMN_RSN}/${change.oldName}`, {
            data: { [COLUMN_RSN]: change.newName, [COLUMN_WOM_ID]: change.memberId, [COLUMN_DISCORD_ID]: change.discordId }
          });
          console.log(`Successfully updated RSN for WOM ID ${change.womId}: ${change.oldName} -> ${change.newName}`);

          // Second sheet (points)
          const publicRow = publicSheetData.find(row => row.RSN?.toLowerCase() === change.oldName.toLowerCase());
          if (publicRow) {
            await axios.put(`${PUBLIC_SHEET_API_URL}/RSN/${change.oldName}`, {
              data: { RSN: change.newName }
            });
          }
        } catch (error) {
          console.error(`Error updating RSN for WOM ID ${change.womId}:`, error.message);
        }
      }

      // Add new members (cont. L76)
      if (newMembersToAddToPublicSheet.length > 0) {
        await axios.post(PUBLIC_SHEET_API_URL, { data: newMembersToAddToPublicSheet });
      }

      // Remove leavers from both spreadsheets
      if (leavers.length > 0) {
        try {
          for (const leaver of leavers) {
            // Main spreadsheet
            await axios.delete(`${SHEETDB_API_URL}/${COLUMN_WOM_ID}/${leaver.womId}`);
            console.log(`Removed leaver internal ID sheet: RSN: ${leaver.rsn} - WOM ID: ${leaver.womId}`);

            // Second spreadsheet (points sheet)
            const matchingRow = publicSheetData.find(row => row.RSN?.toLowerCase() === leaver.rsn.toLowerCase());
            if (matchingRow) {
              try {
                await axios.delete(`${PUBLIC_SHEET_API_URL}/RSN/${leaver.rsn}`);
                console.log(`Removed leaver from public points sheet: RSN: ${leaver.rsn}`);
              } catch (publicDeleteError) {
                console.error(`Error removing RSN ${leaver.rsn} from the second spreadsheet:`, publicDeleteError.response?.data || publicDeleteError.message);
              }
            }
          }
        } catch (deleteError) {
          console.error('Error removing leavers from the spreadsheets:', deleteError.response?.data || deleteError.message);
          await interaction.followUp('Failed to remove leavers from one or both spreadsheets. Check the console for debug logs.');
        }
      }

      // Batch push new members/other sync data to SheetDB
      if (rowsToUpdate.length > 0) {
        try {
          const sheetDbResponse = await axios.post(SHEETDB_API_URL, { data: rowsToUpdate });
          console.log(`SheetDB update success: ${sheetDbResponse.status} ${sheetDbResponse.statusText}`);
        } catch (sheetError) {
          console.error('Error updating SheetDB:', sheetError.response?.data || sheetError.message);
          await interaction.followUp('Failed to update the spreadsheet. Check the console for debug logs.');
        }
      } else {
        await interaction.followUp('No **NEW** members to capture. All current clan members are already captured.');
      }

      // Log leavers
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