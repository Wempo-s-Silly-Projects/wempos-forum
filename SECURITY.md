# Security Policy

## Reporting a Vulnerability

Use GitHub's Private Vulnerability Reporting or email me @ itswempo@wempos-forum.com

To use private reporting, open
<https://github.com/Wempo-s-Silly-Projects/wempos-forum/security/advisories/new>
(or go to the repository's **Security** tab and press **Report a
vulnerability**). Only I can see what you send.

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
  test account — please leave other members' data out of it);
- the potential impact on members, accounts, private information, or service
  availability.

You do not need to provide every item above for a report to be considered.
If you're unsure whether something is a vulnerability, report it anyway.

### What happens next

I will look at your report, may ask follow-up questions, and
will let you know when a fix is released. This is a small project, so
there's no bug bounty, but the help is truly appreciated, and I’m happy to
credit you in the advisory if you'd like.

## How we respond to a report

I (see [GOVERNANCE.md](GOVERNANCE.md)) handle every report
like this:

1. **Acknowledge.** I confirm I got your report, normally within 14 days,
   usually much sooner.
2. **Triage.** I reproduce the problem and rate how severe it is (critical,
   high, medium, low) from its real impact on members' accounts and data.
   Severity considers confidentiality, integrity, availability, the number
   of affected users or systems, and how realistically the issue could be
   exploited. If it isn't a vulnerability, I explain why.
3. **Fix privately.** I prepare the fix in a private GitHub security
   advisory or a private branch, with a test that fails without the fix.
   All the normal checks still run.
4. **Release.** I ship the fix as a new signed release and deploy it to
   <https://wempos-forum.com>. Critical problems are prioritised and fixed
   as fast as reasonably possible (usually within days). My target is to
   fix medium- and high-severity vulnerabilities within 60 days. If that
   target cannot be met, I will explain why, communicate any available
   mitigations, and provide an updated timeline.
5. **Disclose and credit.** I publish a GitHub security advisory (asking
   for a CVE when it's warranted) and describe the fix in
   [CHANGELOG.md](CHANGELOG.md). I credit the reporter by name or handle
   unless they ask to stay anonymous.
6. **Learn.** I look for the same mistake elsewhere in the code, and update
   the [assurance case](docs/assurance-case.md) if the design has to change.

A CVE is an identifier for a publicly documented vulnerability. Requesting
one does not, by itself, determine the vulnerability's severity.

Self-hosters get fixes by updating to the latest release (see
[Updating later](docs/self-hosting.md#updating-later)).

## Confidentiality

Vulnerability reports and investigation details are treated as confidential.

Information is shared only when reasonably necessary to investigate,
reproduce, remediate, or disclose the reported issue. This may include
sharing relevant information with people or service providers whose
involvement is necessary to resolve the vulnerability, or where disclosure
is required by law.

I aim to avoid unnecessarily exposing reporters, affected members, or
sensitive technical details.

## Coordinated Disclosure

Please coordinate public disclosure with me.

I will work with the reporter towards a reasonable disclosure date after
a fix is available. Earlier disclosure may be agreed upon when appropriate.

I ask reporters to avoid publicly disclosing vulnerability details before
a fix or an agreed disclosure date, so affected members have a reasonable
opportunity to receive protection.

## Verifying a release

Every release since v4.5.0 is a GPG-signed Git tag `vMAJOR.MINOR.PATCH`, with a matching
[GitHub Release](https://github.com/Wempo-s-Silly-Projects/wempos-forum/releases).
The signing key is my Ed25519 key, with fingerprint
`1A72 F3E3 5BD7 E5D0 14B7 B855 5A74 55E7 1384 675E`. The public key is
published by GitHub at <https://github.com/ItsWempo.gpg>. To check a release:

```sh
curl -fsSL https://github.com/ItsWempo.gpg | gpg --import
git fetch --tags
git tag -v v5.30.0   # look for "Good signature" and the fingerprint above
```

**Important:** A valid signature alone does not prove that a signing key
belongs to me. Independently verify the fingerprint through a
trusted channel before trusting the key. Do not rely solely on the key
downloaded from the same location you are using to verify it.

Tags are signed on my own machine. GitHub and the hosting
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

This includes security issues involving authentication, account recovery,
session management, authorisation, private information, shared account data,
and interactions between the forum and Wempo Accounts.

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
