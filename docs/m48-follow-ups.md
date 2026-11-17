# M48 follow-ups

Checked in the web preview: the app's web export loads its catalogs from `catalogs/*.json`;
Settings → Language lists English and Bahasa Melayu, and switching redraws the screen in Malay and
back. The landing page at `/` and `/ms/` at desktop width and 375 px: the language switch both
ways, every in-page anchor, no horizontal scroll, reveals on `/ms/`, and every request to the same
origin. The English page's built HTML is the same as before apart from `og:locale`, the `hreflang`
links and the switch.

Covered by tests:

- `apps/app/scripts/check-translations.mjs` (in `pnpm test`), tried on broken catalogs: invalid
  JSON with its line, a missing `@language`, a non-text value, an unused key, different `{holes}`,
  one form of a plural, a stale `template.json` in CI, and Kotlin lines missing from
  `src/nativeText.ts` (or listed there and unused).
- `modules/text/.../NativeCatalogTest.kt`: lookup, holes, English for missing or empty lines,
  saving and reading back.
- `modules/widget/.../ModelsTest.kt`: the widget and tile in Malay, with the book's own title and
  chapter untouched.
- `packages/core/src/settings.test.ts`: any language code is kept, a corrupt one falls back to
  English.
- `apps/site/test/i18n.test.ts`: every line on the Malay page is translated, no unused lines,
  holes and inline tags match.

## Open on a phone

- <a id="native"></a>Switch the profile to Bahasa Melayu, play a book: the notification's buttons
  read “Undur 30 saat”, “Maju 30 saat” and “Pemasa tidur dimatikan” (TalkBack, or a long press on
  a watch or car); Android's notification settings for Lelap list “Kini dimainkan”, and after a
  download and a chapter search also “Muat turun” and “Mencari bab”. Switch back to English: the
  names follow without a restart.
- <a id="widget"></a>With Malay chosen, close the app: the widget reads “Tiada yang dimainkan” or
  the book with “Jeda”/“Main”, and the Quick Settings tile says “Sedang dimainkan” or “Dijeda”.
  Switch the profile to English in the app: both redraw in English.
- <a id="profiles"></a>A Malay kids profile and an English grown-up on one phone: switching
  profiles switches the notification, widget and tile with them.
- <a id="auto"></a>Android Auto (or the Desktop Head Unit) in Malay: the shelves read “Teruskan
  mendengar” and the rest in Malay.
- <a id="downloads"></a>A download in Malay shows “Memuat turun” with “Batal”; finding chapters
  shows “Mencari bab” with “Henti”.

## Translator flow, once on GitHub

- <a id="flow"></a>From an account without write access: edit `catalogs/ms.json` in the browser
  and propose the change; add `catalogs/xx.json` from `template.json`. The pull request's check
  points at the problem lines (annotations need the maintainer to approve the first run for a new
  contributor). The translation issue form shows and files with the `translation` label, which
  may need creating.

## Not translated yet

- Error messages Kotlin passes to the app (a download that failed, a lost cast connection, an
  update that did not install, the “Bluetooth device” fallback name) show in English on every
  language. They need codes from native code that the app translates.
- The widget's name and description in Android's widget picker come from Android resources, so
  they follow the phone's language, not the profile's; they stay English.
- Chapter titles made up from ID3 frames without a title (“Chapter 3”) are saved in English.
- Dates and numbers still follow the device (as in M21).

## For a native speaker's review

Every Malay line is open for review; these are the ones we were least sure of (English → Malay).

Native text:

- “Now playing” (the player's notification channel) → “Kini dimainkan”
- “Wanted books” (channel) → “Buku yang mahu dibaca”
- “Listening for long silences” → “Mendengar senyap panjang”
- “Sleep timer end of chapter” → “Pemasa tidur hujung bab”; “Sleep timer on” → “Pemasa tidur
  dihidupkan”
- “{what}. Opens the player.” → “{what}. Membuka pemain.”
- “Not playing” → “Tidak dimainkan”; “Playing” → “Sedang dimainkan”; “Paused” → “Dijeda”

Landing page:

1. Tagline: “From first chapter to fast asleep.” → “Dari bab pertama hingga tidur lena.”
2. “The open player for audiobooks and podcasts.” → “Pemain terbuka untuk buku audio dan
   podcast.”
3. “A sleep timer that fades” → “Pemasa tidur yang beransur senyap”; “fades out” → “beransur
   senyap”
4. “Offline first” → “Luar talian didahulukan”
5. “The app plays. Add-ons bring the library.” → “Aplikasi memainkan audio. Alat tambah membawa
   pustaka.”
6. “Ships with open sources:” → “Disertakan dengan sumber terbuka:” (may read as open-source
   software)
7. “Built for long listens.” → “Dibina untuk sesi mendengar yang panjang.”
8. “Nothing to look at, by design.” → “Tiada apa-apa untuk kami lihat, memang begitu reka
   bentuknya.”
9. “Cozy and uncanny” → “Damai dan aneh”; “Self-improvement” → “Pembangunan diri”; “Classics” →
   “Klasik”
10. The mock-up's made-up book “Early Mornings at the Laksa Café” → “Pagi-pagi di Kafe Laksa”
11. “a slow loris” → “seekor kongkang”; “Lelap is Indonesian for deep, peaceful sleep” → “Lelap
    ialah perkataan Indonesia untuk tidur yang nyenyak dan tenang”. “lelap” is a Malay word too,
    so “It’s Indonesian for…” may read oddly to Malay readers.
12. “Tap him.” → “Ketik dia.”
13. “Self-host”, “Self-hosted”, “Self-hosting” → “Hos sendiri”
14. “build attestation” → “pengesahan binaan”; “pre-release” → “prakeluaran”; “signed APK” → “APK
    bertandatangan”
15. “credentials” → “butiran log masuk”; “bucket” → “baldi” (as in the app)
16. “chapter-aware scrubbing” → “penggeseran yang mengikut bab”; “pitch correction” → “pembetulan
    pic”
17. “narrators” → “pembaca”; “Covers” → “Kulit buku”; “Trending” → “Sohor kini”
18. Left in English: “Scrobble”, “Metadata”, “Beta”
19. “no lock-in” → “tanpa ikatan”; “no app store” → “tanpa gedung aplikasi”
20. “ciphertext” → “teks sifer”; “end-to-end encrypted” → “disulitkan hujung ke hujung”;
    “Encrypted sync” → “Segerak bersulit”
21. “For people who verify:” → “Bagi yang suka menyemak:”
22. “Contribute” → “Menyumbang”; “FAQ” → “Soalan lazim”; the footer and main navigation labels →
    “Kaki halaman”, “Navigasi utama”
23. “Playing from” → “Dimainkan dari”
24. “{name} is a player.” → “{name} ialah pemain audio.”
25. “Out of the box” → “Secara lalai”
