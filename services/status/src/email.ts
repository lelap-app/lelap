import type { Change } from './store';
import { duration, utc } from './page';

/** Header values come from configuration: never let one start a new header. */
const oneLine = (text: string) => text.replace(/[\r\n]+/g, ' ').trim();

function encodeHeader(text: string): string {
  const line = oneLine(text);
  if (/^[\x20-\x7e]*$/.test(line)) return line;
  const bytes = new TextEncoder().encode(line);
  return `=?UTF-8?B?${btoa(String.fromCharCode(...bytes))}?=`;
}

export function subjectOf(changes: Change[]): string {
  const [first] = changes;
  if (changes.length === 1 && first)
    return `Lelap status: ${first.name} is ${first.up ? 'up again' : 'down'}`;
  const down = changes.filter((c) => !c.up).length;
  return `Lelap status: ${changes.length} changes, ${down} down`;
}

export function bodyOf(changes: Change[], now: number, page?: string): string {
  const lines = changes.map((c) =>
    c.up
      ? `${c.name} is up again, after ${duration(c.lastedMs)} down.`
      : `${c.name} is down${c.error ? `: ${oneLine(c.error)}` : ''}. It was up for ${duration(c.lastedMs)}.\n  ${c.url}`,
  );
  return [`At ${utc(now)}:`, '', ...lines, ...(page ? ['', page] : []), ''].join('\n');
}

/** A plain-text message for Email Routing's `send_email` binding, which takes raw MIME. */
export function rawMessage(
  from: string,
  to: string,
  changes: Change[],
  now: number,
  page?: string,
) {
  const domain = from.split('@')[1] ?? 'localhost';
  return [
    `From: Lelap status <${oneLine(from)}>`,
    `To: ${oneLine(to)}`,
    `Subject: ${encodeHeader(subjectOf(changes))}`,
    `Date: ${new Date(now).toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${oneLine(domain)}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    bodyOf(changes, now, page).replace(/\r?\n/g, '\r\n'),
  ].join('\r\n');
}
