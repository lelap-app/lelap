// Written by scripts/bundle-addons.mjs from the add-on files in this folder; don't edit it.

export const BUNDLED_FILES: { file: string; sha256: string; manifest: unknown; code: string }[] = [
  {
    file: 'http-folder.js',
    sha256: '1afc35740c879f9458a909b1095323e57a84fb34d345ed0a393b1fce7d4ebaef',
    manifest: {
      id: 'app.lelap.http-folder',
      version: '1.0.0',
      protocol: 1,
      protocolVersion: 5,
      name: 'HTTP folder',
      description:
        'Audiobooks in a folder a web server lists: nginx, Apache, Caddy or any server with directory listing on.',
      types: ['audiobook'],
      resources: ['library'],
      catalogs: [],
      sandbox: {
        hosts: [],
      },
      settings: [
        {
          key: 'url',
          label: 'Folder address',
          type: 'url',
          required: true,
          host: true,
          placeholder: 'http://192.168.1.20:8080/audiobooks/',
          help: 'The address that shows the folder’s list of files in a browser.',
        },
        {
          key: 'user',
          label: 'Username',
          type: 'text',
          help: 'Only if the server asks for a login.',
        },
        {
          key: 'password',
          label: 'Password',
          type: 'password',
        },
      ],
    },
    code: "/* global addon, lelap */\n// Bundled with Lelap (M57): audiobooks in a folder that a web server lists, such as nginx with\n// `autoindex on` (HTML or `autoindex_format json`), Apache's directory index, Caddy's\n// `file_server browse` or `python3 -m http.server`. It runs in the app's sandbox and can reach\n// only the address the listener enters. A login, when given, is sent as HTTP Basic.\n\nconst AUDIO = /\\.(mp3|m4a|m4b|aac|ogg|oga|opus|flac|wav)$/i;\nconst IMAGE = /\\.(jpe?g|png|webp)$/i;\nconst MAX_FOLDERS = 2000;\nconst MAX_FILES = 50000;\n\nfunction basic(user, password) {\n  // btoa takes bytes: UTF-8 first, so a name with ø or é works.\n  const bytes = new TextEncoder().encode(user + ':' + password);\n  let binary = '';\n  for (const byte of bytes) binary += String.fromCharCode(byte);\n  return 'Basic ' + btoa(binary);\n}\n\nfunction folderUrl(address) {\n  const url = new URL(address);\n  url.search = '';\n  url.hash = '';\n  if (!url.pathname.endsWith('/')) url.pathname += '/';\n  return url;\n}\n\nfunction decode(segment) {\n  try {\n    return decodeURIComponent(segment);\n  } catch {\n    return segment;\n  }\n}\n\n/** A direct child of `folder`: its name and whether it is a folder; null for anything else. */\nfunction child(href, folder) {\n  let url;\n  try {\n    url = new URL(href, folder);\n  } catch {\n    return null;\n  }\n  // Sort links (`?C=N;O=D`), other servers and the parent folder are not children.\n  if (url.search || url.origin !== folder.origin) return null;\n  if (!url.pathname.startsWith(folder.pathname) || url.pathname === folder.pathname) return null;\n  const rest = url.pathname.slice(folder.pathname.length);\n  const isFolder = rest.endsWith('/');\n  const raw = isFolder ? rest.slice(0, -1) : rest;\n  if (raw === '' || raw.includes('/')) return null;\n  const name = decode(raw);\n  if (name === '.' || name === '..' || name.includes('/')) return null;\n  url.hash = '';\n  return { url, name, folder: isFolder };\n}\n\n/** One folder's entries, from nginx's JSON listing or any HTML page of links. */\nfunction entries(text, type, folder) {\n  if (/json/i.test(type || '')) {\n    const list = JSON.parse(text);\n    if (!Array.isArray(list)) return [];\n    return list.flatMap((entry) => {\n      if (!entry || typeof entry.name !== 'string') return [];\n      const isFolder = entry.type === 'directory';\n      const href = encodeURIComponent(entry.name) + (isFolder ? '/' : '');\n      const found = child(href, folder);\n      if (!found) return [];\n      const modified = Date.parse(entry.mtime || '');\n      return [\n        {\n          ...found,\n          size: Number.isSafeInteger(entry.size) && entry.size >= 0 ? entry.size : undefined,\n          modifiedAt: Number.isFinite(modified) ? modified : undefined,\n        },\n      ];\n    });\n  }\n  const out = [];\n  const seen = new Set();\n  for (const match of text.matchAll(/href\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')/gi)) {\n    const href = (match[1] ?? match[2] ?? '').replace(/&amp;/g, '&');\n    const found = child(href, folder);\n    if (!found || seen.has(found.url.href)) continue;\n    seen.add(found.url.href);\n    out.push(found);\n  }\n  return out;\n}\n\nasync function list(settings) {\n  const root = folderUrl(settings.url);\n  const headers = settings.user\n    ? { Authorization: basic(settings.user, settings.password || '') }\n    : {};\n  const files = [];\n  const queue = [{ url: root, path: '' }];\n  const seen = new Set();\n  while (queue.length > 0) {\n    const { url, path } = queue.shift();\n    if (seen.has(url.href) || seen.size >= MAX_FOLDERS) continue;\n    seen.add(url.href);\n    const response = await lelap.fetch(url.href, { headers });\n    // A folder that can't be read fails the whole listing, so no book is marked missing for it.\n    if (!response.ok)\n      throw new Error(`The server answered HTTP ${response.status} for ${url.pathname}.`);\n    const text = await response.text();\n    for (const entry of entries(text, response.headers.get('content-type'), url)) {\n      const entryPath = path ? `${path}/${entry.name}` : entry.name;\n      if (entry.folder) {\n        queue.push({ url: entry.url, path: entryPath });\n      } else if ((AUDIO.test(entry.name) || IMAGE.test(entry.name)) && files.length < MAX_FILES) {\n        files.push({\n          path: entryPath,\n          url: entry.url.href,\n          ...(entry.size === undefined ? {} : { size: entry.size }),\n          ...(entry.modifiedAt === undefined ? {} : { modifiedAt: entry.modifiedAt }),\n        });\n      }\n    }\n  }\n  return { files, ...(headers.Authorization ? { headers } : {}) };\n}\n\naddon({\n  manifest: {\n    id: 'app.lelap.http-folder',\n    version: '1.0.0',\n    protocol: 1,\n    protocolVersion: 5,\n    name: 'HTTP folder',\n    description:\n      'Audiobooks in a folder a web server lists: nginx, Apache, Caddy or any server with directory listing on.',\n    types: ['audiobook'],\n    resources: ['library'],\n    catalogs: [],\n    sandbox: { hosts: [] },\n    settings: [\n      {\n        key: 'url',\n        label: 'Folder address',\n        type: 'url',\n        required: true,\n        host: true,\n        placeholder: 'http://192.168.1.20:8080/audiobooks/',\n        help: 'The address that shows the folder’s list of files in a browser.',\n      },\n      {\n        key: 'user',\n        label: 'Username',\n        type: 'text',\n        help: 'Only if the server asks for a login.',\n      },\n      { key: 'password', label: 'Password', type: 'password' },\n    ],\n  },\n  library: (args) => list(args.settings || {}),\n});\n",
  },
];
