# Product
<!-- impeccable:product-schema 1 -->
## Platform
web
## Users
Personal prototype, with separate private journals intended for a later version.
## Product Purpose
Capture moments as mixed-emotion memory orbs, revisit dated shelves, and later explore patterns.
## Capabilities and Constraints
Current preview: vertical rotating character selector, one active emotion selected by the wheel, optional note, local memory shelf. Account journals persist on a self-hosted Node/SQLite backend; a separate browser-only guest journal remains available. Seven character circles supplied in the user's screenshot; remaining characters are outside this interaction preview.
## Brand Commitments
Colorful Inside Out character circles, a wheel partially outside the right edge, soft emotion-tinted background. User approved implementing the proposed wheel interaction.
## Stack
Standalone HTML/CSS/JavaScript with a Node.js HTTP backend and SQLite database. Node 22.13+; no third-party runtime dependencies.

## Current check-in interaction
Heading: “What do you feel right now?” The centered character is the single chosen emotion. No selection button or feeling chips. Saving records only the centered emotion. Mixed feelings are deferred.

## Reflection flow
Double-tap the focused character (or use Enter/Space) to open an emotion-colored reflection route. The circle expands into the background, respecting reduced motion. Optional note and up to four images (2 MB combined) are saved together locally. Back navigation preserves the in-session draft.

## Home memory shelves
The former current-emotion label and description area is now dated memory shelves. Saving a reflection returns to the wheel and animates its orb rolling into its shelf. Clicking a stored orb reveals its note and attached images.

## Account persistence
Email/password accounts own their journals and image attachments. Server-enforced access checks apply to every memory and image; sessions are stored server-side with HTTP-only cookies. Memory create, read, edit, delete, export, and retry-safe legacy imports are supported. Guest journals are never imported silently or overwritten by an account journal.

## Deployment
Run npm start for account features. Production requires an HTTPS PUBLIC_ORIGIN and persistent DATA_DIR. A Dockerfile and CI tests are included. Email verification and password recovery via email remain unconfigured; no email provider is assumed.
