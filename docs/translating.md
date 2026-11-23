# Translating Wempo's Forum

Wempo's Forum is free software, and its translations are made by volunteers.
This guide covers where to translate, how the locale files work, the style
to keep, and where help is needed most. Maintainers will find the
translation platform setup at the end.

## Where to translate

- **Hosted Weblate** (once the project is live):
  `https://hosted.weblate.org/projects/wempos-forum/`. Hosted Weblate is a
  free software translation platform. Its free "Libre" plan is for free
  software projects. Sign in, pick your language and translate in the
  browser. Weblate sends your work back to this repository as a pull request.
- **A GitHub pull request** works too. Edit the file for your language in
  `public/locales/` (for example `public/locales/de.json`) and open a pull
  request against `main`. Read [CONTRIBUTING.md](../CONTRIBUTING.md) first.

Both routes land in the same files and pass the same tests.

## How the files work

- `public/locales/en.json` is the English source. Every other
  `public/locales/<code>.json` file is one language.
- Each file is one flat JSON object. The keys are dotted names such as
  `"twofa.secret"`, and the values are the text people see. The dots are
  part of the key name. They do not mean nesting.
- **Every key in `en.json` must exist in every locale, and no locale may
  have extra keys.** Each value must be a non-empty string.
- **`{placeholders}` must match exactly.** If English says
  `"{author} — hidden post (until {when})"`, your text must contain
  `{author}` and `{when}`, spelled the same. Move them wherever your grammar
  needs them, but never rename, translate or drop them.
- **Values must really be translated.** The test suite rejects a locale
  where more than 8% of the values are identical to English (the
  `MAX_ENGLISH_SHARE` check in `tests/i18n.test.mjs`). Some identical values
  are fine, such as brand names or "GIF". A copied English file is not.
- **Plurals.** Countable text has a `.one` key and an `.other` key, for
  example `counts.threads.one` and `counts.threads.other`. `tn()` in
  `public/js/i18n.js` picks the form for the count with the browser's
  `Intl.PluralRules`. `tn()` can also read `.few` and `.many` forms for
  languages that have them (Slavic counts, for example). The key-set check
  above still requires exactly the keys in `en.json`, so do not add a `.few`
  or `.many` key on your own. Until a maintainer adds those keys, make the
  `.other` text work for every count above one. Croatian, Serbian and Slovak
  do this with a label form such as `"Tema: {count}"`.
- **Serbian has two files.** `sr.json` is Cyrillic and is the one to edit.
  `sr-Latn.json` is the Latin form, generated from `sr.json` by
  transliteration (`tests/helpers/serbian-script.mjs`). Never edit
  `sr-Latn.json` by hand. `tests/serbian-scripts.test.mjs` fails if it
  drifts from `sr.json`.

Run the tests before you open a pull request:

```sh
pnpm install
pnpm test
```

## Style

- **Keep the forum's tone:** friendly, plain and short. Match how people
  talk on a small community forum in your language, not a legal document.
  Keep one form of address (for example informal *ti* or formal *vi*)
  across the whole file. The review found pages that switch mid-screen.
- **Don't translate brand names.** "Wempo's Forum", "Wempo Accounts",
  "WemposClaude", "GIF", "YouTube" and file format names stay as they are.
- **Don't change `{placeholder}` names.** See above.
- **Security wording must be precise.** These are different things, and
  each needs its own word in your language:
  - **password**: what you type to sign in;
  - **passphrase**: a password made of several words (the forum can suggest
    one);
  - **secret**: the two-factor (TOTP) setup key that your authenticator app
    stores;
  - **passkey**: a device-held sign-in key that replaces the password;
  - **recovery code** (backup code): a one-time code for when you lose your
    authenticator.

  Never use the same word for two of these. Keep words such as "only",
  "anyway" and "may not". In a security warning they carry the meaning.
- **Translate what the English says now.** If the English string changed,
  re-translate it. Don't keep an older meaning.

