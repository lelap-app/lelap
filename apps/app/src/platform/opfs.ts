// The origin private file system, where the web build keeps downloads. Paths look like
// `/downloads/<bookId>/<name>`, the same shape as on Android.

export const DOWNLOADS_DIR = '/downloads';

async function dirAt(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
  let dir = await navigator.storage.getDirectory();
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
  return dir;
}

const split = (path: string) => path.split('/').filter((p) => p !== '');

export async function directory(path: string, create = false): Promise<FileSystemDirectoryHandle> {
  return dirAt(split(path), create);
}

export async function fileHandle(path: string, create = false): Promise<FileSystemFileHandle> {
  const parts = split(path);
  const name = parts.pop();
  if (!name) throw new Error(`Not a file path: ${path}`);
  return (await dirAt(parts, create)).getFileHandle(name, { create });
}

export async function readFile(path: string): Promise<File> {
  return (await fileHandle(path)).getFile();
}

export async function exists(path: string): Promise<boolean> {
  try {
    await fileHandle(path);
    return true;
  } catch {
    return false;
  }
}

export async function remove(path: string): Promise<void> {
  const parts = split(path);
  const name = parts.pop();
  if (!name) return;
  try {
    await (await dirAt(parts, false)).removeEntry(name, { recursive: true });
  } catch {
    // Already gone.
  }
}

/** Names of the entries in a folder, or none when it does not exist. */
export async function list(path: string): Promise<string[]> {
  try {
    const dir = await directory(path);
    const names: string[] = [];
    // `keys()` is in every browser with OPFS, but not yet in TypeScript's DOM types.
    for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) {
      names.push(name);
    }
    return names;
  } catch {
    return [];
  }
}
