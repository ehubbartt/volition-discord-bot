// vs_tasks / vs_submissions / vs_users mirror against the shared Supabase
// project. Tasks live in their OWN table (vs_tasks), separate from full events
// (vs_events). Site team owns the schema, review, and VP grants. Bot owns:
//   • picking a template + creating a vs_tasks instance per rotation
//   • uploading proof images + writing the vs_submissions row (task_id)
//   • polling for site-approved rows that need a pack grant (packs live on
//     the bot side; the site doesn't know about them)
//
// Required schema (site migration 0029):
//   vs_tasks:       id, name, slug, description, kind, recurrence, is_template,
//                   in_rotation, template_id, vp_reward, requires_proof, status,
//                   starts_at, ends_at
//   vs_submissions: task_id (→ vs_tasks), discord_id, submitter_name,
//                   proof_urls[], proof_paths[], pack_awarded
//   events (bot):   vs_task_id  (link to the vs_tasks instance)

const { supabase } = require('./supabase');

const PROOF_BUCKET = 'vs-bingo-proofs';

// ---------------------------------------------------------------------------
// vs_users lookup

async function lookupSiteUser(discordId) {
    const { data } = await supabase
        .from('vs_users').select('id, rsn')
        .eq('discord_id', String(discordId))
        .maybeSingle();
    return data || null;
}

// ---------------------------------------------------------------------------
// Storage upload

function extFromAttachment(att) {
    const name = (att.name || '').toLowerCase();
    const m = name.match(/\.([a-z0-9]{2,4})$/);
    if (m) return m[1];
    const ct = (att.contentType || '').toLowerCase();
    if (ct.includes('jpeg')) return 'jpg';
    if (ct.includes('png')) return 'png';
    if (ct.includes('webp')) return 'webp';
    if (ct.includes('gif')) return 'gif';
    return 'png';
}

async function uploadAttachment(attachment, { eventId, discordId, targetId, index }) {
    try {
        const res = await fetch(attachment.url);
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());

        const ext = extFromAttachment(attachment);
        const safeTarget = String(targetId).replace(/[^a-z0-9_-]/gi, '_');
        const path = `${eventId}/${discordId}/${safeTarget}-${Date.now()}-${index}.${ext}`;

        const { error: upErr } = await supabase.storage
            .from(PROOF_BUCKET)
            .upload(path, buf, {
                contentType: attachment.contentType || `image/${ext}`,
                upsert: false,
            });
        if (upErr) throw upErr;

        const { data: pub } = supabase.storage.from(PROOF_BUCKET).getPublicUrl(path);
        return { path, publicUrl: pub.publicUrl };
    } catch (err) {
        console.error('[SiteSubmissions] Upload failed:', err.message);
        return null;
    }
}

async function uploadAllProofs(attachments, ctx) {
    const list = Array.from(attachments.values())
        .filter(a => (a.contentType || '').startsWith('image/')
            || /\.(png|jpe?g|webp|gif)$/i.test(a.name || ''));

    const results = await Promise.all(
        list.map((a, i) => uploadAttachment(a, { ...ctx, index: i }))
    );

    const ok = results.filter(Boolean);
    return {
        proof_urls: ok.map(r => r.publicUrl),
        proof_paths: ok.map(r => r.path),
    };
}

// ---------------------------------------------------------------------------
// vs_submissions insert

async function createSubmissionRow({
    taskId,
    userId,
    discordId,
    submitterName,
    targetId,
    targetLabel,
    proofUrls,
    proofPaths,
    discordMessageId,
    discordChannelId,
}) {
    const { data, error } = await supabase
        .from('vs_submissions')
        .insert({
            task_id: taskId,
            user_id: userId || null,
            discord_id: String(discordId),
            submitter_name: submitterName || null,
            team_id: null,
            target_id: targetId,
            target_label: targetLabel || null,
            proof_urls: proofUrls || [],
            proof_paths: proofPaths || [],
            discord_message_id: discordMessageId ? String(discordMessageId) : null,
            discord_channel_id: discordChannelId ? String(discordChannelId) : null,
            status: 'pending',
        })
        .select('id')
        .single();

    if (error) {
        console.error('[SiteSubmissions] Insert failed:', error.message);
        return null;
    }
    return data.id;
}

// ---------------------------------------------------------------------------
// Template rotation (vs_events)

