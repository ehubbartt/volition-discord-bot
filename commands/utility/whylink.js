const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const { isAdmin } = require('../../utils/permissions');

// Admin-only explainer: posts a standalone embed telling members why the site uses
// "Sign in with Discord", exactly what it can/can't see, that the code is open source, and
// how to avoid phishing. The permissions screenshot is attached automatically when the asset
// exists at assets/whylink-permissions.png (post is text-only until that file is added).

const IMAGE_FILE = 'whylink-permissions.png';
const IMAGE_PATH = path.join(__dirname, '..', '..', 'assets', IMAGE_FILE);

const EXPLAINER = [
  'Logging in with Discord lets the site match you to your spot on the clan roster, so your rank, points, event signups, and member-only pages are tied to your account. No new username or password to make.',
  '',
  '**It\'s the same as "Sign in with Google"**',
  'This is the exact pattern behind "Sign in with Google," "Sign in with Apple," or logging into a site with Facebook — a standard called OAuth. The site never sees your Discord email or password; Discord just confirms you\'re you and passes along the basic profile info you approve. We use Discord instead of Google because that\'s what the clan already runs on.',
  '',
  '**What the login can see**',
  'When you Authorize, Discord only shares your **username, avatar, and banner** — the same things anyone in the server already sees. Linking gives us nothing we couldn\'t already get from you just being in the server: no email, no friends list, no clue what other servers you\'re in, and definitely not your DMs, messages, or login details. Discord says on the login screen itself: *"This application cannot read your messages or send messages as you."*',
  '',
  'The only permission we request is called `identify` — Discord\'s [developer docs](https://discord.com/developers/docs/topics/oauth2) list it as returning your basic profile and nothing more. Any site you sign into with Discord shows up under **User Settings → Authorized Apps**, where you can pull our access in one click.',
  '',
  '**Nothing to hide**',
  'The whole site is open source. The code is public on GitHub and clan members have gone through it themselves, so you don\'t have to take our word for it: https://github.com/ehubbartt/volition-site',
  '',
  '**How to spot a fake and dodge phishing**',
  'Good habits for any Discord login:',
  '• **Check the address bar** — the Authorize screen is always on **discord.com**. Another site, or one asking you to type your Discord password? Close it, it\'s a scam.',
  '• **Check the redirect** — ours only sends you to **https://volition-osrs.com**, shown on the login screen before you click.',
  '• **Only use the link from the real site or a pinned message.** Don\'t click a login link a random clan member sent you; trust only official postings.',
  '• **Bookmark the real site** and use that instead of clicking links from randoms.',
  '',
  'If something looks off, ask an admin before you click.'
].join('\n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('whylink')
    .setDescription('(Admin) Post the explainer on why we use "Sign in with Discord" and how it\'s safe'),

  async execute(interaction) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const embed = new EmbedBuilder()
      .setColor(0x5865f2) // Discord blurple
      .setTitle('🔗 Why we use "Sign in with Discord" — and why it\'s safe')
      .setDescription(EXPLAINER)
      .setFooter({ text: 'volition-osrs.com' });

    const files = [];
    if (fs.existsSync(IMAGE_PATH)) {
      files.push(new AttachmentBuilder(IMAGE_PATH, { name: IMAGE_FILE }));
      embed.setImage(`attachment://${IMAGE_FILE}`);
    }

    try {
      // Post as a clean standalone message (no "used /whylink" attribution) so it can be pinned.
      await interaction.channel.send({
        embeds: [embed],
        files,
        allowedMentions: { parse: [] } // never ping, whatever the text contains
      });
      const note = files.length ? '' : '\n\n_(Note: `assets/whylink-permissions.png` isn\'t in the repo yet, so the message posted without the screenshot.)_';
      await interaction.editReply({ content: `✅ Posted the explainer to this channel.${note}` });
    } catch (err) {
      console.error('[whylink] Failed to post explainer:', err);
      await interaction.editReply({ content: `Could not post here — ${err.message}. Check that I have Send Messages / Embed Links / Attach Files in this channel.` });
    }
  },
};
