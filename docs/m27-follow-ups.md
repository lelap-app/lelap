# M27 follow-ups

Checks that need a phone or a deployed add-on; nothing here blocks the merge.

## Device checks

1. **Deep link from a configure page.** Run the template (`wrangler dev --ip 0.0.0.0`), add it,
   tap Configure, pick an order and Save. Android should switch back to Lelap from the browser or
   Custom Tab on the `303` to `lelap://addon?manifest=…`, show "Update Template?", and the catalog
   should follow the chosen order.
2. **Cold start through the link.** With the app closed, open a `lelap://addon?manifest=…` link
   (for example `adb shell am start -a android.intent.action.VIEW -d '<link>'`). The profile gate
   and the confirmation must not hide each other.
3. **Dismissing the dialog.** Tap outside the "Add …?" dialog: the `/addon` screen should go back to
   Add-ons, not spin forever.
4. **Web app.** On the web build, Configure must open in a new tab and come back to `/addon` when
   the add-on lists the web app's origin in `returnOrigins`; without it, the configured page shows
   the URL to paste.
5. **Health.** Turn the add-on's server off, open Settings → Add-ons: the dot should turn red with
   "The add-on could not be reached". Turn it back on and tap Check now.
6. **Kids profile.** Opening the link under a kids profile shows "Ask a grown-up".

## Later

- Scrobble posts use their own poster, so they don't feed the health view yet.
- Health is kept in memory per run; persisting it (or showing a history) would need a table.
- The first-party scrobble add-ons seal their own settings; they could move to the SDK's
  `configure` once it covers their OAuth flows.
