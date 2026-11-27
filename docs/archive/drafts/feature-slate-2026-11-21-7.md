# Feature slate — wave 2026-11-21-7 (forum side)

Two small, member-delighting features for the posts/threads side. Both are
client-only, need no migration, send nothing new over the network, and store
nothing. Neither duplicates anything already shipped (drafts, mention
autocomplete, catch-up, glance, group DMs, DM images, effects, spoilers,
preview, language picker, copy link, text size, pinned chats, lobby reply,
chat filter).

## F2 — Thread-author chip ("Author")

On a thread page, replies written by the member who started the thread get a
small "Author" chip next to their name (hover: "Started this thread").

- Why: in a warm, chatty community, threads turn into back-and-forths. Telling
  the original poster's follow-ups ("fixed it, thanks!") from the crowd
  is the most common forum ask, and it costs nothing.
- Harmless: built from `author.id` values the post payload already carries.
  It reveals nothing new, because the root card already shows who started the
  thread. A removed account yields no chip.
- Where: `public/js/thread-starter.js`. It is applied in `routes/post.js` on
  first paint, on "load older replies", and on expanded sub-replies.
- Rejected alternative: a join-anniversary cake. The join date is not in any
  public payload, and exposing it would widen collection (visibility law /
  "limit collection" posture).

## F3 — Read aloud ("Read aloud" / "Stop reading")

Every post and reply card gets a speaker toggle that reads the post out using
the browser's speech engine. Press it again to stop. Speech also stops on
navigation.

- Why: it helps members with low vision, dyslexia or tired eyes, and anyone
  who wants to listen to a long post while doing something else.
- Privacy (FSF posture): only voices the browser reports as on-device
  (`localService === true`) are ever used. Some browsers offer network voices
  that would send the text to a third party; those are refused. With no
  on-device voice, a status says so and nothing is spoken. Speech only starts
  on an explicit click and is never on by default.
- Kind: spoilers (`||…||`) and quoted text from others are never read out.
  Markdown marks are dropped.
- Accessible: a real `<button>` with `aria-pressed` and a label that flips
  between "Read aloud" and "Stop reading". The polite `role="status"` region
  is mounted empty, so its message is announced.
- Where: `public/js/read-aloud.js`, mounted in `render.js` and stopped in
  `app.js` `renderRoute`. Browsers without speech get no button.

## Tests

`tests/forum-delights.test.mjs` covers the pure helpers, the fake-DOM toggle
behavior, refusal of network voices, idempotent chips, and the mount pins.
