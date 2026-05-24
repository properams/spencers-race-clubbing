# Race music assets

Per-wereld muziek-stems voor het stem-based audiosysteem (zie
`js/audio/samples.js` en `js/audio/music-stems.js`). Werelden zonder
geladen assets vallen automatisch terug op procedurele synth-muziek
in `js/audio/music.js` — er is geen "alles of niets" gate.

## Slot-specificatie

Per wereld een directory `<world>/` met deze bestanden (alle slots
optioneel behalve `base.ogg`):

| Slot | Duur | Functie |
|---|---|---|
| `intro.ogg` | 4–8 sec | Eenmalig na countdown, voor de loops in beginnen |
| `base.ogg` | 60–120 sec, loopable | Drums + bass — speelt altijd 100% — **REQUIRED** |
| `mid.ogg` | 60–120 sec, loopable | Chord-pad + arp — 80% normaal, 100% op final lap |
| `lead.ogg` | 60–120 sec, loopable | Melody + risers — 30% normaal, 100% op final lap |
| `final-lap.ogg` | 4–8 sec | Stinger one-shot bij final-lap event |
| `nitro-fx.ogg` | 1–2 sec | Whoosh-burst bij nitro-activate |

**Encoding**: ogg vorbis, 44.1 kHz, stereo, q4 (~128 kbps). Mono mag voor
mobile-only builds maar stereo geeft beter ruimtelijk effect.

**Sync-eis**: alle drie de loops (`base/mid/lead`) MOETEN dezelfde lengte
en dezelfde BPM/toonsoort hebben — ze worden frame-accurate gestart op
één `t0` en verwacht is dat ze synchroon blijven oneindig herhalen.

**Loop-naden**: in Audacity even controleren dat het einde glitchloos
overgaat in het begin. Een 30–50ms crossfade aan begin+eind van het
bestand is bijna altijd genoeg om hoorbare clicks weg te halen.

## Suno / Udio prompts

Voer alle stems van één wereld door **dezelfde session** met identieke
BPM en toonsoort. Vraag bij elke prompt om "instrumental, loopable, no
fade-in or fade-out". Genereer base eerst, gebruik dan de stem-extend
of cover-functie van Suno om mid/lead op exact hetzelfde tempo/key te
forceren.

### Neon City — 128 BPM, D minor

Stijl-richting: dark cyberpunk industrial. Refs: Carpenter Brut,
Perturbator, Cyberpunk 2077 OST, Hotline Miami.

| Slot | Prompt |
|---|---|
| `intro.ogg` | dark cyberpunk synth riser, 128 bpm, D minor, building tension, ends on dominant chord, instrumental |
| `base.ogg` | dark cyberpunk industrial drum loop with 808 sub-bass, 128 bpm, D minor, no melody, no chords, drums and bass only, loopable, no fade |
| `mid.ogg` | dark cyberpunk synth pads and arpeggios in D minor, 128 bpm, no drums, no bass, atmospheric chord layer, Carpenter Brut style, loopable, no fade |
| `lead.ogg` | aggressive cyberpunk synth lead melody in D minor, 128 bpm, Perturbator style, no drums, no bass, just lead synth and risers, loopable, no fade |
| `final-lap.ogg` | cyberpunk drop stinger in D minor, 128 bpm, intense buildup with cymbal crash, instrumental |
| `nitro-fx.ogg` | synth riser whoosh sweep, cyberpunk, 1 second, instrumental |

### Space — 132 BPM, E minor *(nog te genereren)*

Outrun synthwave. Refs: Kavinsky "Nightcall", Mitch Murder, Daft Punk.

