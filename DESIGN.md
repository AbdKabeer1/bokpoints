---
name: OmaPointii
description: Loyalty for Finnish shops — a warm customer wallet and a precise merchant console.
colors:
  canvas: "#F6F1E7"
  paper: "#FFFCF6"
  sand: "#EFE7D7"
  ink: "#1A1712"
  muted: "#6E675B"
  line: "#E4DAC8"
  line-strong: "#D3C6AE"
  espresso: "#241E18"
  espresso-soft: "#3A3128"
  cream: "#FBF5E8"
  saffron: "#E8A93C"
  saffron-ink: "#7A5410"
  saffron-soft: "#FBF0D8"
  terracotta: "#C25E3D"
  terracotta-ink: "#8A3A22"
  terracotta-soft: "#F8E4DA"
  forest: "#1F5C3A"
  forest-deep: "#184A2F"
  forest-soft: "#E3EDE3"
  merchant-bg: "#F4F8F6"
  merchant-green: "#0B7A4B"
  merchant-green-deep: "#075C38"
  merchant-green-soft: "#E8F4EE"
  info: "#2B5FB4"
  info-soft: "#E5EDF9"
typography:
  display:
    fontFamily: "Fraunces_700Bold"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  display-hero:
    fontFamily: "Fraunces_700Bold"
    fontSize: "46px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Manrope_400Regular"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "Manrope_700Bold"
    fontSize: "10px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.14em"
  merchant-body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  data-mono:
    fontFamily: "'SF Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.06em"
rounded:
  sm: "10px"
  md: "16px"
  lg: "20px"
  xl: "26px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  screen: "20px"
components:
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "16px"
  hero-code:
    backgroundColor: "{colors.espresso}"
    textColor: "{colors.cream}"
    rounded: "{rounded.xl}"
    padding: "20px"
  button-primary:
    backgroundColor: "{colors.espresso}"
    textColor: "{colors.cream}"
    rounded: "{rounded.md}"
    padding: "15px 24px"
  button-primary-hover:
    backgroundColor: "{colors.espresso-soft}"
    textColor: "{colors.cream}"
    rounded: "{rounded.md}"
    padding: "15px 24px"
  pill-ready:
    backgroundColor: "{colors.saffron}"
    textColor: "{colors.espresso}"
    rounded: "{rounded.pill}"
    padding: "4px 9px"
  pill-expiry:
    backgroundColor: "{colors.terracotta-soft}"
    textColor: "{colors.terracotta-ink}"
    rounded: "{rounded.pill}"
    padding: "3px 9px"
  tab-bar:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.muted}"
    rounded: "24px"
    padding: "6px"
  merchant-panel:
    backgroundColor: "#FFFFFF"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "18px 20px"
---

## Overview

OmaPointii has two visual identities with one job each.

**The customer app** (Expo, iOS/Android/web) is a warm editorial wallet: a cream
canvas, paper cards, one espresso card that holds the code, saffron for points and
progress, terracotta for expiry and anything that needs attention. Fraunces sets the
display voice; Manrope carries the interface. It should feel like a card in a nice
café, not a dashboard.

**The merchant surfaces** (till `apps/web`, dashboard `apps/owner`) stay on the
approved green-and-white work system: `#f4f8f6` page, white cards, 1px hairlines,
green primary actions, monospace eyebrows for data labels, dense tables. Staff use them
for a few minutes at a time and need scanability, not personality.

The customer app is `Operate` mode: the shopper must find the code and understand a
balance fast. Warmth never costs legibility.

## Colors

- **Canvas `#F6F1E7`** is the page. It is deliberately not white; paper cards need it
  to read as objects.
- **Paper `#FFFCF6`** for cards, sheets and the tab bar.
- **Espresso `#241E18`** for the code hero and primary buttons. Cream `#FBF5E8` is the
  only text colour on it.
- **Saffron `#E8A93C`** means points and progress: the "Ready" pill, filled segments,
  active tab icons. Never use it for errors.
- **Terracotta `#C25E3D`** means expiry, destructive actions and attention. Text on its
  soft tint uses `#8A3A22`, never grey.
- **Forest `#1F5C3A`** remains the brand accent for positive confirmations and consent
  switches, in the customer app only as a small accent.
