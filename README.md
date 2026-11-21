# Plakoro Pokédex

Public browser app for Plakoro, including 30 saved loadout slots, League Format parties, Enecoro collections and dice, Chronicle cards, HP and evolution loadouts, and readable rules.

## Hosting

This repository is prepared for the organization site `PlakoroPokedex.github.io`. Publish the root of the `main` branch with GitHub Pages. It is a static HTML/CSS/JavaScript application and needs no build step.

## Automatic card updates

The app checks PlakoroDB and the anonymous Chronicle Drive reader. Chronicle checks run on opening and every 30 minutes while the app is open. Original card PNGs are included in this repository; downloaded updates are cached when browser storage is available. No Google sign-in is required for public Drive updates.

Loadouts and collections are saved on each device under the website's origin, not to GitHub. A new website address has separate browser storage from the former ChatGPT site.

## Attribution

2026 translations and artwork: [Jollto/PlakoroDB](https://github.com/Jollto/PlakoroDB), CC BY-NC 4.0; see `PlakoroDB-LICENSE.txt`. Chronicle and Custom cards come from the owner's shared Drive database. This is an unofficial fan companion; Pokémon and Plakoro belong to their respective rights holders.
