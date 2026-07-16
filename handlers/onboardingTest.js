/**
 * Site onboarding — admin TEST helper.
 *
 * The site owns a new-member onboarding flow (volition-site: /welcome/[token]).
 * These helpers mint a one-per-run token row into the shared vs_onboarding_tokens
 * table and DM the recipient a unique link. Two variants:
 *   - 'b' — full site-owned join (verify + profile + intro + setup + rewards)
 *   - 'a' — lighter post-join tour (same flow, starting steps trimmed)
 *
 * TEST ONLY: invoked by the /onboard-test-a|b admin commands. Nothing here touches
 * the live Discord join-ticket path.
 */

const crypto = require('crypto');
const { supabase } = require('../db/supabase');

const SITE_URL = process.env.SITE_URL || 'https://volition-osrs.com';

// 24 random bytes as hex — matches the site's onboarding + dink token format.
function mintTokenString () {
    return crypto.randomBytes(24).toString('hex');
}

async function mintOnboardingToken (discordId, variant, createdBy) {
    const token = mintTokenString();
    const { error } = await supabase.from('vs_onboarding_tokens').insert({
        token,
        discord_id: discordId,
        variant,
        created_by: createdBy,
    });
    if (error) throw new Error(`mint onboarding token: ${error.message}`);
    return token;
}

/**
 * Mint a link for the target user (default: the caller) and DM it, replying
 * ephemerally with the outcome. Assumes the caller already passed the admin gate.
 */
async function sendOnboardingTest (interaction, variant) {
    const target = interaction.options.getUser('user') || interaction.user;
    let token;
    try {
        token = await mintOnboardingToken(target.id, variant, interaction.user.id);
    } catch (err) {
        return interaction.reply({ ephemeral: true, content: `❌ Could not mint the link: ${err.message}` });
    }

    const link = `${SITE_URL}/welcome/${token}`;
    let dmOk = true;
    try {
        await target.send(
            `👋 **Volition onboarding — test (variant ${variant.toUpperCase()})**\n` +
            `Open this link and sign in with Discord to walk the flow:\n${link}\n` +
            `_This link is just for your account and expires in 14 days._`
        );
    } catch {
        dmOk = false;
    }

    await interaction.reply({
        ephemeral: true,
        content: dmOk
            ? `✅ Onboarding **${variant.toUpperCase()}** link sent to ${target}.\nLink: ${link}`
            : `⚠️ Couldn't DM ${target} (their DMs may be closed). Send them this link:\n${link}`,
    });
}

module.exports = { mintOnboardingToken, sendOnboardingTest, SITE_URL };
