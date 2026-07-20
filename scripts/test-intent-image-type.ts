import { Intent, IntentImage } from '../src/types/agent';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('❌', msg); process.exit(1); }
}

const img: IntentImage = { url: 'https://bucket/x.png', mimeType: 'image/png' };
const intent: Intent = {
  name: 'welcome',
  description: 'greeting',
  prompt: 'say hi',
  images: [img],
};

// JSON round-trip preserves images (mirrors intentStore set/get)
const round = JSON.parse(JSON.stringify(intent)) as Intent;
assert(round.images?.length === 1, 'images survives round-trip');
assert(round.images![0].url === 'https://bucket/x.png', 'url preserved');
assert(round.images![0].mimeType === 'image/png', 'mimeType preserved');

// images is optional — an intent without it is still valid
const bare: Intent = { name: 'x', description: 'y', prompt: 'z' };
assert(bare.images === undefined, 'images optional');

console.log('✅ intent image type OK');
