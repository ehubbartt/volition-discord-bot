const { Events, EmbedBuilder } = require('discord.js');
const config = require('../config.json');

module.exports = {
    name: Events.MessageCreate,

    async execute (message) {
        // Ignore bot messages
        if (message.author.bot) return;

        // Check if message is in the intro thread
        if (message.channel.id !== config.INTRO_THREAD_ID) return;

        console.log(`[IntroThread] New introduction posted by ${message.author.tag}`);

        try {
            // Wait a moment to let the message be visible
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Create "How to join" embed with proper emojis
            // Fetch emojis from the guild to get the correct format
            let b1Emoji = '▪️'; // Fallback
            let checkEmoji = '✅'; // Fallback

            try {
                const guild = message.guild;
                const b1EmojiObj = guild.emojis.cache.get(config.B1_EMOJI_ID);
                const checkEmojiObj = guild.emojis.cache.get(config.CHECK_EMOJI_ID);

                if (b1EmojiObj) b1Emoji = `<:${b1EmojiObj.name}:${b1EmojiObj.id}>`;
                if (checkEmojiObj) checkEmoji = `<:${checkEmojiObj.name}:${checkEmojiObj.id}>`;
            } catch (error) {
                console.error('[IntroThread] Error fetching emojis:', error);
            }

            const howToJoinEmbed = new EmbedBuilder()
                .setColor('Blue')
                .setTitle('How to join.')
                .setDescription(
                    `${b1Emoji} Jump in the clan chat in game.\n` +
                    `${b1Emoji} Someone will help you in & rank you ${checkEmoji}`
                )
                .setImage('https://media.discordapp.net/attachments/1085149045456126064/1197653854859313284/Join_Volition_3.png?ex=6913aa92&is=69125912&hm=72f1a38dbc6f80e27af7667560ddb2e865056f0e585cc40c377b2945bf49176d&format=webp&quality=lossless&width=1242&height=936')
                .setTimestamp();

            // Send the embed
            await message.reply({
                embeds: [howToJoinEmbed]
            });

            console.log(`[IntroThread] Sent "How to join" embed`);

        } catch (error) {
            console.error('[IntroThread] Error sending how to join embed:', error);
        }
    },
};
