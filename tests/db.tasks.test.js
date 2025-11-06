/**
 * Tests for Task and Wordle Database Operations
 *
 * Tests:
 * - Getting random tasks
 * - Moving tasks to completed
 * - Getting random wordles
 * - Moving wordles to completed
 */

const db = require('../db/supabase');

describe('Task Operations', () => {
  let testTaskIds = [];

  // Create test tasks before tests
  beforeAll(async () => {
    const tasks = [
      'Test Task 1 - ' + Date.now(),
      'Test Task 2 - ' + Date.now(),
      'Test Task 3 - ' + Date.now(),
    ];

    for (const task of tasks) {
      const { data, error } = await db.supabase
        .from('tasks')
        .insert({ task })
        .select()
        .single();

      if (!error && data) {
        testTaskIds.push(data.id);
      }
    }

    console.log(`Created ${testTaskIds.length} test tasks`);
  });

  // Cleanup
  afterAll(async () => {
    // Clean up any remaining test tasks
    for (const id of testTaskIds) {
      try {
        await db.supabase.from('tasks').delete().eq('id', id);
      } catch (error) {
        // Task may have been moved to completed
      }
    }

    // Clean up completed test tasks
    await db.supabase
      .from('completed_tasks')
      .delete()
      .ilike('task', 'Test Task%');

    console.log('Test cleanup: Deleted test tasks');
  });

  describe('getRandomTask', () => {
    test('should return a random task object', async () => {
      const task = await db.getRandomTask();

      if (task) {
        expect(task).toHaveProperty('id');
        expect(task).toHaveProperty('task');
        expect(typeof task.task).toBe('string');
      } else {
        // Queue might be empty
        console.log('Warning: Task queue is empty');
      }
    });

    test('should return null if no tasks available', async () => {
      // Delete all tasks temporarily
      const { data: allTasks } = await db.supabase.from('tasks').select('*');
      const taskIds = allTasks.map(t => t.id);

      // Delete all
      await db.supabase.from('tasks').delete().in('id', taskIds);

      const task = await db.getRandomTask();
      expect(task).toBeNull();

      // Restore tasks
      for (const id of testTaskIds) {
        await db.supabase
          .from('tasks')
          .insert({ task: 'Restored Test Task ' + id });
      }
    });
  });

  describe('moveTaskToCompleted', () => {
    test('should move task to completed_tasks', async () => {
      // Get a task
      const task = await db.getRandomTask();

      if (!task) {
        console.warn('No tasks available for moveTaskToCompleted test');
        return;
      }

      const originalId = task.id;
      const originalTask = task.task;

      // Move to completed
      await db.moveTaskToCompleted(originalId, originalTask);

      // Verify task is removed from tasks table
      const { data: taskCheck } = await db.supabase
        .from('tasks')
        .select('*')
        .eq('id', originalId)
        .single();

      expect(taskCheck).toBeNull();

      // Verify task is in completed_tasks table
      const { data: completedTask } = await db.supabase
        .from('completed_tasks')
        .select('*')
        .eq('task', originalTask)
        .order('completed_at', { ascending: false })
        .limit(1)
        .single();

      expect(completedTask).toBeDefined();
      expect(completedTask.task).toBe(originalTask);
    });
  });

  describe('getWeeklyTaskAndMove', () => {
    test('should get random task and move it atomically', async () => {
      // Add a specific test task
      const testTask = 'Atomic Test Task - ' + Date.now();
      const { data: inserted } = await db.supabase
        .from('tasks')
        .insert({ task: testTask })
        .select()
        .single();

      // Get count before
      const { data: beforeTasks } = await db.supabase
        .from('tasks')
        .select('id');
      const beforeCount = beforeTasks.length;

      // Execute function
      const taskText = await db.getWeeklyTaskAndMove();

      if (!taskText) {
        console.warn('No tasks available for getWeeklyTaskAndMove test');
        return;
      }

      expect(typeof taskText).toBe('string');
      expect(taskText.length).toBeGreaterThan(0);

      // Get count after
      const { data: afterTasks } = await db.supabase
        .from('tasks')
        .select('id');
      const afterCount = afterTasks.length;

      // Should be one less task
      expect(afterCount).toBe(beforeCount - 1);

      // Check it's in completed
      const { data: completedTask } = await db.supabase
        .from('completed_tasks')
        .select('*')
        .eq('task', taskText)
        .order('completed_at', { ascending: false })
        .limit(1)
        .single();

      expect(completedTask).toBeDefined();
      expect(completedTask.task).toBe(taskText);
    });

    test('should return null if no tasks available', async () => {
      // Delete all tasks
      await db.supabase.from('tasks').delete().neq('id', 0);

      const taskText = await db.getWeeklyTaskAndMove();
      expect(taskText).toBeNull();

      // Restore test tasks
      for (let i = 0; i < 3; i++) {
        await db.supabase
          .from('tasks')
          .insert({ task: 'Restored Task ' + Date.now() + '_' + i });
      }
    });
  });
});

