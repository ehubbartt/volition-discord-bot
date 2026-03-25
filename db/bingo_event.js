const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables. Please set SUPABASE_URL and SUPABASE_ANON_KEY in your .env file');
}

const supabase = createClient(supabaseUrl, supabaseKey);

const bingoTiles = require('../config/bingoTiles.json');
const TOTAL_TILES = bingoTiles.length;

// --- Team functions ---

async function getAllTeams() {
    const { data, error } = await supabase
        .from('bingo_event_teams')
        .select('*')
        .order('completed_tiles_count', { ascending: false });

    if (error) throw error;
    return data || [];
}

async function getTeamByName(teamName) {
    const { data, error } = await supabase
        .from('bingo_event_teams')
        .select('*')
        .eq('team_name', teamName)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
    }
    return data;
}

async function getTeamById(teamId) {
    const { data, error } = await supabase
        .from('bingo_event_teams')
        .select('*')
        .eq('id', teamId)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
    }
    return data;
}

// --- Player functions ---

async function addPlayerToTeam(discordId, teamId, rsn = null) {
    const { data, error } = await supabase
        .from('bingo_event_players')
        .insert({
            discord_id: discordId,
            team_id: teamId,
            rsn: rsn
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

async function removePlayerFromTeam(discordId) {
    const { error } = await supabase
        .from('bingo_event_players')
        .delete()
        .eq('discord_id', discordId);

    if (error) throw error;
}

async function getPlayerTeam(discordId) {
    const { data, error } = await supabase
        .from('bingo_event_players')
        .select(`
            *,
            team:bingo_event_teams(*)
        `)
        .eq('discord_id', discordId)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
    }
    return data;
}

async function getTeamPlayers(teamId) {
    const { data, error } = await supabase
        .from('bingo_event_players')
        .select('*')
        .eq('team_id', teamId);

    if (error) throw error;
    return data || [];
}

// --- Progress functions ---

async function initializeTeamProgress(teamId) {
    const progressRows = bingoTiles.map(tile => ({
        team_id: teamId,
        tile_number: tile.tile_number,
        current_quantity: 0,
        required_quantity: tile.required_quantity
    }));

    const { data, error } = await supabase
        .from('bingo_event_progress')
        .insert(progressRows)
        .select();

    if (error) throw error;
    return data;
}

async function getTeamProgress(teamId) {
    const { data, error } = await supabase
        .from('bingo_event_progress')
        .select('*')
        .eq('team_id', teamId)
        .order('tile_number', { ascending: true });

    if (error) throw error;
    return data || [];
}

async function getTeamTileProgress(teamId, tileNumber) {
    const { data, error } = await supabase
        .from('bingo_event_progress')
        .select('*')
        .eq('team_id', teamId)
        .eq('tile_number', tileNumber)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
    }
    return data;
}

async function getAllTeamsProgress() {
    const { data, error } = await supabase
        .from('bingo_event_progress')
        .select('*')
        .order('team_id')
        .order('tile_number');

    if (error) throw error;
    return data || [];
}

async function incrementProgress(teamId, tileNumber) {
    const existing = await getTeamTileProgress(teamId, tileNumber);
    if (!existing) return null;
    if (existing.is_completed) return existing;

    const newQuantity = existing.current_quantity + 1;
    const isCompleted = newQuantity >= existing.required_quantity;

    const { data, error } = await supabase
        .from('bingo_event_progress')
        .update({
            current_quantity: newQuantity,
            is_completed: isCompleted,
            completed_at: isCompleted ? new Date().toISOString() : null
        })
        .eq('id', existing.id)
        .select()
        .single();

    if (error) throw error;

    if (isCompleted) {
        await updateCompletedCount(teamId);
    }

    return data;
}

async function setProgress(teamId, tileNumber, quantity) {
    const existing = await getTeamTileProgress(teamId, tileNumber);
    if (!existing) return null;

    const isCompleted = quantity >= existing.required_quantity;

    const { data, error } = await supabase
        .from('bingo_event_progress')
        .update({
            current_quantity: quantity,
            is_completed: isCompleted,
            completed_at: isCompleted ? new Date().toISOString() : null
        })
        .eq('id', existing.id)
        .select()
        .single();

    if (error) throw error;

    await updateCompletedCount(teamId);
    return data;
}

async function updateCompletedCount(teamId) {
    const progress = await getTeamProgress(teamId);
    const completedCount = progress.filter(p => p.is_completed).length;
    const allDone = completedCount === TOTAL_TILES;

    const { data, error } = await supabase
        .from('bingo_event_teams')
        .update({
            completed_tiles_count: completedCount,
            completed_at: allDone ? new Date().toISOString() : null
        })
        .eq('id', teamId)
        .select()
        .single();

    if (error) throw error;
    return data;
}

// --- Submission functions ---

async function logSubmission(teamId, submitterDiscordId, tileNumber, itemName, messageLink) {
    const { data, error } = await supabase
        .from('bingo_event_submissions')
        .insert({
            team_id: teamId,
            submitter_discord_id: submitterDiscordId,
            tile_number: tileNumber,
            item_name: itemName,
            quantity: 1,
            message_link: messageLink
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

async function getSubmissionsForTile(teamId, tileNumber) {
    const { data, error } = await supabase
        .from('bingo_event_submissions')
        .select('*')
        .eq('team_id', teamId)
        .eq('tile_number', tileNumber)
        .order('submitted_at', { ascending: true });

    if (error) throw error;
    return data || [];
}

module.exports = {
    getAllTeams,
    getTeamByName,
    getTeamById,
    addPlayerToTeam,
    removePlayerFromTeam,
    getPlayerTeam,
    getTeamPlayers,
    initializeTeamProgress,
    getTeamProgress,
    getTeamTileProgress,
    getAllTeamsProgress,
    incrementProgress,
    setProgress,
    updateCompletedCount,
    logSubmission,
    getSubmissionsForTile,
    TOTAL_TILES
};
