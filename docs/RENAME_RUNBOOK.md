# RENAME_RUNBOOK

Draaiboek voor het hernoemen van de repo. **Nog niet uitgevoerd.** De
daadwerkelijke rename is outward-facing (breekt de live Pages-URL) en admin-werk
op GitHub — die stap zet Jur bewust om. Dit bestand maakt hem rename-ready.

## Waarom

De slug `spencers-race-clubbing` bevat een persoonsnaam en zit in publieke URL's
(GitHub Pages en Vercel). Doel: persoonsnaam uit de publieke URL's. De in-game
merknaam "Spencer's Race Club" is iets anders en blijft (dat is game-branding,
geen repo-slug).

## Aanbevolen nieuwe slug

`race-club` (neutraal, behoudt de "Race Club"-identiteit, geen persoonsnaam).
Alternatief: `holo-race-club` (sluit aan bij de holo/synthwave-stijl). **Finale
keuze is aan Jur.** Intern gebruikt `package.json` al `name: "race-club"` als
werktitel.

## Wat een rename raakt (uit de audit + repo-topologie)

| Afhankelijkheid | Bestand · regel | Actie na rename |
|---|---|---|
| GitHub Pages-URL | `README.md:5` | Link bijwerken naar nieuwe slug; oude URL sterft |
| Vercel-URL | `atelier/MOBILE.md:50` | Alleen bijwerken als je het Vercel-*project* ook hernoemt |
| `package.json` `name` | root | Al `race-club`; pas aan als de finale slug afwijkt |
| **Publish-keten** (privé-repo `srclub-workspace`) | `.github/workflows/publish.yml`, `publish-preview.yml`, `cleanuppublicbranches.yml` | **Kritiek** — deze hardcoden `repository: properams/spencers-race-clubbing`. Bijwerken naar de nieuwe slug, anders stopt elke publish/preview |

Niet geraakt door een repo-rename: de root-absolute SW-paden, de localStorage-
sleutels (`spencerRC`), en de atelier-Actions-workflow (relatieve refs).

> **Volgorde-let-op:** werk de refs in `srclub-workspace` bij *direct na* de
> GitHub-rename (of gebruik de automatische redirect als bruggetje), zodat de
> publish-keten niet stilvalt.

## Stappen (uit te voeren bij go)

1. **Besluit de finale slug** en leg vast in `docs/DECISIONS.md`.
2. **GitHub → Settings → Rename repository** naar de nieuwe slug. (Kan niet via
   de beschikbare tooling in deze sessie; is een handmatige/admin-actie.)
   GitHub zet automatisch een redirect van de oude naar de nieuwe URL.
3. **Git remote bijwerken** lokaal:
   `git remote set-url origin <nieuwe-URL>`.
4. **GitHub Pages** opnieuw controleren: nieuwe URL wordt
   `properams.github.io/<nieuwe-slug>/`. `README.md:5` bijwerken. Check of de
   game op een root of op het subpad draait (backlog-item) — bij subpad moeten
   de root-absolute SW-paden herzien worden.
5. **Vercel** — de Git-koppeling volgt de rename meestal vanzelf via de
   GitHub-app; verifieer in het dashboard. Wil je ook een schone `*.vercel.app`,
   hernoem dan het Vercel-project en werk `atelier/MOBILE.md:50` bij.
6. **`npm run verify`** draaien en een handover schrijven.

## Veiligheid

- Voer stap 2–5 alleen uit met expliciete go. Communiceer de nieuwe live-URL
  aan spelers als die extern gedeeld is.