describe('Wordle Operations', () => {
  let testWordleIds = [];

  // Create test wordles before tests
  beforeAll(async () => {
    const wordles = [
      'https://test-wordle-1.com/' + Date.now(),
      'https://test-wordle-2.com/' + Date.now(),
      'https://test-wordle-3.com/' + Date.now(),
    ];

    for (const wordle_url of wordles) {
      const { data, error } = await db.supabase
        .from('wordles')
        .insert({ wordle_url })
        .select()
        .single();

      if (!error && data) {
        testWordleIds.push(data.id);
      }
    }

    console.log(`Created ${testWordleIds.length} test wordles`);
  });

  // Cleanup
  afterAll(async () => {
    // Clean up any remaining test wordles
    for (const id of testWordleIds) {
      try {
        await db.supabase.from('wordles').delete().eq('id', id);
      } catch (error) {
        // Wordle may have been moved to completed
      }
    }

    // Clean up completed test wordles
    await db.supabase
      .from('completed_wordles')
      .delete()
      .ilike('wordle_url', 'https://test-wordle%');

    console.log('Test cleanup: Deleted test wordles');
  });

  describe('getRandomWordle', () => {
    test('should return a random wordle object', async () => {
      const wordle = await db.getRandomWordle();

      if (wordle) {
        expect(wordle).toHaveProperty('id');
        expect(wordle).toHaveProperty('wordle_url');
        expect(typeof wordle.wordle_url).toBe('string');
      } else {
        console.log('Warning: Wordle queue is empty');
      }
    });

    test('should return null if no wordles available', async () => {
      // Delete all wordles temporarily
      const { data: allWordles } = await db.supabase.from('wordles').select('*');
      const wordleIds = allWordles.map(w => w.id);

      // Delete all
      await db.supabase.from('wordles').delete().in('id', wordleIds);

      const wordle = await db.getRandomWordle();
      expect(wordle).toBeNull();

      // Restore wordles
      for (let i = 0; i < testWordleIds.length; i++) {
        await db.supabase
          .from('wordles')
          .insert({ wordle_url: 'https://restored-wordle.com/' + Date.now() + '_' + i });
      }
    });
  });

  describe('moveWordleToCompleted', () => {
    test('should move wordle to completed_wordles', async () => {
      // Get a wordle
      const wordle = await db.getRandomWordle();

      if (!wordle) {
        console.warn('No wordles available for moveWordleToCompleted test');
        return;
      }

      const originalId = wordle.id;
      const originalUrl = wordle.wordle_url;

      // Move to completed
      await db.moveWordleToCompleted(originalId, originalUrl);

      // Verify wordle is removed from wordles table
      const { data: wordleCheck } = await db.supabase
        .from('wordles')
        .select('*')
        .eq('id', originalId)
        .single();

      expect(wordleCheck).toBeNull();

      // Verify wordle is in completed_wordles table
      const { data: completedWordle } = await db.supabase
        .from('completed_wordles')
        .select('*')
        .eq('wordle_url', originalUrl)
        .order('completed_at', { ascending: false })
        .limit(1)
        .single();

      expect(completedWordle).toBeDefined();
      expect(completedWordle.wordle_url).toBe(originalUrl);
    });
  });

  describe('getDailyWordleAndMove', () => {
    test('should get random wordle and move it atomically', async () => {
      // Add a specific test wordle
      const testWordle = 'https://atomic-test-wordle.com/' + Date.now();
      await db.supabase
        .from('wordles')
        .insert({ wordle_url: testWordle });

      // Get count before
      const { data: beforeWordles } = await db.supabase
        .from('wordles')
        .select('id');
      const beforeCount = beforeWordles.length;

      // Execute function
      const wordleUrl = await db.getDailyWordleAndMove();

      if (!wordleUrl) {
        console.warn('No wordles available for getDailyWordleAndMove test');
        return;
      }

      expect(typeof wordleUrl).toBe('string');
      expect(wordleUrl.length).toBeGreaterThan(0);

      // Get count after
      const { data: afterWordles } = await db.supabase
        .from('wordles')
        .select('id');
      const afterCount = afterWordles.length;

      // Should be one less wordle
      expect(afterCount).toBe(beforeCount - 1);

      // Check it's in completed
      const { data: completedWordle } = await db.supabase
        .from('completed_wordles')
        .select('*')
        .eq('wordle_url', wordleUrl)
        .order('completed_at', { ascending: false })
        .limit(1)
        .single();

      expect(completedWordle).toBeDefined();
      expect(completedWordle.wordle_url).toBe(wordleUrl);
    });

    test('should return null if no wordles available', async () => {
      // Delete all wordles
      await db.supabase.from('wordles').delete().neq('id', 0);

      const wordleUrl = await db.getDailyWordleAndMove();
      expect(wordleUrl).toBeNull();

      // Restore test wordles
      for (let i = 0; i < 3; i++) {
        await db.supabase
          .from('wordles')
          .insert({ wordle_url: 'https://restored-wordle.com/' + Date.now() + '_' + i });
      }
    });
  });
});
