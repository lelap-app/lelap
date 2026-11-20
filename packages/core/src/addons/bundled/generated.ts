// Written by scripts/bundle-addons.mjs from the add-on files in this folder; don't edit it.

export const BUNDLED_FILES: { file: string; sha256: string; manifest: unknown }[] = [
  {
    file: 'emby.js',
    sha256: 'e696178f26b6506e4bef75421fa6ef19314e1f6b4d1e7b4a7604ed14517c31a1',
    manifest: {
      id: 'app.lelap.emby',
      version: '1.0.0',
      protocol: 1,
      protocolVersion: 7,
      name: 'Emby',
      description:
        'Audiobooks on an Emby server, played as the original files. Places are kept with the Emby user.',
      types: ['audiobook'],
      resources: ['library', 'place'],
      catalogs: [],
      sandbox: {
        hosts: [],
      },
      settings: [
        {
          key: 'url',
          label: 'Server address',
          type: 'url',
          required: true,
          host: true,
          placeholder: 'http://192.168.1.20:8096',
          help: 'The address you open Emby at.',
        },
        {
          key: 'user',
          label: 'Username',
          type: 'text',
          required: true,
        },
        {
          key: 'password',
          label: 'Password',
          type: 'password',
          help: 'Stays on this phone. Lelap signs in with it and plays with the token Emby gives back.',
        },
        {
          key: 'apiKey',
          label: 'API key',
          type: 'password',
          help: 'Instead of the password: made in Emby under Settings → API Keys. A key reaches every user’s library, so the password is the better choice.',
        },
        {
          key: 'libraries',
          label: 'Libraries',
          type: 'text',
          placeholder: 'Audiobooks',
          help: 'The libraries to take books from, separated by commas. Every audiobook and book library when left empty.',
        },
      ],
    },
  },
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
  },
  {
    file: 'opds.js',
    sha256: '3d1505c1c7c750b169285be2fc3373c421d6aca3e2cab885f47b70031aef2f1c',
    manifest: {
      id: 'app.lelap.opds',
      version: '1.0.0',
      protocol: 1,
      protocolVersion: 9,
      name: 'OPDS',
      description:
        'The audiobooks in an OPDS catalog, such as a Calibre content server or a library’s open catalog. Ebooks are left out.',
      types: ['audiobook'],
      resources: ['library'],
      catalogs: [],
      sandbox: {
        hosts: [],
      },
      settings: [
        {
          key: 'url',
          label: 'Catalog address',
          type: 'url',
          required: true,
          host: true,
          placeholder: 'http://192.168.1.20:8080/opds',
          help: 'The address of the OPDS feed. For Calibre’s content server, its address with /opds at the end. In the browser the server must allow this site (CORS) and use https.',
        },
        {
          key: 'user',
          label: 'Username',
          type: 'text',
          help: 'Only if the catalog asks for a login.',
        },
        {
          key: 'password',
          label: 'Password',
          type: 'password',
          help: 'Stays on this phone. Sent as HTTP Basic, so use https outside your home network.',
        },
      ],
    },
  },
  {
    file: 'openlibrary-log.js',
    sha256: 'fd8d0d6a6fe1a010490d1f91e1a29ced6b98725e48c939f7ffbaea28b76d0b65',
    manifest: {
      id: 'app.lelap.openlibrary-log',
      version: '1.1.0',
      protocol: 1,
      protocolVersion: 10,
      name: 'Open Library reading log',
      description:
        'Puts the books you start on Currently reading and the ones you finish on Already read in your Open Library reading log.',
      types: ['audiobook'],
      resources: [
        {
          name: 'scrobble',
          events: ['start', 'finish'],
        },
      ],
      catalogs: [],
      sandbox: {
        hosts: ['openlibrary.org'],
      },
      settings: [
        {
          key: 'access',
          label: 'S3 access key',
          type: 'text',
          required: true,
          help: 'From archive.org/account/s3.php, signed in with the account you use on Open Library.',
        },
        {
          key: 'secret',
          label: 'S3 secret key',
          type: 'password',
          required: true,
          help: 'Stays on this phone. The keys also work for the rest of archive.org; to stop the add-on, make new ones on the same page.',
        },
      ],
    },
  },
  {
    file: 'plex.js',
    sha256: '1a1f72b8e34e610cb6eedba7dba795f937951effd7906ef9fb79889c89256a64',
    manifest: {
      id: 'app.lelap.plex',
      version: '1.0.0',
      protocol: 1,
      protocolVersion: 11,
      name: 'Plex',
      description:
        'Audiobooks in the music libraries of your Plex Media Server, played from the server itself. Places are kept with your Plex account.',
      types: ['audiobook'],
      resources: ['library', 'place', 'signin', 'locate', 'settings'],
      catalogs: [],
      sandbox: {
        hosts: ['plex.tv:443'],
      },
      settings: [
        {
          key: 'account',
          label: 'Plex account',
          type: 'signin',
          required: true,
          help: 'You enter a code at plex.tv/link. Lelap never sees your Plex password; the token stays on this device.',
        },
        {
          key: 'server',
          label: 'Server',
          type: 'text',
          help: 'The sign-in fills this in. To use another of your servers, enter its name and sign in again.',
        },
        {
          key: 'url',
          label: 'Address at home',
          type: 'url',
          host: true,
          help: 'The sign-in finds it: the server on your own network.',
        },
        {
          key: 'remote',
          label: 'Address away from home',
          type: 'url',
          host: true,
          help: 'The sign-in finds it when the server can be reached from the internet. Never a Plex relay: audio only comes from your server.',
        },
        {
          key: 'libraries',
          label: 'Libraries',
          type: 'choice',
          multiple: true,
          help: 'The music libraries that hold your audiobooks, listed once you sign in. Every music library with “book” in its name when you pick none.',
        },
      ],
    },
  },
  {
    file: 'subsonic.js',
    sha256: 'da6822d4435cd7e471f9c5b995056f4809c7ca0823baf0ec90910bd750622c80',
    manifest: {
      id: 'app.lelap.subsonic',
      version: '1.0.0',
      protocol: 1,
      protocolVersion: 6,
      name: 'Subsonic',
      description:
        'Audiobooks on Navidrome, Airsonic-Advanced, Gonic or any server that speaks the Subsonic API. Places are kept with the server’s bookmarks.',
      types: ['audiobook'],
      resources: ['library', 'place'],
      catalogs: [],
      sandbox: {
        hosts: [],
      },
      settings: [
        {
          key: 'url',
          label: 'Server address',
          type: 'url',
          required: true,
          host: true,
          placeholder: 'http://192.168.1.20:4533',
          help: 'The address of the server’s web page.',
        },
        {
          key: 'user',
          label: 'Username',
          type: 'text',
          required: true,
        },
        {
          key: 'password',
          label: 'Password',
          type: 'password',
          required: true,
          help: 'Stays on this phone. The server only gets a token made from it.',
        },
        {
          key: 'folder',
          label: 'Music folder',
          type: 'text',
          placeholder: 'Audiobooks',
          help: 'A music folder or library on the server that holds your audiobooks. Every album in it is a book.',
        },
        {
          key: 'genre',
          label: 'Genre',
          type: 'text',
          placeholder: 'Audiobook',
          help: 'Albums with this genre are books; with a music folder, only those in it. Without a music folder, Audiobook when left empty.',
        },
      ],
    },
  },
];
