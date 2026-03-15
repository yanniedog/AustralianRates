# Beta Tester Checklists

## Contents

1. Coverage discovery
2. Page review
3. Flow review
4. Cross-cutting quality checks
5. Improvement lenses

## 1. Coverage Discovery

Build the inventory before the review. Look for:

- Primary nav, footer nav, breadcrumbs, sidebars, hamburger menus
- `sitemap.xml`, `robots.txt`, HTML sitemaps, RSS/XML feeds
- Internal links in body copy, cards, CTAs, promo banners, related-content sections
- Search results, filtered views, pagination, tag/category pages
- Forms, modals, drawers, accordions, tabs, and carousels
- Auth states, onboarding, account settings, logout, password reset, email verification
- Empty states, validation errors, 404 pages, server errors, loading states, success confirmations
- Desktop and mobile layouts, plus any obviously different tablet behavior

Track coverage in a simple inventory:

- URL or state
- How it was discovered
- Tested or blocked
- Notes

## 2. Page Review

For every page, check:

- Purpose: Is the page's purpose obvious within a few seconds?
- Content: Is the copy accurate, current, consistent, and easy to scan?
- Navigation: Is it clear where to go next and how to go back?
- Layout: Does the hierarchy guide attention correctly?
- Visual polish: Are spacing, alignment, typography, imagery, and states consistent?
- Functionality: Do links, buttons, forms, filters, sorting, tabs, and media work?
- Responsiveness: Does the page still work cleanly on a small viewport?
- Accessibility: Is there obvious keyboard/focus trouble, poor contrast, missing labels, or confusing semantics?
- Trust: Are there missing disclaimers, outdated details, broken legal/privacy links, or weak credibility cues?
- Performance clues: Does anything feel slow, jumpy, blocked, or visually unstable?
- SEO basics: Does the page have clear headings, meaningful titles, and crawlable content?

## 3. Flow Review

For each important flow, check:

- Entry point is easy to find
- Steps are understandable
- Back/forward movement is safe
- Validation messages are specific and helpful
- Success state is clear
- Failure state is recoverable
- Cross-page context is preserved where expected
- Mobile interaction remains usable

Important flow types:

- Homepage to key conversion action
- Search or browse to detail page
- Form submission
- Signup/login/logout/reset if present
- Checkout/booking/application if present
- Content discovery loops
- Support/contact/report-a-problem flow

## 4. Cross-Cutting Quality Checks

Look for patterns that recur across the site:

- Inconsistent CTA labeling
- Repeated copy errors or stale information
- Broken image handling
- Unclear pricing, policies, or eligibility rules
- Focus indicators missing on shared components
- Reused components behaving differently without reason
- Visual hierarchy collapsing on mobile
- Dead-end pages with no next action
- Analytics-dark behavior such as silent failures or missing confirmations

## 5. Improvement Lenses

Even when pages technically work, evaluate:

- Clarity: Can a first-time visitor understand the offer and next step?
- Friction: What slows users down or forces unnecessary effort?
- Confidence: What would make the site feel more credible and safer?
- Accessibility: What changes would materially improve inclusiveness?
- Conversion: What reduces motivation to continue?
- Content design: What text is too vague, dense, repetitive, or jargon-heavy?
- Information architecture: Which sections are hard to find or wrongly grouped?
- Delight/polish: What feels unfinished, brittle, or generic?

When suggesting improvements, prefer this format:

- Current issue
- Why it matters
- Exact change to make
- Expected benefit
