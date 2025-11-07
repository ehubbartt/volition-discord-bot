// ================================================================================
// Clean up asap

const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const axios = require('axios');
const db = require('../../db/supabase');
const config = require('../../config.json');
const { RANK_ROLES, determineRank } = require('./sync');
const { isAdmin } = require('../../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('updateranks')
    .setDescription('(Admin Only)'),

  async execute(interaction) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }
    
    await interaction.deferReply({ ephemeral: false });

    try {
      const clanId = config.clanId;

      // Fetch clan data from WOM API
      const womApiUrl = `https://api.wiseoldman.net/v2/groups/${clanId}`;
      const womResponse = await axios.get(womApiUrl);
      const clanData = womResponse.data;

      if (!clanData || !clanData.memberships) {
        return interaction.editReply('Failed to retrieve clan data or no members found.');
      }

      const clanMembers = clanData.memberships;

      // Use centralized RANK_ROLES from sync.js
      // Get all rank role IDs for checking
      const allRankRoleIds = Object.values(RANK_ROLES).filter(id => id !== null);

      const existingPlayers = await db.getAllPlayers();

      const discordIdToRsnMap = {};
      existingPlayers.forEach(player => {
        if (player.discord_id && player.rsn) {
          discordIdToRsnMap[player.discord_id] = player.rsn;
        }
      });

      // Fetch all members of server
      const guild = interaction.guild;
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

      // Check for matches between Discord IDs in the server and EHB -> update rank(s)
      let mismatchOutput = [];
      // Store user mentions for later use
      let userMentions = [];

      for (const discordId in discordIdToRsnMap) {
        const member = allMembers.get(discordId);
        if (member) {
          const rsn = discordIdToRsnMap[discordId];

          const clanMember = clanMembers.find(m => m.player.username === rsn);
          const ehb = clanMember ? Math.round(clanMember.player.ehb || 0) : 0;

          // Determine the rank using centralized function
          const calculatedRank = determineRank(ehb, member.joinedTimestamp, interaction.guild);
          const calculatedRankId = RANK_ROLES[calculatedRank];

          const memberRoles = member.roles.cache;

          // Get current rank role (if any)
          const currentRankRole = memberRoles.find(role => allRankRoleIds.includes(role.id));
          const currentRank = currentRankRole
            ? Object.keys(RANK_ROLES).find(key => RANK_ROLES[key] === currentRankRole.id)
            : 'None';
          const currentRankEmoji = rankEmojiMap[currentRank] || '';

          const hasCorrectRank = memberRoles.some(role => role.id === calculatedRankId);

          if (!hasCorrectRank) {
            // Only remove the current rank role, not all roles
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
          }
        }
      }

      // Send regular mentions FIRST (push notification bug-fix)
      if (userMentions.length > 0) {
        const mentionMessage = userMentions.join('');
        await interaction.followUp({ content: mentionMessage });
      }

      // Helper function for splitting long outputs (1024 char limit)
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

      // Send each chunk in embed messages
      const chunkedMessages = chunkArray(mismatchOutput, 1000);

      for (let i = 0; i < chunkedMessages.length; i++) {
        const embed = new EmbedBuilder()
          .setColor('White')
          .setTitle(i === 0 ? `Rank Update Summary` : `Rank Update Summary (Part ${i + 1} of ${chunkedMessages.length})`)
          .addFields({ name: 'Changes Made:', value: chunkedMessages[i] });

        await interaction.followUp({ embeds: [embed] });
      }

      if (mismatchOutput.length === 0) {
        const embed = new EmbedBuilder()
          .setColor('White')
          .setTitle('No ranks were updated.')

        await interaction.followUp({ embeds: [embed] });
      }


    } catch (error) {
      console.error('Error fetching clan data, Google Sheets data, or Discord members:', error);
      return interaction.editReply('There was an error while fetching the clan data, Discord members, or Discord IDs. ');
    }
  },
};
