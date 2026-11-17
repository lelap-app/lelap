# M35 follow-ups

Covered by tests: the permission list (catalogs, streams, scrobble, settings in the address, http,
host), picking the best square cover, and the SDK serving `artwork`. Checked in the web preview:
see the PR.

Open:

- No first-party add-on serves artwork yet; try it with a small add-on from the SDK template
  (`createAddon({ artwork })`) and an item without a cover.
- On a phone: the install sheet scrolls on a small screen, and the amber lines are readable.
- An add-on installed before this version shows “What it can do” from its menu.
