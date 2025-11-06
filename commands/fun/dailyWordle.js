const db = require('../../db/supabase');

async function getDailyWordleAndMove() {
  try {
    const wordleUrl = await db.getDailyWordleAndMove();
    return wordleUrl || null;
  } catch (err) {
    console.error('[Supabase] Daily wordle move failed:', err);
    return null;
  }
}

module.exports = { getDailyWordleAndMove };
