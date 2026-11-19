---
'@lelap/sdk': minor
---

Protocol revision 11, for add-ons inside the app. A `LibraryResponse` can carry `settings`: new
values for the add-on's own fields, such as a server's new address. The app saves them before it
reads the files; address fields that grant a host change only for add-ons that come with the app.
The new `locate` resource is asked where a book's files are just before it streams
(`LocateRequest`, `LocateResponse`, `locatePath`, `offersLocate`); a file left out streams
without the library's login.

Revision 11 also adds `choice` settings, a list to pick from instead of a name to type. A
`SettingField` of type `choice` has its own `options` (`ChoiceOption`: `value`, `label`,
`detail`), or the add-on lists the `settings` resource and answers `SettingsOptions` at
`settingsPath()` with the form's values so far, such as a server's libraries after signing in.
With `multiple` the value is the picked values, one per line: `choiceValues` splits it,
`choiceOptions` merges both kinds of options, and `offersSettingOptions` says whether the app asks.
`readSettings` checks fixed options. `lelap-sdk check` warns of a choice field without revision
11, a `settings` resource that no field needs and a choice with one option.
