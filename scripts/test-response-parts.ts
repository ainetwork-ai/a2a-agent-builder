import { buildResponseParts } from '../src/lib/responseParts';
import { Intent } from '../src/types/agent';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('❌', msg); process.exit(1); }
}

const withImages: Intent = {
  name: 'pricing', description: 'd', prompt: 'p',
  images: [
    { url: 'https://b/1.png', mimeType: 'image/png' },
    { url: 'https://b/2.jpg', mimeType: 'image/jpeg' },
  ],
};

// text + images when matched, has images, sendImage true
let parts = buildResponseParts('hello', withImages, true);
assert(parts.length === 3, `text + 2 images (got ${parts.length})`);
assert(parts[0].kind === 'text', 'first is text');
assert(parts[1].kind === 'file', 'second is file');
const fp = parts[1] as { file: { uri: string; mimeType?: string } };
assert(fp.file.uri === 'https://b/1.png', 'file uri');
assert(fp.file.mimeType === 'image/png', 'file mimeType');

// sendImage false -> text only
parts = buildResponseParts('hello', withImages, false);
assert(parts.length === 1 && parts[0].kind === 'text', 'sendImage false -> text only');

// no matched intent -> text only
parts = buildResponseParts('hello', null, true);
assert(parts.length === 1 && parts[0].kind === 'text', 'no intent -> text only');

// matched but no images -> text only
parts = buildResponseParts('hello', { name: 'x', description: 'd', prompt: 'p' }, true);
assert(parts.length === 1 && parts[0].kind === 'text', 'no images -> text only');

console.log('✅ response parts OK');
