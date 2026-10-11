# Motion feel: snappy and smooth

**Status:** proposal

What would make cmd feel more fluid, on top of docs/37-motion.md (one spring, one clock, nothing pops). docs/37 made motion *correct*: no jumps, no desyncs, no pops. This is about *feel*: things that answer the hand at once, keep its speed, come from where they were caused, and move together like one gesture. Written 2026-10-11 from a full `e2e/motion.mjs` run (branch `spacing`; master fails the same nine scenarios).

## What the harness shows today

| scenario | what happens | the cause, as far as read |
|---|---|---|
| flick a window onto another (grid) | 332 of 572 px in one frame, then the edges turn back | the drop starts the spring from the pointer's last rendered position with no velocity: the release lands a frame later than the drag, and a flick's speed is thrown away |
| drag a window onto another (grid) | top and bottom change direction once | the same hand-off: the window follows the pointer, then the spring starts at rest and pulls the other way |
| open a window (grid) | the title bar's meta moves 5 px, 3 times | the bar's text lays out as the window scales in |
| move a window to the right sidebar | content slides 60 px inside the window | a sidebar lays the toolbar out its own way (docs/37: not motion, but it reads as a jolt) |
| palette: clear the filter | rows move 586 px in one frame | the palette's list isn't a FLIP list: rows swap in place |
| sheet: open (Feedback) | its height 62 of 74 px in one frame | the sheet grows after its content loads, outside the glide |
| notification | the Navigator's Recent section jumps 16 px | useFlip moves rows; sections below them aren't in its selector |
| markdown: to the editor; previous workspace | the editor's gutter and lines shift 8–9 px | CodeMirror lays out after it's shown |

Ten long frames (100–170 ms of script) during the run pause the glides (the clock steps at most 34 ms), and that's visible as a hitch.

## Principles to add

1. **Answer in the first frame.** Hover and press states change at once (they do). An overlay's first frame is already mostly there: it enters from 0.97 scale and *some* opacity in 120 ms, not from nothing. A pressed control dips (scale 0.97 on `:active`, back on the glide), so a click is felt before its result arrives.
2. **Speed carries across hand-offs.** Where the pointer lets go (a drag, a flick, a resize, a scroll), the spring starts with the pointer's velocity and from where the window was *painted*, not where the last render put it. A flick then travels on and settles; it never snaps back. The same for an interrupted overlay: closing one that is still opening reverses from where it is (Web Animations' `reverse()`, not a second keyframe animation from the end state).
3. **Things come from their cause.** A menu or popover grows from its anchor (`transform-origin` at the side it opens from), a sheet from its window's top, a toast from the corner it lives in, a new window from the button or row that made it. Leaving goes back the same way.
4. **Short moves are quicker than long ones.** One spring for every distance makes a 20 px nudge take as long as a trip across the screen. Scale the response with distance: 0.18 s for a few pixels, up to 0.30 s across the screen (`response = clamp(0.18, 0.12 + 0.006·√px, 0.30)`), still critically damped, still one clock. Small changes feel snappy, big ones stay calm.
5. **One change, one gesture, led by what was touched.** When a change moves several things, the thing acted on leads and the rest follow by distance, 12–20 ms apart at most (a reflow in the grid, rows of an expanding section, windows making room). It reads as cause and effect, not as everything at once. Total added time stays under 60 ms.
6. **Everything in a list moves.** Now that every list is one component (`List`, list.tsx), FLIP belongs in it, not in each view: rows *and* sections glide when anything above them changes (the notification jump), a section's rows reveal and fold on collapse (height on the glide, rows fading in a stagger), and the palette's results become a `List` so filtering moves rows instead of swapping them.
7. **Layout before showing.** Content that lays out after it's shown (the Feedback sheet's height, CodeMirror's gutter, a window's title meta) is measured before its first frame (`flushSync`, an offscreen first layout, or holding it at opacity 0 for one frame), so the glide starts from the final layout.

## What to build, in order

1. **The hand-off** (principle 2): pointer velocity into TileMotion on drop, from the painted rect. Fixes the flick and drag scenarios; add a "throw a window" scenario that checks the window keeps moving the way it was thrown.
2. **Lists** (6). Built 2026-10-11: FLIP in `List` for rows, sections and a row's parts, rows that leave fade out where they were, sections fold and unfold on the glide; `list: fold a section` / `list: unfold it` in the harness, and `notification` passes. Not yet: the palette on `List`.
3. **Anchored overlays** (3) and **reversible presence** (2): `transform-origin` from the popover's placement, presence on Web Animations.
4. **Distance-aware response** (4): one function in `motion.ts` (`responseFor(px)`), used by TileMotion and `glide()`; CSS keeps the fixed `--glide` for what it animates. Tried in the Workbench with Jan before it lands: it's a feel change everywhere.
5. **Press feedback and stagger** (1, 5).
6. **Layout before showing** (7) per case, and the long frames: profile the 100–170 ms ones (`loaf` names the work).

Each step is measured with the harness before and after (`--label`), and the doc's table gets its numbers.

## What stays

One clock, critically damped (no bounce: a tool, not a toy), reduced motion makes everything instant, and View Transitions only for discrete swaps (workspaces).
