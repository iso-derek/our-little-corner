# Design Direction: The Golden Thread

## Product truth

This is a private, shared keepsake for two people. It is not a dating product, a public portfolio, or a dashboard. The redesign must make the real photographs, letters, memories, and small rituals feel carefully kept while preserving the existing Supabase syncing, uploads, editing, passcode, and live games.

## Audit summary

- The current site is complete and functional across nine pages, but nearly every section uses the same white rounded card. Important photographs, controls, and ordinary navigation links therefore have similar visual weight.
- The desktop header contains nine pill links and wraps unpredictably. On mobile it becomes a horizontally clipped strip with no clear menu state.
- Pink is used for the page background, cards, shadows, borders, buttons, and typography. Because there is little material or tonal contrast, the experience reads as a generic template instead of a personal archive.
- Home has the strongest real story, but its first viewport is dominated by empty card space instead of a photograph. The June 21 photographs become much more compelling farther down the page.
- Memories preserves the required order and supports editing and photo uploads, but editing controls are permanently visible. The page reads like a content-management grid rather than a memory wall.
- Open When Letters supports two editable notes per mood, but its accordion presentation does not express the physical act of choosing and opening a letter.
- The image lightbox only opens and closes. It needs next/previous navigation, touch swiping, keyboard navigation, focus return, a counter, and scroll locking.
- Games and shared presence are the most complex functional area and must be restyled without changing the proven state machine or Supabase keys.
- Existing imagery is authentic and high resolution. The files are larger than their display needs, so responsive WebP derivatives can improve load time without removing the originals.

## Visual thesis

**A private editorial scrapbook held together by one golden thread.**

The interface should feel like an intimate keepsake laid out by someone with a sharp editorial eye: warm paper, dark ink, generous breathing room, varied photographic rhythm, and tactile details used sparingly. A thin gold line travels through navigation, timelines, dividers, and active states. It suggests continuity without becoming literal decoration everywhere.

The photographs provide the strongest color. Burgundy is the emotional accent. Gold marks connection, milestones, and focus. Soft sage appears only as a quiet counterpoint for shared/online states.

## Narrative thesis

The site opens on a real moment, not a feature list. Home introduces the relationship through June 21, then reveals the different rooms of the archive. Memories becomes a chronological contact sheet. Letters slows the experience down and asks the reader to choose an envelope. The utility pages keep the same voice while becoming quieter and easier to use.

The narrative rhythm is:

1. **Recognition:** a real photograph and the name of the corner.
2. **Milestone:** June 21 as the first substantial story.
3. **Exploration:** clear entrances to memories, letters, play, and everyday notes.
4. **Participation:** editing, uploading, writing, and playing appear when relevant, not as permanent visual noise.

## Interaction thesis

Interactions should feel like handling a keepsake: an envelope flap lifts, a photograph comes forward, a gold line advances, and a note gently reveals itself. Motion is short, purposeful, and reversible. Nothing floats without meaning, and no animation blocks reading or gameplay.

All interaction states must remain understandable without motion. `prefers-reduced-motion` removes transforms and nonessential transitions.

## Tokens

### Color

- Paper: `#f6f0e6`
- Paper light: `#fffdf8`
- Ink: `#241c1b`
- Muted ink: `#726763`
- Burgundy: `#7b2838`
- Burgundy dark: `#541b28`
- Gold: `#b48a3c`
- Gold light: `#e7d4a8`
- Sage: `#667a62`
- Hairline: `rgba(36, 28, 27, 0.16)`

### Type

- Display/editorial serif: `Newsreader`, with `Iowan Old Style`, `Baskerville`, and `Georgia` fallbacks.
- Interface sans: `Manrope`, with system sans-serif fallbacks.
- Display type is reserved for page titles, pull quotes, and memory numbers. Controls and data remain in the sans family.

### Spacing and shape

- Content max width: `1280px`
- Reading max width: `720px`
- Section spacing: `clamp(4rem, 9vw, 8.5rem)`
- Standard control radius: `2px` to `6px`
- Photographic frame radius: `0` to `4px`
- Pills are reserved for status, dates, and compact filters.
- Shadows are shallow and warm; hierarchy should come primarily from spacing, scale, and contrast.

