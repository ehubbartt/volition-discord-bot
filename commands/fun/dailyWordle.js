const axios = require('axios');
const SHEETDB_URL = 'https://sheetdb.io/api/v1/cc3i0muqbdk5m';
const WORDLE_SHEET = 'Wordle List';
const WORDLE_DONE_SHEET = 'Wordle List Done';

// Pull all rows, filter to valid ones, pick one at random
async function fetchOneRandomWordleRow() {
  const { data } = await axios.get(SHEETDB_URL, { params: { sheet: WORDLE_SHEET } });
  const rows = (Array.isArray(data) ? data : []).filter(r => r && r.id && r.Wordle);
  if (!rows.length) return null;
  const idx = Math.floor(Math.random() * rows.length);
  return rows[idx];
}

// Append the picked row to the "done" sheet
async function appendRowToWordleDone(row) {
  const payload = { data: [row] };
  const res = await axios.post(SHEETDB_URL, payload, {
    params: { sheet: WORDLE_DONE_SHEET, return_values: false },
  });
  return res.data;
}

// Delete the original row from the source sheet by unique id
async function deleteWordleRowById(id) {
  const url = `${SHEETDB_URL}/id/${encodeURIComponent(id)}`;
  const res = await axios.delete(url, { params: { sheet: WORDLE_SHEET } });
  return res.data;
}

async function getDailyWordleAndMove() {
  try {
    const row = await fetchOneRandomWordleRow();
    if (!row) return null;

    await appendRowToWordleDone(row);

    const id = row.id ?? row.ID ?? row.Id;
    if (id != null && String(id).trim() !== '') {
      await deleteWordleRowById(id);
    } else {
      console.log('[SheetDB][Wordle] No unique id on row; not deleting from source:', row);
    }

    return row.Wordle;
  } catch (err) {
    console.log('[SheetDB][wordle] move failed:', err?.response?.data || err);
    try {
      const row = await fetchOneRandomWordleRow();
      return row ? row.Wordle : null;
    } catch {
      return null;
    }
  }
}

module.exports = { getDailyWordleAndMove };
