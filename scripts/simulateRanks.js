/**
 * Rank Formula Simulation Script
 *
 * Fetches WOM + TempleOSRS data for a list of players,
 * calculates composite rank scores, stores in a temp Supabase table,
 * and prints the projected rank distribution.
 *
 * Usage:
 *   node scripts/simulateRanks.js           # Full fetch (slow, hits APIs)
 *   node scripts/simulateRanks.js --recalc  # Recalculate from cached data (instant)
 *
 * Reads RSNs from scripts/temple_players.txt (one RSN per line).
 * Caches API responses in scripts/.cache/ for fast recalculation.
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// --- Config ---
const gearConfig = require('../config/gearScoring.json');
const caConfig = require('../config/combatAchievements.json');
const config = require('../config.json');
const ranksConfig = require('../config/ranks.json');

const CLAN_ID = config.clanId;
const GEAR_SCORE_CAP = gearConfig.GEAR_SCORE_CAP;
const CA_MAX_POINTS = caConfig.maxPoints;
const RECALC_MODE = process.argv.includes('--recalc');
const FETCH_CA_ONLY = process.argv.includes('--fetch-ca');
const CACHE_DIR = path.join(__dirname, '.cache');

// Rank thresholds (composite score 0-1) — starting estimates
const RANK_THRESHOLDS = [
    { scoreMin: 0.00, womRole: 'bronze' },
    { scoreMin: 0.08, womRole: 'iron' },
    { scoreMin: 0.14, womRole: 'steel' },
    { scoreMin: 0.20, womRole: 'gold' },
    { scoreMin: 0.27, womRole: 'mithril' },
    { scoreMin: 0.35, womRole: 'adamant' },
    { scoreMin: 0.43, womRole: 'rune' },
    { scoreMin: 0.52, womRole: 'dragon' },
    { scoreMin: 0.62, womRole: 'sage' },
    { scoreMin: 0.72, womRole: 'legend' },
    { scoreMin: 0.82, womRole: 'myth' },
    { scoreMin: 0.90, womRole: 'tztok' },
    { scoreMin: 0.95, womRole: 'tzkal' },
];

// --- API Clients ---
const womApi = axios.create({
    baseURL: 'https://api.wiseoldman.net/v2',
    timeout: 15000,
    headers: { 'User-Agent': 'Volition-Discord-Bot', 'Accept': 'application/json' }
});

const templeApi = axios.create({
    baseURL: 'https://templeosrs.com/api',
    timeout: 20000,
    headers: { 'User-Agent': 'Volition-Discord-Bot' }
});

const wikiSyncApi = axios.create({
    baseURL: 'https://sync.runescape.wiki/runelite/player',
    timeout: 15000,
    headers: { 'User-Agent': 'Volition-Discord-Bot' }
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// --- Cache ---
function ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function cacheKey(rsn) {
    return rsn.toLowerCase().replace(/[^a-z0-9]/g, '_');
}

function saveCache(rsn, data) {
    ensureCacheDir();
    fs.writeFileSync(path.join(CACHE_DIR, `${cacheKey(rsn)}.json`), JSON.stringify(data));
}

function loadCache(rsn) {
    const file = path.join(CACHE_DIR, `${cacheKey(rsn)}.json`);
    if (fs.existsSync(file)) {
        return JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
    return null;
}

function saveClanCache(data) {
    ensureCacheDir();
    fs.writeFileSync(path.join(CACHE_DIR, '_clan_data.json'), JSON.stringify(data));
}

function loadClanCache() {
    const file = path.join(CACHE_DIR, '_clan_data.json');
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
    return null;
}

// --- Helpers ---
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function determineProjectedRank(compositeScore) {
    for (let i = RANK_THRESHOLDS.length - 1; i >= 0; i--) {
        if (compositeScore >= RANK_THRESHOLDS[i].scoreMin) return RANK_THRESHOLDS[i].womRole;
    }
    return 'bronze';
}

function determineCurrentRank(ehb) {
    for (let i = ranksConfig.ranks.length - 1; i >= 0; i--) {
        if (ehb >= ranksConfig.ranks[i].ehbMin) return ranksConfig.ranks[i].womRole;
    }
    return 'bronze';
}

// --- Scoring Functions ---

/**
 * Calculate gear points from Temple collection log data.
 * Returns { gearPoints, matchedItems, missedItems }
 */
