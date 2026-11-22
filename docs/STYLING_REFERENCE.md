'''File Usage
Update this file whenever site styling changes. Keep it minified without losing meaning.
'''

# DVD Store Styling Reference

Current public branding uses `Video Rewind` as the primary public-facing name.

## Goal

Nostalgic, staff-focused UI with an early-web feel, but cleaner and more usable than a strict 90s recreation. Sparse, fast, responsive, hard-edged, and mostly neutral in tone.

## Keep

- Flat layouts
- Visible borders
- Hard edges or near-hard edges
- Blue links
- System fonts
- Simple states and interactions
- Consistent spacing

## Avoid

- Heavy shadows
- Glassmorphism
- Big gradients
- Rounded, pill-heavy UI
- Too many layered surfaces
- Over-animation
- Component-library bloat

## Typography

```css
font-family: Arial, Helvetica, sans-serif;
```

Optional serif accent only if used intentionally:

```css
font-family: "Times New Roman", Times, serif;
```

Base sizes:

```css
body {
  font-size: 14px;
}
h1 {
  font-size: 24px;
  font-weight: 700;
}
h2 {
  font-size: 18px;
}
small {
  font-size: 12px;
}
```

Links:

```css
a {
  color: blue;
  text-decoration: underline;
}
a:visited {
  color: purple;
}
a:hover {
  text-decoration: none;
}
```

## Palette

Light mode should feel plain, sharp, and neutral gray rather than cream or yellow. Dark mode should preserve that character without becoming glossy.

```css
:root {
  --bg: #ececec;
  --text: #111111;
  --border: #9d9d9d;
  --accent: #1b45d9;
  --muted: #5e5e5e;
  --panel: #f7f7f7;
  --panel-strong: #e2e2e2;
}
```

Dark mode should define equivalents for:

- background
- text
- border
- accent
- muted
- panel

Requirements:

- support system preference
- support manual toggle
- maintain contrast

## Layout

Preferred structure:

```txt
HEADER
MAIN
FOOTER
```

For browse pages or staff tools, a sidebar + main split is acceptable if it stays simple.

Container:

```css
.container {
  max-width: 1000px;
  margin: 0 auto;
}
```

Grid:

```css
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
}
```

## Core Components

Movie cards:

```css
.movie-card {
  border: 1px solid var(--border);
  padding: 8px;
  background: var(--bg);
}
.movie-card img {
  width: 100%;
  height: auto;
}
.movie-title {
  font-size: 14px;
  font-weight: 700;
  margin-top: 6px;
}
.movie-meta {
  font-size: 12px;
  color: var(--muted);
}
```

Small selected-title sets may use a two-column poster grid with metadata and actions below each poster; larger sets should use a compact list.
When order determines a primary item, use a subtle border to distinguish the first item without adding a label.

Availability should stay text-first and not rely on colour alone.

Examples:

```txt
Available: 2 / 5
Out of stock
```

Tables are appropriate for inventory/staff views:

```css
table {
  width: 100%;
  border-collapse: collapse;
}
td,
th {
  border: 1px solid var(--border);
  padding: 6px;
  text-align: left;
}
```

Compact public detail tables are acceptable when they show customer-relevant copy info only.

Buttons:

```css
button {
  border: 1px solid #999;
  background: #e0e0e0;
  padding: 4px 8px;
  cursor: pointer;
}
button:hover {
  background: #d0d0d0;
}
```

Button-style radio groups are appropriate for short constrained choices such as disc format and zone.
Single boolean flags such as sealed should prefer a checkbox-style control.
Checkbox-style format filters are appropriate for stock views where multiple formats can be active at once.
Link-style button actions are acceptable when a form action needs to visually match surrounding links.
Inline label actions should use a small gap and text-sized hit areas.

Inputs:

```css
input[type="text"],
select {
  border: 1px solid var(--border);
  padding: 4px;
}
```

Nav:

```css
.nav {
  border-bottom: 1px solid var(--border);
  padding: 8px 0;
}
.nav a {
  margin-right: 12px;
}
```

Inventory routes replace the public nav with:

```txt
Homepage | Titles | Stock | New
```

Public header should allow a swappable logo block rather than baking text directly into the layout.
The current placeholder logo leans into 90s video-store styling with bright orange text, a thick black outline, strong tracking, and a sign-like palette.
Homepage intro may include a compact inline GET search form instead of a CTA link.
Public footer should stay minimal and utility-like, with room for a staff link.
Standalone public marketing pages like About can push the 90s flavour slightly harder through stripe accents, sticker-style callouts, and strong typographic moments, while keeping the base layout flat and readable.
Orange is a restrained brand accent, not a global replacement for blue links. Use it mainly in the logo, eyebrows, selective emphasis, and subtle separators.

Panels are allowed sparingly, not everywhere:

```css
.panel {
  border: 1px solid var(--border);
  background: var(--panel);
  padding: 8px;
}
```

## Spacing

Quietly modernize through consistent spacing, not decorative surfaces.

```css
.section {
  margin-bottom: 16px;
}
.card {
  padding: 8px;
}
```

## Image Rules

- Smaller posters in lists
- Larger posters on detail pages
- Never stretch posters

## Accessibility

- Use semantic HTML
- Maintain contrast in both themes
- Ensure click targets are usable
- Do not communicate status by colour alone

## Philosophy

Looks nostalgic, behaves modern, stays lean.
