---
name: "Claude Code Workspace"
description: "A bright personal thread desk for local Claude Code work."
colors:
  primary-violet: "#6842d8"
  primary-violet-hover: "#5430bd"
  action-lime: "#d7f36a"
  action-lime-ink: "#263409"
  canvas-cool: "#f5f5fc"
  surface-white: "#fff"
  surface-lilac: "#eeeafb"
  hover-lilac: "#e7e1fa"
  ink-plum: "#25243b"
  muted-slate: "#5d6076"
  divider-lilac: "#dcddeb"
  success-green: "#198154"
  warning-amber: "#965010"
  warning-soft: "#fff0d7"
  error-red: "#a32c39"
  error-soft: "#ffeaed"
  light-canvas: "#f8fafc"
  light-primary: "#245fc1"
  light-action: "#dce8ff"
  dark-canvas: "#171923"
  dark-sidebar: "#202330"
  dark-panel: "#262a39"
  dark-primary: "#bba5ff"
  dark-ink: "#f2f3fc"
  avatar-violet-ink: "#56348b"
  avatar-violet-fill: "#e5dafa"
  avatar-amber-ink: "#714609"
  avatar-amber-fill: "#f9e3b4"
  avatar-teal-ink: "#195d51"
  avatar-teal-fill: "#c6eee0"
  avatar-rose-ink: "#963c61"
  avatar-rose-fill: "#fbd6e4"
  avatar-blue-ink: "#2755a0"
  avatar-blue-fill: "#d2e4ff"
typography:
  display:
    fontFamily: '"Avenir Next", Avenir, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "clamp(42px, 4.1vw, 64px)"
    fontWeight: 800
    lineHeight: 1.01
    letterSpacing: "-0.04em"
  headline:
    fontFamily: '"Avenir Next", Avenir, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "clamp(35px, 4vw, 56px)"
    fontWeight: 750
    lineHeight: 1.4
    letterSpacing: "-0.04em"
  title:
    fontFamily: '"Avenir Next", Avenir, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: '"Avenir Next", Avenir, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.8
    letterSpacing: "normal"
  label:
    fontFamily: '"Avenir Next", Avenir, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.87em"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "normal"
rounded:
  code: "4px"
  control: "8px"
  search: "10px"
  activity: "14px"
  card: "16px"
  message: "20px"
  pill: "22px"
  start-pill: "28px"
  composer: "24px"
  round: "50%"
spacing:
  xs: "5px"
  sm: "8px"
  md: "12px"
  lg: "15px"
  xl: "20px"
  2xl: "24px"
  3xl: "32px"
  4xl: "48px"
components:
  button-inbox-start:
    backgroundColor: "{colors.action-lime}"
    textColor: "{colors.action-lime-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.start-pill}"
    padding: "15px 21px"
  nav-new-chat:
    backgroundColor: "transparent"
    textColor: "{colors.ink-plum}"
    typography: "{typography.label}"
    rounded: "{rounded.activity}"
    padding: "13px 16px"
    height: "54px"
  nav-new-chat-current:
    backgroundColor: "{colors.surface-lilac}"
    textColor: "{colors.primary-violet}"
    typography: "{typography.label}"
    rounded: "{rounded.activity}"
    padding: "13px 16px"
    height: "54px"
  button-primary:
    backgroundColor: "{colors.primary-violet}"
    textColor: "{colors.surface-white}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "9px 13px"
    height: "36px"
  button-ghost:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.ink-plum}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "9px 13px"
    height: "36px"
  input-search:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.ink-plum}"
    typography: "{typography.label}"
    rounded: "{rounded.card}"
    padding: "11px 14px"
    height: "54px"
  chip-source-selected:
    backgroundColor: "{colors.ink-plum}"
    textColor: "{colors.canvas-cool}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "8px 15px"
    height: "40px"
  session-card:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.ink-plum}"
    typography: "{typography.label}"
    rounded: "{rounded.card}"
    padding: "13px 15px"
    height: "84px"
  composer:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.ink-plum}"
    typography: "{typography.body}"
    rounded: "{rounded.composer}"
    padding: "12px"
  activity-group:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.muted-slate}"
    typography: "{typography.label}"
    rounded: "{rounded.activity}"
    padding: "12px 15px"
---

# Design System: Claude Code Workspace

## Overview

**Creative North Star: "The Personal Thread Desk"**

