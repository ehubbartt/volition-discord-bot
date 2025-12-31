const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables. Please set SUPABASE_URL and SUPABASE_ANON_KEY in your .env file');
}

const supabase = createClient(supabaseUrl, supabaseKey);

const KEYSTONE_TILES = [1, 10, 20, 30, 36, 37, 38, 39, 40];
const RAID_TILES = [10, 20, 30];

async function getTeamByName(teamName) {
    const { data, error } = await supabase
        .from('tile_event_teams')
        .select('*')
        .eq('team_name', teamName)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
    }

    return data;
}

async function getTeamByLeaderId(discordId) {
    // Check if user is a leader
    const { data: leaderData, error: leaderError } = await supabase
        .from('tile_event_teams')
        .select('*')
        .eq('leader_discord_id', discordId)
        .single();

    if (leaderData) return leaderData;
    if (leaderError && leaderError.code !== 'PGRST116') throw leaderError;

    // Check if user is a co-leader
    const { data: coleaderData, error: coleaderError } = await supabase
        .from('tile_event_teams')
        .select('*')
        .eq('coleader_discord_id', discordId)
        .single();

    if (coleaderData) return coleaderData;
    if (coleaderError && coleaderError.code !== 'PGRST116') throw coleaderError;

    return null;
}

async function getAllTeams() {
    const { data, error } = await supabase
        .from('tile_event_teams')
        .select('*')
        .order('current_tile', { ascending: false });

    if (error) throw error;
    return data || [];
}

async function updateTeamTile(teamId, newTile) {
    const { data, error } = await supabase
        .from('tile_event_teams')
        .update({
            current_tile: newTile,
            completed_at: newTile === 40 ? new Date().toISOString() : null
        })
        .eq('id', teamId)
        .select()
        .single();

    if (error) throw error;
    return data;
}

async function addSabotageToken(teamId) {
    const team = await supabase
        .from('tile_event_teams')
        .select('sabotage_tokens')
        .eq('id', teamId)
        .single();

    if (team.error) throw team.error;

    const newCount = Math.min(team.data.sabotage_tokens + 1, 3);

    const { data, error } = await supabase
        .from('tile_event_teams')
        .update({ sabotage_tokens: newCount })
        .eq('id', teamId)
        .select()
        .single();

    if (error) throw error;
    return data;
}

async function useSabotageToken(teamId) {
    const team = await supabase
        .from('tile_event_teams')
        .select('sabotage_tokens')
        .eq('id', teamId)
        .single();

    if (team.error) throw team.error;

    const newCount = Math.max(team.data.sabotage_tokens - 1, 0);

    const { data, error } = await supabase
        .from('tile_event_teams')
        .update({ sabotage_tokens: newCount })
        .eq('id', teamId)
        .select()
        .single();

    if (error) throw error;
    return data;
}

async function incrementTotalRolls(teamId) {
    const { data, error } = await supabase
        .from('tile_event_teams')
        .select('total_rolls')
        .eq('id', teamId)
        .single();

    if (error) throw error;

    const { data: updated, error: updateError } = await supabase
        .from('tile_event_teams')
        .update({ total_rolls: (data.total_rolls || 0) + 1 })
        .eq('id', teamId)
        .select()
        .single();

    if (updateError) throw updateError;
    return updated;
}