## Photography rules

- Never hide the subject behind dark overlays or decorative effects.
- Preserve natural aspect ratio in editorial compositions; use controlled cropping only for small previews.
- Use full-bleed or edge-to-edge frames for signature moments.
- Alternate wide, portrait, and paired-image compositions so the memory wall does not become a uniform grid.
- Captions sit outside the image and use compact sans-serif type.
- Decorative rotation is limited to one or two degrees and only on small scrapbook details.
- Responsive derivatives use WebP while originals remain available for uploads and fallback.

## Signature moments

### Home: June 21 opening frame

A first-viewport photographic composition introduces Princess + Frog immediately. The title sits directly on the page, not inside a card. A small gold thread and date lead into the June 21 story below. The next section remains visible at desktop and mobile heights.

### Memories: chronological contact sheet

The required order reads as an editorial timeline rather than a card grid. Large memory numbers, alternating image widths, and the gold thread create movement. A deliberate Edit Memories mode reveals upload, title, date, caption, and delete controls only when requested.

### Letters: sealed envelope shelf

Each category appears as a named envelope. Opening one lifts the flap and reveals a paper letter with Frog and Princess notes. Editing actions remain inside the opened state. The animation is a brief affordance, not a theatrical delay.

### Lightbox: gallery viewing room

A restrained full-screen viewer supports previous/next buttons, arrow keys, Escape, swipe gestures, focus return, captions, and a position counter. The background cannot scroll while it is open.

## Page moments

- Badges: a restrained cabinet of stamped achievements with a gold progress rule.
- Game Room: a focused two-person game table with unmistakable identity, presence, and round states.
- Our Chat: a paper correspondence stream with a fixed, ergonomic composer on small screens.
- Gifts: parcel tags and photo-led entries, with editing controls revealed on demand.
- Things We Said: oversized alternating pull quotes on a ruled editorial page.
- Love Notes: one large generated note with a subtle shuffle/reveal transition and a quieter archive beneath it.

## Reference pass and actionable notes

No reference assets or copy will be shipped.

1. [Niccolo Miranda - Paper Portfolio](https://www.niccolomiranda.com/) - Strong editorial grid, expressive serif scale, paper tone, and rules that create structure without cards. Use the discipline, not the dense newspaper imitation.
2. [Communication Arts: Niccolo Miranda](https://www.commarts.com/webpicks/niccolo-miranda-1) - A single cinematic idea can govern typography and interaction. The concept should be visible in every section, not only the hero.
3. [Codrops: Photo Booth Strips with Lightbox](https://tympanus.net/codrops/2012/08/01/photo-booth-strips-with-lightbox/) - Tactile photo presentation works when image proportions remain clear and touch navigation is considered. Avoid the tutorial's heavy texture and fixed positioning.
4. [Codrops: Responsive Image Gallery](https://tympanus.net/codrops/2011/09/20/responsive-image-gallery/) - A strong gallery needs keyboard controls, adaptive sizing, and a coherent relation between thumbnail and full image.
5. [Codrops: Stack to Content Layout Transition](https://tympanus.net/codrops/2022/05/11/stack-to-content-layout-transition/) - Spatial continuity can make opening content feel physical. Apply a much lighter version to envelopes and photographs.
6. [Vowframes templates](https://vowframes.com/templates) - The useful distinction is between photo-forward, story-first, and scrapbook modes. This project should combine photo-forward hierarchy with restrained scrapbook details.
7. [Site Builder Report wedding examples](https://www.sitebuilderreport.com/inspiration/wedding-websites-examples) - Real photography should be visible immediately, and navigation should remain simple even when the story has many parts.

## Anti-patterns

- No universal rounded white cards.
- No pink-on-pink page wash or decorative gradient blobs.
- No fake scrapbook clutter, torn edges on every section, or handwritten font for body copy.
- No persistent editing forms competing with the memories themselves.
- No giant headings inside compact game panels.
- No animation that delays opening a letter, viewing a photograph, or submitting a game move.
- No new facts, dates, captions, or relationship copy that the existing site does not support.
- No dependency-heavy framework migration for a static site that already works.
