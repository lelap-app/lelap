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
 * Turns the audio files of a library folder into books. Rules: the spec's “Turning a folder into
 * books”.
 */
export function groupIntoBooks(
  rootLocation: string,
  files: ScannedFile[],
  folderCovers: Map<string, string>,
): BookDraft[] {
  const locate = (relPath: string) =>
    relPath === '' ? rootLocation : `${rootLocation}/${relPath}`;

  const byFolder = new Map<string, ScannedFile[]>();
  for (const file of files) {
    if (!isAudioFile(file.name)) continue;
    const folder = parentOf(file.relPath);
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), file]);
  }

  // Disc folders (`Book/CD 1`, `Book/CD 2`) fold into their parent when it has no audio of its
  // own and every audio subfolder is a disc.
  const bookFolderOf = new Map<string, string>();
  for (const folder of byFolder.keys()) {
    const parent = parentOf(folder);
    const siblings = [...byFolder.keys()].filter((f) => f !== '' && parentOf(f) === parent);
    const isDiscSet =
      folder !== '' &&
      parent !== '' &&
      !byFolder.has(parent) &&
      siblings.every((f) => DISC_FOLDER.test(baseName(f)));
    bookFolderOf.set(folder, isDiscSet ? parent : folder);
  }

  const folders = new Map<string, ScannedFile[]>();
  for (const [folder, folderFiles] of byFolder) {
    const target = bookFolderOf.get(folder) ?? folder;
    folders.set(target, [...(folders.get(target) ?? []), ...folderFiles]);
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
          coverPath: file.coverPath ?? folderCovers.get(locate(folder)) ?? null,
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
      coverPath:
        sorted.find((f) => f.coverPath)?.coverPath ?? folderCovers.get(locate(folder)) ?? null,
      files: sorted,
    });
  }

  return books.sort((a, b) => compareNatural(a.location, b.location));
}
