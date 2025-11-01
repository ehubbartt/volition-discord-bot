// ================================================================================
// Clean up asap

const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const axios = require('axios');
const config = require('../../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('updateranks')
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

      // Fetch clan data from WOM API
      const womApiUrl = `https://api.wiseoldman.net/v2/groups/${clanId}`;
      const womResponse = await axios.get(womApiUrl);
      const clanData = womResponse.data;

      if (!clanData || !clanData.memberships) {
        return interaction.editReply('Failed to retrieve clan data or no members found.');
      }

      const clanMembers = clanData.memberships;

      // Define rank thresholds & role IDs
      const ranks = [
        { rank: 'Sweat', minEHB: 3000, roleId: '1339599170394259517', timeRequirement: null },
        { rank: 'Master General', minEHB: 2500, roleId: '1339599293413068860', timeRequirement: null },
        { rank: 'Touch Grass', minEHB: 2000, roleId: '1339599017813741652', timeRequirement: null },
        { rank: 'Wrath', minEHB: 1500, roleId: '1238443298625159220', timeRequirement: null },
        { rank: 'Top Dawgs', minEHB: 1250, roleId: '1309545563498352772', timeRequirement: null },
        { rank: 'Mind Goblin', minEHB: 1000, roleId: '1087162684602056775', timeRequirement: null },
        { rank: 'Holy', minEHB: 900, roleId: '1309547277966377050', timeRequirement: null },
        { rank: 'Skull', minEHB: 800, roleId: '1087485648832843796', timeRequirement: null },
        { rank: 'SLAAAAAY', minEHB: 650, roleId: '1309545367880208405', timeRequirement: null },
        { rank: 'Guthixian', minEHB: 500, roleId: '1087167843998650399', timeRequirement: 2 * 365 * 24 * 60 * 60 * 1000 }, // 500 EHB **or** 2 years+
        { rank: 'Black Hearts', minEHB: 350, roleId: '1309548746844930058', timeRequirement: 1 * 365 * 24 * 60 * 60 * 1000 }, // 350 EHB **or** 1-2 years
        { rank: 'Discord Kitten', minEHB: 200, roleId: '1087482275307978894', timeRequirement: 6 * 30 * 24 * 60 * 60 * 1000 }, // 200 EHB **or** 6 months - 1 year
        { rank: 'Brewaholic', minEHB: 100, roleId: '1213921453762809886', timeRequirement: 0 },
      ];

      // const ranks = [
      //   { rank: 'Wrath', minEHB: 1500, roleId: '1308188139940089856', timeRequirement: null },
      //   { rank: 'Top Dawgs', minEHB: 1250, roleId: '1315911656471138344', timeRequirement: null },
      //   { rank: 'Mind Goblin', minEHB: 1000, roleId: '1315911597230915586', timeRequirement: null },
      //   { rank: 'Holy', minEHB: 900, roleId: '1308188079445639258', timeRequirement: null },
      //   { rank: 'Skull', minEHB: 800, roleId: '1315911590561841243', timeRequirement: null },
      //   { rank: 'SLAAAAAY', minEHB: 650, roleId: '1315911285803843594', timeRequirement: null },
      //   { rank: 'Guthixian', minEHB: 500, roleId: '1315911507799965777', timeRequirement: 2 * 365 * 24 * 60 * 60 * 1000 },
      //   { rank: 'Golden Shower', minEHB: 350, roleId: '1308188211796906128', timeRequirement: 1 * 365 * 24 * 60 * 60 * 1000 },
      //   { rank: 'Discord Kitten', minEHB: 200, roleId: '1308188230679793755', timeRequirement: 6 * 30 * 24 * 60 * 60 * 1000 },
      //   { rank: 'Brewaholic', minEHB: 100, roleId: '1315911335518670879', timeRequirement: 0 },
      // ];

      // Fetch Discord IDs and RSNs from Google Sheets using SheetDB
      const SHEETDB_API_URL = config.SYNC_SHEETDB_API_URL; 
      const sheetResponse = await axios.get(SHEETDB_API_URL);
      const existingData = sheetResponse.data;

      // Extract Discord IDs, RSNs, filtering out 0 for Discord IDs
      const discordIdToRsnMap = {};
      existingData.forEach(row => {
        const discordId = row["Discord ID"];
        const rsn = row["RSN"];
        if (discordId && discordId !== '0' && discordId !== '1' && rsn ) {
          discordIdToRsnMap[discordId] = rsn;
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
          const joinDuration = Date.now() - member.joinedTimestamp;
          
          const clanMember = clanMembers.find(m => m.player.username === rsn);
          const ehb = clanMember ? Math.round(clanMember.player.ehb || 0) : 0; 

          // Determine the rank (based on ranks[])
          const eligibleRank = ranks.find(r => 
            ehb >= r.minEHB || (r.timeRequirement !== null && joinDuration >= r.timeRequirement)
          );
          const calculatedRank = eligibleRank ? eligibleRank.rank : null;
          const calculatedRankId = eligibleRank ? eligibleRank.roleId : null;

          const memberRoles = member.roles.cache;
          const currentRank = ranks.find(r => memberRoles.has(r.roleId))?.rank || 'None';
          const currentRankEmoji = rankEmojiMap[currentRank] || '';

          const hasCorrectRank = memberRoles.some(role => role.id === calculatedRankId);

          if (!hasCorrectRank) {
            const rolesToRemove = memberRoles.filter(role => ranks.some(r => r.roleId === role.id));
            if (rolesToRemove.size > 0) {
              await member.roles.remove(rolesToRemove, 'Removing outdated EHB roles');
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
