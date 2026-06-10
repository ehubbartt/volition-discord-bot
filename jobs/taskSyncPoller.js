// Keep Discord in sync with the site's active tasks. Every cycle it:
//   • posts a submission thread for any active vs_tasks instance that doesn't have
//     one yet (e.g. a task an admin activated on the site, weekly OR custom), and
//   • refreshes the thread's embed when the task was edited (name/desc/reward/deadline).
// ensureTaskThread() is idempotent, so re-running is cheap (no-op when unchanged).
//
// This is the auto-bridge: activate a task on the site and it shows up in Discord
// within one cycle, no slash command needed.

const siteSubs = require('../db/siteSubmissions');
const { ensureTaskThread } = require('../handlers/taskThread');

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let pollInterval = null;

async function runOnce(client) {
    const tasks = await siteSubs.listAllActiveTasks();
    for (const task of tasks) {
        try {
            const r = await ensureTaskThread(client, task);
            if (r?.created) console.log(`[TaskSync] posted thread for "${task.name}"`);
            else if (r?.refreshed) console.log(`[TaskSync] refreshed "${task.name}"`);
            else if (r?.error) console.warn(`[TaskSync] "${task.name}": ${r.error}`);
        } catch (err) {
            console.error(`[TaskSync] "${task.name}" error: ${err.message}`);
        }
    }
}

function startTaskSyncPoller(client) {
    console.log('[TaskSync] Starting (every 5m)');
    runOnce(client).catch((err) => console.error('[TaskSync] startup run error:', err.message));
    pollInterval = setInterval(() => {
        runOnce(client).catch((err) => console.error('[TaskSync] poll error:', err.message));
    }, POLL_INTERVAL_MS);
}

module.exports = { startTaskSyncPoller, runOnce };
