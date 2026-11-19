/* global addon, lelap */
// A Lelap add-on that runs inside the app (protocol revision 3). It reads a `books.json` from a
// server on your own network and offers those books with their files. Install it in Lelap under
// Settings → Library and sources → Add-ons by pasting the address of this file; change BASE and `sandbox.hosts` to your
// server first. The app lets it reach only the hosts in `sandbox.hosts`.
//
// books.json: [{ "id": "secret-garden", "title": "…", "author": "…", "cover": "http://…/cover.jpg",
//   "parts": [{ "url": "http://…/01.mp3", "title": "Chapter 1", "durationMs": 1234000 }] }]

var BASE = 'http://192.168.1.20:8080';

function load() {
  return lelap.fetch(BASE + '/books.json').then(function (response) {
    if (!response.ok) throw new Error('books.json answered ' + response.status);
    return response.json();
  });
}

function find(id) {
  return load().then(function (books) {
    return (
      books.filter(function (b) {
        return 'shelf:' + b.id === id;
      })[0] || null
    );
  });
}

addon({
  manifest: {
    id: 'org.example.homeshelf',
    version: '1.0.0',
    protocol: 1,
    protocolVersion: 3,
    name: 'Home shelf',
    description: 'Audiobooks listed in books.json on a server at home.',
    types: ['audiobook'],
    resources: ['catalog', 'meta', 'stream'],
    idPrefixes: ['shelf:'],
    catalogs: [{ type: 'audiobook', id: 'all', name: 'Home shelf' }],
    sandbox: { hosts: ['192.168.1.20:8080'] },
  },
  catalog: function () {
    return load().then(function (books) {
      return {
        metas: books.map(function (b) {
          return {
            id: 'shelf:' + b.id,
            type: 'audiobook',
            name: b.title,
            author: b.author,
            cover: b.cover,
          };
        }),
      };
    });
  },
  meta: function (args) {
    return find(args.id).then(function (b) {
      return (
        b && {
          meta: { id: args.id, type: 'audiobook', name: b.title, author: b.author, cover: b.cover },
        }
      );
    });
  },
  stream: function (args) {
    return find(args.id).then(function (b) {
      return {
        streams: b ? [{ sourceKey: 'home-shelf:' + b.id, name: 'Home shelf', parts: b.parts }] : [],
      };
    });
  },
});
