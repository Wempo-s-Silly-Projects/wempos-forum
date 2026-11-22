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

## How we respond to a report

The maintainer (see [GOVERNANCE.md](GOVERNANCE.md)) handles every report
like this:

1. **Acknowledge.** We confirm we got your report, normally within 14 days,
   usually much sooner.
2. **Triage.** We reproduce the problem and rate how severe it is (critical,
   high, medium, low) from its real impact on members' accounts and data. If
   it isn't a vulnerability, we explain why.
3. **Fix privately.** We prepare the fix in a private GitHub security
   advisory or a private branch, with a test that fails without the fix. All
   the normal checks still run.
4. **Release.** We ship the fix as a new signed release and deploy it to
   <https://wempos-forum.com>. Critical problems are fixed as fast as we can
   (usually within days). Any problem of medium severity or worse is fixed
   within 60 days.
5. **Disclose and credit.** We publish a GitHub security advisory (asking
   for a CVE when it's warranted) and describe the fix in
   [CHANGELOG.md](CHANGELOG.md). We credit the reporter by name or handle
   unless they ask to stay anonymous.
6. **Learn.** We look for the same mistake elsewhere in the code, and update
   the [assurance case](docs/assurance-case.md) if the design has to change.

Self-hosters get fixes by updating to the latest release (see
[Updating later](docs/self-hosting.md#updating-later)).

## Verifying a release

Every release since v4.5.0 is a GPG-signed Git tag `vX.Y.Z`, with a matching
[GitHub Release](https://github.com/Wempo-s-Silly-Projects/wempos-forum/releases).
The signing key is the maintainer's Ed25519 key, with fingerprint
`1A72 F3E3 5BD7 E5D0 14B7  B855 5A74 55E7 1384 675E`. The public key is
published by GitHub at <https://github.com/ItsWempo.gpg>. To check a release:

```sh
curl -s https://github.com/ItsWempo.gpg | gpg --import
git fetch --tags
git tag -v v5.30.0   # look for "Good signature" and the fingerprint above
```

Tags are signed on the maintainer's own machine. GitHub and the hosting
platform hold only the public key.

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
