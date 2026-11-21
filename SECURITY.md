# Security Policy
## Reporting a Vulnerability

Use GitHub's Private Vulnerability Reporting or email me @ itswempopolytoria@proton.me

To use private reporting, open
<https://github.com/Wempo-s-Silly-Projects/wempos-forum/security/advisories/new>
(or go to the repository's **Security** tab and press **Report a
vulnerability**). Only the maintainers can see what you send.

**Please don't open a public issue, pull request, or forum post for a security
bug.** Report it privately first so it can be fixed before anyone else learns
about it.

### What to include

The more of this you can share, the faster it gets fixed:

- what the problem is and what someone could do with it;
- where it is (the page, the `/api/...` route, or the file in this repo);
- step-by-step instructions to reproduce it;
- what you expected to happen and what actually happened;
- any proof-of-concept, screenshots or request examples (made with your own
  test account — please leave other members' data out of it).

### What happens next

The maintainers will look at your report, may ask follow-up questions, and
will let you know when a fix is released. This is a small hobby project, so
there's no bug bounty, but the help is truly appreciated, and we're happy to
credit you in the advisory if you'd like.

## Supported Versions

Only the **latest deployed release** is supported. The forum runs as a single
hosted site, so a fix reaches everyone at once; there are no older versions to
patch. The live version is shown at <https://wempos-forum.com/api/version>.

## Scope

In scope:

- the forum at <https://wempos-forum.com>
- Wempo Accounts at <https://accounts.wempos-forum.com>
- the code in this repository

Out of scope:

- problems in Cloudflare's own platform (report those to Cloudflare);
- denial-of-service or load testing against the live site;
- spam, social engineering, or physical attacks;
- automated scanner output without a real, working issue behind it.

## Testing responsibly

Please test with your own accounts, don't access or change other members'
data, and stop and report as soon as you've confirmed a problem. Running the
forum locally (see [CONTRIBUTING.md](CONTRIBUTING.md)) is the safest way to
dig in.
