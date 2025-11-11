const { Events, EmbedBuilder } = require('discord.js');
const config = require('../config.json');

module.exports = {
    name: Events.MessageCreate,

    async execute(message) {
        // Ignore bot messages
        if (message.author.bot) return;

        // Check if message is in the intro thread
        if (message.channel.id !== config.INTRO_THREAD_ID) return;

        console.log(`[IntroThread] New introduction posted by ${message.author.tag}`);

        try {
            // Wait a moment to let the message be visible
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Create "How to join" embed with proper emojis
            const b1Emoji = `<:B1:${config.B1_EMOJI_ID}>`;
            const checkEmoji = `<:CHECK:${config.CHECK_EMOJI_ID}>`;

            const howToJoinEmbed = new EmbedBuilder()
                .setColor('Blue')
                .setTitle('How to join.')
                .setDescription(
                    `**YOU MUST VERIFY YOUR DISCORD BEFORE YOU CAN JOIN/SEE THIS DISCORD.**\n\n` +
                    `${b1Emoji} You can verify your discord here - <#${config.WISE_OLD_MAN_CHANNEL_ID}>\n` +
                    `${b1Emoji} After verifying head over to <#1240268854169440347> & open up a ticket.\n\n` +
                    `**After reqs have been checked:**\n\n` +
                    `${b1Emoji} Jump in the clan chat in game.\n` +
                    `${b1Emoji} Someone will help you in & rank you ${checkEmoji}`
                )
                .setImage('https://media.discordapp.net/attachments/1085149045456126064/1197653854859313284/Join_Volition_3.png?ex=6913aa92&is=69125912&hm=72f1a38dbc6f80e27af7667560ddb2e865056f0e585cc40c377b2945bf49176d&format=webp&quality=lossless&width=1242&height=936')
                .setTimestamp();

            // Send the embed
            await message.reply({
                embeds: [howToJoinEmbed]
            });

            // Ping admins
            const adminMentions = config.ADMIN_ROLE_IDS.map(roleId => `<@&${roleId}>`).join(' ');
            await message.channel.send({
                content: `${adminMentions} - New member introduction posted!`,
                allowedMentions: { roles: config.ADMIN_ROLE_IDS }
            });

            console.log(`[IntroThread] Sent "How to join" embed and pinged admins`);

        } catch (error) {
            console.error('[IntroThread] Error sending how to join embed:', error);
        }
    },
};
