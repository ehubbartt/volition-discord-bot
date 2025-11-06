const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables. Please set SUPABASE_URL and SUPABASE_ANON_KEY in your .env file');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function getPlayerByRSN(rsn) {
  const { data, error } = await supabase
    .from('players')
    .select(`
      *,
      player_points (
        points,
        last_loot_date
      )
    `)
    .ilike('rsn', rsn)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }

  return data;
}

async function getPlayerByDiscordId(discordId) {
  const { data, error } = await supabase
    .from('players')
    .select(`
      *,
      player_points (
        points,
        last_loot_date
      )
    `)
    .eq('discord_id', discordId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }

  return data;
}

async function getPlayerByWomId(womId) {
  const { data, error } = await supabase
    .from('players')
    .select(`
      *,
      player_points (
        points,
        last_loot_date
      )
    `)
    .eq('wom_id', womId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }

  return data;
}

async function getAllPlayers() {
  const { data, error } = await supabase
    .from('players')
    .select(`
      *,
      player_points (
        points,
        last_loot_date
      )
    `);

  if (error) throw error;
  return data || [];
}

async function createPlayer(playerData, initialPoints = 0) {
  const { data: player, error: playerError } = await supabase
    .from('players')
    .insert({
      rsn: playerData.rsn,
      discord_id: playerData.discord_id || null,
      wom_id: playerData.wom_id || null,
    })
    .select()
    .single();

  if (playerError) throw playerError;
  const { data: points, error: pointsError } = await supabase
    .from('player_points')
    .insert({
      player_id: player.id,
      points: initialPoints,
    })
    .select()
    .single();

  if (pointsError) throw pointsError;

  return {
    ...player,
    player_points: points,
  };
}

async function updatePlayer(playerId, updates) {
  const { data, error } = await supabase
    .from('players')
    .update(updates)
    .eq('id', playerId)
    .select()
    .single();

  if (error) throw error;
  if (!data) {
    throw new Error(`Player with id ${playerId} not found`);
  }
  return data;
}

async function deletePlayer(playerId) {
  const { error } = await supabase
    .from('players')
    .delete()
    .eq('id', playerId);

  if (error) throw error;
}

async function getPoints(rsn) {
  const player = await getPlayerByRSN(rsn);
  if (!player || !player.player_points) return 0;
  return player.player_points.points || 0;
}

async function addPoints(rsn, amount) {
  const player = await getPlayerByRSN(rsn);
  if (!player) {
    throw new Error(`Player not found: ${rsn}`);
  }

  const currentPoints = player.player_points?.points || 0;
  const newPoints = currentPoints + amount;

  const { data, error } = await supabase
    .from('player_points')
    .update({ points: newPoints })
    .eq('player_id', player.id)
    .select()
    .single();

  if (error) throw error;
  return data.points;
}

async function setPoints(rsn, points) {
  const player = await getPlayerByRSN(rsn);
  if (!player) {
    throw new Error(`Player not found: ${rsn}`);
  }

  const { data, error } = await supabase
    .from('player_points')
    .update({ points })
    .eq('player_id', player.id)
    .select()
    .single();

  if (error) throw error;
  return data.points;
}

async function updateLastLootDate(rsn, date) {
  const player = await getPlayerByRSN(rsn);
  if (!player) {
    throw new Error(`Player not found: ${rsn}`);
  }

  const { error } = await supabase
    .from('player_points')
    .update({ last_loot_date: date })
    .eq('player_id', player.id);

  if (error) throw error;
}

async function getLeaderboard(limit = 10) {
  const { data, error } = await supabase
    .from('player_points')
    .select(`
      points,
      players:player_id (
        rsn
      )
    `)
    .order('points', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data || [])
    .filter(row => row.players)
    .map(row => ({
      rsn: row.players.rsn,
      points: row.points || 0,
    }));
}

async function getRandomTask() {
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('*');

  if (error) throw error;
  if (!tasks || tasks.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * tasks.length);
  return tasks[randomIndex];
}

async function moveTaskToCompleted(taskId, taskText) {
  const { error: insertError } = await supabase
    .from('completed_tasks')
    .insert({ task: taskText });

  if (insertError) throw insertError;
  const { error: deleteError } = await supabase
    .from('tasks')
    .delete()
    .eq('id', taskId);

  if (deleteError) throw deleteError;
}

async function getWeeklyTaskAndMove() {
  const task = await getRandomTask();
  if (!task) return null;

  await moveTaskToCompleted(task.id, task.task);
  return task.task;
}

async function getRandomWordle() {
  const { data: wordles, error } = await supabase
    .from('wordles')
    .select('*');

  if (error) throw error;
  if (!wordles || wordles.length === 0) return null;

  const randomIndex = Math.floor(Math.random() * wordles.length);
  return wordles[randomIndex];
}

async function moveWordleToCompleted(wordleId, wordleUrl) {
  const { error: insertError } = await supabase
    .from('completed_wordles')
    .insert({ wordle_url: wordleUrl });

  if (insertError) throw insertError;
  const { error: deleteError } = await supabase
    .from('wordles')
    .delete()
    .eq('id', wordleId);

  if (deleteError) throw deleteError;
}

async function getDailyWordleAndMove() {
  const wordle = await getRandomWordle();
  if (!wordle) return null;

  await moveWordleToCompleted(wordle.id, wordle.wordle_url);
  return wordle.wordle_url;
}

async function batchCreatePlayers(players) {
  const { data, error } = await supabase
    .from('players')
    .insert(players)
    .select();

  if (error) throw error;
  return data || [];
}

async function updatePlayerRsnByWomId(womId, newRsn) {
  const { data, error } = await supabase
    .from('players')
    .update({ rsn: newRsn })
    .eq('wom_id', womId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function deletePlayerByWomId(womId) {
  const { error } = await supabase
    .from('players')
    .delete()
    .eq('wom_id', womId);

  if (error) throw error;
}

module.exports = {
  supabase,
  getPlayerByRSN,
  getPlayerByDiscordId,
  getPlayerByWomId,
  getAllPlayers,
  createPlayer,
  updatePlayer,
  deletePlayer,
  getPoints,
  addPoints,
  setPoints,
  updateLastLootDate,
  getLeaderboard,
  getRandomTask,
  moveTaskToCompleted,
  getWeeklyTaskAndMove,
  getRandomWordle,
  moveWordleToCompleted,
  getDailyWordleAndMove,
  batchCreatePlayers,
  updatePlayerRsnByWomId,
  deletePlayerByWomId,
};
