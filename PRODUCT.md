# Product

> **Scope.** This brief describes this repository's product, the gated BeOnEdge
> investing app, for design work and design tooling. Copy, money-display and
> accessibility rules live in [RULES.md](RULES.md#product-copy-and-accessibility),
> and decisions live in tally (`docs/records/`); this file points to them rather
> than repeating them. The public education site `beonedge.in` is a separate
> application. Its old brief is archived in
> `release_manager/docs/Completed/PRODUCT-beonedge-in-2026-09.md`.

## Register

product

## Users

- **Clients**: existing BeOnEdge investors whose account an admin opened, either
  by approving an application sent from `beonedge.in` or by creating the client
  directly. They come to see what they hold, what it is worth and what changed.
- **Admins**: BeOnEdge staff who approve applications, create clients, record
  investments and value updates, manage funds, maturities and client email, and
  answer support requests.

## Product Purpose

The app lets a client see their investments with BeOnEdge accurately and calmly,
and lets admins keep that record right. Success is a client who trusts the
screen because it is correct, current and says where a figure came from, and an
admin who records and corrects the book quickly and without mistakes.

There are four surfaces, each designed and checked on its own terms (DEC-40):

| Surface | Delivered as |
| --- | --- |
| Client on a phone | client Android APK |
| Client in a browser | `app.beonedge.in` |
| Admin on a phone | admin Android APK |
| Admin in a browser | console reached only over Tailscale (DEPLOY.md) |

Reference widths (DEC-56): client phone 360 and 390; client web 768, 1280 and
1440; admin phone 390; admin web 1280, 1440 and 1920. Fixes go client phone
first, then client web, admin web and admin phone.

Online payments and AutoPay stay disabled until the maintainer resumes them
(DEC-14, DEC-22); investments enter the ledger when an admin records them. No
surface carries bank details, payment methods or payment instructions (DEC-25).

## Brand Personality

Today's BeOnEdge identity, kept and refined per surface rather than replaced
(DEC-45): premium, institutional, precise. The voice is a calm, credible guide:
plain, exact and confident without hype. A client should leave steadied and
informed, never rushed or talked down to.

## Anti-references

- Trading-app hype: neon gains, rockets, countdowns, urgency.
- Gatekept, jargon-heavy banking screens that make an investor feel shut out.
- A new visual direction. The work refines the existing design system in
  `frontend_stack_ts/src/ui/` (DEC-45); it does not replace it.
- Screens that turn a failed read into zeros, blanks or an endless skeleton.

## Design Principles

- **Money truth first.** Show a figure with its source and freshness, or say
  plainly that it could not be loaded (RULES.md rule 4).
- **Refine, don't reinvent.** Compose the existing tokens, primitives, patterns
  and recipes (DEC-45, RULES.md rule 12).
- **Each surface on its own terms.** Phone and web are laid out separately, not
  stretched or shrunk from each other (DEC-40), and checked at the widths above.
- **Deliberate actions.** A change to money, accounts or records is an explicit
  step, and a retry never silently repeats it (RULES.md rule 6).
- **Keep the boundary.** Nothing private reaches the public site.

## Accessibility & Inclusion

WCAG 2.2 AA, as RULES.md "Product, copy, and accessibility" sets out. Treat plain
language, readable type and generous touch targets as part of accessibility on
every surface, phone and web alike.
