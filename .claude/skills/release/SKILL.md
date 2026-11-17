---
name: release
description: Use when preparing, tagging or publishing a Lelap release (a beta like v0.2.0-beta.1 or a stable like v0.2.0), when asked to write the changelog or release notes, or when checking that the README, landing page and store text match what is shipped.
---

# Releasing Lelap

A release is a `v*` tag on `main`. `.github/workflows/release.yml` does the building: the signed
APK, the F-Droid APK, `SHA256SUMS`, `latest.json` or `beta.json` on the downloads host, an
over-the-air bundle (only when `apps/app/certs/certificate.pem` is committed), five images on `ghcr.io`, and sync to production. This skill
covers everything around it: choosing the version, writing what changed, and making every
public text match what the tag ships.

**Core rule:** every claim a user can read (README, landing page, store text, changelog) must be
true of the commit being tagged. Check each claim against the code, not against a milestone file
or a previous description.

## What you need to know first

| Fact                 | Where it comes from                                                                                                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Version rules        | `packages/core/src/release.ts`: `vMAJOR.MINOR.PATCH` or `-beta.N`; minor and patch at most 99, beta 1–98. Beta versionCode sits below its stable.                                                                                                  |
| What the tag deploys | APK, OTA, images, and sync to production (beta and stable tags alike: beta apps use it). The web app, catalog, proxy and updates deploy on every merge to `main` already (`web.yml`, `services.yml`), so they are live before the tag.             |
| Site state           | Repository variables `LELAP_BETA` and `LELAP_RELEASED` (read by `site.yml`). `apps/site/src/site.ts` turns them into `site.beta` and `site.released`.                                                                                              |
| SDK                  | Released on its own through Changesets and `sdk.yml`, not by the app tag. See `packages/sdk/README.md`.                                                                                                                                            |
| F-Droid              | Every tag builds an F-Droid APK, but F-Droid itself only picks up stable tags, and only after the recipe in `docs/fdroid/app.lelap.yml` is submitted to fdroiddata. Release notes: `fastlane/metadata/android/en-US/changelogs/<versionCode>.txt`. |
| Who may do what      | You prepare files and a pull request. The user merges, approves the `release` environment, pushes tags and changes repository variables, or tells you in chat to do one of those specific things.                                                  |

## Steps

Keep the task list in this order. Stop and ask where a step says so.

### 1. Pick the version and the range

1. `git fetch --tags origin`, then work from `origin/main` with a clean tree. In a worktree,
   `git switch --detach origin/main` (main is usually checked out elsewhere); otherwise
   `git switch main && git pull`.
2. Last tags: `git tag --sort=-v:refname | head`. There are two ranges:
   - **Notes range** (what the changelog covers): from the previous **stable** tag for a stable
     release, so its notes cover all the betas; from the previous tag of any kind for a beta.
   - **Upgrade range** (native changes, migrations, permissions): always from the **last tag
     users have installed**, beta or stable, since that is what this release replaces.
   - **First stable** (no stable tag yet): the notes range is the whole history. Don't list every
     pull request; write a short “what Lelap does” summary grouped by area, then the fixes since
     the first beta in detail.
3. Propose the next version to the user with one line of why (beta number up, patch for fixes
   only, minor for new features). Check it parses with `parseVersion` rules and the tag doesn't
   exist yet. **Ask before going on.**
4. CI on `main`'s head must be green: `gh run list --branch main --limit 10`.

### 2. Collect what changed

- The first-parent history of `main` is the source of truth:
  `git log --first-parent --format='%h %s' <start>..origin/main`. Merge commits name their pull
  request (`Merge pull request #85 from …`); read each with `gh pr view N --json title,body`.
  Don't filter `gh pr list` by `--base main` or by date: milestone pull requests are stacked on
  each other's branches, so many never had `main` as their base. Commits without a pull request
  were pushed directly; read them too.
- Read the PR bodies, not only the titles. Sort each change into: **New**, **Improved**,
  **Fixed**, **Self-hosting and add-on developers**, **Known issues**. Drop changes users can't
  notice (CI, refactors, docs, tests) unless they matter to self-hosters or add-on authors.
- Look for things that need a line of their own:
  - **Native changes** (upgrade range:
    `git diff --stat <last-tag>..origin/main -- modules/ apps/app/app.json apps/app/app.config.js apps/app/plugins apps/app/package.json`):
    a new native build means the OTA bundle won't reach older APKs; users must install the APK.
  - **App database migrations** (`packages/core/drizzle/`, upgrade range): run on every phone at first start.
    Ask whether an upgrade from the previous release was tested on a phone.
  - **Sync migrations** (`services/sync/migrations/`): every tag, beta or stable, applies them to production.
  - **Permissions** in the Android manifest or `app.json`: users see these; name them.
  - **SDK:** compare `.changeset/*.md` (pending, unreleased changes) with what npm has
    (`npm view @lelap/sdk version`). Pending changesets mean the docs site may already describe
    features `npm install` doesn't give yet; ask whether to release the SDK first. SDK changes
    with no changeset: ask whether one is needed.
- **Open checks:** there are many, so don't list them all. For a stable release, the release
  milestone's “Done when” (`docs/milestones/m40.md`: no open check older than the milestone
  without a reason) is the gate: ask the user whether it holds. Under Known issues, name only
  features a user would try and that are untested on real hardware (for example casting or
  Android Auto when their follow-up checks are open).

