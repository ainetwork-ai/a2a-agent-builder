import { buildSelectedIntentSection } from '../src/lib/promptBuilder';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('❌', msg); process.exit(1); }
}

const section = buildSelectedIntentSection({
  name: 'pricing',
  description: 'when asked about price',
  prompt: 'Explain the pricing tiers clearly.',
});

assert(section.includes('Explain the pricing tiers clearly.'), 'contains intent prompt');
assert(!section.includes('when asked about price') || section.includes('pricing'),
  'may reference name/desc but must carry the prompt');
assert(section.trim().length > 0, 'non-empty');

console.log('✅ selected intent section OK');
