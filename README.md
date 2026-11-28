# Plakoro Pokédex

Public browser app for Plakoro, including 30 saved loadout slots, League Format parties, Enecoro collections and dice, Chronicle cards, HP and evolution loadouts, and readable rules.

## Hosting

The public website is https://plakoropokedex.github.io/. GitHub Pages uses **GitHub Actions** as its publishing source. `.github/workflows/refresh-pages.yml` builds and deploys the HTML/CSS/JavaScript site on changes to `main`, on demand, and every 30 minutes (at minutes 17 and 47). Scheduled runs may be delayed by GitHub.

## Automatic card updates

`node refresh-cards.mjs` reads Jollto/PlakoroDB and the owner's publicly shared Google Drive directly, including all OG Chronicle cards and their original PNGs. It needs Node 24 and no Google account, API key, or visitor. It skips retired RE and JP folders. A modified-file cache reduces repeated downloads. Matching editor metadata supplies Pokémon names, move ownership, and evolution targets.

The job builds `_site/` with complete card snapshots, original local PNG files, a `site-cards.json` index, and content-versioned asset URLs. It checks complete folder listings and image integrity before publication. Unfinished Drive uploads retain the previous complete cards while finished additions can publish. A failed source retains its previous snapshot; a missing required image prevents deployment. The last published snapshot can be recovered when the build cache expires. A daily `update-check.json` records successful checks and keeps the scheduled repository active between card releases.

Visitors receive the latest published cards with the page. The app also checks the published index when opened and while in use, and keeps its original source checks as a fallback. Older device caches, pending downloads, or fallback feeds cannot replace newer card snapshots. Updates are installed as complete snapshots and saved for offline use when browser storage is available. Android and portable HTML retain their existing source updaters.

Run `node --test test-published-cards.mjs` to verify the publishing and browser update policy. In GitHub, **Actions → Refresh cards and publish Pokédex → Run workflow** requests an immediate website refresh. Failed runs leave the previous deployment available.

Loadouts and collections are saved on each device under the website's origin, not to GitHub. A new website address has separate browser storage from the former ChatGPT site.

## Attribution

2026 translations and artwork: [Jollto/PlakoroDB](https://github.com/Jollto/PlakoroDB), CC BY-NC 4.0; see `PlakoroDB-LICENSE.txt`. Chronicle and Custom cards come from the owner's shared Drive database. This is an unofficial fan companion; Pokémon and Plakoro belong to their respective rights holders.