- A store's own brand colour is never painted raw on a large surface. It is washed into
  the canvas for its page (`mix(brand, canvas, 0.78)`) and deepened/desaturated for its
  avatar (saturation capped at 42%, lightness 34%), so a neon or pure blue still sits
  on warm paper.

Merchant surfaces use `#0B7A4B` / `#075C38` / `#E8F4EE`. Green is the primary action
there because staff are acting, not browsing.

## Typography

- **Display: Fraunces 700.** Greetings, page titles, balances, store names, section
  headings. Never below 20px; never for paragraphs.
- **Interface: Manrope 400/500/600/700/800.** Body, labels, buttons, metadata.
- Scale: 46/34 hero, 23–26 section, 15 card title, 14 body, 12 secondary, 10 label.
- Labels that are field names inside a card ("YOUR OMAPOINTII CODE", "TOTAL POINTS") may be
  uppercase with 0.14em tracking. Do not put a kicker label above a page heading.
- Balances and points use tabular numerals.
- The merchant dashboard keeps the system sans stack and the monospace stack for IDs,
  times and eyebrow labels.

## Layout

- 20px screen gutters, 16px card padding, 10–14px between cards, 24px above a section
  heading and 12px below it.
- One column at phone widths (360–430). The customer app never shows a table.
- Tap targets are at least 44px; the till's are at least 56px.
- The customer tab bar floats 12px above the safe area, inset 14px, 24px radius.
- Merchant content is a card grid: two columns above 1080px with a narrower right
  column, one column below.

## Elevation & Depth

- Borders before shadows. Customer cards use a 1px `line` border.
- The only shadow is the floating tab bar: offset 8px down, 18px blur, 12% warm brown.
- The merchant shell uses at most a 1px border and a 4% shadow; no glows, no coloured
  halos, no glass.

## Shapes

- Cards 20px, hero 26px, buttons 16px, inputs 14–16px, pills fully rounded.
- Store avatars are rounded squares (32% radius); the customer's avatar and profile
  circle are round.
- No nested cards. Lists inside a card are rows divided by hairlines, not cards.

## Components

- **Code hero:** espresso surface; uppercase field labels in cream at 66% opacity; QR on
  a paper tile; total points in Fraunces 46; saffron "Ready" pill; one footer row with
  a hint and a chevron action.
- **Store card:** avatar, name, last visit, balance in Fraunces, optional segmented bar
  to the cheapest reward above the balance. The bar is the only progress pattern; don't
  add rings or sparklines.
- **Store page:** the store's colour as a pale wash; name, balance and points; reward
  rows with a "Ready to use" / "Keep earning" pill; consent switch; history rows with
  a status pill and a signed amount.
- **Segmented bar:** 10 segments, 3px gaps, saffron when filling, forest or espresso
  when complete, `role="progressbar"` with real values.
- **Tab bar:** paper pill, four items, active item an espresso capsule with a saffron
  icon and cream label. Icons are Feather line icons, never emoji or text glyphs.
- **Merchant icons:** Lucide line icons at 16px with a 1.9 stroke in the sidebar and
  page actions. Customer app icons are Feather at 18px. One family per surface, never
  mixed, never a text glyph standing in for an icon.
- **Buttons:** espresso fill with cream text in the customer app; green fill in merchant
  surfaces. Destructive actions are terracotta-tinted, never green.
- **Merchant panel:** white, 1px `#e3ebe6`, 16px radius, monospace uppercase labels at
  10px, large tabular numbers, compact tables.

## Do's and Don'ts

- **Do** keep the customer app's warmth in the canvas and type, and keep the code the
  brightest object on the home screen.
- **Do** tint text on coloured surfaces from that hue; never use grey on saffron,
  terracotta or espresso.
- **Do** use real Feather icons; Unicode glyphs are not an icon system.
- **Do** let a store's brand colour appear as a wash or an avatar, never as a full
  saturated background behind body text.
- **Do** keep merchant surfaces precise and green; their job is speed.
- **Don't** put an uppercase kicker above a page heading.
- **Don't** nest cards, use gradient text, glass effects, or hard offset shadows.
- **Don't** add charts, progress rings or sparklines to the customer app; the segmented
  bar toward a reward is the only progress visual.
- **Don't** use pure black or pure white; the palette is always warm.
- **Don't** animate more than one authored moment per screen; respect reduced motion.
