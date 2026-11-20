import { describe, expect, it } from 'vitest';

import {
  LATEST_PROTOCOL_VERSION,
  MultiPartStream,
  StreamPart,
  WebStreamResponse,
} from './protocol';

// Revision 12 (M136): a stream part may carry its transcripts, as a feed's `podcast:transcript`.

const part = { url: 'https://example.org/01.mp3', durationMs: 1000 };
const transcript = { url: 'https://example.org/01.txt', type: 'text/plain', language: 'en' };

describe('revision 12', () => {
  it('is the newest revision', () => {
    expect(LATEST_PROTOCOL_VERSION).toBe(12);
  });

  it('reads a part’s transcripts', () => {
    expect(StreamPart.parse({ ...part, transcripts: [transcript] }).transcripts).toEqual([
      transcript,
    ]);
    const bare = StreamPart.parse({
      ...part,
      transcripts: [{ url: transcript.url, type: 'text/vtt' }],
    });
    expect(bare.transcripts?.[0]?.language).toBeUndefined();
  });

  it('drops a list that does not fit, not the part', () => {
    for (const transcripts of [
      [{ url: 'ftp://example.org/01.txt', type: 'text/plain' }],
      [{ url: transcript.url }],
      Array.from({ length: 11 }, () => transcript),
      'https://example.org/01.txt',
    ]) {
      const parsed = StreamPart.parse({ ...part, transcripts });
      expect(parsed.transcripts).toBeUndefined();
      expect(parsed.url).toBe(part.url);
    }
  });

  it('keeps a stream without transcripts as it was', () => {
    const stream = { sourceKey: 'k', name: 'Example', parts: [part] };
    expect(MultiPartStream.parse(stream).parts[0]).toEqual(part);
    const response = WebStreamResponse.parse({
      streams: [{ ...stream, parts: [{ ...part, transcripts: [transcript] }] }],
    });
    const parsed = response.streams[0];
    expect(parsed && 'parts' in parsed ? parsed.parts[0]?.transcripts : null).toEqual([transcript]);
  });
});