| Slot | Prompt |
|---|---|
| `intro.ogg` | retro synthwave intro pad, 132 bpm, E minor, neon nostalgia, instrumental |
| `base.ogg` | synthwave drum machine loop with gated reverb snare and analog bass arpeggio, 132 bpm, E minor, no melody, loopable, no fade |
| `mid.ogg` | synthwave chord pads in E minor, 132 bpm, Kavinsky style, no drums no bass, loopable, no fade |
| `lead.ogg` | synthwave lead synth in E minor, 132 bpm, Mitch Murder style saw lead, no drums no bass, loopable, no fade |
| `final-lap.ogg` | synthwave drop stinger E minor, 132 bpm, gated snare hit and synth riser, instrumental |
| `nitro-fx.ogg` | retro synth sweep, 1 second, instrumental |

### Deep Sea — 118 BPM, A minor *(nog te genereren)*

Deep dub-techno met onderwater feel. Refs: Burial, Subnautica OST.

| Slot | Prompt |
|---|---|
| `intro.ogg` | deep underwater dub-techno intro, 118 bpm, A minor, sonar pings and filtered pads, instrumental |
| `base.ogg` | deep dub-techno drum loop with sub-bass and shuffled hats, 118 bpm, A minor, underwater filtered, no melody, loopable, no fade |
| `mid.ogg` | deep dub chord stabs in A minor, 118 bpm, underwater reverb, no drums no bass, loopable, no fade |
| `lead.ogg` | melancholic dub-techno lead in A minor, 118 bpm, Rival Consoles style, no drums no bass, loopable, no fade |
| `final-lap.ogg` | dub-techno drop stinger A minor, 118 bpm, underwater whoosh and sub-bass hit, instrumental |
| `nitro-fx.ogg` | underwater whoosh sweep, 1 second, instrumental |

### Candy — 140 BPM, C major *(nog te genereren)*

Hyperpop chiptune. Refs: Snail's House, Anamanaguchi, Sugar Rush.

| Slot | Prompt |
|---|---|
| `intro.ogg` | bouncy hyperpop chiptune intro, 140 bpm, C major, sugary 8-bit melody, instrumental |
| `base.ogg` | hyperpop chiptune drum loop with kick on every beat and helium-vocal-chops, 140 bpm, C major, no melody, loopable, no fade |
| `mid.ogg` | bouncy 8-bit chord stabs in C major, 140 bpm, Anamanaguchi style, no drums no bass, loopable, no fade |
| `lead.ogg` | sugary chiptune lead melody in C major, 140 bpm, Snail's House kawaii style, no drums no bass, loopable, no fade |
| `final-lap.ogg` | hyperpop drop stinger C major, 140 bpm, glitchy pitch riser, instrumental |
| `nitro-fx.ogg` | cartoon sugar rush whoosh, 1 second, instrumental |

### Volcano — 165 BPM, E phrygian *(nog te genereren)*

Drum'n'bass meets metal. Refs: Pendulum, Doom OST, Mick Gordon.

| Slot | Prompt |
|---|---|
| `intro.ogg` | aggressive metal-dnb intro, 165 bpm, E phrygian, distorted guitar and double-kick fill, instrumental |
| `base.ogg` | drum'n'bass loop with double-kick and distorted reese bass, 165 bpm, E phrygian, no melody, loopable, no fade |
| `mid.ogg` | dark metal chord stabs in E phrygian, 165 bpm, Doom OST style, no drums no bass, loopable, no fade |
| `lead.ogg` | aggressive distorted lead in E phrygian, 165 bpm, Mick Gordon style, no drums no bass, loopable, no fade |
| `final-lap.ogg` | metal-dnb drop stinger E phrygian, 165 bpm, distorted guitar and double-kick crash, instrumental |
| `nitro-fx.ogg` | flame thrower whoosh, 1 second, instrumental |

### Arctic — 105 BPM, F# minor *(nog te genereren)*

Cinematic ambient + future-bass drop op final lap. Refs: ODESZA, SSX OST.

