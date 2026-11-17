# M16 follow-ups

Checked in the web preview: a smart list from a preset, editing its rule, tags from a book's menu
and the tag chips in the Library. Covered by tests: tags, lists, smart rules, sync of both, and
export and import between two databases.

Open on a phone:

- Long press on a book opens the menu sheet; tags and “Add to a list…” work, and so do Download,
  Remove download and “This is a podcast…”, which moved from the old dialog into the sheet.
- A hand-made list keeps its order after moving books up, and after a sync to a second device.
- Settings → Backup → Export opens the share sheet with the JSON; saving it to Files or Drive and
  importing it on another phone (or after reinstalling) brings back places, lists and tags.
- Import offers the add-ons from the file and adds them only after “Add them”; a kids profile
  never sees that question.
- A large library (a few hundred books) exports and imports without freezing the UI.

Notes:

- Local books are named by their path inside the chosen folder, so an import only finds them after
  the same folder is chosen on the new phone (and scanned). Import again after choosing it.
- The export holds add-on addresses, which can contain keys for those add-ons; the Settings text
  says to keep the file private. Server passwords are not exported.
- Android shares the export as text (as OPML does); a “save as file” picker can replace that later.
