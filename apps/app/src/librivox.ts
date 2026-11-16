type Part = { url: string; title: string };
type Section = { section_number: string; title: string; listen_url: string };
type Book = { title: string; sections: Section[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSection(value: unknown): value is Section {
  return (
    isRecord(value) &&
    typeof value.section_number === 'string' &&
    typeof value.title === 'string' &&
    typeof value.listen_url === 'string'
  );
}

function isBook(value: unknown): value is Book {
  return (
    isRecord(value) &&
    typeof value.title === 'string' &&
    Array.isArray(value.sections) &&
    value.sections.every(isSection)
  );
}

/** Fetches a LibriVox book's parts in reading order. Audio streams straight from archive.org. */
export async function fetchLibriVoxBook(id: string): Promise<{ title: string; parts: Part[] }> {
  const notFound = new Error(`LibriVox book ${id} not found`);
  const response = await fetch(
    `https://librivox.org/api/feed/audiobooks/?id=${encodeURIComponent(id)}&format=json&extended=1`,
  );
  if (!response.ok) throw notFound;
  const body: unknown = await response.json();
  const book = isRecord(body) && Array.isArray(body.books) ? body.books[0] : undefined;
  if (!isBook(book)) throw notFound;
  const parts = [...book.sections]
    .filter((section) => section.listen_url !== '')
    .sort((a, b) => Number(a.section_number) - Number(b.section_number))
    .map((section) => ({
      url: section.listen_url,
      title: `${section.section_number}. ${section.title}`,
    }));
  if (parts.length === 0) throw notFound;
  return { title: book.title, parts };
}