| Slot | Prompt |
|---|---|
| `intro.ogg` | cinematic arctic ambient pad intro, 105 bpm, F# minor, icy reverb and choir, instrumental |
| `base.ogg` | half-time future-bass drum loop with ice-crystal hats, 105 bpm, F# minor, no melody, loopable, no fade |
| `mid.ogg` | ethereal pad and bell stabs in F# minor, 105 bpm, ODESZA style, no drums no bass, loopable, no fade |
| `lead.ogg` | cinematic arctic lead in F# minor, 105 bpm, sine wave + choir, no drums no bass, loopable, no fade |
| `final-lap.ogg` | future-bass drop stinger F# minor, 105 bpm, ice cymbal crash and sub-bass hit, instrumental |
| `nitro-fx.ogg` | icy wind whoosh, 1 second, instrumental |

### Thrill Park — 155 BPM, G major *(nog te genereren)*

Funk-circus / 70s game-show. Refs: Wii Music, Mario Kart, Goblins from Mars.

| Slot | Prompt |
|---|---|
| `intro.ogg` | funky circus carnival intro, 155 bpm, G major, brass fanfare and organ, instrumental |
| `base.ogg` | funk drum loop with tight kick and snare, 155 bpm, G major, walking bassline, no melody, loopable, no fade |
| `mid.ogg` | carnival organ chord stabs and brass in G major, 155 bpm, Mario Kart style, no drums no bass, loopable, no fade |
| `lead.ogg` | funky brass and calliope lead in G major, 155 bpm, 70s game show style, no drums no bass, loopable, no fade |
| `final-lap.ogg` | circus brass drop stinger G major, 155 bpm, cymbal crash and trumpet roll, instrumental |
| `nitro-fx.ogg` | cartoon springboard whoosh, 1 second, instrumental |

### Sandstorm Canyon — 128 BPM, D phrygian dominant

Stijl-richting: cinematic Middle-Eastern electronic rock met oud, duduk
en darbuka over moderne electronic beats. Refs: Niyaz, Loreena McKennitt,
Junkie XL Mad Max OST, RJD2 Middle-East-fusion.

| Slot | Prompt |
|---|---|
| `intro.ogg` | cinematic Middle-Eastern desert intro, oud + duduk + low brass swells, slow build, 70 BPM, mysterious and grand, 25 seconds, instrumental |
| `base.ogg` | driving Arabic-fusion electronic rock, 128 BPM, D phrygian dominant, oud and electric guitar interplay, deep sub bass, tribal darbuka percussion, hypnotic loop, no melody, drums and bass only, loopable, no fade |
| `mid.ogg` | layered Middle-Eastern percussion, darbuka and frame drums over electronic synths, 128 BPM, D phrygian dominant, intensity rising, no drums no bass, atmospheric chord layer, loopable, no fade |
| `lead.ogg` | soaring oud lead over driving electronic beat, 128 BPM, D phrygian dominant, anthemic motorsport energy, no drums no bass, loopable, no fade |
| `final-lap.ogg` | maximum intensity Arabic electronic rock, full distortion, frantic darbuka, 130 BPM, climax stinger, instrumental |
| `nitro-fx.ogg` | short sandstorm sweep with brass stinger, 2-3 seconds, no melody, instrumental |

## Workflow

1. Genereer in Suno met bovenstaande prompts. Lever stems los aan
   (`base` apart van `mid` apart van `lead`).
2. Trim in Audacity tot exact bar-boundary zodat de loop naadloos is.
   30–50ms crossfade aan begin+eind voorkomt clicks.
3. Export als ogg vorbis q4, stereo, 44.1 kHz.
4. Drop de zes bestanden in `assets/audio/music/<world>/` met exact
   de filenames hierboven.
5. Hard-refresh de game (Ctrl+Shift+R) → bij eerste race in die
   wereld worden de stems gedecodeerd (~2-3 sec) en daarna gespeeld.

## Debug

Console:
- `_samplesDebug()` — welke werelden zijn geladen, wat zit er in cache
- `_musicDebug()` — welke scheduler draait nu, ducking, gain levels
- `_hasMusicStems('neoncity')` — synchrone check of stems voor wereld
  klaar zijn voor dispatch
