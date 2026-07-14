import { parseFormIntentResponse } from '../src/lib/formIntentClassifier';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('❌', msg); process.exit(1); }
}

let r = parseFormIntentResponse('INTENT: pricing\nSEND_IMAGE: yes');
assert(r.intent === 'pricing', 'parses intent name');
assert(r.sendImage === true, 'parses sendImage yes');

r = parseFormIntentResponse('INTENT: NONE\nSEND_IMAGE: no');
assert(r.intent === null, 'NONE -> null');
assert(r.sendImage === false, 'sendImage no');

r = parseFormIntentResponse('INTENT: welcome\nSEND_IMAGE: NO');
assert(r.intent === 'welcome' && r.sendImage === false, 'case-insensitive no');

r = parseFormIntentResponse('garbage with no fields');
assert(r.intent === null && r.sendImage === false, 'garbage -> {null,false}');

r = parseFormIntentResponse('INTENT:   Spaced Name  \nSEND_IMAGE: yes');
assert(r.intent === 'Spaced Name', 'trims intent name');

console.log('✅ form intent parser OK');