// Pick a rotation template. Prefer least-recently-activated for fairness:
// fewest instances spawned. Falls back to random if all candidates have zero
// instances. `kind` is e.g. 'weekly_task' or 'daily_task'.
async function pickTemplateForKind(kind) {
    const { data: templates, error } = await supabase
        .from('vs_tasks')
        .select('id, name, slug, description, vp_reward, requires_proof, recurrence')
        .eq('is_template', true)
        .eq('in_rotation', true)
        .eq('kind', kind);

    if (error) {
        console.error('[SiteSubmissions] template fetch failed:', error.message);
        return null;
    }
    if (!templates || templates.length === 0) return null;

    // Count instances per template — least-used wins.
    const ids = templates.map(t => t.id);
    const { data: counts } = await supabase
        .from('vs_tasks')
        .select('template_id')
        .in('template_id', ids)
        .eq('is_template', false);

    const usage = new Map(ids.map(id => [id, 0]));
    for (const row of counts || []) {
        usage.set(row.template_id, (usage.get(row.template_id) || 0) + 1);
    }

    const minUsage = Math.min(...Array.from(usage.values()));
    const candidates = templates.filter(t => (usage.get(t.id) || 0) === minUsage);

    // Random pick among the least-used.
    return candidates[Math.floor(Math.random() * candidates.length)] || null;
}

// Close any vs_events instances of `kind` still status='open' so a single
// instance is active at a time per rotation kind. Idempotent.
async function closeActiveInstancesOfKind(kind) {
    const { error } = await supabase
        .from('vs_tasks')
        .update({ status: 'closed' })
        .eq('kind', kind)
        .eq('is_template', false)
        .eq('status', 'open');
    if (error) {
        console.error('[SiteSubmissions] close active failed:', error.message);
    }
}

function makeSlug(name) {
    const base = (name || 'instance').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return `${base}-${Date.now()}`;
}

// Insert an instance copy of `template` for the given window. Returns the
// inserted row (or null on failure). vpReward/packReward override the template's
// reward (e.g. the weekly rotation awards a pack, so vpReward=0 + packReward set).
async function createInstanceFromTemplate(template, { kind, recurrence, startsAt, endsAt, name, description, vpReward, packReward }) {
    const slug = makeSlug(name || template.name);
    const { data, error } = await supabase
        .from('vs_tasks')
        .insert({
            name: name || template.name,
            slug,
            description: description ?? template.description ?? null,
            kind,
            recurrence: recurrence || template.recurrence || 'weekly',
            is_template: false,
            in_rotation: false,
            template_id: template.id,
            status: 'open',
            starts_at: startsAt instanceof Date ? startsAt.toISOString() : startsAt,
            ends_at: endsAt instanceof Date ? endsAt.toISOString() : endsAt,
            vp_reward: vpReward ?? template.vp_reward ?? 5,
            pack_reward: packReward ?? template.pack_reward ?? null,
            requires_proof: template.requires_proof ?? true,
        })
        .select()
        .single();

    if (error) {
        console.error('[SiteSubmissions] instance insert failed:', error.message);
        return null;
    }
    return data;
}

// Insert a standalone (non-rotation) vs_events instance — used by /event task
// and /event custom where the admin authored the title/description, not a
// pre-existing template.
async function createStandaloneInstance({ kind, name, description, startsAt, endsAt, vpReward, packReward = null, requiresProof = true }) {
    const slug = makeSlug(name);
    const { data, error } = await supabase
        .from('vs_tasks')
        .insert({
            name,
            slug,
            description: description || null,
            kind,
            recurrence: 'one_off',
            is_template: false,
            in_rotation: false,
            template_id: null,
            status: 'open',
            starts_at: startsAt instanceof Date ? startsAt.toISOString() : (startsAt || new Date().toISOString()),
            ends_at: endsAt instanceof Date ? endsAt.toISOString() : (endsAt || null),
            vp_reward: vpReward ?? 0,
            pack_reward: packReward,
            requires_proof: requiresProof,
        })
        .select()
        .single();

    if (error) {
        console.error('[SiteSubmissions] standalone instance insert failed:', error.message);
        return null;
    }
    return data;
}

// List currently-active (open, deadline not passed) vs_events instances of a kind
// e.g. 'weekly_task'. Used by /sendweeklytask to ANNOUNCE what's live — it does
// not create anything. Newest first.
async function listActiveInstancesOfKind(kind) {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
        .from('vs_tasks')
        .select('id, name, description, kind, vp_reward, pack_reward, ends_at')
        .eq('is_template', false)
        .eq('kind', kind)
        .eq('status', 'open')
        .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
        .order('starts_at', { ascending: false });
    if (error) {
        console.error('[SiteSubmissions] listActiveInstancesOfKind failed:', error.message);
        return [];
    }
    return data || [];
}

// All currently-active (open, deadline not passed) task instances of any task kind.
// Used by the task-sync poller to ensure each has a Discord thread + stays in sync.
async function listAllActiveTasks() {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
        .from('vs_tasks')
        .select('id, name, description, kind, vp_reward, pack_reward, ends_at')
        .eq('is_template', false)
        .eq('status', 'open')
        .in('kind', ['weekly_task', 'daily_task', 'custom_task'])
        .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
        .order('starts_at', { ascending: false });
    if (error) {
        console.error('[SiteSubmissions] listAllActiveTasks failed:', error.message);
        return [];
    }
    return data || [];
}

