import type { Part } from '@a2a-js/sdk';
import { Intent } from '@/types/agent';

/**
 * Build the response message parts. Always includes the text part; appends a
 * FilePart per intent image only when an intent with images matched AND the
 * classifier decided to send images this turn.
 */
export function buildResponseParts(
  responseText: string,
  matchedIntent: Intent | null,
  sendImage: boolean
): Part[] {
  const parts: Part[] = [{ kind: 'text', text: responseText }];

  if (matchedIntent?.images?.length && sendImage) {
    for (const img of matchedIntent.images) {
      parts.push({
        kind: 'file',
        file: { uri: img.url, mimeType: img.mimeType },
      });
    }
  }

  return parts;
}
