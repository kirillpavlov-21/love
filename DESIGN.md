---
name: Куда идём?
description: Night-city guide that helps people decide where to go today, one card at a time.
colors:
  night-ground: "#0F0E13"
  surface: "#1A1920"
  surface-raised: "#22212A"
  surface-top: "#2A2932"
  hairline: "rgba(244, 241, 234, .08)"
  hairline-strong: "rgba(244, 241, 234, .16)"
  ink: "#F4F1EA"
  muted: "#A39EAE"
  muted-strong: "#C9C5D2"
  date-pink: "#FF6F91"
  date-pink-ink: "#1C0A10"
  friends-lime: "#D7F25C"
  friends-lime-ink: "#15170A"
  girls-lavender: "#B9A1FF"
  girls-lavender-ink: "#17102A"
  yes-green: "#7CE3A1"
typography:
  display:
    fontFamily: "Unbounded, 'Arial Black', system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Unbounded, 'Arial Black', system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Onest, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "Onest, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Onest, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.3
rounded:
  sm: "12px"
  md: "16px"
  lg: "22px"
  xl: "24px"
  pill: "99px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "18px"
  gutter: "20px"
components:
  button-primary:
    backgroundColor: "{colors.date-pink}"
    textColor: "{colors.date-pink-ink}"
    rounded: "{rounded.md}"
    padding: "0 22px"
    height: "52px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 22px"
    height: "52px"
  button-mini:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "36px"
  chip:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.muted-strong}"
    rounded: "{rounded.pill}"
    padding: "6px 10px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "18px"
  chip-choice-on:
    backgroundColor: "{colors.date-pink}"
    textColor: "{colors.date-pink-ink}"
    rounded: "{rounded.pill}"
    height: "40px"
  deck-card:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.display}"
    rounded: "{rounded.xl}"
  deck-yes:
    backgroundColor: "{colors.date-pink}"
    textColor: "{colors.date-pink-ink}"
    rounded: "{rounded.pill}"
    size: "60px"
---

# Design System: Куда идём?

## Overview

**Creative North Star: "Ночной город" (The Night City)**

