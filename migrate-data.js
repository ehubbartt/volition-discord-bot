/**
 * Migration script to import CSV data into Supabase
 *
 * This script will:
 * 1. Read clan_members.csv, points.csv, and task_list.csv
 * 2. Import all data into Supabase tables
 * 3. Generate a detailed migration report
 *
 * Usage: node migrate-data.js
 */

const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials!');
  console.error('Please set SUPABASE_URL and SUPABASE_ANON_KEY in your .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ============================================================================
// CSV PARSING HELPERS
// ============================================================================

function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',');

  return lines.slice(1).map(line => {
    const values = line.split(',');
    const obj = {};
    headers.forEach((header, index) => {
      obj[header.trim()] = values[index]?.trim() || '';
    });
    return obj;
  });
}

// ============================================================================
// MIGRATION FUNCTIONS
// ============================================================================

async function migratePlayers() {
  console.log('\n📋 Reading clan_members.csv...');
  const clanMembers = parseCSV('./clan_members.csv');
  console.log(`   Found ${clanMembers.length} clan members`);

  console.log('\n📋 Reading points.csv...');
  const pointsData = parseCSV('./points.csv');
  console.log(`   Found ${pointsData.length} point records`);

  // Create a map of RSN -> Points data (case-insensitive)
  const pointsMap = new Map();
  for (const row of pointsData) {
    const rsn = row.RSN?.toLowerCase();
    if (rsn) {
      pointsMap.set(rsn, {
        points: parseInt(row.Points) || 0,
        lastLootDate: row.LastLootDate || null,
      });
    }
  }

  const report = {
    playersCreated: 0,
    pointsCreated: 0,
    errors: [],
    warnings: [],
  };

  console.log('\n🚀 Starting player migration...\n');

  for (const member of clanMembers) {
    const rsn = member.RSN?.trim();
    if (!rsn) {
      report.warnings.push('⚠️  Skipped row with empty RSN');
      continue;
    }

    // Parse Discord ID (handle "0" and "1" as null)
    let discordId = member['Discord ID']?.trim();
    if (discordId === '0' || discordId === '1' || !discordId) {
      discordId = null;
    }

    // Parse WOM ID
    const womId = member['Wise Old Man ID'] ? parseInt(member['Wise Old Man ID']) : null;

    try {
      // Insert player
      const { data: player, error: playerError } = await supabase
        .from('players')
        .insert({
          rsn: rsn,
          discord_id: discordId,
          wom_id: womId,
        })
        .select()
        .single();

      if (playerError) {
        // Check if it's a duplicate
        if (playerError.code === '23505') {
          report.warnings.push(`⚠️  Duplicate player skipped: ${rsn}`);
          continue;
        }
        throw playerError;
      }

      report.playersCreated++;

      // Get points info for this player
      const pointsInfo = pointsMap.get(rsn.toLowerCase()) || { points: 0, lastLootDate: null };

      // Insert points record
      const { error: pointsError } = await supabase
        .from('player_points')
        .insert({
          player_id: player.id,
          points: pointsInfo.points,
          last_loot_date: pointsInfo.lastLootDate === '' ? null : pointsInfo.lastLootDate,
        });

      if (pointsError) throw pointsError;

      report.pointsCreated++;

      console.log(`✅ ${rsn.padEnd(20)} | ${pointsInfo.points.toString().padStart(5)} points | Discord: ${discordId || 'N/A'}`);

    } catch (error) {
      const errorMsg = `❌ ${rsn}: ${error.message}`;
      report.errors.push(errorMsg);
      console.error(errorMsg);
    }
  }

  // Check for orphaned points (players in points.csv but not in clan_members.csv)
  console.log('\n🔍 Checking for orphaned point records...\n');

  const clanRSNs = new Set(clanMembers.map(m => m.RSN?.toLowerCase()));

  for (const [rsn, pointsInfo] of pointsMap) {
    if (!clanRSNs.has(rsn)) {
      report.warnings.push(`⚠️  ${rsn} has ${pointsInfo.points} points but no clan member record`);

      try {
        // Create player record anyway to preserve points
        const { data: player, error: playerError } = await supabase
          .from('players')
          .insert({ rsn: rsn })
          .select()
          .single();

        if (playerError) {
          if (playerError.code !== '23505') { // Ignore duplicates
            throw playerError;
          }
          continue;
        }

        const { error: pointsError } = await supabase
          .from('player_points')
          .insert({
            player_id: player.id,
            points: pointsInfo.points,
            last_loot_date: pointsInfo.lastLootDate === '' ? null : pointsInfo.lastLootDate,
          });

        if (pointsError) throw pointsError;

        report.playersCreated++;
        report.pointsCreated++;
        console.log(`✅ ${rsn.padEnd(20)} | ${pointsInfo.points.toString().padStart(5)} points | (orphaned record)`);

      } catch (error) {
        const errorMsg = `❌ Failed to create orphaned record for ${rsn}: ${error.message}`;
        report.errors.push(errorMsg);
        console.error(errorMsg);
      }
    }
  }

  return report;
}