## Where help is needed most

A back-translation review of the rarer locales (forum v5.81.0, 2026-11-22)
found these problems. Some may be fixed by the time you read this, so check
the current file first.

**Top 10 fixes** (security wording first):

1. `security.humanCheckFailed` is stale in all 35 reviewed locales, and in
   es, fr and de. The English now says the human-verification **check
   failed**. The translations still say the widget **did not load**.
   Re-translate it from the current English.
2. **fil** `twofa.introOn` drops "only" ("lang"), so the warning reads as
   permission.
3. **fa** renders the TOTP secret as `رمز`, which Persian readers take as
   "password". Suggested: `کلید مخفی` (twofa.secret, currentPasswordHelp,
   introOff, introOn, setupNote).
4. **ny** `twofa.introOn` drops "only", and the words for password and
   secret are nearly the same.
5. **ak** uses the same word for the password and the TOTP secret
   (introOn, currentPasswordHelp).
6. **ce** `twofa.generateWarn` may invert the meaning. A native check is
   needed.
7. **hr** `security.suggestPassphrase` says "suggest a password"
   ("zaporka"), so the idea of a passphrase is lost.
8. **sr** mixed Cyrillic and Latin within one page. Serbian is now split
   into `sr` (Cyrillic) and the generated `sr-Latn`. Check that `sr.json` is
   fully Cyrillic.
9. **my** `safety.linkWarningContinue` drops "anyway", so the escape button
   on the link warning reads as the normal path. bi and ab have similar
   problems.
10. **be** (and **bs** `counts.threads.other`): the `.other` plural is wrong
    for 2 to 4. Use the label form described under Plurals.

Also worth a native check: **cv** renders "two-factor" as words that read as
"two hundred".

**Low-confidence locales.** In these, the reviewer read the language poorly.
Flags there are pointers, and "no flag" does not mean the text is right. A
native speaker's full pass is the most valuable help:

`aa` (Afar), `ab` (Abkhaz), `ak` (Akan), `av` (Avaric), `ay` (Aymara),
`bi` (Bislama), `bm` (Bambara), `ce` (Chechen), `ch` (Chamorro, which also
has 5 untranslated English keys), `cv` (Chuvash), `ny` (Chichewa).

The review only read the security, safety, two-factor, fun and count
strings by hand. Profiles, the composer and the rest of the site are not
reviewed in any locale.

## Maintainers: setting up the Weblate component

Use these settings when you create the project on Hosted Weblate:

| Setting | Value |
|---|---|
| Plan | Libre (free, for free software projects) |
| Source code repository | this GitHub repository, branch `main` |
| Version control system | GitHub pull request (Weblate pushes to its own branch and opens a PR against `main`; it never pushes to `main` directly) |
| File format | **JSON file** (Weblate id `json`, flat key/value). Not "JSON nested structure file": the keys are flat dotted strings, and a nested format would split them at the dots. |
| File mask | `public/locales/*.json` |
| Monolingual base language file | `public/locales/en.json` |
| Template for new translations | `public/locales/en.json` |
| Source language | English |
| Language code style | BCP style using hyphen (to match `zh-Hans`, `zh-Hant` and `sr-Latn`) |
| Language filter | exclude `sr-Latn`, for example `^(?!sr-Latn$).*` |

- **`sr-Latn` stays out of Weblate.** It is generated from `sr.json` by
  transliteration, so translators edit only `sr`. A maintainer regenerates
  `sr-Latn.json` when `sr.json` changes.
- **Weblate's pull requests go through the same CI as any other.** The full
  `pnpm test` suite must pass, including the key-set, placeholder
  and `MAX_ENGLISH_SHARE` checks in `tests/i18n.test.mjs` and the Serbian
  script check. Merge only green pull requests.
- Turn off any Weblate add-on that removes or reorders keys. The key set is
  owned by `en.json` in this repository.
