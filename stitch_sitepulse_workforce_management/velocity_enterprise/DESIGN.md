---
name: Velocity Enterprise
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#434655'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#737686'
  outline-variant: '#c3c6d7'
  surface-tint: '#0053db'
  primary: '#004ac6'
  on-primary: '#ffffff'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#b4c5ff'
  secondary: '#545f73'
  on-secondary: '#ffffff'
  secondary-container: '#d5e0f8'
  on-secondary-container: '#586377'
  tertiary: '#46566c'
  on-tertiary: '#ffffff'
  tertiary-container: '#5e6e85'
  on-tertiary-container: '#e9f0ff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#d8e3fb'
  secondary-fixed-dim: '#bcc7de'
  on-secondary-fixed: '#111c2d'
  on-secondary-fixed-variant: '#3c475a'
  tertiary-fixed: '#d3e4fe'
  tertiary-fixed-dim: '#b7c8e1'
  on-tertiary-fixed: '#0b1c30'
  on-tertiary-fixed-variant: '#38485d'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  display-lg:
    fontFamily: Hanken Grotesk
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-md:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Geist
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
  headline-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  container-margin: 24px
  gutter: 16px
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 24px
  section-padding: 32px
---

## Brand & Style

The design system is engineered for high-stakes operational environments where clarity, speed, and precision are paramount. The brand personality is authoritative yet unobtrusive, functioning as a sophisticated "Mission Control" for workforce logistics. 

The aesthetic is **Corporate / Modern** with a focus on high-density information architecture. It leverages a clean, systematic approach to white space, ensuring that even data-heavy dashboards remain legible and calm under pressure. The interface utilizes a tiered hierarchy: deep institutional surfaces for navigation, crisp neutral layers for content containment, and vibrant semantic accents for real-time status updates.

## Colors

This design system utilizes a structured color palette designed for long-term task endurance. 

- **Primary Blue (#2563eb):** Reserved for primary actions, active states, and critical progress indicators. 
- **Institutional Navy (#1e293b):** Applied strictly to the global sidebar and primary navigation to provide a strong structural "anchor" for the eyes.
- **Semantic System:** Status colors must always be paired with subtle background tints (10-15% opacity) when used in badges to ensure high legibility without visual fatigue.
- **Surface Colors:** Use `#ffffff` for primary cards and `#f8fafc` for the application background to create a clear distinction between the canvas and interactive elements.
- **Borders:** A consistent `#e2e8f0` is used for all decorative and structural dividers.

## Typography

The typography strategy employs three distinct typefaces to balance character with utility. 

1. **Hanken Grotesk** is used for headlines and titles to provide a modern, sharp, and contemporary professional feel.
2. **Inter** serves as the workhorse for all body copy and data entry, chosen for its exceptional legibility in dense UI environments.
3. **Geist** is used for labels, data points, and monospaced-adjacent values. Its precise, technical nature is ideal for timestamps, coordinates, and ID numbers.

Maintain a strict vertical rhythm by adhering to the defined line heights. All "Label" roles should be used for metadata, table headers, and small button text.

## Layout & Spacing

This design system follows a **12-column fluid grid** for the main content area, while the sidebar remains a fixed-width component (256px expanded, 72px collapsed).

- **Rhythm:** An 8px-based spacing system is used for component-to-component layout, while a 4px "half-step" is used for internal component padding (e.g., inside buttons or inputs).
- **Density:** To accommodate workforce management workflows, "Compact" views are encouraged for tables and lists, reducing vertical padding to 8px.
- **Safe Zones:** Always maintain a 24px outer margin on desktop and 16px on mobile to prevent content from touching the viewport edges.
- **Side Panels:** Contextual actions and details should emerge from the right in a 400px wide "Drawer" rather than a centered modal when the user is deep in a data-entry flow.

## Elevation & Depth

Hierarchy is established through **Tonal Layering** and **Subtle Soft Shadows**. 

1. **Level 0 (Canvas):** `#f8fafc` — The base background.
2. **Level 1 (Cards):** `#ffffff` — Used for the primary content blocks. These feature a 1px border of `#e2e8f0`.
3. **Level 2 (Interaction):** Elements like dropdowns, popovers, and active modals receive a soft, diffused shadow: `0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)`.
4. **Level 3 (Overlay):** Global modals or critical alerts use a backdrop blur (8px) on the layer below to maintain context while forcing focus.

Avoid heavy shadows; use thin borders to define boundaries between sections of the same elevation.

## Shapes

The shape language is "Approachable Professional." 

- **Primary Cards:** Use a **12px (`rounded-lg`)** corner radius to soften the high-density data and make the interface feel modern.
- **Buttons and Inputs:** Use an **8px (`rounded-md`)** radius to maintain a sense of structural integrity.
- **Badges and Tags:** Use a **Full Pill** radius to distinguish them clearly from interactive buttons.
- **Sidebar Elements:** Active states in the sidebar should use a 6px radius to fit within the narrower navigation container.

## Components

### Buttons
- **Primary:** Solid `#2563eb` with white text. Subtle 2px inner-glow on hover.
- **Secondary:** White background with `#e2e8f0` border and `#1e293b` text.
- **Tertiary/Ghost:** No border or background unless hovered. Use for low-priority actions in tables.

### Tables & Data
- **Header:** Use `label-sm` typography with a light grey background (`#f1f5f9`).
- **Rows:** 1px bottom border only. Hover state should use a subtle blue tint (`#f0f7ff`).
- **Status Badges:** Text in the semantic color, background at 10% opacity of the same color. Include a 6px solid dot next to the label for visual accessibility.

### Input Fields
- **Default:** White background, 1px `#e2e8f0` border.
- **Focus:** 1px `#2563eb` border with a 3px soft blue outer glow (ring).
- **Labels:** Always placed above the field using `label-md`.

### KPI Cards
- Large `headline-lg` value at the top left.
- Micro-chart (Sparkline) at the bottom or right side.
- Percentage change indicator at the top right using semantic success/danger colors.

### Sidebar
- Background: `#1e293b`.
- Active State: Background `#334155` with a 4px primary blue vertical "pill" on the left edge.
- Text: `#94a3b8` (Inactive), `#ffffff` (Active).