function calculateGearPoints(templeItems) {
    if (!templeItems) return { gearPoints: 0, matchedItems: [], missedItems: [] };

    // Build a flat lookup: itemName (lowercase) -> max count across all categories
    const playerItems = {};
    for (const category of Object.values(templeItems)) {
        if (!Array.isArray(category)) continue;
        for (const item of category) {
            const key = item.name.toLowerCase();
            playerItems[key] = Math.max(playerItems[key] || 0, item.count || 1);
        }
    }

    let totalPoints = 0;
    const matchedItems = [];
    const missedItems = [];

    for (const gear of gearConfig.gear) {
        const itemChecks = gear.items;
        const totalChecks = itemChecks.length;
        let checksPassed = 0;

        for (const check of itemChecks) {
            // Handle OR items (name is an array of alternatives)
            const names = Array.isArray(check.name) ? check.name : [check.name];
            const requiredQty = check.quantity || 1;

            // Find the best match among alternatives
            let bestCount = 0;
            for (const name of names) {
                const count = playerItems[name.toLowerCase()] || 0;
                bestCount = Math.max(bestCount, count);
            }

            if (requiredQty > 1) {
                // Quantity-based: proportional credit
                checksPassed += Math.min(bestCount, requiredQty) / requiredQty;
            } else {
                // Binary: has it or not
                checksPassed += bestCount >= 1 ? 1 : 0;
            }
        }

        const completion = checksPassed / totalChecks;
        const earnedPoints = Math.round(completion * gear.points);

        if (earnedPoints > 0) {
            matchedItems.push({ name: gear.name, earned: earnedPoints, max: gear.points });
        } else {
            missedItems.push(gear.name);
        }

        totalPoints += earnedPoints;
    }

    return { gearPoints: totalPoints, matchedItems, missedItems };
}

function normalizeGear(gearPoints) {
    return Math.min(1, gearPoints / GEAR_SCORE_CAP);
}

function normalizeTimeInClan(clanJoinedAt) {
    if (!clanJoinedAt) return 0;
    const joinDate = new Date(clanJoinedAt);
    const now = new Date();
    const months = (now - joinDate) / (1000 * 60 * 60 * 24 * 30.44);
    return Math.min(1, months / 24);
}

function normalizeTotalLevel(totalLevel) {
    if (!totalLevel || totalLevel < 2000) return 0;
    return Math.min(1, (totalLevel - 2000) / 376);
}

function normalizeCollectionLog(finished, available) {
    if (!finished || !available || available === 0) return 0;
    return Math.min(1, finished / 1200);
}

function normalizeEhb(ehb) {
    if (!ehb || ehb <= 0) return 0;
    return Math.min(1, ehb / 3000);
}

/**
 * Calculate CA score from completed task IDs (from WikiSync).
 * Only awards points for completing entire tiers, not individual tasks.
 * Steeply weighted — Grandmaster alone is ~70% of the max score.
 *
 * Steps:
 * 1. Sum wiki points from completed tasks
 * 2. Check which tier thresholds are met (cumulative wiki points)
 * 3. Award tier completion rewards only for fully completed tiers
 *
 * Returns { caPoints, tasksCompleted, wikiPoints, highestTier }
 */
function calculateCAPoints(completedTaskIds) {
    if (!completedTaskIds || !completedTaskIds.length) {
        return { caPoints: 0, tasksCompleted: 0, wikiPoints: 0, highestTier: 'none' };
    }

    // Sum raw wiki points from completed tasks
    let wikiPoints = 0;
    let tasksCompleted = 0;
    for (const taskId of completedTaskIds) {
        const pts = caConfig.tasks[String(taskId)];
        if (pts) {
            wikiPoints += pts;
            tasksCompleted++;
        }
    }

    // Check which tier thresholds are met and sum tier completion rewards
    const tierOrder = ['easy', 'medium', 'hard', 'elite', 'master', 'grandmaster'];
    const rewards = caConfig.tierCompletionRewards;
    let caPoints = 0;
    let highestTier = 'none';

    for (const tier of tierOrder) {
        const threshold = caConfig.tiers[tier].cumulativeForReward;
        if (wikiPoints >= threshold) {
            caPoints += rewards[tier];
            highestTier = tier;
        } else {
            break;
        }
    }

    return { caPoints, tasksCompleted, wikiPoints, highestTier };
}

