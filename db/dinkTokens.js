const crypto = require('node:crypto');
const { supabase } = require('./supabase');

async function getOrCreateToken(discordId) {
    const { data: existing, error: selectError } = await supabase
        .from('dink_tokens')
        .select('token')
        .eq('discord_id', discordId)
        .is('revoked_at', null)
        .maybeSingle();

    if (selectError) throw selectError;
    if (existing) return { token: existing.token, created: false };

    const token = crypto.randomBytes(24).toString('hex');
    const { error: insertError } = await supabase
        .from('dink_tokens')
        .insert({ token, discord_id: discordId });

    if (insertError) throw insertError;
    return { token, created: true };
}

async function revokeTokensFor(discordId) {
    const { error } = await supabase
        .from('dink_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('discord_id', discordId)
        .is('revoked_at', null);

    if (error) throw error;
}

async function getAllActiveTokens() {
    const { data, error } = await supabase
        .from('dink_tokens')
        .select('token')
        .is('revoked_at', null);

    if (error) throw error;
    return (data || []).map(row => row.token);
}

module.exports = {
    getOrCreateToken,
    revokeTokensFor,
    getAllActiveTokens,
};
