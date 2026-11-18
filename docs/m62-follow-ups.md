# M62 follow-ups

Checked against real servers on this Mac, in Docker (Samba 4 from `dperson/samba` on port 1445,
OpenSSH from `linuxserver/openssh-server` on port 2222, two books made with `say` and `ffmpeg`), from
the JVM: the SMB walk found all four files of both books, read a range from the middle of an MP3
and called a wrong password a refused login and a missing share not found; SFTP showed the
server's Ed25519 key with the same fingerprint `ssh-keyscan | ssh-keygen -l` printed, then listed
the books with the password and that key.

Not checked on the Android emulator: the release APK built and installed, but the emulator
(`Medium_Phone_API_37.0`) stalled under the load. Its package and activity services kept dying,
also after a reboot, before Lelap's first screen. So nothing here has run inside the app yet.

Covered by tests: addresses in both directions (`@lelap/core` builds them, Kotlin reads them, with
spaces, `#`, `?` and `+` in names; `..` refused), logins sealed in the database, the bounded walk
(5,000 folders, 32 levels, NAS folders like `@eaDir` and `#recycle` skipped, links followed once,
broken ones left out), 64 KB block reads across block ends, the connection pool (shared, closed a
minute after its last use, a broken one closed and replaced, nothing closed while in use),
downloads that continue a part file, start again when the part is too long and stop for good on a
refused login. Against an SFTP server inside the test run (Apache MINA SSHD): host key fingerprint
before any login, listing and range reads with a password, a PEM private key with a passphrase (a
wrong one is told apart), a changed and an untrusted host key refused, a refused login told apart
from a server that is down.

Open on a phone:

- <a id="synology"></a>Synology: Settings → Add a server → SMB, `smb://<nas>/<share>/Audiobooks`
  with a DSM user: books appear with titles, covers (embedded and `cover.jpg`) and chapters.
- <a id="play"></a>An SMB book plays, seeks far ahead at once, keeps its place, and plays on with
  the screen off and the app swiped away.
- <a id="download"></a>An SMB book downloads, also one that waits for Wi-Fi, and plays in airplane
  mode.
- <a id="sftp"></a>SFTP with a password: “Test connection” shows the host key; it matches
  `ssh-keygen -l -f /etc/ssh/ssh_host_ed25519_key.pub` on the server; Connect adds the books.
- <a id="key"></a>SFTP with a private key, pasted and picked as a file, with and without a
  passphrase.
- <a id="changed"></a>Change the server's host key (or point the address at another server): the
  next scan leaves the books as they are and Settings says the key changed; a book from it does
  not play, and a download stops with the same message.
- <a id="password"></a>Change the share's password: Settings shows “The server refused the login”
  with Log in; logging in again keeps books and places.
- <a id="cast"></a>Cast an SMB book and an SFTP book to a UPnP speaker and a Chromecast: the phone
  serves the files, seeking works.
- <a id="windows"></a>A Windows 11 share with a Microsoft account and with a local account, and
  `DOMAIN\name` on a domain.
- <a id="qnap"></a>QNAP and Samba on a Raspberry Pi.
- <a id="web"></a>The web app: Add a server → SMB or SFTP says it is in the Android app only.

## From the review

Fixed before merging: a read-ahead buffer for the player (Media3 reads a few hundred bytes at a
time, each a round trip); a folder the login can't read is left out of the scan instead of failing
it as a refused login; refused logins are not retried by the player and not tried again for five
minutes, and a wrong SFTP password costs one attempt, not two; a seek that interrupts a read keeps
the shared connection; the whole `DOMAIN\name` for SFTP; host certificates left out so the
fingerprint is the key's; a part file of another version starts again; no SMB or SFTP login on a
web cover's request.

Left for later:

- A download's `job.json` keeps the login headers (now also an SFTP private key) in app-private,
  never-backed-up storage until the download is removed, as WebDAV's did; it could drop them once
  every file is done. The playback journal keeps them while the book is loaded.
- The first SFTP connection replaces Android's cut-down "BC" security provider with the full Bouncy
  Castle for the whole process (added last, so TLS keeps Conscrypt). Nothing else in the app asks
  for "BC" by name today.
- The pool's per-server handshake gates are never removed; one small object per server and login.
- A book that can't play because of a refused login or a changed key shows the player's usual
  error; the reason is in Settings after the next scan, and in a download's error.
