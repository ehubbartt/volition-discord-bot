/**
 * Generates an HTML visualization of the rank simulation results.
 * Reads from the rank_simulation Supabase table and outputs an HTML file.
 *
 * Usage: node scripts/visualizeRanks.js
 * Then open scripts/rank_distribution.html in your browser.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const RANK_ORDER = ['bronze', 'iron', 'steel', 'gold', 'mithril', 'adamant', 'rune', 'dragon', 'sage', 'legend', 'myth', 'tztok', 'tzkal'];
const RANK_COLORS = {
    bronze: '#CD7F32', iron: '#A0A0A0', steel: '#71797E', gold: '#FFD700',
    mithril: '#4B0082', adamant: '#2E8B57', rune: '#4169E1', dragon: '#DC143C',
    sage: '#9370DB', legend: '#FF8C00', myth: '#8B0000', tztok: '#FF4500', tzkal: '#B22222'
};

async function main() {
    let { data: results, error } = await supabase
        .from('rank_simulation')
        .select('*')
        .order('composite_score', { ascending: false });

    if (error) {
        console.error('Error fetching data:', error.message);
        process.exit(1);
    }

    if (!results.length) {
        console.log('No data in rank_simulation table. Run simulateRanks.js first.');
        process.exit(1);
    }

    // Filter to only players with Temple data
    const allCount = results.length;
    results = results.filter(r => r.temple_available);
    console.log(`Loaded ${allCount} players, using ${results.length} with Temple data`);

    // Build distributions
    const currentDist = {};
    const projectedDist = {};
    for (const rank of RANK_ORDER) {
        currentDist[rank] = 0;
        projectedDist[rank] = 0;
    }
    for (const r of results) {
        if (currentDist[r.current_rank] !== undefined) currentDist[r.current_rank]++;
        if (projectedDist[r.projected_rank] !== undefined) projectedDist[r.projected_rank]++;
    }

    const total = results.length;

    // Component averages
    const avg = (key) => (results.reduce((s, r) => s + (parseFloat(r[key]) || 0), 0) / total).toFixed(4);

    // Score histogram buckets (0-1 in 0.05 increments)
    const buckets = new Array(20).fill(0);
    for (const r of results) {
        const idx = Math.min(19, Math.floor(parseFloat(r.composite_score) * 20));
        buckets[idx]++;
    }

    // Player table rows
    const playerRows = results.map(r => {
        const changed = r.current_rank !== r.projected_rank;
        const currentIdx = RANK_ORDER.indexOf(r.current_rank);
        const projIdx = RANK_ORDER.indexOf(r.projected_rank);
        const direction = projIdx > currentIdx ? 'upgrade' : projIdx < currentIdx ? 'downgrade' : 'same';
        const caScore = r.ca_score != null ? (parseFloat(r.ca_score) * 100).toFixed(1) + '%' : '-';
        const caPts = r.raw_ca_points != null ? r.raw_ca_points : '-';
        const caTier = r.ca_tier || '-';
        return `<tr class="${direction}">
            <td>${r.rsn}</td>
            <td>${r.temple_available ? 'Y' : 'N'}/${r.wikisync_available ? 'Y' : 'N'}</td>
            <td>${r.raw_ehb}</td>
            <td>${r.raw_total_level || '-'}</td>
            <td>${r.raw_gear_points}</td>
            <td>${r.raw_clog_finished}/${r.raw_clog_available || '-'}</td>
            <td>${r.raw_months_in_clan}mo</td>
            <td>${caPts} (${caTier})</td>
            <td>${(parseFloat(r.gear_score) * 100).toFixed(1)}%</td>
            <td>${(parseFloat(r.ehb_score) * 100).toFixed(1)}%</td>
            <td>${caScore}</td>
            <td>${(parseFloat(r.time_score) * 100).toFixed(1)}%</td>
            <td>${(parseFloat(r.total_level_score) * 100).toFixed(1)}%</td>
            <td>${(parseFloat(r.clog_score) * 100).toFixed(1)}%</td>
            <td><strong>${(parseFloat(r.composite_score) * 100).toFixed(1)}%</strong></td>
            <td><span class="rank-badge" style="background:${RANK_COLORS[r.current_rank]}">${r.current_rank}</span></td>
            <td><span class="rank-badge" style="background:${RANK_COLORS[r.projected_rank]}">${r.projected_rank}</span></td>
            <td>${changed ? (direction === 'upgrade' ? '⬆' : '⬇') : '-'}</td>
        </tr>`;
    }).join('\n');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Volition Rank Simulation</title>
<style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1a1a2e; color: #e0e0e0; padding: 24px; }
    h1 { text-align: center; margin-bottom: 8px; color: #fff; }
    .subtitle { text-align: center; color: #888; margin-bottom: 32px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 32px; }
    .card { background: #16213e; border-radius: 12px; padding: 24px; }
    .card h2 { margin-bottom: 16px; color: #e94560; font-size: 18px; }
    .full-width { grid-column: 1 / -1; }

    /* Bar chart */
    .bar-chart { display: flex; flex-direction: column; gap: 6px; }
    .bar-row { display: flex; align-items: center; gap: 8px; }
    .bar-label { width: 80px; text-align: right; font-size: 13px; font-weight: 600; }
    .bar-track { flex: 1; height: 28px; background: #0f3460; border-radius: 4px; position: relative; display: flex; }
    .bar-fill { height: 100%; border-radius: 4px; display: flex; align-items: center; justify-content: flex-end; padding-right: 6px; font-size: 12px; font-weight: 600; min-width: 30px; transition: width 0.5s; }
    .bar-fill.current { opacity: 0.5; }
    .bar-fill.projected { }
    .bar-value { width: 60px; font-size: 13px; }

    /* Grouped bars */
    .bar-group { display: flex; flex-direction: column; gap: 2px; }
    .bar-sub { height: 14px; }

    /* Histogram */
    .histogram { display: flex; align-items: flex-end; gap: 3px; height: 200px; padding-top: 20px; }
    .hist-bar { flex: 1; background: #e94560; border-radius: 3px 3px 0 0; position: relative; min-height: 2px; transition: height 0.5s; }
    .hist-bar:hover { background: #ff6b81; }
    .hist-bar .tooltip { display: none; position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); background: #333; padding: 4px 8px; border-radius: 4px; font-size: 11px; white-space: nowrap; }
    .hist-bar:hover .tooltip { display: block; }
    .hist-labels { display: flex; gap: 3px; margin-top: 4px; }
    .hist-labels span { flex: 1; text-align: center; font-size: 10px; color: #888; }

    /* Component averages */
    .component-list { display: flex; flex-direction: column; gap: 12px; }
    .component { display: flex; align-items: center; gap: 12px; }
    .comp-name { width: 140px; font-size: 14px; }
    .comp-bar-track { flex: 1; height: 24px; background: #0f3460; border-radius: 4px; }
    .comp-bar-fill { height: 100%; border-radius: 4px; background: #e94560; display: flex; align-items: center; justify-content: flex-end; padding-right: 8px; font-size: 12px; font-weight: 600; }
    .comp-weight { width: 40px; font-size: 12px; color: #888; text-align: right; }

    /* Summary stats */
    .stats { display: flex; gap: 24px; justify-content: center; margin-bottom: 24px; flex-wrap: wrap; }
    .stat { background: #16213e; border-radius: 8px; padding: 16px 24px; text-align: center; }
    .stat-value { font-size: 28px; font-weight: 700; color: #e94560; }
    .stat-label { font-size: 12px; color: #888; margin-top: 4px; }

    /* Legend */
    .legend { display: flex; gap: 16px; margin-bottom: 12px; justify-content: center; font-size: 13px; }
    .legend-item { display: flex; align-items: center; gap: 6px; }
    .legend-swatch { width: 16px; height: 16px; border-radius: 3px; }

    /* Table */
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid #0f3460; }
    th { background: #0f3460; color: #e94560; position: sticky; top: 0; font-size: 11px; }
    tr:hover { background: #1a2744; }
    tr.upgrade td:last-child { color: #4ade80; }
    tr.downgrade td:last-child { color: #f87171; }
    .rank-badge { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; color: #fff; }
    .table-container { max-height: 600px; overflow-y: auto; border-radius: 8px; }
    .filter-bar { margin-bottom: 12px; display: flex; gap: 12px; align-items: center; }
    .filter-bar input { background: #0f3460; border: 1px solid #1a3a6e; color: #e0e0e0; padding: 6px 12px; border-radius: 6px; font-size: 13px; }
</style>
</head>
<body>
<h1>Volition Rank Simulation</h1>
<p class="subtitle">${total} players analyzed &mdash; Temple: ${results.filter(r => r.temple_available).length}/${total} | WikiSync: ${results.filter(r => r.wikisync_available).length}/${total}</p>

<div class="stats">
    <div class="stat">
        <div class="stat-value">${total}</div>
        <div class="stat-label">Players</div>
    </div>
    <div class="stat">
        <div class="stat-value">${results.filter(r => r.current_rank !== r.projected_rank).length}</div>
        <div class="stat-label">Rank Changes</div>
    </div>
    <div class="stat">
        <div class="stat-value">${results.filter(r => RANK_ORDER.indexOf(r.projected_rank) > RANK_ORDER.indexOf(r.current_rank)).length}</div>
        <div class="stat-label">Upgrades</div>
    </div>
    <div class="stat">
        <div class="stat-value">${results.filter(r => RANK_ORDER.indexOf(r.projected_rank) < RANK_ORDER.indexOf(r.current_rank)).length}</div>
        <div class="stat-label">Downgrades</div>
    </div>
    <div class="stat">
        <div class="stat-value">${(parseFloat(avg('composite_score')) * 100).toFixed(1)}%</div>
        <div class="stat-label">Avg Composite</div>
    </div>
</div>

<div class="grid">
    <div class="card">
        <h2>Rank Distribution — Current vs Projected</h2>
        <div class="legend">
            <div class="legend-item"><div class="legend-swatch" style="background:#e94560;opacity:0.5"></div> Current</div>
            <div class="legend-item"><div class="legend-swatch" style="background:#4ade80"></div> Projected</div>
        </div>
        <div class="bar-chart">
            ${RANK_ORDER.map(rank => {
                const currPct = ((currentDist[rank] / total) * 100);
                const projPct = ((projectedDist[rank] / total) * 100);
                return `<div class="bar-row">
                    <div class="bar-label" style="color:${RANK_COLORS[rank]}">${rank}</div>
                    <div class="bar-track">
                        <div class="bar-group" style="width:100%;position:absolute;top:0;left:0;">
                            <div class="bar-sub bar-fill current" style="width:${currPct}%;background:#e94560;opacity:0.4"></div>
                            <div class="bar-sub bar-fill projected" style="width:${projPct}%;background:#4ade80"></div>
                        </div>
                    </div>
                    <div class="bar-value">${currentDist[rank]} → ${projectedDist[rank]}</div>
                </div>`;
            }).join('\n')}
        </div>
    </div>

    <div class="card">
        <h2>Component Averages</h2>
        <div class="component-list">
            ${[
                { name: 'Gear Score', key: 'gear_score', weight: '35%', color: '#e94560' },
                { name: 'EHB', key: 'ehb_score', weight: '25%', color: '#4169E1' },
                { name: 'Combat Achievements', key: 'ca_score', weight: '10%', color: '#FF6347' },
                { name: 'Collection Log', key: 'clog_score', weight: '10%', color: '#4ade80' },
                { name: 'Time in Clan', key: 'time_score', weight: '10%', color: '#FFD700' },
                { name: 'Total Level', key: 'total_level_score', weight: '10%', color: '#9370DB' },
            ].map(c => {
                const val = parseFloat(avg(c.key));
                return `<div class="component">
                    <div class="comp-name">${c.name}</div>
                    <div class="comp-bar-track">
                        <div class="comp-bar-fill" style="width:${val * 100}%;background:${c.color}">${(val * 100).toFixed(1)}%</div>
                    </div>
                    <div class="comp-weight">${c.weight}</div>
                </div>`;
            }).join('\n')}
        </div>
        <div style="margin-top:24px;">
            <h2>Composite Score Histogram</h2>
            <div class="histogram">
                ${buckets.map((count, i) => {
                    const maxB = Math.max(...buckets, 1);
                    const pct = (count / maxB) * 100;
                    const lo = (i * 0.05).toFixed(2);
                    const hi = ((i + 1) * 0.05).toFixed(2);
                    return `<div class="hist-bar" style="height:${Math.max(pct, 1)}%"><div class="tooltip">${lo}-${hi}: ${count}</div></div>`;
                }).join('\n')}
            </div>
            <div class="hist-labels">
                ${buckets.map((_, i) => `<span>${i % 4 === 0 ? (i * 0.05).toFixed(1) : ''}</span>`).join('')}
            </div>
        </div>
    </div>

    <div class="card full-width">
        <h2>All Players</h2>
        <div class="filter-bar">
            <input type="text" id="search" placeholder="Search player..." onkeyup="filterTable()">
        </div>
        <div class="table-container">
            <table id="playerTable">
                <thead>
                    <tr>
                        <th>RSN</th>
                        <th>T/W</th>
                        <th>EHB</th>
                        <th>Total</th>
                        <th>Gear Pts</th>
                        <th>CLog</th>
                        <th>Time</th>
                        <th>CA</th>
                        <th>Gear%</th>
                        <th>EHB%</th>
                        <th>CA%</th>
                        <th>Time%</th>
                        <th>Level%</th>
                        <th>CLog%</th>
                        <th>Score</th>
                        <th>Current</th>
                        <th>Projected</th>
                        <th>Chg</th>
                    </tr>
                </thead>
                <tbody>
                    ${playerRows}
                </tbody>
            </table>
        </div>
    </div>
</div>

<script>
function filterTable() {
    const q = document.getElementById('search').value.toLowerCase();
    const rows = document.querySelectorAll('#playerTable tbody tr');
    rows.forEach(row => {
        const rsn = row.cells[0].textContent.toLowerCase();
        row.style.display = rsn.includes(q) ? '' : 'none';
    });
}
</script>
</body>
</html>`;

    const outPath = path.join(__dirname, 'rank_distribution.html');
    fs.writeFileSync(outPath, html);
    console.log(`\nVisualization saved to: ${outPath}`);
    console.log('Open it in your browser to view.');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