### 3. Write the changelog

`CHANGELOG.md` at the repository root (create it on the first release with a one-line intro).
Newest version on top:

```markdown
## 0.2.0 (2026-12-01)

### New

- Sleep timer until the end of the chapter. (#91)

### Fixed

- Downloads no longer restart after the phone reboots. (#95)
```

- Plain English for listeners: what they can now do or what stopped going wrong. No internal
  names (module names, milestone numbers, function names). Link the PR number.
- A stable entry summarises all its betas; keep the beta entries below it.
- Stable only: `fastlane/metadata/android/en-US/changelogs/<versionCode>.txt`, plain text, at most
  500 characters, the highlights of the same entry. `versionCode` from `release.ts` (0.2.0 →
  `20099`).
- Never name piracy-related services, torrent indexes or file hosters, even when describing a
  fix or a refusal (see the hard rules in `AGENTS.md`).

### 4. Make every public text match the release

For each claim, find the code that makes it true. Remove or reword claims that aren't shipped;
add shipped features that a reader would look for.

- **`README.md`:** the status note (installable or not, beta or stable, where to get it), the
  feature list (present tense only for shipped things), the repository layout table's Status
  column, getting-started commands (app as well as site), the Deployment section (everything
  that deploys, not only the site), the license line about the SDK.
- **Landing page** (`apps/site/src/pages/index.astro`): the `features` array, the hero text, the
  “Get it” cards (APK, GitHub Releases, Obtainium, F-Droid, web app, self-hosted), the FAQ, and
  badges such as “Beta” or “Coming soon”. Text inside `!site.released` blocks disappears when
  `LELAP_RELEASED` is set, so for a stable release check the released branch of each condition
  too. Look at it: `preview_start` with `site-beta` or
  `site-released` from `.claude/launch.json`, and screenshot each section that changed.
- **Developer docs** (`apps/site/src/pages/docs/`): protocol and SDK pages match the SDK version
  on npm, not only the workspace (see the SDK check in step 2).
- **Store text:** `fastlane/metadata/android/en-US/full_description.txt` and
  `short_description.txt`, same check as the landing page.
- **F-Droid recipe** (`docs/fdroid/app.lelap.yml`), stable only: `versionName`, `versionCode`
  and `commit` in `Builds`, and `CurrentVersion`, `CurrentVersionCode`. Before the first
  submission, `AllowedAPKSigningKeys` needs the certificate hash; ask the user whether this
  release is the one to submit, and make the landing page's F-Droid card say the same.
- **Project docs:** the status line of the release milestone (`docs/milestones/m40.md` for
  `v0.1.0`) and of any milestone this release finishes; `docs/brief.md` if a decision changed.
  Never edit the table in `docs/roadmap.md`.

### 5. Release pull request

1. Branch `release/vX.Y.Z`, commit the changes above, and run `pnpm format:check`, `pnpm lint`,
   `pnpm check`, `pnpm test` and `pnpm build`. Paste failures; don't tag over them.
2. Open a pull request titled `Release vX.Y.Z` whose body is the changelog entry plus a short
   list of the checks from step 2 (native build or not, migrations, open checks).
3. **Stop.** The user reviews and merges.

### 6. Tag and publish (only after the user says so)

1. On the merge commit of `main`:
   `git tag -a vX.Y.Z -m "Lelap X.Y.Z" && git push origin vX.Y.Z`. Run this only after the user
   tells you in chat to tag; otherwise give them the two commands.
2. Remind the user to approve the `release` environment in the Actions run. Then follow it with
   `gh run watch` in the background.
3. Replace the generated notes with the changelog entry:
   `gh release edit vX.Y.Z --notes-file <file with the entry>`.
4. Check what went out:
   - `curl -s https://dl.<domain>/beta.json` (and `latest.json` for stable) shows the new
     version, and its `url` downloads.
   - `gh release view vX.Y.Z` lists both APKs, `SHA256SUMS` and `release.json`.
   - The images exist: `docker manifest inspect ghcr.io/lelap-app/web:X.Y.Z`.
5. Site state: the first beta needs `LELAP_BETA=true`; the first stable needs
   `LELAP_RELEASED=true`. Then rerun the site deploy (`gh workflow run site.yml`). Changing a
   repository variable is the user's call: ask, and run `gh variable set` only on their yes.
6. Update the milestone status line with what is out, in a small follow-up pull request.

## Common mistakes

| Mistake                                                  | Instead                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Changelog written from PR titles                         | Read the bodies; titles say what changed in code, not for the listener.              |
| Feature listed because its milestone file says “done”    | Find the code path, or check the follow-up file for open checks.                     |
| Stable notes that only cover the last beta               | Range from the previous stable tag.                                                  |
| README still says “nothing to install yet”               | The status note changes with every first: first beta, first stable, F-Droid listing. |
| Tagging before the release PR is merged                  | The tag must point at a commit on `main` that contains the changelog.                |
| Promising an update “over the air” after a native change | Native changes need the new APK; say so in the notes.                                |
| Hard-coding `lelap.app` in new site or app text          | Hosts come from `site.ts` or the domain variable.                                    |