function normalizeCA(caPoints) {
    if (!caPoints || caPoints <= 0) return 0;
    return Math.min(1, caPoints / CA_MAX_POINTS);
}


function calculateCompositeScore({ gearPoints, monthsInClan, totalLevel, clogFinished, clogAvailable, ehb, clanJoinedAt, caPoints }) {
    const gear = normalizeGear(gearPoints);
    const time = normalizeTimeInClan(clanJoinedAt);
    const level = normalizeTotalLevel(totalLevel);
    const clog = normalizeCollectionLog(clogFinished, clogAvailable);
    const ehbNorm = normalizeEhb(ehb);
    const ca = normalizeCA(caPoints);

    const composite = (gear * 0.35) + (ehbNorm * 0.25) + (ca * 0.10) + (time * 0.10) + (clog * 0.10) + (level * 0.10);

    return { composite, gear, time, level, clog, ehb: ehbNorm, ca };
}

// --- Data Fetching ---

async function fetchClanData() {
    console.log(`Fetching WOM clan data for clan ${CLAN_ID}...`);
    const response = await womApi.get(`/groups/${CLAN_ID}`);
    const memberships = response.data.memberships || [];
    console.log(`  Found ${memberships.length} clan members`);

    // Build lookup by lowercase RSN
    const lookup = {};
    for (const m of memberships) {
        const rsn = m.player.displayName || m.player.username;
        lookup[rsn.toLowerCase()] = {
            rsn: rsn,
            womId: m.player.id,
            ehb: Math.round(m.player.ehb || 0),
            ehp: m.player.ehp || 0,
            clanJoinedAt: m.createdAt,
        };
    }
    return lookup;
}

async function fetchPlayerTotalLevel(rsn) {
    try {
        const response = await womApi.get(`/players/${encodeURIComponent(rsn)}`);
        const skills = response.data?.latestSnapshot?.data?.skills;
        return skills?.overall?.level || null;
    } catch (err) {
        console.log(`  [WOM] Could not fetch total level for ${rsn}: ${err.message}`);
        return null;
    }
}

async function fetchWikiSync(rsn) {
    try {
        const response = await wikiSyncApi.get(`/${encodeURIComponent(rsn)}/STANDARD`);
        const data = response.data;
        if (!data) return null;

        return {
            combatAchievements: data.combat_achievements || [],
        };
    } catch (err) {
        if (err.response?.status === 404) {
            console.log(`  [WikiSync] No data for ${rsn}`);
        } else {
            console.log(`  [WikiSync] Error for ${rsn}: ${err.message}`);
        }
        return null;
    }
}

async function fetchTempleCollectionLog(rsn) {
    try {
        const response = await templeApi.get('/collection-log/player_collection_log.php', {
            params: { player: rsn, categories: 'all', includenames: 1 }
        });

        const data = response.data?.data;
        if (!data) return null;

        return {
            items: data.items || {},
            finished: data.total_collections_finished || 0,
            available: data.total_collections_available || 0,
            ehc: data.ehc || 0,
        };
    } catch (err) {
        if (err.response?.status === 404) {
            console.log(`  [Temple] No data for ${rsn}`);
        } else {
            console.log(`  [Temple] Error for ${rsn}: ${err.message}`);
        }
        return null;
    }
}

// --- Supabase Table ---

