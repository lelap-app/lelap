# @lelap/netfs

Kotlin Expo module for SMB and SFTP servers on Android (M62). A browser has no raw sockets, so the
web app has none of this.

- SMB 2 and 3 with [smbj](https://github.com/hierynomus/smbj), SFTP with
  [sshj](https://github.com/hierynomus/sshj), both Apache-2.0 from Maven Central, with Bouncy
  Castle (MIT). SMB 1 is not supported.
- Addresses are `smb://host[:port]/share/folder` and `sftp://host[:port]/folder`, built by
  `netRootUri` in `@lelap/core`. The login travels with them in the `X-Lelap-Netfs` header, as a
  WebDAV login does in `Authorization`; it is sealed in the database like the other servers' and
  never sent over HTTP.
- `NetWalk` lists every file below a folder, at most 5,000 folders and 32 levels, with 30 s for
  each request. It skips dot folders and what a NAS keeps for itself (`@eaDir`, `#recycle`).
- `NetDataSource` reads for Media3 at any offset, so seeking costs one request, not a walk from
  the start. `NetDataSource.Factory` hands every other address to the usual data source.
- `SessionPool` shares one logged-in connection per server and login between the player,
  downloads, tags and the cast server, and closes it a minute after its last use.
- SFTP host keys are trusted on first use: `hostKey` asks the server for its key and stops before
  any login is sent; the app shows the fingerprint (`SHA256:…`, as `ssh-keygen -l` prints it) and
  stores it on Connect. Every later connection must show the same key, or it is refused with
  `ERR_NETFS_HOST_KEY_CHANGED`.

`audio`, `download`, `library` and `cast` depend on this module for files with these addresses.

Unit tests run on the JVM, the SFTP ones against an Apache MINA SSHD server inside the test run:

```sh
cd apps/app/android && ./gradlew :lelap-netfs:testDebugUnitTest
```
