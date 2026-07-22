# LESSONS

Geleerde lessen, zodat we ze niet herhalen.

## De werkwijze-laag hoort in de repo zelf
De vaste regels en het handover-template leefden in een *aparte* repo
(`srclub-workspace`). Gevolg: sessies die rechtstreeks in deze repo openden,
kregen geen instap en schreven geen handover. Les: de instap (`CLAUDE.md`) en het
handover-template moeten in **elke** repo staan waar daadwerkelijk gewerkt wordt,
niet in een centrale workspace-repo. (Bewijs: de open vragen in PR #5.)

## Gedeelde code is een bewijslast, geen aanname
De opgedragen eindvorm ging uit van een gedeelde `packages/engine`. De audit vond
nul cross-imports tussen game en atelier. Les: extraheer pas een gedeeld pakket als
er een **tweede bewezen gebruiker** is — niet op basis van een vermoeden.

## "Repo-gewicht" ≠ werkboom-omvang
`preview/` was ~4,2 GB in de werkboom maar de repo is gepackt ~82 MB (git
dedupliceert near-identieke snapshots). Les: meet bloat in de juiste eenheid —
bestandsaantal en checkout-omvang zijn hier de echte pijn, niet kloon-bandbreedte.
