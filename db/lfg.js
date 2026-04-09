const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Create a new LFG party
 */
async function createParty({ creatorId, bossKey, groupSize, experienceLevel, scheduledTime, notes, messageId, channelId, expiresAt, startsAt, teachersNeeded, rolesNeeded, pingMessageId }) {
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
      expires_at: expiresAt,
      starts_at: startsAt || null,
      teacher_id: experienceLevel === 'teaching' ? creatorId : null,
      teachers_needed: teachersNeeded || 0,
      roles_needed: rolesNeeded || null,
      ping_message_id: pingMessageId || null
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
async function addMember(partyId, userId, status = 'joined', isTeacher = false, role = null) {
  const { data, error } = await supabase
    .from('lfg_members')
    .insert({
      party_id: partyId,
      user_id: userId,
      status,
      is_teacher: isTeacher,
      role: role
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

/**
 * Get active parties whose start time has passed but haven't been notified yet
 */
async function getPartiesNeedingStartNotification() {
  const { data, error } = await supabase
    .from('lfg_parties')
    .select('*')
    .in('status', ['active', 'full'])
    .eq('start_notified', false)
    .not('starts_at', 'is', null)
    .lt('starts_at', new Date().toISOString());

  if (error) throw error;
  return data || [];
}

/**
 * Set a user as teacher (marks on both party and member)
 */
async function setTeacher(partyId, userId) {
  // Set teacher_id on party (first teacher or overwrite)
  const { data, error } = await supabase
    .from('lfg_parties')
    .update({ teacher_id: userId })
    .eq('id', partyId)
    .select()
    .single();

  if (error) throw error;

  // Mark the member as a teacher
  await supabase
    .from('lfg_members')
    .update({ is_teacher: true })
    .eq('party_id', partyId)
    .eq('user_id', userId);

  return data;
}

/**
 * Get count of teachers in a party
 */
async function getTeacherCount(partyId) {
  const { count, error } = await supabase
    .from('lfg_members')
    .select('*', { count: 'exact', head: true })
    .eq('party_id', partyId)
    .eq('is_teacher', true);

  if (error) throw error;
  return count || 0;
}

/**
 * Mark a party as start-notified
 */
async function markStartNotified(partyId) {
  const { error } = await supabase
    .from('lfg_parties')
    .update({ start_notified: true })
    .eq('id', partyId);

  if (error) throw error;
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
  getExpiredParties,
  getPartiesNeedingStartNotification,
  markStartNotified,
  setTeacher,
  getTeacherCount,
  markTeacherPaid,
  getPartiesPendingDeletion,
  markMessageDeleted
};

/**
 * Get expired/cancelled parties that are 8+ hours past expiry and not yet deleted
 */
async function getPartiesPendingDeletion() {
  const cutoff = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('lfg_parties')
    .select('*')
    .in('status', ['expired', 'cancelled'])
    .eq('message_deleted', false)
    .lt('expires_at', cutoff);

  if (error) throw error;
  return data || [];
}

/**
 * Mark a party's message as deleted
 */
async function markMessageDeleted(partyId) {
  const { error } = await supabase
    .from('lfg_parties')
    .update({ message_deleted: true })
    .eq('id', partyId);

  if (error) throw error;
}

/**
 * Mark a teacher's VP as claimed (prevents double-claiming)
 */
async function markTeacherPaid(partyId, userId) {
  const { error } = await supabase
    .from('lfg_members')
    .update({ vp_claimed: true })
    .eq('party_id', partyId)
    .eq('user_id', userId);

  if (error) throw error;
}
