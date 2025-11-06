const db = require('../../db/supabase');

async function getWeeklyTaskAndMove() {
  try {
    const taskText = await db.getWeeklyTaskAndMove();
    return taskText || 'No task description available.';
  } catch (err) {
    console.error('[Supabase] Weekly task move failed:', err);
    return 'No task description available.';
  }
}

module.exports = { getWeeklyTaskAndMove };
