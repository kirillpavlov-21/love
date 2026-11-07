# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People in Moscow and Saint Petersburg deciding where to go today: inviting someone on a date, going out with friends, or going alone (including introverts choosing for themselves). The job is to decide quickly without being overwhelmed by choice. Confirmed by the owner, 2026-11-07.

They arrive in two equally important ways (confirmed 2026-11-07): the website in a mobile browser (often from search) and the Telegram Mini App opened from the bot.

## Product Purpose

«Куда идём?» turns the problem of choice into a fast, almost game-like decision: the person swipes cards (a place, a ready route, or an event), right for «хочу», left for «не то». Swipes personalise what comes next; liked items collect in «Хочу сходить», and the tool then picks what fits today (open hours, budget, distance). Success: the person goes from opening the site to «we're going here» in minutes, and keeps coming back because the cards feel made for them.

## Positioning

A city guide that decides with you instead of listing everything: a personal swipe deck that learns from every yes/no inside the browser (no account), adapts to season and weather, and hands over a concrete plan — plus a playful invitation link («позови игрой») to send the choice to someone.

## Operating Context

- Used on a phone, often in the moment («сегодня вечером»), sometimes in the cold while walking.
- Modes: Свидание, Друзья, Подружки. Cities: Москва, Санкт-Петербург.
- Content: ~1400 places, ~670 ready plans (routes of 1–3 stops), afisha events, collections, promo codes.
- Invitation game (index.html / create.html): a link where the other person picks place, day and time.

## Capabilities and Constraints

- Static site on GitHub Pages (no build step, plain HTML/CSS/JS); optional own server for reviews and short links.
- All personalisation lives in the user's browser (localStorage); recommendation rules are public on rules.html (149-ФЗ ст. 10.2-2) and must be updated when recommendation behaviour changes.
- Telegram Mini App mode is the same pages with `html.tg`.
- Photos: real photos with credited sources (Wikimedia Commons, venue sites, venue/photographer public pages); no distinguishable faces, no portraits.
- Site text never names or links Telegram or Instagram as social networks (build-seo checks this).
- Undecided: which home-page sections remain below the deck long term.

## Brand Commitments

Name «Куда идём?». The owner made no visual element binding (asked 2026-11-07: no preference on keeping the cat mascot, the modes switcher, catalog placement or the invitation game's prominence).

## Evidence on Hand

- Place photos with credits: assets/photos.js, assets/ph/.
- Catalog and plans: assets/places.js, assets/places-spb.js; events: assets/events*.js; collections: assets/collections*.js.
- No testimonials, user counts or press exist — do not invent them.

## Product Principles

1. One decision at a time: show one strong option, not a wall of choices.
2. Every swipe teaches; the deck must feel different for each person.
3. Fit the moment: today's time, weather and season beat a static ranking.
4. Minimal words: a photo, a name and one line; details on demand.
5. Honest by design: real photos with credit, real hours and prices, public recommendation rules.
