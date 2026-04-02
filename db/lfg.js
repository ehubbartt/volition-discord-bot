const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Create a new LFG party
 */
async function createParty({ creatorId, bossKey, groupSize, experienceLevel, scheduledTime, notes, messageId, channelId, expiresAt }) {
  const { data, error } = await supabase
    .from('lfg_parties')
    .insert({
      creator_id: creatorId,
      boss_key: bossKey,
      group_size: groupSize,
      experience_level: experienceLevel,
      scheduled_time: scheduledTime || null,
      notes: notes || null,
      message_id: messageId,
      channel_id: channelId,
      expires_at: expiresAt
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get a party by its Discord message ID
 */
async function getPartyByMessageId(messageId) {
  const { data, error } = await supabase
    .from('lfg_parties')
    .select('*')
    .eq('message_id', messageId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
}

/**
 * Get active parties created by a user
 */
async function getActivePartiesByUser(userId) {
  const { data, error } = await supabase
    .from('lfg_parties')
    .select('*')
    .eq('creator_id', userId)
    .in('status', ['active', 'full']);

  if (error) throw error;
  return data || [];
}

/**
 * Add a member to a party
 */
async function addMember(partyId, userId, status = 'joined') {
  const { data, error } = await supabase
    .from('lfg_members')
    .insert({
      party_id: partyId,
      user_id: userId,
      status
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Remove a member from a party
 */
async function removeMember(partyId, userId) {
  const { error } = await supabase
    .from('lfg_members')
    .delete()
    .eq('party_id', partyId)
    .eq('user_id', userId);

  if (error) throw error;
}

/**
 * Get all members of a party, ordered by join time
 */
async function getMembers(partyId) {
  const { data, error } = await supabase
    .from('lfg_members')
    .select('*')
    .eq('party_id', partyId)
    .order('joined_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Get a specific member entry
 */
async function getMember(partyId, userId) {
  const { data, error } = await supabase
    .from('lfg_members')
    .select('*')
    .eq('party_id', partyId)
    .eq('user_id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
}

/**
 * Promote the first waitlisted member to joined
 */
async function promoteFirstWaitlisted(partyId) {
  const { data: waitlisted, error: fetchError } = await supabase
    .from('lfg_members')
    .select('*')
    .eq('party_id', partyId)
    .eq('status', 'waitlisted')
    .order('joined_at', { ascending: true })
    .limit(1);

  if (fetchError) throw fetchError;
  if (!waitlisted || waitlisted.length === 0) return null;

  const { data, error } = await supabase
    .from('lfg_members')
    .update({ status: 'joined' })
    .eq('id', waitlisted[0].id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Update party status
 */
async function updatePartyStatus(partyId, status) {
  const { data, error } = await supabase
    .from('lfg_parties')
    .update({ status })
    .eq('id', partyId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get all expired active parties
 */
async function getExpiredParties() {
  const { data, error } = await supabase
    .from('lfg_parties')
    .select('*')
    .in('status', ['active', 'full'])
    .lt('expires_at', new Date().toISOString());

  if (error) throw error;
  return data || [];
}

module.exports = {
  createParty,
  getPartyByMessageId,
  getActivePartiesByUser,
  addMember,
  removeMember,
  getMembers,
  getMember,
  promoteFirstWaitlisted,
  updatePartyStatus,
  getExpiredParties
};
