const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function migrateTasks() {
  console.log('Starting task migration...');

  const csvPath = path.join(__dirname, 'task_list.csv');

  if (!fs.existsSync(csvPath)) {
    console.error('task_list.csv not found!');
    process.exit(1);
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n').filter(line => line.trim());

  const headers = lines[0].split(',');
  console.log('CSV headers:', headers);

  const tasks = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    if (values.length >= 2 && values[1]) {
      tasks.push({
        task: values[1].trim()
      });
    }
  }

  console.log(`Found ${tasks.length} tasks to import`);

  console.log('\nClearing existing test tasks...');
  const { error: deleteError } = await supabase
    .from('tasks')
    .delete()
    .neq('id', 0);

  if (deleteError && deleteError.code !== 'PGRST116') {
    console.error('Error clearing tasks:', deleteError);
  } else {
    console.log('Existing tasks cleared');
  }

  console.log('\nInserting tasks into database...');
  const { data, error } = await supabase
    .from('tasks')
    .insert(tasks)
    .select();

  if (error) {
    console.error('Error inserting tasks:', error);
    process.exit(1);
  }

  console.log(`\nSuccessfully migrated ${data.length} tasks!`);
  console.log('\nSample tasks:');
  data.slice(0, 5).forEach((task, index) => {
    console.log(`${index + 1}. ${task.task}`);
  });

  console.log('\nMigration complete!');
}

migrateTasks().catch(console.error);
