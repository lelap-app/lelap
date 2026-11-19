---
'@lelap/sdk': minor
---

Protocol revision 11, for add-ons inside the app. A `LibraryResponse` can carry `settings`: new
values for the add-on's own fields, such as a server's new address. The app saves them before it
reads the files; address fields that grant a host change only for add-ons that come with the app.
The new `locate` resource is asked where a book's files are just before it streams
(`LocateRequest`, `LocateResponse`, `locatePath`, `offersLocate`); a file left out streams
without the library's login.
