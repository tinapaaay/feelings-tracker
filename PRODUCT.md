# Product
<!-- impeccable:product-schema 1 -->
## Platform
web
## Users
Personal prototype, with separate private journals intended for a later version.
## Product Purpose
Capture moments as mixed-emotion memory orbs, revisit dated shelves, and later explore patterns.
## Capabilities and Constraints
Current preview: vertical rotating character selector, one active emotion selected by the wheel, optional note, local memory shelf. No accounts or cloud storage. Seven character circles supplied in the user's screenshot; remaining characters are outside this interaction preview.
## Brand Commitments
Colorful Inside Out character circles, a wheel partially outside the right edge, soft emotion-tinted background. User approved implementing the proposed wheel interaction.
## Stack
Standalone HTML, CSS, JavaScript chosen for a directly runnable interaction preview.

## Current check-in interaction
Heading: “What do you feel right now?” The centered character is the single chosen emotion. No selection button or feeling chips. Saving records only the centered emotion. Mixed feelings are deferred.

## Reflection flow
Double-tap the focused character (or use Enter/Space) to open an emotion-colored reflection route. The circle expands into the background, respecting reduced motion. Optional note and up to four images (2 MB combined) are saved together locally. Back navigation preserves the in-session draft.

## Home memory shelves
The former current-emotion label and description area is now dated memory shelves. Saving a reflection returns to the wheel and animates its orb rolling into its shelf. Clicking a stored orb reveals its note and attached images.
