# PROVENANCE, Design System

**Atlas Sahara palette, Apple-style behaviour.** The brand stays as specified in
the system spec (terracotta `#C0642C`, warm gold `#B89040`, sand/bone surfaces,
serif display type, DM Mono for financials). The *feel*, motion, materials,
typography discipline, feedback, follows Apple's WWDC design talks, applied via
[emilkowalski/skills · `apple-design`](https://github.com/emilkowalski/skills)
(Emil Kowalski, ex-Vercel/Linear), plus Figma's design-basics foundations
(tokens, type scale, 8-pt grid, component variants).

## Tokens (`src/styles/tokens.css`)

Every spacing, radius, shadow, duration and colour is a custom property. Nothing
is "random", each value is defensible (WWDC *Principles of Great Design*: craft).

| Token | Value | Note |
|---|---|---|
| `--paper / --card / --well` | `#F3EDE1 / #FFFDF8 / #ECE4D4` | warm sand ground, bone surface, recessed well |
| `--terracotta / --terracotta-deep` | `#C0642C / #A5541F` | deep variant keeps text contrast ≥ AA |
| `--gold / --sage / --clay` | `#B89040 / #5E7D66 / #A94438` | endorsement states, success, destructive |
| `--r-xl…--r-sm` | `20/14/10/8 px` | soft continuous-corner feel (user-requested refinement of the spec's square corners) |
| `--ease` | `cubic-bezier(0.32, 0.72, 0, 1)` | ease-out-dominant, mirrors Apple's spring character on the web |
| `--t-fast/med/slow` | `120/240/420 ms` | fast = press feedback; med = screens; slow = materials |

## Materials & depth (skill §12)

* Sidebar and topbar are **translucent layers**, `backdrop-filter: blur() saturate()`
  with content scrolling underneath, a bright inset top edge ("light catching the
  material"), and no hard divider where chrome meets content.
* Hierarchy by material weight: nav is heavier (`0.78` alpha, 28 px blur), topbar
  lighter (`0.66`, 16 px). Never a light translucent surface stacked on another.
* Modals **materialize** (opacity + translateY + blur radius animating together) over
  a dimming scrim, arriving as a material, not a fade.
* `prefers-reduced-transparency` swaps to solid surfaces; `prefers-contrast: more`
  is respected; `prefers-reduced-motion` collapses all animation to cross-fades.

## Motion (skill §1, §5)

* **Feedback on press, not release**: every button, row, card and nav item scales
  (`0.97`) on `:active` with a ~100 ms ease-out.
* Screens enter with one coherent fade + 6 px rise on the route container only,
  no lock-out, no stagger jail.
* The kanban board moves cards **optimistically** (server reconciles in the
  background); dragging lifts the card with a slight tilt (a flick carries
  momentum, so it earns a little character).
* Enter and exit share the same path; durations come from tokens.

## Typography (skill §15)

* **Size-specific tracking**: display/serif headings tighten (`-0.02em`), body
  sits near `0`, uppercase eyebrows open up (`+0.08, 0.09em`).
* Hierarchy from weight + size + leading *as a set*: DM Serif Display for
  display, Montserrat 400, 700 for UI, Cormorant Garamond italic reserved for
  editorial moments, **DM Mono with tabular numerals for all financial figures**.
* All fonts are self-hosted via Fontsource, no external font requests.

## Foundations (Figma design basics)

* 8-pt spacing grid (`--s1…--s8`), one type scale, one radius scale.
* Components have variants, not one-offs: Button = primary/secondary/ghost/danger ×
  sm/md/lg × block; Badge = 4 tones + dot; Card = bare/pad/kpi.
* Controls ≥ 40 px tall (touch-target floor); focus is always visible (`--ring`).
* Empty states are designed (glyph + serif line + guidance), not blank panels.
* Wayfinding: the topbar answers "where am I"; the sidebar answers "where can I
  go"; destructive or consequential actions confirm with a scoped dialog
  (gate sign-off explains permanence before committing, principle: agency).

## Accessibility

* Contrast: ink-on-bone ≥ 12:1; terracotta-deep on bone ≥ 4.5:1 for text;
  white-on-terracotta used at ≥ 14 px semibold.
* Icons are `aria-hidden`; interactive elements have real labels; the stage rail
  and board columns are `role`-annotated.
* Reduced motion / transparency / contrast media queries all have real fallbacks.
