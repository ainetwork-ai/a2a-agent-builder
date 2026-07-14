import { validateImageUpload, MAX_IMAGE_BYTES } from '../src/lib/imageUploadValidation';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('❌', msg); process.exit(1); }
}

assert(validateImageUpload('image/png', 1000).ok === true, 'png ok');
assert(validateImageUpload('image/jpeg', 1000).ok === true, 'jpeg ok');
assert(validateImageUpload('image/webp', 1000).ok === true, 'webp ok');
assert(validateImageUpload('image/gif', 1000).ok === true, 'gif ok');

const bad = validateImageUpload('application/pdf', 1000);
assert(bad.ok === false, 'pdf rejected');

const tooBig = validateImageUpload('image/png', MAX_IMAGE_BYTES + 1);
assert(tooBig.ok === false, 'oversized rejected');

console.log('✅ image upload validation OK');
