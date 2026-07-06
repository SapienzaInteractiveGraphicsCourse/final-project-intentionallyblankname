# Mecha-Basketball 3D

**Final Project — Interactive Graphics** · Prof. Marco Schaerf · La Sapienza University of Rome

[![Three.js](https://img.shields.io/badge/Three.js-e8c205?style=flat-square&logo=three.js&logoColor=black)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev/)
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](https://developer.mozilla.org/docs/Web/JavaScript)
[![Status](https://img.shields.io/badge/Status-In%20Progress-orange?style=flat-square)](#step-plan)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Not%20Deployed%20Yet-lightgrey?style=flat-square&logo=github)](#)

---

## About

Partita di basket simulata tra robot procedurali selezionabili, ambientata in un campo da basket GLTF. Nessun modello esterno per i robot: sono costruiti in Three.js con primitive e gerarchie di `THREE.Group`, animate interamente via codice. L'utente sceglie una classe di robot da una schermata di selezione, ognuna con stat e mossa speciale diverse, poi osserva/dirige la simulazione della partita.

---

## Robot Classes

Roster corretto — sostituisce il concept iniziale COLOSSUS/GLITCH/SENTINEL (mai implementato):

| Classe | Locomozione | Mossa Speciale | Stato |
|---|---|---|---|
| **MANIPULATOR** | Ruote | — | ✅ Implementata (Step 4), unica giocabile |
| **LEGGED MANIPULATOR** | Gambe | Jump | ⬜ Placeholder nel Main Menu, da fare (Section 4) |
| **DRONE** | Volo | Uplifting | ⬜ Placeholder nel Main Menu, da fare (Section 4) |

---

## Step Plan

<table width="100%">
<colgroup><col width="12%"><col width="35%"><col width="53%"></colgroup>
<thead><tr><th>Status</th><th>Step</th><th>Cosa include</th></tr></thead>
<tbody>
<tr><td>✅</td><td><b>1 — Scouting</b></td><td>8 repository Sapienza analizzati per pattern comuni</td></tr>
<tr><td>✅</td><td><b>2 — Campo & Rendering</b></td><td>Vite + Three.js, campo GLTF, luci, tone mapping ACES</td></tr>
<tr><td>✅</td><td><b>3 — Spectator Camera</b></td><td>Free-fly con Pointer Lock, WASD + Space/Shift</td></tr>
<tr><td>✅</td><td><b>3.5 — Polish rendering</b></td><td>SSAO, SMAA, fix shadow acne, illuminazione lampioni</td></tr>
<tr><td>✅</td><td><b>4 — Basic Playable Robot</b></td><td>MANIPULATOR: modello gerarchico procedurale, debug menu, movimento/sterzata/mira/dash in Play mode. Solo questa classe — altre 3 da fare</td></tr>
<tr><td>✅</td><td><b>5 — Basic Basketball</b></td><td>Pallone GLTF dedicato (color + normal + metallic/roughness map) e palleggio animato: macchina a stati push/drop/rise a timestep fisso, sincronizzata con la cinematica del braccio</td></tr>
<tr><td>✅</td><td><b>6 — Primo Polishing & Riallineamento</b></td><td>Scouting comparativo di 7 repo del corso, texture procedurali PBR sul robot, pulizia dead code</td></tr>
<tr><td>✅</td><td><b>Section 2 — Gameplay Mechanics</b></td><td>Classi/statistiche ✅, pick-up/handling a bottone ✅, Shooting System (direzione da crosshair + forza costante + hoop assist da stat SHOOTING) ✅, collisioni backboard/ferro/muri/pali/panchine/tribuna ✅ (mesh reali del GLTF, ora in <code>CollisionWorld</code>), pickup automatico ✅, preview di traiettoria ✅, Point System (HUD punteggio 2/3pt) ✅, Effetti Sonori (<code>SoundEffects</code>, Web Audio sintetizzato) ✅, Main Menu completo (gamemode/robot/time-of-day, pausa, options) ✅, FSM <code>GameMode</code>/<code>TimeOfDay</code> ✅</td></tr>
<tr><td>⬜</td><td><b>Section 3 — Enemies & Polish</b></td><td>Enemies 3v3 con AI, Steal/Block, personalizzazione menu colori, animation tweaks, secondo polishing e allineamento con esame (Main Menu/HUD rework già anticipato in Section 2)</td></tr>
<tr><td>⬜</td><td><b>Section 4 — Nuove Classi & Game Modes</b></td><td>Classe Drone (mossa "Uplifting"), Classe Legged Manipulator (mossa "Jump"), modalità di gioco (3v3 normale, beat the time, beat the score), polish finale (selettore Sunrise/Day/Sunset/Night e impostazioni globali già anticipati in Section 2)</td></tr>
<tr><td>⬜</td><td><b>Section 5 — Revisione Finale</b></td><td>Revisione completa del codice (a mano e assistita), cambiare il necessario e capire tutto</td></tr>
</tbody>
</table>

---

## Controls

<table width="100%">
<colgroup><col width="30%"><col width="70%"></colgroup>
<thead><tr><th>Input</th><th>Effetto</th></tr></thead>
<tbody>
<tr><td><b>P</b></td><td>Apre/chiude pannello DEBUG (tuning parametrico del robot componente per componente + Copy Config) e pannello CAMERA</td></tr>
<tr><td><b>M</b></td><td>Alterna modalità <b>Spectate</b> (free-fly) / <b>Play</b> (terza persona sul robot)</td></tr>
<tr><td>Spectate: click + mouse + WASD + Space/Shift</td><td>Volo libero nella direzione esatta della camera</td></tr>
<tr><td>Play: click + mouse</td><td>Orbita la camera attorno al robot; il pitch alza/abbassa leggermente il braccio</td></tr>
<tr><td>Play: WASD</td><td>Muove il robot relativo a dove guarda la camera; le ruote sterzano verso la direzione di marcia, il braccio punta sempre dove guarda la camera</td></tr>
<tr><td>Play: Shift sinistro</td><td>Dash nella direzione di marcia (cooldown 4s)</td></tr>
<tr><td>Play: tasto destro tenuto (solo se si ha la palla)</td><td><code>RobotState.HANDLING</code> — palleggio in pausa, camera a orientamento libero per mirare; non fa nulla se la palla è libera (<code>BallState.FREE</code>)</td></tr>
<tr><td>Play: click sinistro (in HANDLING)</td><td>Tiro — direzione dal raycast sul crosshair, forza costante (ridotta dentro l'arco dei 3 punti), animazione windup/release/recover</td></tr>
<tr><td>Play: camminare vicino a una palla libera</td><td>Pickup automatico (nessun tasto) — appena il bounding box del robot tocca la palla, animazione di raccolta rapida e si torna a <code>DRIBBLE</code></td></tr>
<tr><td><b>ESC</b> (in Play)</td><td>Apre il menu di pausa (freeza il gioco): OPTIONS / BACK TO GAME / BACK TO MAIN MENU (resetta il punteggio)</td></tr>
</tbody>
</table>

---

## Tech Stack

<table width="100%">
<thead><tr><th width="20%">Categoria</th><th>Tools</th></tr></thead>
<tbody>
<tr><td><b>Core</b></td><td><img src="https://img.shields.io/badge/Three.js-e8c205?style=flat-square&logo=three.js&logoColor=black"> <img src="https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white"> <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black"></td></tr>
<tr><td><b>Rendering</b></td><td><img src="https://img.shields.io/badge/GLTFLoader-e8c205?style=flat-square"> <img src="https://img.shields.io/badge/EffectComposer-e8c205?style=flat-square"> <img src="https://img.shields.io/badge/SSAO-e8c205?style=flat-square"> <img src="https://img.shields.io/badge/SMAA-e8c205?style=flat-square"></td></tr>
<tr><td><b>Robot</b></td><td><img src="https://img.shields.io/badge/Procedural%20Hierarchy-e8c205?style=flat-square"> <img src="https://img.shields.io/badge/Runtime%20Geometry%20Rebuild-e8c205?style=flat-square"></td></tr>
<tr><td><b>Basketball</b></td><td><img src="https://img.shields.io/badge/Fixed%20Timestep%20Simulation-e8c205?style=flat-square"> <img src="https://img.shields.io/badge/State%20Machine-e8c205?style=flat-square"></td></tr>
<tr><td><b>Deploy</b></td><td><img src="https://img.shields.io/badge/GitHub%20Pages-222222?style=flat-square&logo=github&logoColor=white"></td></tr>
</tbody>
</table>

---

## TODO

<table width="100%">
<colgroup><col width="8%"><col width="92%"></colgroup>
<tbody>
<tr><td>✅</td><td>Modello gerarchico robot con animazione strutturale (MANIPULATOR)</td></tr>
<tr><td>✅</td><td>Movimento robot controllato dall'utente (Play mode: WASD + mira mouse + dash)</td></tr>
<tr><td>⬜</td><td>Altre 2 classi robot (LEGGED MANIPULATOR, DRONE — roster corretto, sostituisce COLOSSUS/GLITCH/SENTINEL mai implementate)</td></tr>
<tr><td>✅</td><td>Pallone + palleggio animato (Step 5)</td></tr>
<tr><td>✅</td><td>Texture di almeno due tipi diversi (pallone: color + normal + metallic/roughness map; campo: solo color map)</td></tr>
<tr><td>✅</td><td>Selezione robot da schermata iniziale — Main Menu con 3 card (MANIPULATOR con preview 3D live, LEGGED MANIPULATOR/DRONE placeholder disabilitati, ancora da implementare)</td></tr>
<tr><td>⬜</td><td>Perf: <code>light.shadow.autoUpdate = false</code> su sole e lampioni — le shadow map di campo/lampioni (statici) vengono ricalcolate ogni frame inutilmente (1 map 4096² + 4×6 map 512²); vanno congelate e aggiornate solo quando la scena statica cambia, ora che il robot mobile aggiunge ombre dinamiche vere</td></tr>
<tr><td>✅</td><td>Section 2: stabilire le classi e le loro statistiche — roster corretto (MANIPULATOR/LEGGED MANIPULATOR/DRONE, non più COLOSSUS/GLITCH/SENTINEL), stats struct omogeneo <code>{ speed, power }</code> via <code>RobotBase</code>/<code>ManipulatorRobot</code> (<code>src/robots/</code>)</td></tr>
<tr><td>✅</td><td>Section 2: Pick-up/Handling della palla come azione a bottone (tasto destro tenuto premuto, <code>RobotState.HANDLING</code>) invece del palleggio sempre attivo automatico</td></tr>
<tr><td>✅</td><td>Section 2: interazioni tra le animazioni di dribble/handling — transizioni interpolate in entrambe le direzioni (posa braccio, presa paletta, camera posizione+rotazione)</td></tr>
<tr><td>✅</td><td>Section 2: Shooting System — <code>RobotState.NO_BALL</code>, direzione da raycast sul crosshair, forza costante, animazione windup/release/recover con gomito agganciato al pitch della camera</td></tr>
<tr><td>✅</td><td>Section 2: collisioni backboard/ferro/muri/pali/panchine/tribuna — sfera-vs-AABB e sfera-vs-toro, coordinate reali dagli accessor del GLTF (non stimate), restituzione tarata per oggetto</td></tr>
<tr><td>✅</td><td>Section 2: <code>Basketball</code> (<code>src/Basketball.js</code>) — wrapper con FSM <code>HANDLED</code>/<code>FREE</code>; pickup automatico della palla libera (bounding box del robot, animazione di raccolta breve, nessun tasto)</td></tr>
<tr><td>✅</td><td>Section 2: preview di traiettoria durante la mira (tubo 3D, nero→blu/verde in base a cosa colpisce, ferma al primo tocco col pavimento)</td></tr>
<tr><td>✅</td><td>Section 2: Point System — HUD punteggio (<code>#scoreboard</code>, stile thehollowzone), 2/3 punti in base a dentro/fuori l'arco dei 3 punti catturato al rilascio, canestro rilevato con interpolazione esatta del punto di attraversamento (<code>isHoopCrossing</code>)</td></tr>
<tr><td>✅</td><td>Effetti sonori — <code>SoundEffects</code> (<code>src/SoundEffects.js</code>): <code>AudioListener</code> + 3 suoni sintetizzati via Web Audio (canestro, rimbalzo, tiro), zero asset esterni scaricati</td></tr>
<tr><td>✅</td><td>FSM <code>GameMode</code> (PRACTICE/1v1/3v3) e FSM <code>TimeOfDay</code> (Sunrise/Day/Sunset/Night) — selezionabili dal Main Menu, <code>TimeOfDay</code> collegato a preset reali di luci/sfondo/faretti canestro</td></tr>
<tr><td>✅</td><td>Main Menu completo — GAMEMODES → ROBOT (preview 3D live, il robot palleggia davvero con <code>stepDribble</code>, barre stat SPEED/SHOOTING a blocchi) → TIME OF DAY + START, pausa in-game (ESC) con OPTIONS (ora con sfondo proprio)/BACK TO GAME/BACK TO MAIN MENU (reset completo dello stato di gioco, non solo il punteggio)</td></tr>
<tr><td>✅</td><td>Refactor: <code>SoundEffects</code>/<code>CollisionWorld</code> — audio e collisioni ambientali raccolti in classi wrapper (stesso pattern di <code>RobotBase</code>/<code>Basketball</code>) invece di funzioni/variabili sciolte a livello di modulo in <code>main.js</code>; palleggio (<code>stepDribble</code>) estratto a funzione pura parametrizzata su robot/palla, riusata identica dal gioco vero e dalla preview del menu</td></tr>
<tr><td>✅</td><td>Pallone: rotazione realistica (<code>updateBallSpin</code>, dedotta dalla velocità reale frame-su-frame) durante palleggio/tiro/handling/pickup, prima era visivamente fissa</td></tr>
<tr><td>⬜</td><td>Section 3: Enemies (3v3) — AI e differenziazioni tra classi avversarie</td></tr>
<tr><td>⬜</td><td>Section 3: personalizzazione menu colori</td></tr>
<tr><td>⬜</td><td>Section 3: interazioni e stati aggiuntivi — "Steal"</td></tr>
<tr><td>⬜</td><td>Section 3: Block/Steal (meccaniche difensive)</td></tr>
<tr><td>⬜</td><td>Section 3: Animation Tweaks (rifinitura animazioni esistenti)</td></tr>
<tr><td>✅</td><td>Section 3: Main Menu e HUD rework (vedi "Tecniche UI da riprendere" sopra) — anticipato in Section 2, Main Menu e scoreboard già con font Google/<code>clip-path</code>/<code>backdrop-filter</code> in stile thehollowzone; personalizzazione colori resta da fare (vedi voce sotto)</td></tr>
<tr><td>⬜</td><td>Section 3: secondo polishing e allineamento con altri progetti e con l'esame</td></tr>
<tr><td>⬜</td><td>Section 4: Classe Drone — stat + mossa speciale "Uplifting"</td></tr>
<tr><td>⬜</td><td>Section 4: Classe Legged Manipulator — mossa speciale "Jump"</td></tr>
<tr><td>✅</td><td>Section 4: selettore Sunrise/Day/Sunset/Night (preset illuminazione) — anticipato in Section 2 insieme al Main Menu, FSM <code>TimeOfDay</code> collegata a preset reali di luci/sfondo/faretti canestro</td></tr>
<tr><td>✅</td><td>Section 4: altre impostazioni globali (Other Global Setting) — anticipato in Section 2, menu OPTIONS (SSAO on/off, ombre on/off, volume, FOV)</td></tr>
<tr><td>⬜</td><td>Section 4: modalità di gioco effettive — 3v3 normale, beat the time, beat the score</td></tr>
<tr><td>⬜</td><td>Section 4: polish finale e riallineamento</td></tr>
<tr><td>⬜</td><td>Section 5: revisione completa del codice (a mano e assistita), cambiare il necessario e capire tutto</td></tr>
<tr><td>✅</td><td>GitHub Pages base configurata (<code>base: './'</code> in <code>vite.config.js</code>)</td></tr>
<tr><td>⬜</td><td>GitHub Pages attivo e funzionante online</td></tr>
<tr><td>⬜</td><td>Link GitHub Pages in questo README</td></tr>
<tr><td>⬜</td><td>Documentazione tecnica (5-10+ pagine) — struttura ricorrente scandagliata su 7/8 repo del corso (vedi "Documentazione Tecnica: Struttura da Altri Progetti" più sotto): Intro/Ambiente di Sviluppo → Librerie/Asset esterni → Modelli Gerarchici → Materiali/Luci → Animazioni → Interazione/Manuale Utente → Conclusioni/Limiti, mappata contro i requisiti del corso</td></tr>
<tr><td>✅</td><td>Registrazione Infostud</td></tr>
<tr><td>⬜</td><td>Email al docente</td></tr>
</tbody>
</table>

---

## Run Locally

```bash
npm install
npm run dev      # → localhost:5173
```

---

## Deadlines

| Consegna | Discussione |
|---|---|
| 12 luglio, ore 23:59 | 16 luglio |
| 28 agosto, ore 23:59 | 1 settembre |
| fino a febbraio 2027 | — |

---

## Problemi e Soluzioni

Cronologia dei problemi tecnici incontrati durante lo sviluppo e come sono stati risolti — spostata qui da `CLAUDE.md`, che ora descrive solo lo stato/architettura attuale del progetto.

### Campo GLTF

**KHR_materials_pbrSpecularGlossiness**: il modello Sketchfab usa questa estensione, **rimossa da Three.js r152+**. Non esiste un plugin npm ufficiale — Three.js l'ha rimosso e non l'ha rimpiazzato. Soluzione: plugin custom registrato nel `GLTFLoader`.

```js
class SpecularGlossinessPlugin {
  // Converte diffuseFactor→color, glossinessFactor→roughness, diffuseTexture→map
  getMaterialType() { return THREE.MeshStandardMaterial }
  extendMaterialParams(materialIndex, materialParams) { ... }
}
loader.register(parser => new SpecularGlossinessPlugin(parser))
```

**Colori GLTF modificati manualmente**: il modello aveva materiali grigi/bianchi. I `diffuseFactor` sono stati editati direttamente nel `scene.gltf`:

| Materiale | Originale | Attuale |
|---|---|---|
| `wall` | [0.75,0.75,0.75] | [0.55,0.55,0.55] |
| `Mat.1` | [0.8,0.8,0.8] | [0.55,0.55,0.55] |
| `floor.1` | [0.34,0.34,0.34] | [0.55,0.55,0.55] |
| `floor` | [0.6,0.6,0.6] | [0.55,0.55,0.55] |

Uniformati allo stesso grigio per evitare bande alternate visibili (causate da ombre della ringhiera).

**Z-fighting linee campo**: le linee del campo (`Basket_ball_lines`) sono coplanari al pavimento → flickering dall'alto. Fix:
```js
child.material.polygonOffset = true
child.material.polygonOffsetFactor = -1
child.material.polygonOffsetUnits = -4
child.renderOrder = 1
```

**Perché è meno realistico di Sketchfab**: Sketchfab usa **IBL (Image-Based Lighting)** con HDR environment map reale + AO automatico. Noi abbiamo solo hemisphere + directional. Non c'è un modo semplice di replicarlo senza caricare un file HDR esterno (`RGBELoader` + `PMREMGenerator`). `RoomEnvironment` è stato provato ma sovraespone tutto sommandosi alle luci esistenti.

### Post-Processing & Illuminazione

Aggiunti `EffectComposer` (`RenderPass` → `SSAOPass` → `OutputPass` → `SMAAPass`) e 4 `PointLight` sui lampioni del campo. Tabella dei problemi incontrati durante il debug:

| # | Problema | Causa | Soluzione |
|---|---|---|---|
| 1 | Ombre "a chiazze" sui muri (shadow acne) | `sun.shadow.bias`/`normalBias` a 0 (default); frustum enorme (±2500) su 4096px = bassa densità texel, self-shadowing sulle superfici quasi parallele alla luce | `sun.shadow.bias = -0.0005`, `sun.shadow.normalBias = 2` |
| 2 | Buffer debug SSAO tutto bianco (nessuna occlusione) | `minDistance`/`maxDistance` di `SSAOPass` sono frazioni **normalizzate** di profondità (0–1 su tutto near→far), non unità mondo — passati valori enormi (0.5/25/80), condizione mai soddisfatta | Derivati da `kernelRadius / (camera.far - camera.near)` |
| 3 | SSAO ancora tutto bianco dopo il fix #2 | `camera.near = 0.1` su `far = 5000` (rapporto 1:50000) satura la precisione del depth buffer → depth texture inutilizzabile a distanza | `camera.near` alzato a `5` |
| 4 | Lag dopo aver aggiunto `SSAOPass` | Risoluzione del pass = canvas × devicePixelRatio(2), kernel a 32 sample | `renderer.setPixelRatio(1)`, `kernelSize` ridotto a 16 |
| 5 | Aloni scuri "sospesi in aria" attorno ai bordi degli oggetti | `kernelRadius` troppo grande (90): i sample intercettano superfici lontane dietro la silhouette e le confondono per occlusione locale | `kernelRadius` ridotto a `12` |
| 6 | Antialiasing sparito introducendo `EffectComposer` | `renderer.antialias: true` non ha effetto: il rendering passa dai `WebGLRenderTarget` interni del composer, mai da `renderer.render()` diretto sul canvas | Aggiunto `SMAAPass` come ultimo pass della pipeline |
| 7 | Ricolorazione palo lampione senza effetto visibile | Colorata la mesh sbagliata (`Cylinder_1_3`, un minuscolo raccordo decorativo) invece del vero palo (`Cylinder_5`, che usa il materiale `floor.1` — condiviso col pavimento, per questo sembrava "uguale al pavimento") | Palo identificato correttamente analizzando gerarchia nodi/mesh + bounding box nel GLTF; materiale clonato prima di ricolorare (era condiviso) |
| 8 | Match per nome mesh (`'Cylinder_5_floor.1_0'`) non funzionava | `GLTFLoader`/Three.js sanitizza i nomi nodo rimuovendo i caratteri riservati per i path di animazione (`. : / [ ]`) | Confronto sul nome sanitizzato, senza punto: `'Cylinder_5_floor1_0'` |
| 9 | Posizione dei lampioni sbagliata (luci nel punto sbagliato) | Calcolata solo la matrice del nodo padre (`Null_1_7`), ignorata la trasformazione locale del nodo `Sphere_1` (scala 2× + offset Y) frapposta tra i due | Ricomposta l'intera catena di matrici nodo-per-nodo dalla root fino alla mesh |
| 10 | `PointLight` dei lampioni non proiettava ombra | La luce sta al centro esatto del globo (sfera solida): il depth-test dell'ombra intercetta subito il proprio guscio in ogni direzione → self-shadowing totale, nessuna luce esce | `shadow.camera.near` alzato a `30` (> raggio del globo, ~26 unità) per escludere il proprio guscio dal depth-test |
| 11 | `PointLight` dei lampioni non illuminava visibilmente | `intensity` è in **candela** con `decay=2` (inverso-quadratico, fisicamente corretto da three.js r155+); alla distanza reale lampione→terreno (~250 unità) `intensity=3000` → E ≈ 0.04 lux, invisibile | `intensity` alzata di ordini di grandezza (~200000) per la scala "grande" della scena |
| 12 | Ombre dei lampioni dal bordo duro, non morbide | `shadow.radius` di default = 1, blur PCF quasi invisibile | `shadow.radius = 6` |

**Lezione generale**: la scena usa unità "cm-scale" molto grandi (migliaia di unità) — qualunque parametro three.js con semantica fisica (depth precision, candela/decay, kernel SSAO in world-space) va ricalcolato per questa scala, i default sono tarati per scene ~1-10 unità.

### Robot Procedurale — MANIPULATOR

| # | Problema | Causa | Soluzione |
|---|---|---|---|
| 1 | Pannello CAMERA mostrava un "Roll" spurio (~40°) su una camera che non può fisicamente rollare (solo mouse look) | `PointerLockControls` costruisce la rotazione con ordine Euler `'YXZ'`, ma `camera.rotation` veniva letta/scritta con l'ordine di default `'XYZ'` — ordine sbagliato genera una componente Z fittizia | `camera.rotation.order = 'YXZ'` impostato una volta sull'oggetto camera |
| 2 | Ruote scollegate dal disco dopo aver introdotto lo slider "Wheels Scale" | L'altezza del disco (`discY`) era un valore fisso calcolato dal raggio ruota *non scalato* — cambiando la scala le ruote si spostavano/rimpicciolivano ma il disco restava fermo | `syncChassisHeight()` ricalcola la posizione Y di disco+base dal bordo superiore reale delle ruote ogni volta che cambia la loro scala |
| 3 | Ruote che sbucavano sopra il disco anche dopo il fix #2 | Il toro giace nel piano XY (bounding box ±(radius+tube) sia in X sia in Y): il "bordo superiore" reale è a `2×(radius+tube)` dal suolo, non `radius+tube` come calcolato — la ruota era più alta di quanto stimato | Ricalcolato correttamente il raggio esterno (`wheelOuterRadius`) e il centro-ruota posizionato lì da terra |
| 4 | Ruote perpendicolari alla direzione di marcia invece che allineate | Il toro (piano XY, perno lungo Z) ha come direzione di rotolamento "a riposo" l'asse **X locale**, non Z — applicare `rotation.y = robotFacing` direttamente allinea l'*asse* della ruota al movimento, non la direzione di rotolamento | Offset di `-90°`: `wheelsGroup.rotation.y = robotFacing - Math.PI/2` |
| 5 | Tasti A/D invertiti in Play mode | Il vettore "destra" della camera (`camRightFlat`) era calcolato con il segno opposto rispetto alla formula equivalente già usata in Spectate (`camDir × up`) | Segno corretto: `(-cos(yaw), 0, sin(yaw))` invece di `(cos(yaw), 0, -sin(yaw))` |
| 6 | Paletta dell'end effector visibilmente storta (non piatta/orizzontale) | Gomito (75°) e polso (-30°) ruotano sullo stesso asse (X) quindi i pitch **si sommano** (45° netti) — la paletta ereditava quell'inclinazione senza mai essere compensata | Contro-rotazione: `paddle.rotation.x = -(elbow.rotation.x + wrist.rotation.x)`, ricalcolata ogni frame in Play |
| 7 | End effector doveva connettersi al centro del **lato lungo** della paletta, non al suo centro | `BoxGeometry` è centrata sulla propria origine di default | Pivot della geometria traslato sul bordo lungo (`geo.translate(0,0,±width/2)`) invece di offsettare la mesh |
| 8 | "WASD relativo alla camera" nella prima versione era indistinguibile da "assi mondo fissi" | La camera in Play era interamente derivata da `robotFacing` (ultima direzione di movimento) — non aveva un orientamento indipendente da cui calcolare assi diversi | Aggiunta camera orbitale a mouse (yaw/pitch liberi via pointer lock, disaccoppiata dal movimento); WASD ora usa `camForward`/`camRightFlat` derivati dall'orbit yaw corrente |

**Revisione DRY / semplicità (post Step 4)**: revisione mirata a duplicazione di codice e "cose semplici fatte in modo complicato" su `main.js`/`manipulator.js`/`index.html`:

- **`manipulator.js`**: `makeScaleSetter(key, mesh)` factory per i 6 setter scale identici; `createLinkControls({...})` generica per Scale/Length/Thickness di link1/link2 (prima ~25 righe quasi duplicate 1:1); `replaceGeometry(mesh, geo)` per il pattern dispose+riassegna ripetuto 6 volte
- **`main.js`**: `createSliderControl()` estratta e riusata sia dallo slider "Manipulator Scale" sia da `addComponentSection`; costante `SCALE_SLIDER_RANGE` invece della tripla `0.2/3/0.05` ripetuta 7 volte; helper `angleToForward()`/`rotateRight()` per la conversione angolo→vettore direzione (prima scritta a mano 4 volte — la stessa causa del bug #5 sopra); `camReadouts` come array iterato invece di 6 variabili + 6 assegnazioni speculari
- **`index.html`**: classe `.hidden` unica invece di 4 regole separate; classi base condivise `.hud-panel`/`.hud-pill`

Unificata anche la posa: prima `main.js` toccava gli interni del robot in due modi diversi — `controls.X()` per la forma, accesso diretto a `manipulator.joints.X.rotation.Y` per la posa in Play. Aggiunti a `controls`: `setAimYaw(angle)`, `setAimPitch(pitchOffset)`, `setWheelsYaw(angle)` — `main.js` non legge/scrive più nessun oggetto interno del robot direttamente.

### Pallone e Palleggio

| # | Problema | Causa | Soluzione |
|---|---|---|---|
| 1 | A fine `push`, ogni tanto (casuale) la palla entra in `drop` con velocità quasi nulla invece di quella reale della spinta — scatto visibile | La velocità di rilascio era letta come differenza finita a **singolo frame** (`Δy/delta`): se un micro-hitch di frame-rate capitava esattamente sul frame in cui l'ease della spinta satura (clamp a 1), il movimento residuo della paletta era piccolo ma il `delta` di quel frame grande → velocità stimata vicina a zero proprio nell'unico frame che eredita tutto il `drop` | Timestep fisso (`DRIBBLE_FIXED_DT = 1/120` + accumulator, disaccoppiato dal `delta` di rendering): la simulazione non vede mai un `delta` anomalo, solo passi costanti — il caso patologico non può più capitare |
| 2 | Dopo il fix del timestep fisso, lo stesso reset di velocità (ora sempre uguale, non più casuale) si ripresentava **ad ogni ciclo** | `dribblePhaseT` accumula `dt = 1/120` (non rappresentabile esattamente in binario) per ~30 passi: arriva a un pelo **sotto** la soglia della durata di `push` invece che esattamente uguale — l'ease tocca `0.999999999999998` invece di `1`, e il controllo `>= 1` falliva per quell'epsilon, richiedendo un passo fisso extra "sprecato" (la paletta è già a fine corsa, non si muove) in cui `Δy = 0` esatto | Tolleranza sul confronto invece di uguaglianza stretta: `dribbleArmEase >= 1 - 1e-6` |

### Shooting System, Collisioni e Pickup (Section 2)

Lo Shooting System (`RobotState.NO_BALL`, animazione windup/release/recover, collisioni backboard/ferro/muri/pali/panchine/tribuna, preview di traiettoria, pickup automatico) è stata la parte più lunga e iterata del progetto finora. Tabella dei problemi reali incontrati (non le tante regolazioni di gusto su velocità/restituzione/durate, quelle sono solo tuning):

| # | Problema | Causa | Soluzione |
|---|---|---|---|
| 1 | Crash al momento del rilascio del tiro (`setShootTilt is not a function`) | Aggiunta la variabile `shootTiltOffset` e usata in `levelPaddle()` dimenticando di esportare il setter corrispondente da `manipulator.js` | Aggiunto `controls.setShootTilt(offset)` mancante |
| 2 | Crash con `shootStateTransitionTimer` "usata prima di essere dichiarata" | La variabile veniva letta nella logica di rilascio prima della sua `let` dichiarata più in basso nel file | Dichiarazione spostata più in alto, vicino a `shootReleased` |
| 3 | Fix a un problema di tracking palla↔paletta in HANDLING aveva **rotto il palleggio automatico** (che prima funzionava) | Introdotto un nuovo calcolo dell'offset (quaternion-based) usato sia da `updateHandling` sia — per errore — da `updateDribble`, che aveva la sua formula (yaw + offset mondo) tarata separatamente | `updateDribble` riportato esattamente alla formula originale; creato un punto di tracking **separato** (`ballRestPoint`, vedi sotto) solo per HANDLING/tiro |
| 4 | La palla in HANDLING seguiva un punto sbagliato (offset a occhio lungo "la direzione di link2"), sempre storta | La costruzione geometrica corretta è diversa: le due metà della paletta a V vanno estruse lungo le loro normali fino al punto di convergenza — quello è il centro-palla corretto, non un offset arbitrario | `ballRestPoint` aggiunto in `manipulator.js`, calcolato come `d / cos(halfAngle)` (mentre `paddleCenter`, usato dal palleggio, resta `d × cos(halfAngle)`) |
| 5 | La camera usciva dalla vista libera di HANDLING nell'istante esatto del rilascio, facendo sembrare che il tiro puntasse "da un'altra parte" anche se la direzione catturata era corretta | `manipulator.state` passava a `NO_BALL` nello stesso frame del rilascio reale — la camera (che segue `isHandling`) si sganciava dalla vista libera mentre la palla stava ancora lasciando la mano | Rilascio fisico (`shootReleased=true`, cattura direzione/velocità) disaccoppiato dal cambio di stato "vero", ritardato di `SHOOT_STATE_TRANSITION_DELAY` (0.35s) |
| 6 | Il canestro/pickup smettevano di funzionare completamente dopo il fix precedente: `manipulator.state` non passava **mai** a `NO_BALL` | Il countdown di `SHOOT_STATE_TRANSITION_DELAY` viveva **solo** dentro il branch `shootPhase === 'release'` — ma con `SHOOT_RELEASE_DURATION` (0.3s) più breve del countdown (0.35s), la fase passava a `'recover'` prima che il countdown finisse, e lì restava bloccato per sempre (il branch non veniva più eseguito) | Countdown spostato fuori dai branch di fase, eseguito sempre in cima a `updateShootAnimation`; la funzione stessa resta "viva" anche a `shootPhase==='idle'` finché il countdown non finisce (altrimenti smetteva comunque di essere chiamata) |
| 7 | Dopo un pickup, lo stato tornava a `DRIBBLE`/`HANDLED` ma **il palleggio non ripartiva mai** | `shootReleased` (impostato `true` al tiro precedente) non veniva mai resettato a `false` al completamento del pickup — il branch di `animate()` instrada su `updateShotFlight` finché `manipulator.state===NO_BALL` **oppure** `shootReleased`, quindi restava bloccato lì anche a stato già tornato `DRIBBLE` | Aggiunto `shootReleased = false` nel blocco di completamento di `updatePickup()` |
| 8 | Il pickup automatico non scattava mai, nonostante il robot sembrasse visivamente vicino alla palla | Il test iniziale usava un semplice raggio dal **centro** del robot (`manipulator.root.position`) — con la scala del robot (45×) il solo corpo/ruote occupano già ~60-70 unità dal centro, quindi il raggio scelto richiedeva quasi la sovrapposizione perfetta col centro della palla | Sostituito con un vero bounding box (`THREE.Box3().setFromObject(manipulator.root)`, ricalcolato dalla geometria reale ogni volta), espanso di un margine — rappresenta la vera forma larga/bassa del robot invece di un raggio da un punto solo |
| 9 | Durante il pickup la palla "sembrava scappare" se era ancora in movimento nell'istante in cui il pickup partiva | La palla veniva interpolata (lerp) dalla sua posizione di cattura fino alla paletta per tutta la durata dell'animazione — per quel tempo restava visivamente "libera" | La palla si blocca (`.copy()`, non lerp) sulla paletta dal primissimo frame del pickup; solo il braccio anima un piccolo "tuffo" (0→1→0) come flourish visivo |
| 10 | Al completamento del pickup, uno scatto visibile del braccio | Il "tuffo" del braccio saliva fino ad ampiezza piena (1.0) proprio nell'istante in cui il palleggio automatico riprendeva da 0 | Curva del tuffo cambiata da 0→1 a 0→1→0 (`Math.sin(t·π)`): torna a 0 da sola prima che il pickup finisca, l'aggancio col palleggio è già a 0 su entrambi i lati |
| 11 | Il pallone durante il pickup si compenetrava visibilmente con la paletta | Usato per errore `manipulator.paddle` (il centro piatto sulla superficie, pensato per il palleggio) invece di `manipulator.ballRestPoint` (il punto corretto, spostato fuori lungo la convergenza della V, già usato da HANDLING/tiro) | Sostituito il riferimento in `updatePickup` |
| 12 | La preview di traiettoria (linea nera→blu/verde) è passata per tre implementazioni diverse prima di funzionare bene | `THREE.Line` semplice non aveva spessore regolabile; passata a `Line2`/`LineGeometry`/`LineMaterial` (fat lines) per lo spessore, ma il suo shader degenera quando un segmento punta quasi parallelo alla direzione della camera — proprio il caso comune quando si mira lungo la traiettoria di tiro, causando una linea nera "più corta" del reale | Abbandonato `Line2`, sostituito con `THREE.TubeGeometry` + `CatmullRomCurve3` — geometria 3D vera, nessuna proiezione screen-space, nessun caso degenere |
| 13 | Il tratto verde (canestro) non appariva quasi mai nella preview, anche per tiri che entravano davvero | La zona di contatto fisico del ferro (fino a `RIM_TUBE_RADIUS+BALL_RADIUS` oltre l'anello) è più larga della zona "canestro vero" (`HOOP_DETECTION_RADIUS`) — il tocco sul ferro scattava quasi sempre per primo, bloccando il colore su blu prima che il test del canestro potesse mai scattare | Il test del canestro (`isHoopCrossing`) viene ricontrollato **ad ogni passo**, anche dopo un tocco già avvenuto, e ha sempre priorità sul colore finale |
| 14 | Un tiro veloce contro la backboard **ogni tanto** passava attraverso senza rimbalzare | Tunneling classico: a `SHOT_SPEED`~1100 unità/s un frame intero (delta variabile, 16-30ms) sposta la palla di 18-33 unità — più dello spessore del pannello (`BACKBOARD_HALF_THICKNESS×2` = 8 unità) — la palla "salta" da un lato all'altro del pannello senza mai risultare "dentro" durante il check | `updateShotFlight` suddivisa in sotto-passi a timestep fisso (`SHOT_PHYSICS_SUBSTEP_DT = 1/240`), spostamento massimo per sotto-passo sotto le 5 unità |
| 15 | Le collisioni dei muri hanno richiesto **tre tentativi**: prima un box preso dal bordo del campo dipinto (`floor_court`, troppo vicino — è ancora bordocampo calpestabile), poi il bounding box di tutto il sottoalbero `walls` del GLTF (troppo lontano — includeva le tribune profonde, la palla non ci arrivava mai), poi un rettangolo per lato preso dal materiale `floor` (posizione giusta ma con buchi nei punti dove i pannelli reali non coprivano tutto lo span) | Il vero confine non è un rettangolo semplice: sono **66 mesh reali** distinte nel sottoalbero `walls` (pannelli verticali + gradoni di tribuna a Y crescente), con spazi vuoti intenzionali tra loro (pattern architettonico) | Estratte tutte le 66 mesh una per una (bounding box world-space dagli accessor GLTF, script Node dedicato), incollate come array statico di `THREE.Box3` — nessuna approssimazione aggregata |

### Main Menu, Point System, Hoop Assist ed Effetti Sonori (Section 2, seconda parte)

| # | Problema | Causa | Soluzione |
|---|---|---|---|
| 1 | Il menu principale non spariva dopo aver scelto la fase del giorno | `menuOverlayEl.classList.add('hidden')` non aveva alcun effetto: la regola CSS sull'ID `#menu-overlay` (`display: flex`) ha specificità più alta della classe `.hidden` (`display: none`) | Impostato `menuOverlayEl.style.display` direttamente via JS invece di alternare la classe |
| 2 | In gioco, premendo ESC si tornava prima alla schermata "Click per entrare" e serviva una **seconda** pressione per aprire davvero il menu di pausa | Col puntatore lockato, il **browser** intercetta ESC per sbloccarlo PRIMA che l'evento arrivi al `keydown` handler della pagina — la prima pressione sblocca soltanto, la seconda (ora sbloccato) raggiunge finalmente il handler | Aggiunta l'apertura del menu di pausa anche sull'evento `unlock` di `PointerLockControls` (idempotente), con un flag `suppressPauseOnUnlock` per non farla scattare quando è il tasto M a sbloccare esplicitamente |
| 3 | L'hint "Click per entrare" lampeggiava visibilmente per un frame al caricamento della pagina, nonostante non dovesse più esistere come step | `hint.style.display = 'none'` veniva eseguito troppo tardi nell'esecuzione del modulo (dopo tutto il setup sincrono di scena/robot/luci), lasciando una finestra di uno o più frame visibili | Stato nascosto spostato direttamente nell'HTML: `<div id="hint" style="display:none">` |
| 4 | Disattivare le ombre da OPTIONS non le rimuoveva, le "congelava" nell'ultimo stato | `renderer.shadowMap.enabled = false` da solo non forza retroattivamente i materiali già compilati a rimuovere il loro shadow-path — gotcha noto di three.js | Aggiunto anche `sun.castShadow = enabled` + `material.needsUpdate = true` su tutta la scena (`scene.traverse`) |
| 5 | **Il campo intero smetteva di essere renderizzato** dopo una modifica ai faretti canestro | Durante un refactor del materiale dei faretti, la dichiarazione `const poleMetalMaps = createProceduralPBRMaps(...)` era stata accidentalmente cancellata, ma la variabile restava referenziata più sotto (nel callback async del `GLTFLoader`, per il materiale dell'asta del lampione) — `ReferenceError` che crashava il callback prima di `scene.add(gltf.scene)` | Re-individuato con `grep -c` (il conteggio della dichiarazione risultava 0, mentre `node --check`/`npm run build` restavano puliti: controllano solo la sintassi, non la risoluzione dei riferimenti runtime dentro un callback) — dichiarazione ripristinata con un commento di avviso esplicito |
| 6 | Dopo un rimbalzo, a volte la palla attraversava la backboard (o parte del ferro) invece di rimbalzarci contro | Un unico timer di cooldown globale sospendeva **tutte** le collisioni per 0.3s dopo un rimbalzo qualsiasi — un rimbalzo sul ferro seguito a ruota da un volo verso la backboard attraversava quest'ultima senza mai risultare in collisione | Cooldown per-oggetto (`Map<collidable, secondiResidui>`, non un timer unico); volo reale e preview di traiettoria usano mappe separate (la preview non deve "consumare" il cooldown di un oggetto reale mentre si sta solo mirando) |
| 7 | Molte collisioni segnavano "dentro" (verde) nella preview per tiri che in realtà toccavano il ferro e rimbalzavano via | `HOOP_DETECTION_RADIUS` (35, primo tentativo) era più largo del vero spazio fisicamente libero (`RIM_RING_RADIUS - RIM_TUBE_RADIUS - BALL_RADIUS = 21`) | Ridotto al valore geometrico più stretto (poi affinato ulteriormente, vedi #9) |
| 8 | Il canestro con statistica SHOOTING alta, da vicino, a volte **peggiorava** il tiro invece di aiutarlo (la palla veniva sparata oltre il centro) | Il primo hoop-assist era un'accelerazione sulla velocità, che si accumula con quanto tempo la palla passa nel cono d'assistenza — un tiro lento/da vicino passa più tempo nel cono, accumulando una spinta eccessiva | Sostituito con una correzione di **posizione** (`pull = min(strength * dist/coneRadius * rate * dt, 1)`, clampata a 1): non può mai superare il centro del canestro qualunque sia il tempo di permanenza |
| 9 | Nonostante il fix del cooldown per-oggetto, tiri che entravano chiaramente nel canestro continuavano a non dare né punteggio né linea verde in preview, specialmente da vicino | Due cause sommate: (a) `isHoopCrossing` testava solo la posizione **dopo** il passo di simulazione, non il punto esatto di attraversamento — con un passo di campionamento grezzo (preview) la palla poteva "saltare oltre" la stretta finestra del canestro proprio nell'istante vero del passaggio; (b) `HOOP_DETECTION_RADIUS` non aveva alcun margine di tolleranza (un tiro può sfiorare l'interno del ferro ed entrare comunque, non ogni tocco fa rimbalzare via) | `isHoopCrossing(previousPos, position, hoop)` ora **interpola** linearmente il punto esatto di attraversamento tra i due campioni invece di testare solo quello finale; `HOOP_DETECTION_RADIUS` riportato al valore geometrico esatto + 30% dello spessore del ferro di tolleranza; passo della preview (`TRAJECTORY_DT`) affinato da 0.02 a 0.005 per avvicinarsi alla risoluzione del volo reale (`SHOT_PHYSICS_SUBSTEP_DT=1/240`) |
| 10 | La linea diventava verde solo se il tiro passava in un cerchio molto interno al canestro — nella realtà un tiro passa "in tutto il rim", anche sfiorando l'interno del ferro | `HOOP_DETECTION_RADIUS` (21+30% tolleranza ≈ 22.2) rappresentava solo "il centro della palla non tocca mai il ferro", non "il centro passa da qualche parte dentro il buco del canestro" — molto più stretto del vero raggio dell'apertura | Allargato al vero raggio geometrico dell'apertura (`RIM_RING_RADIUS - RIM_TUBE_RADIUS = 36`) |
| 11 | Dopo backboard+rimbalzo sul ferro, la palla **ogni tanto** attraversava comunque la backboard, anche col cooldown per-oggetto già a posto | 0.3s di cooldown (valore originale) era troppo lungo: backboard e ferro sono fisicamente vicini, un rimbalzo sul ferro seguito a ruota da un ritorno verso la STESSA backboard (tutt'altro che raro alle velocità di tiro in gioco) restava ancora in cooldown su quell'oggetto specifico | `COLLISION_COOLDOWN` ridotto da 0.3s a 0.05s — la posizione viene già respinta esattamente al bordo del volume espanso nello stesso passo, bastano pochi passi fisici perché la velocità riflessa allontani davvero la palla |
| 12 | Allargare `HOOP_DETECTION_RADIUS` (fix #10) rischiava di reintrodurre falsi positivi (verde/punteggio su tiri che in realtà rimbalzano via) | Nel volo reale `collisionWorld.resolve(...)` (che può deflettere la palla) veniva chiamato **prima** di `checkHoopScore` — il canestro veniva giudicato sulla posizione già respinta dalla collisione in questo stesso passo, non sul percorso balistico puro | Riordinato: `checkHoopScore` ora gira prima di `collisionWorld.resolve(...)` in `stepShotFlight`, stesso ordine già usato dalla preview |
| 13 | La preview robot nel Main Menu (card MOBILE MANIPULATOR) mostrava il braccio muoversi ma la palla restava sempre incollata alla mano, mai un vero rimbalzo a terra | Prima versione: solo la fase "push" reimplementata a mano, senza le fasi drop/rise libere | Riscritta per usare `stepDribble`, la **stessa** funzione del palleggio automatico vero (estratta e parametrizzata su robot/palla/oggetto-stato), non una ricostruzione approssimata — vedi "Pallone e Palleggio" in CLAUDE.md |
| 14 | Nella preview (prima di riusare `stepDribble`), c'era una pausa percepibile tra la fine della spinta e l'inizio della caduta, e il braccio iniziava a risalire nello stesso istante in cui la palla si staccava | Tentativo intermedio con `smoothstep` (derivata zero a inizio/fine) per la caduta, e un'unica transizione invece di separare "drop" (braccio fermo) da "rise" (braccio risale) | Superato riusando `stepDribble` stesso, che già separa correttamente le due fasi |
| 15 | "Back to Main Menu" azzerava il punteggio ma una nuova PRACTICE ripartiva col robot fisicamente dov'era stato lasciato (a metà tiro/palleggio/dash) | Il reset toccava solo `score`, non lo stato di gioco transitorio (posizione robot, `RobotState`, palleggio, dash, tiro, handling, pickup) | Aggiunta `resetGameplayState()`, chiamata insieme all'azzeramento del punteggio |

---

## Confronto con Altri Progetti del Corso (Step 6 — Polish)

Durante la prima fase di polish (ricerca di dead code/inefficienze/DRY) abbiamo anche scandagliato altri progetti finali dello stesso corso (stessa consegna, stessa rubrica) per confrontare approcci a librerie, modellazione, animazione, fisica e texture — 7 durante lo Step 6, un ottavo (`isometric_racer`) più avanti per lo stile del main menu/selezione. A differenza dello Step 1 (8 repo analizzati all'inizio, di cui non abbiamo mai salvato i nomi — persi), stavolta teniamo il link di ognuno.

| Repo | Librerie oltre three.js | Modellazione | Animazione | Fisica | Texture | Rischio compliance |
|---|---|---|---|---|---|---|
| [a-space-odyssey](https://github.com/SapienzaInteractiveGraphicsCourse/final-project-a-space-odyssey) | Tween.js, dat.GUI (vendored) | GLTF/FBX Mixamo rigged, importato | Tween.js su pose esportate da Blender | Nessuna (solo AABB box-check) | PBR completa | Alto — libreria di animazione su modello importato |
| [thegoblinslayers](https://github.com/SapienzaInteractiveGraphicsCourse/final-project-thegoblinslayers) | nessuna (CDN, no bundler) | Perlopiù GLTF importati; una trappola procedurale | `AnimationMixer`/`AnimationClip` sul personaggio principale | AABB, no engine | PBR 4K completa | Medio — Mixer su personaggio chiave |
| [404nation](https://github.com/SapienzaInteractiveGraphicsCourse/final-project-404nation) | tween.js (installata, mai usata) | Procedurale (Box/Sphere/Cone), factory pattern — simile al nostro | 100% imperativo, tween non usata nonostante la dipendenza | Gravità a griglia discreta (turn-based) | PBR reale (base+normal+roughness) | Basso — solo dipendenza morta |
| [theboringgame](https://github.com/SapienzaInteractiveGraphicsCourse/final-project-theboringgame) | cannon-es (fisica) + tween.js (animazione) | GLB rigged importato, livelli da JSON | State machine + tween.js sui bone | cannon-es, vero motore fisico | PBR completa (6 mappe) | Alto — entrambe le librerie usate attivamente |
| [interactivelan](https://github.com/SapienzaInteractiveGraphicsCourse/final-project-interactivelan) | simplex-noise (solo terreno) | GLTF rigged importato (Blender) | 100% imperativo, delta variabile | A* pathfinding + raycasting a mano | PBR completa (5 mappe) | Medio — modelli importati, niente lib di animazione |
| [thehollowzone](https://github.com/SapienzaInteractiveGraphicsCourse/final-project-thehollowzone) | tween.js (installata, mai usata) | Procedurale, gerarchia profonda per-arto | 100% imperativo, pattern reset+delta | AABB/cerchio a mano, no accumulator | PBR completa (4 mappe) | Basso — solo dipendenza morta |
| [robot_factory](https://github.com/SapienzaInteractiveGraphicsCourse/final-project-robot_factory) | nessuna, no bundler | Procedurale puro, il più profondo (braccio 7 giunti) | 100% imperativo | Mass-spring cable scritto a mano (Eulero) | `CanvasTexture` proceduali (bump+roughness) | Nessuno apparente — il più "pulito" |
| [isometric_racer](https://github.com/SapienzaInteractiveGraphicsCourse/final-project-isometric_racer) | nessuna, no bundler (`"three": "0.160.0"` locale in `libs/`) | GLB importati (auto: Dodge/Lamborghini/Nissan; tracciati GLTF+bin) | 100% imperativo, ruote animate a mano (gruppi "steer"+"roll" annidati) | Interamente a mano (`src/vehicle/physics.js`): sterzo per accumulo d'angolo, raycast verticale per aderenza al terreno con tilt via quaternioni, grip differenziato per materiale (erba/asfalto/boost pad), 3 raycaster orizzontali per collisioni con rimbalzo | Numerose, scaricate nei GLTF (baseColor+normal+metallicRoughness+specularF0 sul tracciato più completo); unica proceduraie: la scacchiera del traguardo via `CanvasTexture` | Basso — fisica veicolo e animazione ruote interamente scritte a mano, nessuna libreria |
| **(il nostro)** | nessuna | Procedurale puro (3R + ruote) | 100% imperativo, timestep fisso (unici a farlo) | State machine a timestep fisso | Pallone: color+normal+metallic-roughness; campo: solo color | Basso |

### Cosa abbiamo imparato

- **`tween.js` installata-ma-mai-usata in 3 repo su 7** (a-space-odyssey la usa davvero, 404nation e thehollowzone no) — probabile boilerplate/template del corso che la include di default, non rimossa da chi non la usa.
- **Solo 1 su 7 usa un motore fisico vero** (theboringgame → cannon-es). Tutti gli altri scrivono fisica/collisioni a mano, ma il nostro timestep fisso con accumulator è più sofisticato di chiunque altro (gli altri integrano direttamente sul `delta` variabile).
- **Modellazione spaccata a metà**: 4/7 importano modelli riggati (a-space-odyssey, thegoblinslayers, theboringgame, interactivelan), 3/7 costruiscono tutto proceduralmente (404nation, thehollowzone, robot_factory) — noi compresi. I repo procedurali hanno anche il rischio di compliance più basso, non a caso.
- **Siamo gli unici con un post-processing pipeline** (SSAO+SMAA) — nessun altro repo ha un `EffectComposer`.
- **Sulle texture eravamo indietro, ora recuperato in parte**: tutti gli altri hanno set PBR completi (normal+roughness+AO, spesso 4-6 mappe) sui loro asset principali, quasi sempre **scaricati** da librerie di texture gratuite (nomi/risoluzioni tipiche di ambientCG/Poliigon). **Unica eccezione: `robot_factory`** (il progetto più simile al nostro per filosofia) genera le texture proceduralmente via `CanvasTexture`, senza asset esterni — abbiamo seguito lo stesso approccio per le texture del robot (normal map + roughness map generate in codice via height-field→gradiente, vedi `src/robots/manipulator.js`), invece di scaricare texture pronte come fa la maggioranza; per campo/pallone (già asset esterni non nostri) resta aperta l'opzione di scaricare qualcosa in futuro se necessario.
- **GUI/debug**: `dat.GUI` compare una sola volta su 7 (a-space-odyssey); nessuno usa `lil-gui`; gli altri 6 (incluso `thehollowzone`) non hanno nessuna libreria GUI né un pannello debug visibile nel codice. Il nostro pannello fatto a mano non è un'anomalia, anzi è più elaborato della media.
- **`isometric_racer`** (analizzato a parte, dopo lo Step 6, per il main menu): la sua card di selezione auto renderizza un **thumbnail 3D live** con un renderer offscreen condiviso, camera inquadrata sul bounding box reale del modello (8 angoli proiettati nel frustum per la distanza minima che li contiene tutti), un render singolo convertito in PNG (`toDataURL`) e incollato come `<img>` — tecnica ripresa identica per la card MANIPULATOR del nostro main menu (`renderRobotCardPreview` in `src/main.js`), dato che anche i nostri robot sono procedurali e non ha senso avere uno screenshot statico pre-fatto. Fisica veicolo (sterzo, aderenza al suolo via raycast, grip per materiale, collisioni con rimbalzo) interamente scritta a mano in `src/vehicle/physics.js`, nessun motore esterno — stesso spirito "zero librerie" della maggioranza scandagliata.

### Documentazione Tecnica: Struttura da Altri Progetti (ricerca preliminare)

Prima di scrivere la nostra documentazione tecnica (5-10+ pagine, requisito del corso), controllati gli altri 8 repo per vedere se/come avessero strutturato la loro. Nessuna implementazione ancora — solo riferimento per quando la scriveremo.

| Repo | Report trovato? | File & posizione | Pagine |
|---|---|---|---|
| a-space-odyssey | Sì | `report.pdf` (root) | 5 |
| thegoblinslayers | Sì | `Project Presentation.pdf` (root — nonostante il nome, è un report vero non slide) | 9 |
| 404nation | No | — solo README | — |
| theboringgame | Sì | `report/Affinita_Meconi_Report.pdf` | 20 |
| interactivelan | Sì | `report.pdf` + `report.tex` **+ `Presentation.pptx`** separata | 17 |
| thehollowzone | Sì | `docs/technical-report.pdf` + screenshot | 15 |
| robot_factory | Sì | `docs/project_documentation.pdf` | 12 |
| isometric_racer | Sì | `docs/Report_Gallo_Rinaldi.pdf` | 20 |

**7 repo su 8** hanno un report dedicato oltre al README (quasi sempre PDF numerato/sezionato, mediana ~15 pagine), posizionato in root o in `docs/`/`report/`. Struttura ricorrente, praticamente identica in tutti: **Intro/Ambiente di Sviluppo → Librerie/Tool/Asset esterni → Modelli Gerarchici → Materiali/Luci → Animazioni → Interazione Utente/Manuale Utente** (spesso una vera tabella controlli) **→ Conclusioni/Limiti**, quasi sempre mappata esplicitamente contro i requisiti dichiarati del corso. `robot_factory` (il più simile al nostro per filosofia procedurale/imperativa) apre addirittura con un "requirement coverage summary" diretto — buon modello da seguire per la nostra.

**Chiarimenti sui requisiti reali del corso** (dalla lettura effettiva dei 7 report, non solo la struttura): nessuna regola aggiuntiva/diversa trovata su rubrica a punti, gruppi, formato della discussione orale o librerie vietate — ma tre cose da tenere a mente:

- **Il modello gerarchico PUÒ venire da una libreria esterna** — `a-space-odyssey` cita testualmente il requisito del corso: *"The composition of the two robots is complex enough and can be obtained from an external library."* Il "nessun modello esterno per i robot" è quindi una regola **nostra**, non richiesta dal corso — la richiesta vera è solo "gerarchia sufficientemente complessa".
- **Vendorizzare Three.js localmente (no CDN a runtime) è una precauzione presa da due team indipendenti** (`isometric_racer`, `robot_factory`), motivata con "riproducibilità alla discussione senza dipendere dalla rete" — ma NON è un vincolo: `thehollowzone` e `interactivelan` usano tranquillamente Vite + build, quindi il nostro setup è a posto.
- **Conferma, non new**: `isometric_racer` attribuisce esplicitamente al corso il "nessuna animazione importata", coerente con quanto già sappiamo.

### Spunti per Enemy AI (Section 3, ricerca preliminare)

Nessuna implementazione ancora — ricerca mirata (non parte dello scouting Step 6 originale) fatta su `interactivelan` e `thehollowzone` per capire come gestiscono navigazione/AI dei nemici, in vista del multiplayer 3v3 di Section 3.

| Repo | Approccio | Perché vale la pena |
|---|---|---|
| `interactivelan` (`src/core/navigation.js`) | A* vero su una griglia derivata dall'heightmap del terreno: `openSet`/`closedSet`, `gCost`/`fCost`/`cameFrom`, vicini a 8 direzioni con prevenzione del taglio d'angolo in diagonale, euristica euclidea; i nemici chiamano `findPath(start, goal)` una volta e seguono i waypoint restituiti | Implementazione solida e da manuale se vogliamo pathfinding vero multi-waypoint attorno agli ostacoli fissi del campo |
| `thehollowzone` (`src/systems/navigation.js`) | Nessuna griglia/grafo: gli zombie testano una linea diretta verso il giocatore (`segmentIntersectsBox`, sfera-vs-AABB); solo se bloccata generano waypoint d'aggiramento attorno al box che blocca (`chooseNavigationWaypoint()`), scorendo 8 candidati per distanza + una memoria di preferenza di lato (evita oscillazioni sinistra-destra), 2 waypoint di deviazione | Riusa esattamente le stesse primitive che abbiamo già in `CollisionWorld` (sfera-vs-AABB) invece di costruire un nav-grid separato — integrazione molto più economica della A* completa per un campo con pochi ostacoli fissi come il nostro |

### Tecniche UI da riprendere (da `thehollowzone`)

`thehollowzone` non usa una libreria GUI, ma i suoi menu (main menu, pausa, game over, vittoria) sono notevolmente più curati del nostro pannello debug in stile "terminale monospace". Tecnica: **pura HTML/CSS sovrapposta al canvas**, niente three.js coinvolto — ogni schermata è una funzione (`showMainMenu()`, ecc.) che scrive un template literal HTML in un div overlay, non file HTML separati. Da riusare quando faremo il polish della nostra UI:

1. **Più font Google mescolati per ruolo**, non il default di sistema: un font bold/da poster per i titoli (`Black Ops One`), uno "da interfaccia" per label/bottoni (`Oxanium`), uno leggibile per il corpo testo (`Roboto Condensed`), uno monospace per readout tecnici/numeri (`Space Mono`).
2. **`clip-path: polygon(...)`** sui pannelli invece di rettangoli/bordi arrotondati — angoli tagliati a 45° per un effetto "pannello HUD sci-fi".
3. **`backdrop-filter: blur(16px)`** sul pannello semi-trasparente — effetto vetro smerigliato sopra il gameplay dietro.
4. **Pseudo-elementi `::before`/`::after`** per dettagli decorativi (linee accento con `box-shadow` colorato tipo neon, angoli con bordini) senza sporcare l'HTML.
5. **Variabili CSS** (`--ui-red`, `--ui-gold`, `--ui-panel`, ecc.) per un sistema colore coerente in tutta l'interfaccia.
6. **`@keyframes` per l'ingresso dei pannelli** (es. `panel-arrival`) invece di comparire di scatto.

### Class JS vs Factory Function (architettura RobotBase)

Con l'arrivo delle stat multi-classe (Section 2) ci si è chiesti se passare da factory function (pattern usato ovunque finora, vedi `createManipulatorRobot()`) a `class` JS vere per rappresentare le classi robot. Confronto:

| | Class JS | Factory Function |
|---|---|---|
| Pro | Ereditarietà nativa (`extends`/`super`), `instanceof`, metodi condivisi sul prototype | Incapsulamento vero via closure, zero bug di binding `this`, composizione più flessibile della catena rigida |
| Contro | Footgun del `this` nei callback, incapsulamento non automatico (serve `#private`), cambio di stile a metà progetto | Nessuna condivisione di metodi tra istanze (irrilevante con pochi robot in campo), niente `instanceof` nativo |

**6 dei 7 repo scandagliati usano factory function anche per oggetti con più varianti** (solo `404nation` ha una `class SnakeSegment`) — nessuno ha però un sistema di classi-personaggio selezionabili con stat come il nostro, quindi non c'è un precedente diretto per questa domanda specifica.

**Scelta**: composizione, non sostituzione. `RobotBase` (`src/robots/RobotBase.js`) è una `class` vera che **compone** una factory function passata al costruttore (`Object.assign(this, factory())`), invece di riscrivere `manipulator.js` a `class`. Risultato: `manipulator.js` resta intatto (zero rischio), e si guadagnano comunque `instanceof`, stat/tipo/`specialMove()` come proprietà naturali della classe, ereditarietà per il comportamento condiviso (`move()`, il getter `speed`) — il meglio dei due mondi senza dover scegliere in modo netto.

### Basketball (FSM HANDLED/FREE)

Il possesso della palla era prima un fatto dedotto ogni volta da `manipulator.state` (se il robot è in `NO_BALL` la palla non ce l'ha, altrimenti sì). Con l'arrivo del pickup automatico (serve sapere "questa palla è raccoglibile?" indipendentemente da quale robot la sta guardando) è stato introdotto `src/Basketball.js`: stesso pattern di `RobotBase`/`RobotState` — un "enum" congelato (`BallState = { HANDLED, FREE }`) più una classe wrapper leggera attorno al mesh GLTF del pallone (`basketball.position`/`.scale` restano proxy trasparenti verso il mesh, il resto del codice non è cambiato).

Le due FSM (`RobotState` del robot, `BallState` della palla) sono tenute in sincronia manualmente: ogni punto che porta il robot a `NO_BALL` porta anche la palla a `FREE` (e viceversa per `HANDLED`/`DRIBBLE`). Non è la soluzione più elegante (sono due macchine a stati separate scritte a mano in sincrono, non una sola fonte di verità) — un bug reale di sincronizzazione (`shootReleased` non resettato, vedi tabella sopra) è nato proprio da questo — ma il possesso è concettualmente **della palla**, non del robot: con più robot in campo (Section 3, 3v3) sarà la palla a dover sapere chi la possiede, non il contrario. Tenerla come oggetto/stato a sé stante fin da ora evita una migrazione più dolorosa dopo.

### Effetti Sonori negli Altri Progetti

Ricerca preliminare fatta scandagliando gli stessi repo per capire come avessero gestito l'audio, prima di scegliere un approccio — poi implementato in `src/SoundEffects.js`.

| Repo | Approccio |
|---|---|
| a-space-odyssey | Nessun audio |
| thegoblinslayers | Web Audio API a mano (`AudioContext`, `decodeAudioData`, cache di buffer), SFX one-shot + ambience in loop con gain node per il volume |
| 404nation | Nessun audio |
| theboringgame | `THREE.Audio` + `THREE.AudioListener` sulla camera, `THREE.AudioLoader` — solo una traccia di sottofondo in loop |
| interactivelan | `THREE.AudioListener` + `THREE.PositionalAudio` per suoni 3D spaziali (motore del mezzo, esplosioni), caricamento manuale via `decodeAudioData` |
| thehollowzone | `new Audio()` semplice, `.cloneNode()` ad ogni play per permettere SFX sovrapposti (raffiche di colpi) senza tagliarsi a vicenda |
| robot_factory | Nessun audio |
| isometric_racer | `THREE.AudioLoader`→`THREE.Audio` (non `HTMLAudioElement`), sblocco al primo click/keypress (aggira l'autoplay policy dei browser), `.setLoop(true)` per le tracce di sottofondo, crossfade menu↔partita via un helper `fadeGain(audio, target, duration)` (`gain.gain.cancelScheduledValues()` + `linearRampToValueAtTime()` su 1.2s), pitch del motore agganciato alla velocità (`setPlaybackRate(0.7 + ratio*1.6)`) |

Metà dei repo non ha audio (progetti "puri" simulazione/procedurali come il nostro); l'altra metà se lo costruisce a mano, nessuno usa Howler.js. **Scelta fatta per il nostro progetto**: niente file audio esterni da scaricare (coerente con le texture procedurali del robot) — `THREE.AudioListener` sulla camera + 3 suoni **sintetizzati** via Web Audio grezzo (oscillatori + rumore bianco filtrato, non campioni caricati): `playScore()` (due toni ascendenti), `playBounce(volumeScale)` (tono grave + transiente di rumore passa-basso), `playShoot()` (rumore passa-banda con centro che sale). Incapsulati in `class SoundEffects` (`src/SoundEffects.js`).

**Musica di sottofondo — ancora da fare**: `isometric_racer` è l'unico repo con vera musica in loop (non solo SFX), e il suo approccio (`THREE.Audio`, crossfade via rampa sul gain, pitch dinamico per il motore) è direttamente riusabile con lo stesso stack Web Audio già in `SoundEffects` — nessuna libreria nuova richiesta, solo aggiungere `.setLoop(true)` + un helper di crossfade quando affronteremo questo punto.

---

## Author

**Alessandro Carotenuto** — MSc Artificial Intelligence & Robotics, La Sapienza University of Rome

[![Personal Website](https://img.shields.io/badge/Personal%20Website-alessandro--carotenuto.github.io-blue?style=flat-square&logo=github)](https://alessandro-carotenuto.github.io)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Alessandro%20Carotenuto-0077B5?style=flat-square&logo=linkedin)](https://www.linkedin.com/in/alessandro-carotenuto-airo)
