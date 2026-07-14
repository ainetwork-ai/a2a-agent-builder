import { getSentImageIntents, markImageIntentSent } from '../src/lib/imageSentStore';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('❌', msg); process.exit(1); }
}

async function main() {
  const ctx = `test-ctx-${process.pid}`;
  const start = await getSentImageIntents(ctx);
  assert(Array.isArray(start) && start.length === 0, 'empty initially');

  await markImageIntentSent(ctx, 'welcome');
  await markImageIntentSent(ctx, 'pricing');
  await markImageIntentSent(ctx, 'welcome'); // dedupe

  const after = await getSentImageIntents(ctx);
  assert(after.includes('welcome'), 'has welcome');
  assert(after.includes('pricing'), 'has pricing');
  assert(after.length === 2, `no duplicates (got ${after.length})`);

  console.log('✅ image sent store OK');
  process.exit(0);
}
main();