async function ensureSimulationTable() {
    // Try to create the table via RPC or just test if it exists
    const { data, error } = await supabase.from('rank_simulation').select('id').limit(1);
    if (error && error.code === '42P01') {
        console.log('\n⚠  Table "rank_simulation" does not exist.');
        console.log('   Please create it in Supabase SQL Editor with:\n');
        console.log(`CREATE TABLE IF NOT EXISTS rank_simulation (
  id serial PRIMARY KEY,
  rsn text NOT NULL,
  raw_ehb numeric(8,2),
  raw_total_level integer,
  raw_gear_points integer,
  raw_clog_finished integer,
  raw_clog_available integer,
  raw_months_in_clan numeric(6,2),
  gear_score numeric(6,4),
  time_score numeric(6,4),
  total_level_score numeric(6,4),
  clog_score numeric(6,4),
  ehb_score numeric(6,4),
  composite_score numeric(6,4),
  current_rank text,
  projected_rank text,
  temple_available boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);`);
        process.exit(1);
    }
    // Clear previous run data
    await supabase.from('rank_simulation').delete().neq('id', 0);
    console.log('Cleared previous simulation data.');
}

async function insertSimulationRow(row) {
    const { error } = await supabase.from('rank_simulation').insert(row);
    if (error) {
        console.log(`  [DB] Error inserting ${row.rsn}: ${error.message}`);
    }
}

// --- Main ---

