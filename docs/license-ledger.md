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