async function addPlayerToTeam(discordId, teamId, rsn = null) {
    const { data, error } = await supabase
        .from('tile_event_players')
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

async function getPlayerTeam(discordId) {
    const { data, error } = await supabase
        .from('tile_event_players')
        .select(`
            *,
            team:tile_event_teams(*)
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
        .from('tile_event_players')
        .select('*')
        .eq('team_id', teamId);

    if (error) throw error;
    return data || [];
}

async function getTileData(tileNumber) {
    const { data, error } = await supabase
        .from('tile_event_tiles')
        .select('*')
        .eq('tile_number', tileNumber)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
    }

    return data;
}

async function getAllTiles() {
    const { data, error } = await supabase
        .from('tile_event_tiles')
        .select('*')
        .order('tile_number', { ascending: true });

    if (error) throw error;
    return data || [];
}

async function initializeTileProgress(teamId, tileNumber, optionId) {
    const tile = await getTileData(tileNumber);
    if (!tile) throw new Error(`Tile ${tileNumber} not found`);

    const requirements = tile.requirement_json;
    const option = requirements.find(opt => opt.option_id === optionId);
    if (!option) throw new Error(`Option ${optionId} not found in tile ${tileNumber}`);

    const progressRows = option.items.map(item => ({
        team_id: teamId,
        tile_number: tileNumber,
        option_id: optionId,
        item_name: item.name,
        current_quantity: 0,
        required_quantity: item.quantity
    }));

    const { data, error } = await supabase
        .from('tile_event_progress')
        .insert(progressRows)
        .select();

    if (error) throw error;
    return data;
}

async function ensureProgressItemExists(teamId, tileNumber, optionId, itemName, requiredQuantity) {
    // Check if the item already exists in progress
    const { data: existing, error: checkError } = await supabase
        .from('tile_event_progress')
        .select('*')
        .eq('team_id', teamId)
        .eq('tile_number', tileNumber)
        .eq('item_name', itemName)
        .single();

    if (existing) return existing; // Already exists
    if (checkError && checkError.code !== 'PGRST116') throw checkError;

    // Item doesn't exist, insert it
    const { data, error } = await supabase
        .from('tile_event_progress')
        .insert({
            team_id: teamId,
            tile_number: tileNumber,
            option_id: optionId,
            item_name: itemName,
            current_quantity: 0,
            required_quantity: requiredQuantity
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

async function incrementProgress(teamId, tileNumber, itemName, quantity) {
    const { data: existing, error: fetchError } = await supabase
        .from('tile_event_progress')
        .select('*')
        .eq('team_id', teamId)
        .eq('tile_number', tileNumber)
        .eq('item_name', itemName)
        .single();

    if (fetchError) {
        if (fetchError.code === 'PGRST116') {
            return null;
        }
        throw fetchError;
    }

    const newQuantity = existing.current_quantity + quantity;
    const isCompleted = newQuantity >= existing.required_quantity;

    const { data, error } = await supabase
        .from('tile_event_progress')
        .update({
            current_quantity: newQuantity,
            is_completed: isCompleted,
            completed_at: isCompleted ? new Date().toISOString() : existing.completed_at
        })
        .eq('id', existing.id)
        .select()
        .single();

    if (error) throw error;
    return data;
}

async function getTeamProgress(teamId, tileNumber) {
    const { data, error } = await supabase
        .from('tile_event_progress')
        .select('*')
        .eq('team_id', teamId)
        .eq('tile_number', tileNumber)
        .order('option_id', { ascending: true })
        .order('item_name', { ascending: true });

    if (error) throw error;
    return data || [];
}

async function checkTileCompletion(teamId, tileNumber) {
    const progress = await getTeamProgress(teamId, tileNumber);

    if (progress.length === 0) return false;

    const optionIds = [...new Set(progress.map(p => p.option_id))];

    for (const optionId of optionIds) {
        const optionProgress = progress.filter(p => p.option_id === optionId);
        const allCompleted = optionProgress.every(p => p.is_completed);

        if (allCompleted) {
            return true;
        }
    }

    return false;
}

async function completeTile(teamId, tileNumber) {
    const { data, error } = await supabase
        .from('tile_event_progress')
        .update({
            is_completed: true,
            completed_at: new Date().toISOString()
        })
        .eq('team_id', teamId)
        .eq('tile_number', tileNumber)
        .select();

    if (error) throw error;
    return data;
}

async function logSubmission(teamId, submitterDiscordId, tileNumber, itemName, quantity, messageLink) {
    const { data, error } = await supabase
        .from('tile_event_submissions')
        .insert({
            team_id: teamId,
            submitter_discord_id: submitterDiscordId,
            tile_number: tileNumber,
            item_name: itemName,
            quantity: quantity,
            message_link: messageLink
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

async function logSabotageUsage(attackerTeamId, targetTeamId, targetTile, outcome, itemAffected, usedByDiscordId) {
    const { data, error } = await supabase
        .from('tile_event_sabotage_log')
        .insert({
            attacker_team_id: attackerTeamId,
            target_team_id: targetTeamId,
            target_tile_number: targetTile,
            outcome: outcome,
            item_affected: itemAffected,
            used_by_discord_id: usedByDiscordId
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

async function applySabotage(targetTeamId, targetTile, itemName, isPositive) {
    const { data: progress, error: fetchError } = await supabase
        .from('tile_event_progress')
        .select('*')
        .eq('team_id', targetTeamId)
        .eq('tile_number', targetTile)
        .eq('item_name', itemName)
        .single();

    if (fetchError) throw fetchError;

    const modifier = isPositive ? -1 : 1;
    const newRequired = Math.max(1, progress.required_quantity + modifier);
    const newSabotageModifier = progress.sabotage_modifier + modifier;

    // Check if reducing the requirement auto-completes the item
    const isNowCompleted = progress.current_quantity >= newRequired;
    const completedAt = isNowCompleted && !progress.is_completed ? new Date().toISOString() : progress.completed_at;

    const { data, error } = await supabase
        .from('tile_event_progress')
        .update({
            required_quantity: newRequired,
            sabotage_modifier: newSabotageModifier,
            is_completed: isNowCompleted,
            completed_at: completedAt
        })
        .eq('id', progress.id)
        .select()
        .single();

    if (error) throw error;
    return data;
}

async function applySabotageProgress(targetTeamId, targetTile, itemName, progressChange) {
    const { data: progress, error: fetchError } = await supabase
        .from('tile_event_progress')
        .select('*')
        .eq('team_id', targetTeamId)
        .eq('tile_number', targetTile)
        .eq('item_name', itemName)
        .single();

    if (fetchError) throw fetchError;

    // Add or subtract progress (min 0)
    const newQuantity = Math.max(0, progress.current_quantity + progressChange);

    // Check if this completes the item
    const isNowCompleted = newQuantity >= progress.required_quantity;
    const completedAt = isNowCompleted && !progress.is_completed ? new Date().toISOString() : progress.completed_at;

    const { data, error } = await supabase
        .from('tile_event_progress')
        .update({
            current_quantity: newQuantity,
            is_completed: isNowCompleted,
            completed_at: completedAt
        })
        .eq('id', progress.id)
        .select()
        .single();

    if (error) throw error;
    return data;
}

// Modify the required quantity for a sabotage (add or reduce requirement)
async function applySabotageRequirement(targetTeamId, targetTile, itemName, requirementChange) {
    const { data: progress, error: fetchError } = await supabase
        .from('tile_event_progress')
        .select('*')
        .eq('team_id', targetTeamId)
        .eq('tile_number', targetTile)
        .eq('item_name', itemName)
        .single();

    if (fetchError) throw fetchError;

    // Add or subtract from required quantity (min 1 to prevent 0 or negative requirements)
    const newRequirement = Math.max(1, progress.required_quantity + requirementChange);

    // Check if current progress now completes the item (in case requirement was reduced)
    const isNowCompleted = progress.current_quantity >= newRequirement;
    const completedAt = isNowCompleted && !progress.is_completed ? new Date().toISOString() : progress.completed_at;

    const { data, error } = await supabase
        .from('tile_event_progress')
        .update({
            required_quantity: newRequirement,
            is_completed: isNowCompleted,
            completed_at: completedAt
        })
        .eq('id', progress.id)
        .select()
        .single();

    if (error) throw error;
    return data;
}

async function logRoll(teamId, fromTile, rollValue, toTile, wasCapped, rolledByDiscordId) {
    const { data, error } = await supabase
        .from('tile_event_roll_log')
        .insert({
            team_id: teamId,
            from_tile: fromTile,
            roll_value: rollValue,
            to_tile: toTile,
            was_capped_by_mandatory: wasCapped,
            rolled_by_discord_id: rolledByDiscordId
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

function calculateNewTile(currentTile, rollValue) {
    let newTile = currentTile + rollValue;
    let wasCapped = false;

    const passedKeystone = KEYSTONE_TILES.find(
        t => t > currentTile && t <= newTile
    );

    if (passedKeystone) {
        newTile = passedKeystone;
        wasCapped = true;
    }

    newTile = Math.min(newTile, 40);

    return { newTile, wasCapped };
}

async function getTeamsAheadOf(teamId) {
    const team = await supabase
        .from('tile_event_teams')
        .select('current_tile')
        .eq('id', teamId)
        .single();

    if (team.error) throw team.error;

    const { data, error } = await supabase
        .from('tile_event_teams')
        .select('*')
        .gt('current_tile', team.data.current_tile)
        .order('current_tile', { ascending: true });

    if (error) throw error;
    return data || [];
}

async function findItemInTileOptions(tileNumber, itemName) {
    const tile = await getTileData(tileNumber);
    if (!tile) return null;

    for (const option of tile.requirement_json) {
        const item = option.items.find(i => i.name.toLowerCase() === itemName.toLowerCase());
        if (item) {
            return { optionId: option.option_id, item };
        }
    }

    return null;
}

async function hasBeenSabotagedOnCurrentTile(targetTeamId, currentTile) {
    const { data, error } = await supabase
        .from('tile_event_sabotage_log')
        .select('id')
        .eq('target_team_id', targetTeamId)
        .eq('target_tile_number', currentTile)
        .limit(1);

    if (error) throw error;
    return data && data.length > 0;
}

async function useRerollToken(teamId) {
    const team = await supabase
        .from('tile_event_teams')
        .select('reroll_tokens')
        .eq('id', teamId)
        .single();

    if (team.error) throw team.error;

    if (team.data.reroll_tokens <= 0) {
        throw new Error('No reroll tokens available');
    }

    const { data, error } = await supabase
        .from('tile_event_teams')
        .update({ reroll_tokens: 0 })
        .eq('id', teamId)
        .select()
        .single();

    if (error) throw error;
    return data;
}

function getWeightedRoll() {
    // Weighted roll: 50% chance of 2, 25% chance of 1, 25% chance of 3
    // This gives an average of 2.0
    const rand = Math.random();

    if (rand < 0.25) {
        return 1;
    } else if (rand < 0.75) {
        return 2;
    } else {
        return 3;
    }
}

async function setProgressQuantity(progressId, newQuantity, requiredQuantity, wasCompleted) {
    const isNowCompleted = newQuantity >= requiredQuantity;

    const { data, error } = await supabase
        .from('tile_event_progress')
        .update({
            current_quantity: newQuantity,
            is_completed: isNowCompleted,
            completed_at: isNowCompleted && !wasCompleted ? new Date().toISOString() : null
        })
        .eq('id', progressId)
        .select()
        .single();

    if (error) throw error;
    return data;
}

async function getTeamTileReachedAt(teamId, tileNumber) {
    // Get when a team first reached a specific tile from the roll log
    const { data, error } = await supabase
        .from('tile_event_roll_log')
        .select('created_at')
        .eq('team_id', teamId)
        .eq('to_tile', tileNumber)
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null; // No roll found (could be starting tile)
        throw error;
    }
    return data?.created_at || null;
}

// Get the tile the team rolled FROM to reach their current tile
async function getPreviousTile(teamId, currentTile) {
    const { data, error } = await supabase
        .from('tile_event_roll_log')
        .select('from_tile')
        .eq('team_id', teamId)
        .eq('to_tile', currentTile)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null; // No roll found (team started here or tile 0)
        throw error;
    }
    return data?.from_tile ?? null;
}

module.exports = {
    getTeamByName,
    getTeamByLeaderId,
    getAllTeams,
    updateTeamTile,
    addSabotageToken,
    useSabotageToken,
    incrementTotalRolls,
    addPlayerToTeam,
    getPlayerTeam,
    getTeamPlayers,
    getTileData,
    getAllTiles,
    initializeTileProgress,
    ensureProgressItemExists,
    incrementProgress,
    getTeamProgress,
    checkTileCompletion,
    completeTile,
    logSubmission,
    logSabotageUsage,
    applySabotage,
    applySabotageProgress,
    applySabotageRequirement,
    logRoll,
    calculateNewTile,
    getTeamsAheadOf,
    findItemInTileOptions,
    hasBeenSabotagedOnCurrentTile,
    useRerollToken,
    getWeightedRoll,
    setProgressQuantity,
    getTeamTileReachedAt,
    getPreviousTile,
    KEYSTONE_TILES,
    RAID_TILES
};
