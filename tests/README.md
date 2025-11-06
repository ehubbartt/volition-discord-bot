# Test Suite Quick Reference

## Quick Start

```bash
# Run all tests
npm test

# Run specific test file
npm test db.players.test.js

# Watch mode (auto-rerun)
npm run test:watch

# Coverage report
npm run test:coverage
```

## Test Files

| File | Tests | Description |
|------|-------|-------------|
| `db.players.test.js` | 15 | Player CRUD operations |
| `db.points.test.js` | 20 | Points, leaderboard, loot dates |
| `db.tasks.test.js` | 8 | Task & wordle queue management |
| `integration.test.js` | 10 | Complete workflows (loot crate, competitions, etc.) |

## What Gets Tested

### ✅ Database Operations
- Create, read, update, delete players
- Add, subtract, set points
- Get leaderboards
- Manage task/wordle queues

### ✅ Data Integrity
- No data loss
- Cascade deletes work
- Unique constraints enforced
- Foreign keys maintained

### ✅ Bot Workflows
- Loot crate claims (free & paid)
- Competition rewards
- Player name changes
- Weekly task selection
- Concurrent operations

## Expected Results

**Total**: ~53 tests
**Time**: 12-15 seconds
**Success Rate**: 100%

## Quick Validation

After migration, run this to verify everything works:

```bash
npm test 2>&1 | grep -E "(PASS|FAIL|Tests:)"
```

You should see:
```
PASS  tests/db.players.test.js
PASS  tests/db.points.test.js
PASS  tests/db.tasks.test.js
PASS  tests/integration.test.js
Tests:       53 passed, 53 total
```

## Common Issues

### "Missing Supabase credentials"
→ Check `.env` file has `SUPABASE_URL` and `SUPABASE_ANON_KEY`

### "Player not found"
→ Run migration script first: `node migrate-data.js`

### Tests timeout
→ Check internet connection and Supabase project status

## What This Validates

- ✅ Supabase connection works
- ✅ All database tables exist
- ✅ All database functions work
- ✅ Migration was successful
- ✅ Ready to run the bot

---

See [TESTING_GUIDE.md](../TESTING_GUIDE.md) for detailed documentation.