// ---------------------------------------------------------------------------
// Site events (vs_events) — announced in Discord by the event-announce poller

// Currently-running site events (status='open'). These are full vs_events rows
// (bingo / duo / simple / sequential / custom), NOT the vs_tasks instances above.
// The bot posts ONE describe-and-link embed per open event into the events channel
// and points players at the site to submit. Newest first.
async function listActiveSiteEvents() {
    const { data, error } = await supabase
        .from('vs_events')
        .select('id, slug, name, kind, description, status, starts_at, ends_at')
        .eq('status', 'open')
        .order('starts_at', { ascending: false });
    if (error) {
        console.error('[SiteSubmissions] listActiveSiteEvents failed:', error.message);
        return [];
    }
    return data || [];
}

// ---------------------------------------------------------------------------
// Pack-payout poller helpers

// Approved rows still awaiting bot-side processing (pack grant).
async function fetchApprovedPendingPack() {
    const { data, error } = await supabase
        .from('vs_submissions')
        .select('id, task_id, user_id, discord_id, submitter_name, vs_tasks!task_id(name, pack_reward)')
        .eq('status', 'approved')
        .eq('pack_awarded', false)
        .not('task_id', 'is', null);
    if (error) {
        console.error('[SiteSubmissions] fetchApprovedPendingPack failed:', error.message);
        return [];
    }
    return data || [];
}

async function markPackAwarded(siteSubmissionId) {
    const { error } = await supabase
        .from('vs_submissions')
        .update({ pack_awarded: true })
        .eq('id', siteSubmissionId);
    if (error) {
        console.error('[SiteSubmissions] markPackAwarded failed:', error.message);
        return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Approval-notification poller helpers

// Approved rows whose "your submission was approved" notice hasn't been sent yet.
// Carries the task name + rewards so the bot can tell the player what they earned,
// plus the Discord message linkage so it can reply to their original proof post.
async function fetchApprovedPendingNotify() {
    const { data, error } = await supabase
        .from('vs_submissions')
        .select('id, task_id, user_id, discord_id, submitter_name, discord_message_id, discord_channel_id, vs_tasks!task_id(name, vp_reward, pack_reward, event_id)')
        .eq('status', 'approved')
        .eq('approval_notified', false)
        .not('task_id', 'is', null);
    if (error) {
        console.error('[SiteSubmissions] fetchApprovedPendingNotify failed:', error.message);
        return [];
    }
    return data || [];
}

async function markApprovalNotified(siteSubmissionId) {
    const { error } = await supabase
        .from('vs_submissions')
        .update({ approval_notified: true })
        .eq('id', siteSubmissionId);
    if (error) {
        console.error('[SiteSubmissions] markApprovalNotified failed:', error.message);
        return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Rejection-notification poller helpers

// Rejected rows whose "your submission was rejected" notice hasn't been sent yet.
// Carries the task name + review note so the bot can tell the player what + why.
async function fetchRejectedPendingNotify() {
    const { data, error } = await supabase
        .from('vs_submissions')
        .select('id, task_id, user_id, discord_id, submitter_name, review_note, discord_message_id, discord_channel_id, vs_tasks!task_id(name, event_id)')
        .eq('status', 'rejected')
        .eq('rejection_notified', false);
    if (error) {
        console.error('[SiteSubmissions] fetchRejectedPendingNotify failed:', error.message);
        return [];
    }
    return data || [];
}

async function markRejectionNotified(siteSubmissionId) {
    const { error } = await supabase
        .from('vs_submissions')
        .update({ rejection_notified: true })
        .eq('id', siteSubmissionId);
    if (error) {
        console.error('[SiteSubmissions] markRejectionNotified failed:', error.message);
        return false;
    }
    return true;
}

// Resolve a Discord id from a vs_users row id (for site-submitted rows that stored
// user_id but not discord_id).
async function getDiscordIdForUserId(userId) {
    if (!userId) return null;
    const { data } = await supabase
        .from('vs_users').select('discord_id')
        .eq('id', userId)
        .maybeSingle();
    return data?.discord_id || null;
}

module.exports = {
    PROOF_BUCKET,
    lookupSiteUser,
    uploadAllProofs,
    createSubmissionRow,
    pickTemplateForKind,
    closeActiveInstancesOfKind,
    createInstanceFromTemplate,
    createStandaloneInstance,
    listActiveInstancesOfKind,
    listAllActiveTasks,
    listActiveSiteEvents,
    fetchApprovedPendingPack,
    markPackAwarded,
    fetchApprovedPendingNotify,
    markApprovalNotified,
    fetchRejectedPendingNotify,
    markRejectionNotified,
    getDiscordIdForUserId,
};
