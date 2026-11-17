# M37 follow-ups

Checked in the web preview: a new kids profile starts with an empty Library even when the grown-up
has books; “Put on a kid’s shelf…” from the grown-up's book menu puts a book there and the kid then
sees it (with their own place); the kid's Podcasts tab has no feed field and Settings has no
Servers, Backup, People or Sync. Covered by tests: shelf filtering, local books only through the
shelf, the shelf hidden from the kid's own lists.

Open on a phone:

- With local audiobooks in the chosen folder, a kids profile's Library and Home show none of them
  until a grown-up shelves one; Android Auto (M17) and the widget (M25) follow the same rule.
- A shelf set on the phone appears on a second synced device, and removing a book from the shelf
  there removes it here.
- With a PIN on the grown-up profile, the kid can't switch to it.
- A book the kid started from the LibriVox catalog stays in their Library after a restart.
