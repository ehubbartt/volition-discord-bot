const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../db/supabase');
const dinkTokens = require('../../db/dinkTokens');
const dinkProxy = require('../../services/dinkProxy');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dink')
        .setDescription('Get the Volition Dink plugin settings for RuneLite'),

    async execute (interaction) {
        const embed = new EmbedBuilder()
            .setColor(0xFFF400)
            .setTitle('Dink Plugin Settings')
            .setDescription(
                'Set up the Dink plugin to automatically send your drops, pets, and collection log entries to the right Discord channels.\n\n' +
                '**How to set up:**\n' +
                '1. Click the button below to get your personal config URL\n' +
                '2. In RuneLite, open the **Dink** plugin settings\n' +
                '3. Scroll to the bottom and reset your plugin settings\n' +
                '4. Go to **Advanced Settings** and paste it into **Dynamic Config URL**'
            )
            .setFooter({ text: 'Requires the Dink plugin installed in RuneLite' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('dink_dynamic_url')
                .setLabel('Get Config URL')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🔗')
        );

        await interaction.reply({ embeds: [embed], components: [row] });
    },

    async handleDynamicUrl (interaction) {
        await interaction.deferReply({ ephemeral: true });

        const discordId = interaction.user.id;

        const player = await db.getPlayerByDiscordId(discordId);
        if (!player) {
            return interaction.editReply({
                content: 'You need to link your RuneScape account first. Use **/verify** to get set up, then try again.'
            });
        }

        let token, created;
        try {
            ({ token, created } = await dinkTokens.getOrCreateToken(discordId));
        } catch (err) {
            console.error('[dink] getOrCreateToken failed:', err);
            return interaction.editReply({ content: 'Could not look up your Dink token. Try again in a minute.' });
        }

        if (created) {
            try {
                await dinkProxy.syncWorker();
            } catch (err) {
                console.error('[dink] syncWorker failed after mint:', err);
                return interaction.editReply({
                    content: 'Your token was created but the proxy sync failed. Try **/dink** again in a minute.'
                });
            }
        }

        const configUrl = `${process.env.PROXY_BASE_URL}/config/${token}`;
        await interaction.editReply({
            content:
                'Paste this into **Dynamic Config URL** under Dink\'s Advanced Settings:\n' +
                '```\n' + configUrl + '\n```\n' +
                'Don\'t share this link — it\'s tied to your account.'
        });
    },
};