This workspace turns local Claude Code sessions into a friendly personal inbox rather than an operations dashboard. It keeps the familiar three-part desktop structure—sidebar, reading pane, optional details—but replaces registry density with roomy thread cards, candid prompts, and one bright invitation to start.

The mood is youthful, direct, and calm enough for long technical conversations. Rounded surfaces and project-derived initials bring personality without pretending that agents have portraits or social presence. The original dark Codex-like mockup remains layout ancestry only; the shipped visual authority is the themeable Pop, Light, and Dark system in `src/styles.css`.

**Key Characteristics:**
- Personal-inbox language instead of administrative language.
- A bright action color reserved for the inbox's “Start something” invitation.
- Real session names, project labels, status, and history; no decorative identity data.
- Compact, collapsed tool activity that reveals raw input and results on demand.
- Comfortable reading by default with a persistent larger-text option.

## Colors

The default Pop theme uses cool paper, clean white surfaces, electric violet orientation, and a lime start action. Light remaps the primary action to blue; Dark uses deep indigo surfaces with lavender orientation and preserves the lime start action.

### Primary
- **Electric Violet** (`primary-violet`): navigation emphasis, focus rings, links, and selected context in Pop.
- **Start Lime** (`action-lime`): the inbox's explicit “Start something” action; its rarity keeps it energetic.

### Secondary
- **Light Blue** (`light-primary`): the orientation accent when the Light theme is active.
- **Dark Lavender** (`dark-primary`): the orientation accent when the Dark theme is active.

### Tertiary
- **Success Green** (`success-green`): healthy connection and completion indicators.
- **Warning Amber** (`warning-amber`, `warning-soft`): permission risk and sessions needing input.
- **Error Red** (`error-red`, `error-soft`): failures, destructive actions, and inline errors.

### Neutral
- **Cool Canvas** (`canvas-cool`): default page field behind white content surfaces.
- **Surface White** (`surface-white`): sidebar, top bar, cards, composer, and disclosures in Pop.
- **Lilac Layers** (`surface-lilac`, `hover-lilac`, `divider-lilac`): selection, hover, and structural separation without heavy chrome.
- **Plum Ink** (`ink-plum`) and **Muted Slate** (`muted-slate`): primary reading color and supporting metadata.
- **Dark Ink Canvas** (`dark-canvas`, `dark-sidebar`, `dark-panel`, `dark-ink`): high-contrast Dark theme layering.

**The Start Color Rule.** Use the start color only for the inbox's “Start something” action. Sidebar navigation—including New chat—stays neutral until current; ordinary confirmation and send actions use the theme accent.

**The Semantic Theme Rule.** Build new UI from the existing semantic CSS custom properties. Never hard-code the Pop palette into a component that must also work in Light and Dark.

## Typography

**Display Font:** Avenir Next with the native system sans stack
**Body Font:** Avenir Next with the native system sans stack
**Label/Mono Font:** The system sans stack for labels; UI monospace for paths, identifiers, and code

**Character:** One friendly geometric sans family carries both personality and dense technical reading. Weight and scale, not a decorative second font, distinguish the personal inbox from the conversation workspace.

### Hierarchy
- **Display** (800, responsive 42–64px, 1.01): the two-line “Pick up a thread” invitation only.
- **Headline** (750, responsive 35–56px, 1.4): generous empty-state statements.
- **Title** (600, 18px, 1.4): top-bar and compact panel titles.
- **Body** (400, 17px, 1.8): conversation Markdown, capped at 75 characters for direct paragraphs. Larger reading mode raises this to 20px.
- **Label** (600, 15px, 1.4): thread names, buttons, and navigational emphasis.
- **Mono** (400, relative 0.87em, 1.7): commands, paths, session references, and code blocks.

**The Reading First Rule.** Conversation and activity text inherit the reader-size token; do not freeze their text to the smaller UI scale.

## Layout

Desktop uses a full-height flex workspace with a responsive sidebar (`clamp(260px, 21.3vw, 328px)`), a 60px top bar, and a fluid content pane. Conversations are centered up to 1000px; the composer is centered up to 940px. The inbox expands to 1280px and uses cards instead of a compact table.

At 1150px, the details rail tightens and the reading/composer gutters shrink. At 940px, session details become an overlaid right rail. Below 760px, the sidebar becomes an off-canvas drawer, the top bar becomes 54px, the inbox start action becomes an icon button, and primary controls maintain 44px touch targets. Content density changes, but theme geometry stays consistent.

