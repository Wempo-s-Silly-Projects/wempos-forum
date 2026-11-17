# License pass ledger — wempos-forum

The per-repo record of the AGPLv3 program: COPYING/README landings, per-file
notice passes, and the ruled coordinated pairs. Rows carry the SHAs the
reviewer (and every future audit) traces back through. The GooberCord twin of
this file carries the same pair row with both SHAs.

## wempos-forum

| SHA | Step | Verification |
| --- | --- | --- |
| c8df23b | Ruled allow-list extension, forum side: FORUM_PROJECT/GOOBER_PROJECT named constants + the forum half of the once-per-file token bound in license-parity.test.mjs | suite green at the zero-failure baseline |
| 63f2e7a | COPYING (rename of the hand-wrap-drifted LICENSE) + README gains the license block, section 13 line, all-permissive notice; the project token "Wempo's Forum." on record | gnu.org canonical cmp-identical to GC's committed COPYING |
| c5e5bb3 | 77-file per-file notice pass on the non-twin code (+18 insert-only) | suite exit 0, zero failures, before and after |
| 54c52a5 | Forum twin-header: the five parity-locked files noticed (partner = GooberCord a04a96b) | GC's contract-parity + messages-module gates green post-pair |

## The ruled coordinated twin-header pair

| Side | Twin files | SHA | Named partner |
| --- | --- | --- | --- |
| wempos-forum | api/core/auth.mjs, passwords.mjs, totp.mjs, images.mjs, api/filter.mjs | 54c52a5 | GooberCord a04a96b |
| GooberCord | api/core/auth.mjs, passwords.mjs, totp.mjs, images.mjs, api/filter.mjs | a04a96b | wempos-forum 54c52a5 |

Law of the pair: the substitution allow-list carries the project-name pair as
named constants (forum: "Wempo's Forum", GC: "GooberCord" — the tokens come
from each repo's own COPYING/README wording, never invented); the notices are
byte-identical across the twin copies except each repo's own project-token
line; each twin carries its own token exactly once per file, asserted in the
extension commits (forum c8df23b, GC 027fc28) while tokens were absent
(no-op) and forever after (red on duplication or rebrand); exactly one repo's
gate held transient-red between the two header commits (GC's).

## Straddling copies

wempo-accounts api/filter.mjs (third twin of the same body) took its notice
in 3102c49 with its own project token; its body remains byte-identical to the
twin body.

## The __Host- cookie-prefix rename wave (lead-ruled coordinated pair)

| Side | Touched files | SHA | Named partner |
| --- | --- | --- | --- |
| wempos-forum | api/core/auth.mjs (pin-locked byte-twin), api/session.mjs, worker.mjs, 4 test fixture files, tests/cookie-prefix.test.mjs (new) | 4299fe2 | GooberCord a8f28bf |
| GooberCord | api/core/auth.mjs (byte-identical after substitution), api/accounts.mjs, public/js/main.js wiring, fixture files, contract-parity rider re-aim | a8f28bf | wempos-forum 4299fe2 |

Shape: the write path answers ONLY `__Host-` + the repo's own session name
with `; Secure` unconditional (the RFC 6265bis prefix contract); the READ
path accepts the legacy bare name for exactly one transitional cycle; a
legacy hit on a live row self-migrates — `session.migrateCookies` re-issues
the SAME token under the prefixed name (remaining TTL) plus clears the bare
name (Max-Age=0), zero DB writes — and each repo's boot-GET attach carries
the pair. Verification: byte-identity of the twin file holds under the
substitution map (FORUM_DB, wempo_session, "Wempo's Forum") — GC a8f28bf ==
vendorize(forum 4299fe2:api/core/auth.mjs), re-verified from both sides;
suites same-wave green (forum 208/208 at 4299fe2, GC 1132/1132 at a8f28bf);
GC's contract-parity rider re-aimed in a8f28bf to the wave's content-anchored
markers, all four passing against the forum bytes.

Dead-limb record: a conformance attempt (67f3257, built from the peer's
STAGED-but-unpushed rider bytes, WeakMap era) diverged from the canonical
shape and re-red the gate; reverted publicly in 99a914d (no history
rewrite). Law codified by the gate chair for every future coordinated wave:
BUILD ONLY FROM COMMITTED SHAs — staged-but-unpushed peer bytes are a rumor
until pushed; iteration rides commit + push, in the lane that owns the
bytes. The legacy-read fallback and its attach are a NAMED cleanup row
(chair-called) once a full cycle's ledger shows zero legacy reads.
