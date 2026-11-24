// The web reads transcripts through the proxy, which keeps them for a day; nothing is kept here.

export const savedTranscript = (): Promise<string | null> => Promise.resolve(null);

export const hasSavedTranscript = (): boolean => false;

export function saveTranscript(): void {}

export function dropTranscripts(): void {}

/** Whether transcripts are kept with downloads on this platform. */
export const KEEPS_TRANSCRIPTS = false;
