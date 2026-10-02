// DANGER: wipes every table. Usage: CONFIRM=yes npm run db:reset
const db = require('./db');
(async () => {
  if (process.env.CONFIRM !== 'yes') return console.log('This deletes ALL data. Re-run with CONFIRM=yes to proceed.');
  await db.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); console.log('Database wiped. It will be re-created on the next request.'); process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
