import { compareNatural, isAudioFile, type ScannedFile, stripExtension } from './files';

export type BookDraft = {
  location: string;
  kind: 'folder' | 'file';
  title: string;
  author: string | null;
  coverPath: string | null;
  /** In play order. */
  files: ScannedFile[];
};

const DISC_FOLDER = /^(cd|disc|disk|part|del)\s*\d+$/i;

/** Marks the `Lelap` folder that downloads go to in a folder the listener chose. */
export const DOWNLOADS_MARKER = '.lelap-downloads';

function parentOf(relPath: string): string {
  const slash = relPath.lastIndexOf('/');
  return slash < 0 ? '' : relPath.slice(0, slash);
}

function baseName(relPath: string): string {
  return relPath.slice(relPath.lastIndexOf('/') + 1);
}

function sortFiles(files: ScannedFile[]): ScannedFile[] {
  return [...files].sort((a, b) => compareNatural(a.relPath, b.relPath));
}

/**
 * Leaves out Lelap's own downloads when the download folder sits inside the library folder: they
 * are in the library already, as the books they were downloaded for.
 */
export function withoutDownloads<F extends { name: string; relPath: string }>(files: F[]): F[] {
  const folders = files.filter((f) => f.name === DOWNLOADS_MARKER).map((f) => parentOf(f.relPath));
  if (folders.length === 0) return files;
  return files.filter(
    (f) => !folders.some((folder) => folder === '' || f.relPath.startsWith(`${folder}/`)),
  );
}

/**
 * Turns the audio files of a library folder into books. Rules: the spec's “Turning a folder into
 * books”.
 */
export function groupIntoBooks(
  rootLocation: string,
  files: ScannedFile[],
  folderCovers: Map<string, string>,
  /** Covers from images named after an audio file, by the audio file's location. */
  fileCovers: Map<string, string> = new Map(),
): BookDraft[] {
  const locate = (relPath: string) =>
    relPath === '' ? rootLocation : `${rootLocation}/${relPath}`;

  const byFolder = new Map<string, ScannedFile[]>();
  for (const file of withoutDownloads(files)) {
    if (!isAudioFile(file.name)) continue;
    const folder = parentOf(file.relPath);
    const list = byFolder.get(folder);
    if (list) list.push(file);
    else byFolder.set(folder, [file]);
  }

  // Disc folders (`Book/CD 1`, `Book/CD 2`) fold into their parent when it has no audio of its
  // own and every audio subfolder is a disc.
  const onlyDiscsUnder = new Map<string, boolean>();
  for (const folder of byFolder.keys()) {
    if (folder === '') continue;
    const parent = parentOf(folder);
    const disc = DISC_FOLDER.test(baseName(folder));
    onlyDiscsUnder.set(parent, (onlyDiscsUnder.get(parent) ?? true) && disc);
  }
  const bookFolderOf = (folder: string) => {
    const parent = parentOf(folder);
    const isDiscSet =
      folder !== '' &&
      parent !== '' &&
      !byFolder.has(parent) &&
      onlyDiscsUnder.get(parent) === true;
    return isDiscSet ? parent : folder;
  };

  const folders = new Map<string, ScannedFile[]>();
  for (const [folder, folderFiles] of byFolder) {
    const target = bookFolderOf(folder);
    const list = folders.get(target);
    if (list) list.push(...folderFiles);
    else folders.set(target, [...folderFiles]);
  }

  const authorFromFolders = (folder: string): string | null => {
    const parent = parentOf(folder);
    return folder !== '' && parent !== '' ? baseName(parent) : null;
  };
  const tagAuthor = (file: ScannedFile | undefined) => file?.albumArtist ?? file?.artist ?? null;

  const books: BookDraft[] = [];
  for (const [folder, folderFiles] of folders) {
    const sorted = sortFiles(folderFiles);
    const allChaptered = sorted.length > 1 && sorted.every((f) => f.chapters.length > 0);

    if (folder === '' || allChaptered) {
      for (const file of sorted) {
        books.push({
          location: file.location,
          kind: 'file',
          title: file.album ?? stripExtension(file.name),
          author: tagAuthor(file) ?? (folder === '' ? null : baseName(folder)),
          coverPath:
            file.coverPath ??
            fileCovers.get(file.location) ??
            folderCovers.get(locate(folder)) ??
            null,
          files: [file],
        });
      }
      continue;
    }

    const albums = new Set(sorted.map((f) => f.album));
    const [onlyAlbum] = albums;
    books.push({
      location: locate(folder),
      kind: 'folder',
      title: albums.size === 1 && onlyAlbum != null ? onlyAlbum : baseName(folder),
      author: tagAuthor(sorted[0]) ?? authorFromFolders(folder),
      // An embedded picture, then the first part's own image, then the folder's.
      coverPath:
        sorted.find((f) => f.coverPath)?.coverPath ??
        (sorted[0] && fileCovers.get(sorted[0].location)) ??
        folderCovers.get(locate(folder)) ??
        null,
      files: sorted,
    });
  }

  return books.sort((a, b) => compareNatural(a.location, b.location));
}