**The One Reading Column Rule.** Keep assistant content in one centered reading column; tools collapse into that flow rather than creating a second transcript rail.

## Elevation & Depth

The system is flat by default and communicates structure through tonal surfaces, borders, and whitespace. Shadows are reserved for temporary overlays: the appearance panel, dialogs, and the responsive details rail. Cards and conversation content remain unshadowed at rest.

### Shadow Vocabulary
- **Floating panel** (`0 14px 55px #17162933`): the appearance picker.
- **Modal focus** (`0 18px 70px #0007`): dialogs above a dark backdrop.
- **Side overlay** (`-15px 0 40px #0005`): the responsive session-details rail.

**The Flat-at-Rest Rule.** Do not add card shadows to thread rows, messages, or activity groups; use semantic surface changes for hover and selection.

## Shapes

Corners are soft and purposeful. Compact controls use 7–10px rounding, disclosures use 14px, thread cards and navigation actions use 16px, user messages use 20px, and the composer uses 24px. Source tabs and appearance controls are pill-shaped; send controls and theme swatches are circular. Project avatars use rounded squares, never headshots.

## Components

### Buttons
- **Shape:** compact actions use gently curved controls; start actions use rounded cards or pills; send is circular.
- **Primary:** the theme accent carries confirmation and send; the inbox's “Start something” action alone uses the separate start-color pair.
- **Hover / Focus:** hover shifts to the semantic hover color or a slight brightness reduction. Keyboard focus uses a 3px theme-accent outline with a 2px offset.
- **Secondary / Ghost:** bordered, transparent controls move to the raised surface on hover.

### Chips
- **Style:** session-source chips are quiet text pills at rest.
- **State:** the selected source reverses to current ink on current canvas and keeps its real count visible with tabular numerals.

### Cards / Containers
- **Corner Style:** thread cards use 16px corners; activity groups use 14px.
- **Background:** current theme panel at rest, current raised surface on hover.
- **Shadow Strategy:** none at rest.
- **Border:** thread cards omit borders; activity groups use the semantic divider.
- **Internal Padding:** 13px by 15px for thread cards; 12px by 15px for activity summaries.

### Inputs / Fields
- **Style:** search is a borderless panel with a 16px radius; the composer is a 24px panel with a nested 23px input surface.
- **Focus:** the search boundary adopts the accent; the global focus ring remains visible for keyboard users.
- **Error / Disabled:** errors use the semantic soft-red pair; disabled send controls use the semantic disabled pair.

### Navigation

The sidebar keeps projects and recently picked-up chats close to New chat. New chat and Your chats are neutral destinations at rest; only the current destination receives the same raised tint and accent text, with `aria-current="page"` providing the semantic state. This prevents two primary actions or two active destinations from competing. On mobile, the sidebar becomes an off-canvas drawer with a scrim; it does not compress beside the conversation.

### Thread Card

Each row shows a deterministic project-derived initial tile, the untouched session name, a short project label and reference, and a factual status. It must not imply an avatar, live presence, or relationship beyond the source data.

### Activity Group

Consecutive tool calls and their results become one collapsed “Activity” disclosure. The summary reports actual command and error counts. Expanded rows pair clearly labeled Command and Output panels with Copy controls. Shell commands preserve every source character while applying token color; structured results use readable JSON; plain logs remain plain text. When normalized content differs from the source payload, a Raw toggle restores the original JSON. Payloads scroll within a bounded 300px panel; no chain-of-thought or invented “thinking” text appears.

## Do's and Don'ts

### Do:
- **Do** preserve the personal-inbox voice: short invitations, familiar project labels, and real thread names.
- **Do** use semantic theme variables so every component remains legible in Pop, Light, and Dark.
- **Do** keep reading text at 17px by default and honor the persistent 20px Larger setting.
- **Do** keep session-source boundaries visible: Agents, Terminals, and Saved are different data kinds.
- **Do** collapse verbose tool traffic into factual activity groups, then reveal paired Command and Output panels with Copy and Raw access.

### Don't:
- **Don't** return to a registry, admin table, or terminal-wall aesthetic for the primary inbox.
- **Don't** fabricate agent portraits, presence, thinking text, timestamps, session names, or counts.
- **Don't** use the lime start color for sidebar New chat or routine controls; it belongs to the inbox's “Start something” invitation.
- **Don't** add resting shadows to ordinary cards, messages, or tool groups.
- **Don't** hide paths, IDs, or raw tool data permanently; shorten them in the first view and reveal the source detail on demand.