The site is the city after dark seen from a phone: a near-black, faintly violet ground, warm off-white type, and one lit sign at a time. The single accent is the colour of the evening being planned (pink for a date, lime for friends, lavender for girls' nights), so the interface changes mood with the mode switch rather than with decoration. Photographs of real places carry the colour; the chrome stays quiet so a photo can own the screen.

Density is low by doctrine. The home leads with one question, «Куда пойдём?» (with whom, when, then a ten-card game on its own screen), then a compact search, then a single favourite plan; everything else is one tap or one scroll away. Copy is short, in the product's own spoken Russian, and never explains what the layout already shows.

The owner chose this world over replacement directions (2026-11-07) and named two failure modes for future work: «слишком мило» (cartoonish, emoji-heavy) and «скучно-корпоративно» (correct but characterless).

**Key Characteristics:**
- Near-black violet ground, tonal surfaces stepped in three levels, hairline borders instead of shadows on content.
- One accent per screen, re-tinted by mode; never two accents competing.
- Unbounded for the display voice, Onest for everything people read or tap.
- Real place photography, credited on the image itself, no faces.
- Line icons in one stroke weight; emoji are not interface icons.

## Colors

A dark, slightly violet night palette with exactly one luminous accent that follows the chosen mode.

### Primary
- **Date Pink** (#FF6F91): the accent in «Свидание» mode and the default. Primary buttons, the selected mode, the ♥ «Хочу» button, focus rings, links. Text on it is **Date Pink Ink** (#1C0A10).
- **Friends Lime** (#D7F25C): the same role in «Друзья» mode, with its ink (#15170A).
- **Girls Lavender** (#B9A1FF): the same role in «Подружки» mode, with its ink (#17102A).

### Tertiary
- **Yes Green** (#7CE3A1): only the «Хочу» stamp that appears while a deck card is dragged right. Not a general success colour.

### Neutral
- **Night Ground** (#0F0E13): page background in every mode.
- **Surface** (#1A1920): cards, sheets, the «Куда пойдём?» panel.
- **Surface Raised** (#22212A): chips, inputs inside panels, photo placeholders, rows inside a sheet.
- **Surface Top** (#2A2932): the highest tonal step (empty thumbnails, pressed rows).
- **Hairline** (8% ink) and **Hairline Strong** (16% ink): every border; strong for interactive outlines.
- **Ink** (#F4F1EA): primary text, warm rather than pure white.
- **Muted** (#A39EAE): secondary text and input placeholders; meets 4.5:1 on every surface.
- **Muted Strong** (#C9C5D2): secondary text that must stay readable on photos and chips.

### Named Rules
**The One Lit Sign Rule.** A screen has one accent colour, the current mode's. Status, decoration and emphasis never introduce a second hue.

**The Mode Recolours Everything Rule.** Components read the accent from `--accent` / `--on-accent` / `--glow`; nothing hard-codes pink, so switching mode recolours the page at once.

## Typography

**Display Font:** Unbounded (with Arial Black, system-ui)
**Body Font:** Onest (with system-ui, -apple-system, Segoe UI)

**Character:** Unbounded is wide, round and loud, used sparingly for names that must be read at a glance; Onest is a calm Cyrillic grotesque for everything else.

### Hierarchy
- **Display** (700, 22px on deck cards and sheet titles, up to 28px; line-height 1.1–1.2; -0.02em): the place or plan name on the swipe card, sheet titles.
- **Headline** (500, 19px, 1.2, -0.01em): section titles such as «Куда пойти сегодня», «Выбор недели», «Готовые планы».
- **Title** (Onest 700, 15–16px, 1.3): card and row titles inside lists.
- **Body** (Onest 400, 15px, 1.45): descriptions and sheet text; 14px on dense rows.
- **Label** (Onest 600, 12–13px): chips, mini buttons, metadata lines; uppercase only for the small section labels inside sheets, tracked 0.05em.

### Named Rules
**The One Line Rule.** Under a name there is at most one line of facts (type · metro · price, or day · time · venue). A second explanatory caption is a defect.

## Layout

A single centred column, max 760px, with 20px side gutters (safe-area aware) on every viewport; desktop shows the same column, not a wider grid. The home stacks: header with section tabs, the «Куда пойдём?» panel, compact search with one scrolling row of text chips, one favourite plan, the «Выбор недели» rail, the invitation block, then the catalogue feed (plans, afisha, places). Horizontal rails scroll with snap and bleed to the screen edge. Spacing steps are 6, 10, 14, 18 and 20px; groups sit tight inside, sections separate by 18–24px.

## Elevation & Depth

Depth is tonal: Night Ground, Surface, Surface Raised, Surface Top, separated by hairlines. Content cards carry no shadow at rest. Shadows appear only on things that float above the page.

### Shadow Vocabulary
- **Deck lift** (`box-shadow: 0 18px 40px rgba(0, 0, 0, .35)`): the top swipe card, which sits above the stack.
- **Sheet / result float** (`box-shadow: 0 20px 50px rgba(0, 0, 0, .35)`): bottom sheets and the constructor's result panel.

### Named Rules
**The No Neon Halo Rule.** Shadows are neutral black with offset and blur. A coloured, zero-offset glow around buttons or cards is not part of this world; the accent's soft radial glow lives only behind the hero panel, never around controls.

## Shapes

Soft, generous corners that grow with the object: 12px for small controls, 16px for buttons and inputs, 22px for cards, 24px for the swipe card and sheets, full pills for chips, mini buttons and the round ✕ / ♥ deck buttons (60px). Borders are 1px hairlines; a dashed hairline marks an optional, skippable prompt (the «С кем сегодня?» card). Photos fill their container edge to edge with object-fit: cover and inherit its radius.

## Components

### Buttons
- **Shape:** gently rounded rectangle (16px), 52px tall, 0 22px padding, Onest 700 16px.
- **Primary:** accent fill with accent ink. One primary per screen region.
- **Ghost:** transparent with a strong hairline and ink text; secondary actions such as «Пример», «Ещё варианты».
- **Mini:** 36px pill with hairline, Onest 600 13px and a 16px accent line icon; filters and section actions («Все новые», «Удиви меня», «Подобрать за 10 секунд»).
- **Press / Focus:** scale to 0.97 on press; 2px accent outline with a 2–3px offset on keyboard focus.

### Chips
- **Style:** Surface Raised pill, Muted Strong text, 6px 10px padding, optional 16px line icon.
- **State:** selected search chips take the accent; at most one hint chip per plan card.

### Cards / Containers
- **Corner Style:** 22px.
- **Background:** Surface with a hairline border.
- **Shadow Strategy:** none at rest (see Elevation & Depth).
- **Internal Padding:** 18px; the photo strip runs to the card's inner edge.

### Inputs / Fields
- **Style:** Night Ground fill inside Surface panels, strong hairline, 16px radius, 54px tall, leading 18px search icon in Muted.
- **Placeholder:** Muted.
- **Focus:** the border shifts to the accent.

### Navigation
- **Mode:** chosen in the «Куда пойдём?» panel (Вдвоём / Друзья / Подруги / Один); the first three switch the site mode and its accent, there is no separate mode bar on the home.
- **Section tabs:** small pills under the header that jump to «Планы», «Афиша», «Места».

### Card Game «Куда пойдём?»
The signature interaction, in two parts. On the home, a Surface panel (24px radius, soft accent glow top-right) holds the title in Display, a fan of three tilted photo thumbnails, two rows of pill chips (with whom; when), one full-width primary «Листать 10 карточек» and a quiet underlined «Хочу сходить · N». The button opens a full-screen game over the page: ✕, a 6px accent progress bar and «3 из 10» on top; one full-bleed photo card with a dark gradient foot, a «место / маршрут / событие» pill, the photo credit in 10px, the name in Display and one fact line; round ✕ (Surface, hairline) and ♥ (accent) below. Dragging right shows a green «Хочу» stamp, left a pink «Не то»; past 90px the card flies off. After ten cards a result screen shows «Сегодня — сюда»: one large pick and two spares, «Ещё 10 карточек» and «Всё сохранённое». Back closes the game.

## Do's and Don'ts

### Do:
- **Do** let a real photo own the card and keep the chrome dark around it.
- **Do** credit every photo on the image (author or venue handle, 10px).
- **Do** read colours from `--accent`, `--on-accent` and `--glow` so all three modes stay correct.
- **Do** keep one fact line under a name and push detail into the sheet.
- **Do** keep placeholders and secondary text at Muted (#A39EAE) or brighter.

### Don't:
- **Don't** use emoji as interface icons; use the line icon set (one stroke weight, 16–18px).
- **Don't** add a second accent hue, gradient text, or a coloured glow around controls.
- **Don't** put a small uppercase label (eyebrow) above a heading.
- **Don't** add decorative grid or line-field backgrounds to panels.
- **Don't** go cute (cartoon characters in the product chrome, hearts and sparkles as decoration) or corporate (light grey forms, stock icons, no character).
