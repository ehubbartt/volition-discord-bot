// Card pack grants/revokes.
//
// The bot writes to the website's vs_* tables directly (shared Supabase project,
// RLS off). Packs key off vs_users.id, NOT players.id or Discord ID — so every
// grant has to map the recipient to a site account first. A Discord user who's
// never signed into the site cannot hold packs; surface that with reason
// 'not_registered' so callers can ask them to log in once.

const { supabase } = require('./supabase');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolvePackId(packNameOrId) {
    if (!packNameOrId) return null;
    if (UUID_RE.test(packNameOrId)) {
        const { data } = await supabase
            .from('vs_card_packs').select('id')
            .eq('id', packNameOrId).maybeSingle();
        if (data) return data.id;
    }
    const { data } = await supabase
        .from('vs_card_packs').select('id')
        .ilike('name', packNameOrId)
        .order('created_at', { ascending: true })
        .limit(1).maybeSingle();
    return data ? data.id : null;
}

async function siteUserIdByDiscordId(discordId) {
    const { data } = await supabase
        .from('vs_users').select('id')
        .eq('discord_id', String(discordId))
        .maybeSingle();
    return data ? data.id : null;
}

async function siteUserIdByRsn(rsn) {
    const { data } = await supabase
        .from('vs_users').select('id')
        .ilike('rsn', rsn)
        .limit(1).maybeSingle();
    return data ? data.id : null;
}

async function addPacks(userId, packId, qty) {
    const { data: row } = await supabase
        .from('vs_user_packs').select('id, quantity')
        .eq('user_id', userId).eq('pack_id', packId).maybeSingle();
    if (row) {
        const { error } = await supabase.from('vs_user_packs')
            .update({ quantity: (row.quantity ?? 0) + qty, updated_at: new Date().toISOString() })
            .eq('id', row.id);
        return !error;
    }
    const { error } = await supabase.from('vs_user_packs')
        .insert({ user_id: userId, pack_id: packId, quantity: qty });
    return !error;
}

// Returns { ok, granted } | { ok: false, reason }.
// reason ∈ 'bad_qty' | 'not_registered' | 'no_pack' | 'db_error'
async function grantPackToDiscordId(discordId, packNameOrId, qty = 1) {
    qty = Math.floor(Number(qty) || 0);
    if (qty < 1) return { ok: false, reason: 'bad_qty' };
    const userId = await siteUserIdByDiscordId(discordId);
    if (!userId) return { ok: false, reason: 'not_registered' };
    const packId = await resolvePackId(packNameOrId);
    if (!packId) return { ok: false, reason: 'no_pack' };
    return (await addPacks(userId, packId, qty))
        ? { ok: true, granted: qty }
        : { ok: false, reason: 'db_error' };
}

async function grantPackToRsn(rsn, packNameOrId, qty = 1) {
    qty = Math.floor(Number(qty) || 0);
    if (qty < 1) return { ok: false, reason: 'bad_qty' };
    const userId = await siteUserIdByRsn(rsn);
    if (!userId) return { ok: false, reason: 'not_registered' };
    const packId = await resolvePackId(packNameOrId);
    if (!packId) return { ok: false, reason: 'no_pack' };
    return (await addPacks(userId, packId, qty))
        ? { ok: true, granted: qty }
        : { ok: false, reason: 'db_error' };
}

// Returns { ok: true, granted: <site-member count> } | { ok: false, reason }.
async function grantPackToEveryone(packNameOrId, qty = 1) {
    qty = Math.floor(Number(qty) || 0);
    if (qty < 1) return { ok: false, reason: 'bad_qty' };
    const packId = await resolvePackId(packNameOrId);
    if (!packId) return { ok: false, reason: 'no_pack' };
    const { data: users, error: uErr } = await supabase.from('vs_users').select('id');
    if (uErr) return { ok: false, reason: 'db_error' };
    const ids = (users ?? []).map(u => u.id);
    if (!ids.length) return { ok: true, granted: 0 };
    // upsert SETS quantity, so we read current totals and add qty on top.
    const { data: existing } = await supabase
        .from('vs_user_packs').select('user_id, quantity')
        .eq('pack_id', packId);
    const have = new Map((existing ?? []).map(r => [r.user_id, r.quantity ?? 0]));
    const now = new Date().toISOString();
    const rows = ids.map(id => ({
        user_id: id,
        pack_id: packId,
        quantity: (have.get(id) ?? 0) + qty,
        updated_at: now,
    }));
    const { error } = await supabase
        .from('vs_user_packs')
        .upsert(rows, { onConflict: 'user_id,pack_id' });
    return error ? { ok: false, reason: 'db_error' } : { ok: true, granted: ids.length };
}

// Returns { ok, removed } | { ok: false, reason } where reason includes 'none_owned'.
async function removePackFromDiscordId(discordId, packNameOrId, qty = 1) {
    qty = Math.floor(Number(qty) || 0);
    if (qty < 1) return { ok: false, reason: 'bad_qty' };
    const userId = await siteUserIdByDiscordId(discordId);
    if (!userId) return { ok: false, reason: 'not_registered' };
    const packId = await resolvePackId(packNameOrId);
    if (!packId) return { ok: false, reason: 'no_pack' };
    const { data: row } = await supabase
        .from('vs_user_packs').select('id, quantity')
        .eq('user_id', userId).eq('pack_id', packId).maybeSingle();
    if (!row || (row.quantity ?? 0) < 1) return { ok: false, reason: 'none_owned' };
    const newQty = (row.quantity ?? 0) - qty;
    if (newQty <= 0) {
        const { error } = await supabase.from('vs_user_packs').delete().eq('id', row.id);
        return error ? { ok: false, reason: 'db_error' } : { ok: true, removed: row.quantity };
    }
    const { error } = await supabase.from('vs_user_packs')
        .update({ quantity: newQty, updated_at: new Date().toISOString() })
        .eq('id', row.id);
    return error ? { ok: false, reason: 'db_error' } : { ok: true, removed: qty };
}

module.exports = {
    resolvePackId,
    grantPackToDiscordId,
    grantPackToRsn,
    grantPackToEveryone,
    removePackFromDiscordId,
};