async function main() {
    // Read RSN list
    const rsnFile = path.join(__dirname, 'temple_players.txt');
    if (!fs.existsSync(rsnFile)) {
        console.log(`\nPlease create ${rsnFile} with one RSN per line.`);
        console.log('These should be the ~70 players synced with TempleOSRS.');
        process.exit(1);
    }

    const rsns = fs.readFileSync(rsnFile, 'utf-8')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith('#'));

    const mode = RECALC_MODE ? ' (RECALC from cache)' : FETCH_CA_ONLY ? ' (FETCH CA only)' : '';
    console.log(`\n=== Rank Formula Simulation${mode} ===`);
    console.log(`Players to process: ${rsns.length}\n`);

    await ensureSimulationTable();

    // Fetch or load WOM clan data
    let clanData;
    if (RECALC_MODE) {
        clanData = loadClanCache();
        if (!clanData) {
            console.log('No cached clan data found. Run without --recalc first.');
            process.exit(1);
        }
        console.log(`Loaded clan data from cache`);
    } else {
        clanData = await fetchClanData();
        saveClanCache(clanData);
    }

    const results = [];
    let templeHits = 0;
    let templeMisses = 0;
    let wikiSyncHits = 0;
    let wikiSyncMisses = 0;

    for (let i = 0; i < rsns.length; i++) {
        const rsn = rsns[i];
        const progress = `[${i + 1}/${rsns.length}]`;
        console.log(`${progress} Processing ${rsn}...`);

        // Get WOM data from bulk fetch
        const womData = clanData[rsn.toLowerCase()];
        if (!womData) {
            console.log(`  Skipping — not found in WOM clan data`);
            continue;
        }

        let totalLevel;
        let templeData;
        let wikiSyncData;

        if (RECALC_MODE) {
            // Load everything from cache
            const cached = loadCache(rsn);
            if (cached) {
                totalLevel = cached.totalLevel;
                templeData = cached.templeData;
                wikiSyncData = cached.wikiSyncData || null;
            } else {
                console.log(`  No cache for ${rsn}, skipping`);
                continue;
            }
        } else if (FETCH_CA_ONLY) {
            // Load Temple from cache, only fetch WikiSync
            const cached = loadCache(rsn);
            if (!cached || !cached.templeData) {
                console.log(`  No cached Temple data, skipping`);
                continue;
            }
            totalLevel = cached.totalLevel;
            templeData = cached.templeData;
            if (i > 0) await sleep(2000);
            wikiSyncData = await fetchWikiSync(rsn);
            // Update cache with new WikiSync data
            saveCache(rsn, { totalLevel, templeData, wikiSyncData });
        } else {
            // Full fetch from all APIs
            totalLevel = await fetchPlayerTotalLevel(rsn);
            if (i > 0) await sleep(5000);
            templeData = await fetchTempleCollectionLog(rsn);
            wikiSyncData = await fetchWikiSync(rsn);
            // Save to cache
            saveCache(rsn, { totalLevel, templeData, wikiSyncData });
        }

        let gearPoints = 0;
        let clogFinished = 0;
        let clogAvailable = 0;
        let templeAvailable = false;

        if (templeData) {
            templeAvailable = true;
            templeHits++;
            const gearResult = calculateGearPoints(templeData.items);
            gearPoints = gearResult.gearPoints;
            clogFinished = templeData.finished;
            clogAvailable = templeData.available;
        } else {
            templeMisses++;
        }

        // Calculate CA from WikiSync
        let caPoints = 0;
        let caTasksCompleted = 0;
        let caTier = 'none';
        let wikiSyncAvailable = false;

        if (wikiSyncData && wikiSyncData.combatAchievements) {
            wikiSyncAvailable = true;
            wikiSyncHits++;
            const caResult = calculateCAPoints(wikiSyncData.combatAchievements);
            caPoints = caResult.caPoints;
            caTasksCompleted = caResult.tasksCompleted;
            caTier = caResult.highestTier;
        } else {
            wikiSyncMisses++;
        }

        console.log(`  Gear: ${gearPoints}/${GEAR_SCORE_CAP} | CLog: ${clogFinished}/${clogAvailable} | EHB: ${womData.ehb} | Total: ${totalLevel || '?'} | CA: ${caPoints}pts (${caTier})`);

        // Calculate scores
        const scores = calculateCompositeScore({
            gearPoints,
            clanJoinedAt: womData.clanJoinedAt,
            totalLevel,
            clogFinished,
            clogAvailable,
            ehb: womData.ehb,
            caPoints,
        });

        const currentRank = determineCurrentRank(womData.ehb);
        const projectedRank = determineProjectedRank(scores.composite);

        const joinDate = new Date(womData.clanJoinedAt);
        const monthsInClan = (Date.now() - joinDate) / (1000 * 60 * 60 * 24 * 30.44);

        const row = {
            rsn: womData.rsn,
            raw_ehb: womData.ehb,
            raw_total_level: totalLevel,
            raw_gear_points: gearPoints,
            raw_clog_finished: clogFinished,
            raw_clog_available: clogAvailable,
            raw_months_in_clan: Math.round(monthsInClan * 100) / 100,
            raw_ca_points: caPoints,
            raw_ca_tasks_completed: caTasksCompleted,
            gear_score: Math.round(scores.gear * 10000) / 10000,
            time_score: Math.round(scores.time * 10000) / 10000,
            total_level_score: Math.round(scores.level * 10000) / 10000,
            clog_score: Math.round(scores.clog * 10000) / 10000,
            ehb_score: Math.round(scores.ehb * 10000) / 10000,
            ca_score: Math.round(scores.ca * 10000) / 10000,
            composite_score: Math.round(scores.composite * 10000) / 10000,
            current_rank: currentRank,
            projected_rank: projectedRank,
            temple_available: templeAvailable,
            wikisync_available: wikiSyncAvailable,
            ca_tier: caTier,
        };

        results.push(row);
        await insertSimulationRow(row);
    }

    // --- Print Summary ---
    console.log('\n' + '='.repeat(70));
    console.log('SIMULATION RESULTS');
    console.log('='.repeat(70));
    console.log(`\nPlayers processed: ${results.length}`);
    console.log(`Temple data available: ${templeHits} | Missing: ${templeMisses}`);
    console.log(`WikiSync data available: ${wikiSyncHits} | Missing: ${wikiSyncMisses}`);

    // Distribution comparison
    console.log('\n--- RANK DISTRIBUTION ---\n');
    const currentDist = {};
    const projectedDist = {};
    for (const r of results) {
        currentDist[r.current_rank] = (currentDist[r.current_rank] || 0) + 1;
        projectedDist[r.projected_rank] = (projectedDist[r.projected_rank] || 0) + 1;
    }

    const rankOrder = ['bronze', 'iron', 'steel', 'gold', 'mithril', 'adamant', 'rune', 'dragon', 'sage', 'legend', 'myth', 'tztok', 'tzkal'];
    const total = results.length;

    console.log(padRight('Rank', 12) + padRight('Current', 16) + padRight('Projected', 16) + 'Change');
    console.log('-'.repeat(56));

    for (const rank of rankOrder) {
        const curr = currentDist[rank] || 0;
        const proj = projectedDist[rank] || 0;
        const currPct = total > 0 ? ((curr / total) * 100).toFixed(1) : '0.0';
        const projPct = total > 0 ? ((proj / total) * 100).toFixed(1) : '0.0';
        const diff = proj - curr;
        const diffStr = diff > 0 ? `+${diff}` : diff === 0 ? ' 0' : `${diff}`;
        console.log(
            padRight(rank, 12) +
            padRight(`${curr} (${currPct}%)`, 16) +
            padRight(`${proj} (${projPct}%)`, 16) +
            diffStr
        );
    }

    // Score component averages
    console.log('\n--- COMPONENT AVERAGES (0-1 scale) ---\n');
    const avg = (arr, key) => arr.length ? (arr.reduce((s, r) => s + r[key], 0) / arr.length).toFixed(4) : 'N/A';

    console.log(`Gear Score (50%):       ${avg(results, 'gear_score')}`);
    console.log(`EHB (15%):              ${avg(results, 'ehb_score')}`);
    console.log(`CA (10%):               ${avg(results, 'ca_score')}`);
    console.log(`Time in Clan (10%):     ${avg(results, 'time_score')}`);
    console.log(`Collection Log (10%):   ${avg(results, 'clog_score')}`);
    console.log(`Total Level (5%):       ${avg(results, 'total_level_score')}`);
    console.log(`Composite:              ${avg(results, 'composite_score')}`);

    // Biggest rank changes
    console.log('\n--- NOTABLE RANK CHANGES ---\n');
    const changes = results
        .map(r => ({
            rsn: r.rsn,
            from: r.current_rank,
            to: r.projected_rank,
            fromIdx: rankOrder.indexOf(r.current_rank),
            toIdx: rankOrder.indexOf(r.projected_rank),
        }))
        .filter(r => r.fromIdx !== r.toIdx)
        .sort((a, b) => Math.abs(b.toIdx - b.fromIdx) - Math.abs(a.toIdx - a.fromIdx));

    const upgrades = changes.filter(c => c.toIdx > c.fromIdx).slice(0, 10);
    const downgrades = changes.filter(c => c.toIdx < c.fromIdx).slice(0, 10);

    if (upgrades.length) {
        console.log('Top Upgrades:');
        for (const c of upgrades) {
            console.log(`  ${padRight(c.rsn, 20)} ${c.from} → ${c.to} (+${c.toIdx - c.fromIdx})`);
        }
    }

    if (downgrades.length) {
        console.log('\nTop Downgrades:');
        for (const c of downgrades) {
            console.log(`  ${padRight(c.rsn, 20)} ${c.from} → ${c.to} (${c.toIdx - c.fromIdx})`);
        }
    }

    if (!upgrades.length && !downgrades.length) {
        console.log('No rank changes detected.');
    }

    // Histogram
    console.log('\n--- COMPOSITE SCORE HISTOGRAM ---\n');
    const buckets = new Array(20).fill(0); // 0.00-0.05, 0.05-0.10, ...
    for (const r of results) {
        const idx = Math.min(19, Math.floor(r.composite_score * 20));
        buckets[idx]++;
    }
    const maxBucket = Math.max(...buckets, 1);
    for (let i = 0; i < 20; i++) {
        const lo = (i * 0.05).toFixed(2);
        const hi = ((i + 1) * 0.05).toFixed(2);
        const bar = '█'.repeat(Math.round((buckets[i] / maxBucket) * 40));
        console.log(`${lo}-${hi} | ${bar} ${buckets[i]}`);
    }

    console.log('\n✓ Results stored in rank_simulation table.');
    console.log('  Run: SELECT * FROM rank_simulation ORDER BY composite_score DESC;');
}

function padRight(str, len) {
    return String(str).padEnd(len);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
