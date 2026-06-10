const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ----------------------------------------------------------------------------
// Events CRUD

async function createEvent({ type, title, description, created_by, vp_reward, place_rewards, tasks, wom_competition_id, message_id, thread_id, channel_id, ends_at, pack_reward_name, vs_event_id }) {
    const { data, error } = await supabase
        .from('events')
        .insert({
            type,
            title,
            description: description || null,
            created_by: created_by || null,
            vp_reward: vp_reward ?? 5,
            place_rewards: place_rewards || null,
            tasks: tasks || null,
            wom_competition_id: wom_competition_id || null,
            message_id: message_id || null,
            thread_id: thread_id || null,
            channel_id: channel_id || null,
            ends_at: ends_at || null,
            pack_reward_name: pack_reward_name || null,
            vs_event_id: vs_event_id || null,
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

async function getEvent(eventId) {
    const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('id', eventId)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
    }
    return data;
}

async function getEventByVsEventId(vsEventId) {
    const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('vs_event_id', vsEventId)
        .maybeSingle();
    if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
    }
    return data || null;
}

async function getEventByThreadId(threadId) {
    const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('thread_id', threadId)
        .eq('status', 'active')
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
    }
    return data;
}

async function getActiveEvents() {
    const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
}

async function getActiveCompetitionEvents() {
    const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('status', 'active')
        .in('type', ['sotw', 'botw'])
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
}

async function getActiveVoiceWeeklyEvent() {
    const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('status', 'active')
        .eq('type', 'voice_weekly')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) throw error;
    return data || null;
}

async function getExpiredActiveEvents() {
    const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('status', 'active')
        .not('ends_at', 'is', null)
        .lte('ends_at', new Date().toISOString());

    if (error) throw error;
    return data || [];
}

async function getClosedEventsReadyForDeletion() {
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('status', 'closed')
        .lte('closed_at', twelveHoursAgo);

    if (error) throw error;
    return data || [];
}

async function updateEvent(eventId, updates) {
    const { data, error } = await supabase
        .from('events')
        .update(updates)
        .eq('id', eventId)
        .select()
        .single();

    if (error) throw error;
    return data;
}

async function closeEvent(eventId) {
    return updateEvent(eventId, {
        status: 'closed',
        closed_at: new Date().toISOString()
    });
}

async function markEventDeleted(eventId) {
    return updateEvent(eventId, { status: 'deleted' });
}

// ----------------------------------------------------------------------------
// Event Submissions CRUD

async function createSubmission({ event_id, discord_id, message_id }) {
    const { data, error } = await supabase
        .from('event_submissions')
        .insert({
            event_id,
            discord_id,
            message_id,
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

async function getSubmission(submissionId) {
    const { data, error } = await supabase
        .from('event_submissions')
        .select('*')
        .eq('id', submissionId)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
    }
    return data;
}

async function getSubmissionByMessage(messageId) {
    const { data, error } = await supabase
        .from('event_submissions')
        .select('*')
        .eq('message_id', messageId)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
    }
    return data;
}

async function getApprovedSubmission(eventId, discordId) {
    const { data, error } = await supabase
        .from('event_submissions')
        .select('*')
        .eq('event_id', eventId)
        .eq('discord_id', discordId)
        .eq('approved', true)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
    }
    return data;
}

async function getApprovedSubmissions(eventId) {
    const { data, error } = await supabase
        .from('event_submissions')
        .select('*')
        .eq('event_id', eventId)
        .eq('approved', true)
        .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
}

async function approveSubmission(submissionId, approvedBy, vpAwarded) {
    const { data, error } = await supabase
        .from('event_submissions')
        .update({
            approved: true,
            approved_by: approvedBy,
            vp_awarded: vpAwarded
        })
        .eq('id', submissionId)
        .select()
        .single();

    if (error) throw error;
    return data;
}

module.exports = {
    createEvent,
    getEvent,
    getEventByVsEventId,
    getEventByThreadId,
    getActiveEvents,
    getActiveCompetitionEvents,
    getActiveVoiceWeeklyEvent,
    getExpiredActiveEvents,
    getClosedEventsReadyForDeletion,
    updateEvent,
    closeEvent,
    markEventDeleted,
    createSubmission,
    getSubmission,
    getSubmissionByMessage,
    getApprovedSubmission,
    getApprovedSubmissions,
    approveSubmission,
};
