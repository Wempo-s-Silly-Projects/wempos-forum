# Governance

Wempo's Forum is a small hobby project with **one maintainer**. This page
says how decisions get made, who does what, and what happens if that one
person disappears. It describes how things really are today, gaps included.

## How decisions are made

The project uses a **single-maintainer model** (sometimes called "benevolent
dictator"). The maintainer, **ItsWempo** (GitHub
[@ItsWempo](https://github.com/ItsWempo)), owns the repository, the
`Wempo-s-Silly-Projects` GitHub organization and the hosted site at
<https://wempos-forum.com>, and makes the final call on:

- what gets built, merged and released;
- the roadmap ([ROADMAP.md](ROADMAP.md));
- security fixes and disclosures ([SECURITY.md](SECURITY.md));
- moderation of the project's own spaces under the
  [Code of Conduct](CODE_OF_CONDUCT.md).

Anyone can take part in a decision. Open an issue, a pull request or a GitHub
Discussion, or post in the forum's **Suggestions** board, and the maintainer
answers there in public. Big or hard-to-reverse choices are written down in
[CHANGELOG.md](CHANGELOG.md) and, for project-wide rules, in
[docs/decisions.md](docs/decisions.md).

**Disagreements.** If you disagree with a decision, say so on the issue or
pull request and explain why. The maintainer will reply with the reasoning.
Since there is one maintainer, their decision is final, but a decision can
always be reopened with new information.

## AI-assisted development

Much of the code, tests and documentation is written with AI coding agents
(Claude Code), working under the maintainer's direction; many past commits
carry a `Co-Authored-By: Claude Code` trailer. Automated review bots (for example
CodeRabbit, Sourcery, Aikido and Codacy) comment on changes too.

None of these are project members. They don't make decisions, and they don't
count as a second person for review or continuity. The maintainer is
responsible for everything that gets merged and released, whoever or
whatever drafted it.

## Roles and responsibilities

| Role | Who | Responsibilities |
|---|---|---|
| **Maintainer** (also owner, release manager and security contact) | ItsWempo | Sets direction and the roadmap; reviews and merges changes; cuts releases (version bump, CHANGELOG, signed `vX.Y.Z` tag, GitHub Release) and deploys them; applies database migrations; holds the deploy credentials and production secrets; triages issues; handles private vulnerability reports per [SECURITY.md](SECURITY.md); enforces the Code of Conduct. |
| **Contributor** | Anyone | Proposes changes through issues and pull requests that follow [CONTRIBUTING.md](CONTRIBUTING.md): tests included, `pnpm test` and `pnpm lint` passing, license headers in place. |
| **Forum staff** (admins and moderators on the hosted site) | Appointed by the owner on the site | Moderate the community at wempos-forum.com, as described in the [admin guide](docs/admin-guide.md). This role is about running the community. It doesn't give any rights over the code or releases. |

Today the maintainer does every task in the first row. No one else holds
those responsibilities.

## Continuity and bus factor

The project's **bus factor is 1**: if the maintainer suddenly became
unavailable, development and releases would stop. This is the plain truth,
and it is the project's biggest weakness.

What exists today:

- **The code can't be lost.** The full history, every tag and every release
  is public on GitHub under AGPLv3-or-later. Anyone can fork the project and
  keep it going, and [docs/self-hosting.md](docs/self-hosting.md) explains how
  to run your own copy from scratch.
- **The steps are written down.** Releasing ([docs/release-checklist.md](docs/release-checklist.md)),
  versioning ([CONTRIBUTING.md](CONTRIBUTING.md#versioning)), migrations and
  deploys ([docs/architecture.md](docs/architecture.md)) are all documented,
  so a successor wouldn't have to work them out again.
- **Account recovery.** The maintainer's GitHub and hosting accounts have
  their providers' normal recovery options.

What is missing:

- **No second person** with documented authority to create and close issues,
  accept changes, and cut releases if the maintainer is gone.
- **The hosted site's credentials** (the Cloudflare account and the owner-held
  secrets, such as the password pepper) are held only by the maintainer. If
  they were lost, the hosted site couldn't be redeployed under its current
  domain within a week. A fork could be deployed, but existing passwords
  can't be checked without the original pepper.

Fixing this means adding a second trusted maintainer with organization owner
rights, plus a sealed, documented hand-over of the hosting credentials. That
is on the [roadmap](ROADMAP.md). Until then, the project does **not** meet
the "continue within a week" bar for access continuity.

## Changing this document

The maintainer changes this file through a normal pull request, and the
change is recorded in CHANGELOG.md.
