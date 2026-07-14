import { getSentImageIntents, markImageIntentSent } from '../src/lib/imageSentStore';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('❌', msg); process.exit(1); }
}

async function main() {
  const agentId = 'test-agent';
  const ctx = `test-ctx-${process.pid}`;
  const start = await getSentImageIntents(agentId, ctx);
  assert(Array.isArray(start) && start.length === 0, 'empty initially');

  await markImageIntentSent(agentId, ctx, 'welcome');
  await markImageIntentSent(agentId, ctx, 'pricing');
  await markImageIntentSent(agentId, ctx, 'welcome'); // dedupe

  const after = await getSentImageIntents(agentId, ctx);
  assert(after.includes('welcome'), 'has welcome');
  assert(after.includes('pricing'), 'has pricing');
  assert(after.length === 2, `no duplicates (got ${after.length})`);

  console.log('✅ image sent store OK');
  process.exit(0);
}
main();