async function migrateTasks() {
  console.log('\n📋 Reading task_list.csv...');
  const tasks = parseCSV('./task_list.csv');
  console.log(`   Found ${tasks.length} tasks`);

  const report = {
    tasksCreated: 0,
    errors: [],
  };

  console.log('\n🚀 Starting task migration...\n');

  for (const task of tasks) {
    const taskText = task.Task?.trim();
    if (!taskText) {
      report.errors.push('⚠️  Skipped row with empty task');
      continue;
    }

    try {
      const { error } = await supabase
        .from('tasks')
        .insert({ task: taskText });

      if (error) throw error;

      report.tasksCreated++;
      console.log(`✅ Task added: ${taskText}`);

    } catch (error) {
      const errorMsg = `❌ Failed to add task "${taskText}": ${error.message}`;
      report.errors.push(errorMsg);
      console.error(errorMsg);
    }
  }

  return report;
}

// ============================================================================
// VALIDATION
// ============================================================================

async function validateMigration() {
  console.log('\n🔍 Validating migration...\n');

  const originalClan = parseCSV('./clan_members.csv');
  const originalPoints = parseCSV('./points.csv');
  const originalTasks = parseCSV('./task_list.csv');

  // Count migrated records
  const { data: players } = await supabase.from('players').select('*');
  const { data: points } = await supabase.from('player_points').select('*');
  const { data: tasks } = await supabase.from('tasks').select('*');

  console.log('Original Records:');
  console.log(`  Clan members: ${originalClan.length}`);
  console.log(`  Points records: ${originalPoints.length}`);
  console.log(`  Tasks: ${originalTasks.length}`);

  console.log('\nMigrated Records:');
  console.log(`  Players: ${players?.length || 0}`);
  console.log(`  Points: ${points?.length || 0}`);
  console.log(`  Tasks: ${tasks?.length || 0}`);

  // Verify point totals
  const originalTotal = originalPoints.reduce((sum, p) => sum + (parseInt(p.Points) || 0), 0);
  const migratedTotal = points?.reduce((sum, p) => sum + (p.points || 0), 0) || 0;

  console.log('\nPoints Validation:');
  console.log(`  Original total points: ${originalTotal}`);
  console.log(`  Migrated total points: ${migratedTotal}`);

  if (originalTotal === migratedTotal) {
    console.log('  ✅ VALIDATION PASSED - Points match!');
  } else {
    console.log(`  ⚠️  WARNING - Point mismatch: ${migratedTotal - originalTotal} difference`);
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('🌟 Supabase Data Migration Tool');
  console.log('================================\n');

  try {
    // Migrate players and points
    const playerReport = await migratePlayers();

    // Migrate tasks
    const taskReport = await migrateTasks();

    // Validation
    await validateMigration();

    // Final report
    console.log('\n' + '='.repeat(60));
    console.log('📊 MIGRATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Players created: ${playerReport.playersCreated}`);
    console.log(`✅ Points created: ${playerReport.pointsCreated}`);
    console.log(`✅ Tasks created: ${taskReport.tasksCreated}`);
    console.log(`⚠️  Warnings: ${playerReport.warnings.length}`);
    console.log(`❌ Errors: ${playerReport.errors.length + taskReport.errors.length}`);

    if (playerReport.warnings.length > 0) {
      console.log('\n⚠️  WARNINGS:');
      playerReport.warnings.forEach(w => console.log(`   ${w}`));
    }

    if (playerReport.errors.length > 0 || taskReport.errors.length > 0) {
      console.log('\n❌ ERRORS:');
      [...playerReport.errors, ...taskReport.errors].forEach(e => console.log(`   ${e}`));
    }

    console.log('\n✅ Migration complete!');
    console.log('\nNext steps:');
    console.log('1. Update your .env file with SUPABASE_URL and SUPABASE_ANON_KEY');
    console.log('2. Remove old SheetDB config from config.json');
    console.log('3. Test the bot commands');

  } catch (error) {
    console.error('\n❌ FATAL ERROR:', error.message);
    console.error(error);
    process.exit(1);
  }
}

main();
