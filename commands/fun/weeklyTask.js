const axios = require('axios');
const SHEETDB_API_URL = 'https://sheetdb.io/api/v1/cc3i0muqbdk5m';
const TASK_SHEET = 'Task List';
const DONE_SHEET = 'Done Weekly Tasks';

async function fetchOneRandomRowFromTaskList() {
  const { data } = await axios.get(SHEETDB_API_URL, { params: { sheet: TASK_SHEET } });
  if (!Array.isArray(data) || data.length === 0) return null;
  const idx = Math.floor(Math.random() * data.length);
  return data[idx];
}

async function appendRowToDoneWeeklyTasks(row) {
  const res = await axios.post(SHEETDB_API_URL, { data: [row] }, { params: { sheet: DONE_SHEET, return_values: false } });
  console.log('[SheetDB] append ->', res.data);
  return res.data;
}

async function deleteRowFromTaskList(column, value) {
  const url = `${SHEETDB_API_URL}/${encodeURIComponent(column)}/${encodeURIComponent(value)}`;
  const res = await axios.delete(url, { params: { sheet: TASK_SHEET } });
  console.log('[SheetDB] delete ->', res.data);
  return res.data;
}

function extractTask(row) {
  return row?.Task || row?.task || null;
}

async function getWeeklyTaskAndMove({ allowDeleteByTask = false } = {}) {
  try {
    const row = await fetchOneRandomRowFromTaskList();
    if (!row) return null;

    await appendRowToDoneWeeklyTasks(row);

    const id = row.id ?? row.ID ?? row.Id;
    if (id != null && String(id).trim() !== '') {
      await deleteRowFromTaskList('id', id);
    } else if (allowDeleteByTask && row.Task) {
      await deleteRowFromTaskList('Task', row.Task);
    } else {
      console.warn('[SheetDB] No unique id present on the row; not deleting from Task List.');
    }

    return extractTask(row);

  } catch (err) {
    console.error('[SheetDB] Weekly task move failed:', err?.response?.data || err);
    try {
      const row = await fetchOneRandomRowFromTaskList();
      return extractTask(row);
    } catch {
      return 'No task description available.';
    }
  }
}

module.exports = { getWeeklyTaskAndMove };
