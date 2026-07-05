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

| Classe | Locomozione | Caratteristica | Mossa Speciale |
|---|---|---|---|
| **MANIPULATOR** | Ruote | Bilanciato | — |
| **COLOSSUS** | Umanoide tozzo | Rimbalzo / Block | Slam Dunk (vale doppio) |
| **GLITCH** | Snello / asimmetrico | Velocità / Dribbling | Overclock (5s inarrestabile) |
| **SENTINEL** | Torretta / traliccio | Tiro puro | Lock-on (tiro garantito) |

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
<tr><td>⬜</td><td><b>Section 2 — Gameplay Mechanics</b></td><td>Classi/statistiche ✅, pick-up/handling a bottone ✅, Shooting System (direzione da crosshair + forza costante, animazione windup/release/recover) ✅, collisioni backboard/ferro/muri/pali/panchine/tribuna ✅ (mesh reali del GLTF), pickup automatico della palla libera ✅, preview di traiettoria ✅ — Point System ancora da fare</td></tr>
<tr><td>⬜</td><td><b>Section 3 — Enemies & Polish</b></td><td>Enemies 3v3 con AI, Steal/Block, personalizzazione menu, animation tweaks, rework Main Menu/HUD, secondo polishing e allineamento con esame</td></tr>
<tr><td>⬜</td><td><b>Section 4 — Nuove Classi & Game Modes</b></td><td>Classe Drone (mossa "Uplifting"), Classe Legged Manipulator (mossa "Jump"), selettore Sunrise/Day/Sunset/Night, altre impostazioni globali, modalità di gioco (3v3 normale, beat the time, beat the score), polish finale</td></tr>
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
<tr><td>⬜</td><td>Altre 3 classi robot (COLOSSUS, GLITCH, SENTINEL)</td></tr>
<tr><td>✅</td><td>Pallone + palleggio animato (Step 5)</td></tr>
<tr><td>✅</td><td>Texture di almeno due tipi diversi (pallone: color + normal + metallic/roughness map; campo: solo color map)</td></tr>
<tr><td>⬜</td><td>Selezione robot da schermata iniziale</td></tr>
<tr><td>⬜</td><td>Perf: <code>light.shadow.autoUpdate = false</code> su sole e lampioni — le shadow map di campo/lampioni (statici) vengono ricalcolate ogni frame inutilmente (1 map 4096² + 4×6 map 512²); vanno congelate e aggiornate solo quando la scena statica cambia, ora che il robot mobile aggiunge ombre dinamiche vere</td></tr>
<tr><td>✅</td><td>Section 2: stabilire le classi e le loro statistiche — roster corretto (MANIPULATOR/LEGGED MANIPULATOR/DRONE, non più COLOSSUS/GLITCH/SENTINEL), stats struct omogeneo <code>{ speed, power }</code> via <code>RobotBase</code>/<code>ManipulatorRobot</code> (<code>src/robots/</code>)</td></tr>
<tr><td>✅</td><td>Section 2: Pick-up/Handling della palla come azione a bottone (tasto destro tenuto premuto, <code>RobotState.HANDLING</code>) invece del palleggio sempre attivo automatico</td></tr>
<tr><td>✅</td><td>Section 2: interazioni tra le animazioni di dribble/handling — transizioni interpolate in entrambe le direzioni (posa braccio, presa paletta, camera posizione+rotazione)</td></tr>
<tr><td>✅</td><td>Section 2: Shooting System — <code>RobotState.NO_BALL</code>, direzione da raycast sul crosshair, forza costante (HUD/carica ancora da fare), animazione windup/release/recover con gomito agganciato al pitch della camera</td></tr>
<tr><td>✅</td><td>Section 2: collisioni backboard/ferro/muri/pali/panchine/tribuna — sfera-vs-AABB e sfera-vs-toro, coordinate reali dagli accessor del GLTF (non stimate), restituzione tarata per oggetto</td></tr>
<tr><td>✅</td><td>Section 2: <code>Basketball</code> (<code>src/Basketball.js</code>) — wrapper con FSM <code>HANDLED</code>/<code>FREE</code>; pickup automatico della palla libera (bounding box del robot, animazione di raccolta breve, nessun tasto)</td></tr>
<tr><td>✅</td><td>Section 2: preview di traiettoria durante la mira (tubo 3D, nero→blu/verde in base a cosa colpisce, ferma al primo tocco col pavimento)</td></tr>
<tr><td>⬜</td><td>Section 2: HUD/carica della forza di tiro (per ora costante, dipendente solo dalla zona campo)</td></tr>
<tr><td>⬜</td><td>Section 2: Point System, overlay HUD e/o texture fisiche in scena (canestro rilevato in console, nessuna UI ancora)</td></tr>
<tr><td>⬜</td><td>Effetti sonori — nessuno ancora; vedi "Effetti Sonori negli Altri Progetti" più sotto per l'approccio scelto (<code>THREE.Audio</code>/<code>AudioListener</code>), da implementare</td></tr>
<tr><td>⬜</td><td>FSM <code>GameMode</code> (PRACTICE/1v1/3v3) e FSM <code>TimeOfDay</code> (Sunrise/Day/Sunset/Night) — richieste, ancora da creare (solo valori enum, nessun comportamento)</td></tr>
<tr><td>⬜</td><td>Section 3: Enemies (3v3) — AI e differenziazioni tra classi avversarie</td></tr>
<tr><td>⬜</td><td>Section 3: personalizzazione menu colori</td></tr>
<tr><td>⬜</td><td>Section 3: interazioni e stati aggiuntivi — "Steal"</td></tr>
<tr><td>⬜</td><td>Section 3: Block/Steal (meccaniche difensive)</td></tr>
<tr><td>⬜</td><td>Section 3: Animation Tweaks (rifinitura animazioni esistenti)</td></tr>
<tr><td>⬜</td><td>Section 3: Main Menu e HUD rework (vedi "Tecniche UI da riprendere" sopra)</td></tr>
<tr><td>⬜</td><td>Section 3: secondo polishing e allineamento con altri progetti e con l'esame</td></tr>
<tr><td>⬜</td><td>Section 4: Classe Drone — stat + mossa speciale "Uplifting"</td></tr>
<tr><td>⬜</td><td>Section 4: Classe Legged Manipulator — mossa speciale "Jump"</td></tr>
<tr><td>⬜</td><td>Section 4: selettore Sunrise/Day/Sunset/Night (preset illuminazione)</td></tr>
<tr><td>⬜</td><td>Section 4: altre impostazioni globali (Other Global Setting)</td></tr>
<tr><td>⬜</td><td>Section 4: modalità di gioco effettive — 3v3 normale, beat the time, beat the score</td></tr>
<tr><td>⬜</td><td>Section 4: polish finale e riallineamento</td></tr>
<tr><td>⬜</td><td>Section 5: revisione completa del codice (a mano e assistita), cambiare il necessario e capire tutto</td></tr>
<tr><td>✅</td><td>GitHub Pages base configurata (<code>base: './'</code> in <code>vite.config.js</code>)</td></tr>
<tr><td>⬜</td><td>GitHub Pages attivo e funzionante online</td></tr>
<tr><td>⬜</td><td>Link GitHub Pages in questo README</td></tr>
<tr><td>⬜</td><td>Documentazione tecnica (5-10+ pagine)</td></tr>
<tr><td>⬜</td><td>Registrazione Infostud</td></tr>
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

---

## Confronto con Altri Progetti del Corso (Step 6 — Polish)

Durante la prima fase di polish (ricerca di dead code/inefficienze/DRY) abbiamo anche scandagliato 7 altri progetti finali dello stesso corso (stessa consegna, stessa rubrica) per confrontare approcci a librerie, modellazione, animazione, fisica e texture. A differenza dello Step 1 (8 repo analizzati all'inizio, di cui non abbiamo mai salvato i nomi — persi), stavolta teniamo il link di ognuno.

| Repo | Librerie oltre three.js | Modellazione | Animazione | Fisica | Texture | Rischio compliance |
|---|---|---|---|---|---|---|
| [a-space-odyssey](https://github.com/SapienzaInteractiveGraphicsCourse/final-project-a-space-odyssey) | Tween.js, dat.GUI (vendored) | GLTF/FBX Mixamo rigged, importato | Tween.js su pose esportate da Blender | Nessuna (solo AABB box-check) | PBR completa | Alto — libreria di animazione su modello importato |
| [thegoblinslayers](https://github.com/SapienzaInteractiveGraphicsCourse/final-project-thegoblinslayers) | nessuna (CDN, no bundler) | Perlopiù GLTF importati; una trappola procedurale | `AnimationMixer`/`AnimationClip` sul personaggio principale | AABB, no engine | PBR 4K completa | Medio — Mixer su personaggio chiave |
| [404nation](https://github.com/SapienzaInteractiveGraphicsCourse/final-project-404nation) | tween.js (installata, mai usata) | Procedurale (Box/Sphere/Cone), factory pattern — simile al nostro | 100% imperativo, tween non usata nonostante la dipendenza | Gravità a griglia discreta (turn-based) | PBR reale (base+normal+roughness) | Basso — solo dipendenza morta |
| [theboringgame](https://github.com/SapienzaInteractiveGraphicsCourse/final-project-theboringgame) | cannon-es (fisica) + tween.js (animazione) | GLB rigged importato, livelli da JSON | State machine + tween.js sui bone | cannon-es, vero motore fisico | PBR completa (6 mappe) | Alto — entrambe le librerie usate attivamente |
| [interactivelan](https://github.com/SapienzaInteractiveGraphicsCourse/final-project-interactivelan) | simplex-noise (solo terreno) | GLTF rigged importato (Blender) | 100% imperativo, delta variabile | A* pathfinding + raycasting a mano | PBR completa (5 mappe) | Medio — modelli importati, niente lib di animazione |
| [thehollowzone](https://github.com/SapienzaInteractiveGraphicsCourse/final-project-thehollowzone) | tween.js (installata, mai usata) | Procedurale, gerarchia profonda per-arto | 100% imperativo, pattern reset+delta | AABB/cerchio a mano, no accumulator | PBR completa (4 mappe) | Basso — solo dipendenza morta |
| [robot_factory](https://github.com/SapienzaInteractiveGraphicsCourse/final-project-robot_factory) | nessuna, no bundler | Procedurale puro, il più profondo (braccio 7 giunti) | 100% imperativo | Mass-spring cable scritto a mano (Eulero) | `CanvasTexture` proceduali (bump+roughness) | Nessuno apparente — il più "pulito" |
| **(il nostro)** | nessuna | Procedurale puro (3R + ruote) | 100% imperativo, timestep fisso (unici a farlo) | State machine a timestep fisso | Pallone: color+normal+metallic-roughness; campo: solo color | Basso |

### Cosa abbiamo imparato

- **`tween.js` installata-ma-mai-usata in 3 repo su 7** (a-space-odyssey la usa davvero, 404nation e thehollowzone no) — probabile boilerplate/template del corso che la include di default, non rimossa da chi non la usa.
- **Solo 1 su 7 usa un motore fisico vero** (theboringgame → cannon-es). Tutti gli altri scrivono fisica/collisioni a mano, ma il nostro timestep fisso con accumulator è più sofisticato di chiunque altro (gli altri integrano direttamente sul `delta` variabile).
- **Modellazione spaccata a metà**: 4/7 importano modelli riggati (a-space-odyssey, thegoblinslayers, theboringgame, interactivelan), 3/7 costruiscono tutto proceduralmente (404nation, thehollowzone, robot_factory) — noi compresi. I repo procedurali hanno anche il rischio di compliance più basso, non a caso.
- **Siamo gli unici con un post-processing pipeline** (SSAO+SMAA) — nessun altro repo ha un `EffectComposer`.
- **Sulle texture eravamo indietro, ora recuperato in parte**: tutti gli altri hanno set PBR completi (normal+roughness+AO, spesso 4-6 mappe) sui loro asset principali, quasi sempre **scaricati** da librerie di texture gratuite (nomi/risoluzioni tipiche di ambientCG/Poliigon). **Unica eccezione: `robot_factory`** (il progetto più simile al nostro per filosofia) genera le texture proceduralmente via `CanvasTexture`, senza asset esterni — abbiamo seguito lo stesso approccio per le texture del robot (normal map + roughness map generate in codice via height-field→gradiente, vedi `src/robots/manipulator.js`), invece di scaricare texture pronte come fa la maggioranza; per campo/pallone (già asset esterni non nostri) resta aperta l'opzione di scaricare qualcosa in futuro se necessario.
- **GUI/debug**: `dat.GUI` compare una sola volta su 7 (a-space-odyssey); nessuno usa `lil-gui`; gli altri 6 (incluso `thehollowzone`) non hanno nessuna libreria GUI né un pannello debug visibile nel codice. Il nostro pannello fatto a mano non è un'anomalia, anzi è più elaborato della media.

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

Nessuno degli effetti sonori è ancora implementato — ricerca preliminare fatta scandagliando gli stessi 7 repo dello Step 6 per capire come li avessero gestiti, prima di scegliere un approccio.

| Repo | Approccio |
|---|---|
| a-space-odyssey | Nessun audio |
| thegoblinslayers | Web Audio API a mano (`AudioContext`, `decodeAudioData`, cache di buffer), SFX one-shot + ambience in loop con gain node per il volume |
| 404nation | Nessun audio |
| theboringgame | `THREE.Audio` + `THREE.AudioListener` sulla camera, `THREE.AudioLoader` — solo una traccia di sottofondo in loop |
| interactivelan | `THREE.AudioListener` + `THREE.PositionalAudio` per suoni 3D spaziali (motore del mezzo, esplosioni), caricamento manuale via `decodeAudioData` |
| thehollowzone | `new Audio()` semplice, `.cloneNode()` ad ogni play per permettere SFX sovrapposti (raffiche di colpi) senza tagliarsi a vicenda |
| robot_factory | Nessun audio |

Metà dei repo non ha audio (progetti "puri" simulazione/procedurali come il nostro); l'altra metà se lo costruisce a mano, nessuno usa Howler.js. **Scelta per il nostro progetto**: `THREE.Audio`/`THREE.AudioListener` via `THREE.AudioLoader` — zero dipendenze nuove (already three.js), si integra con la camera esistente, e `THREE.PositionalAudio` darebbe gratis il suono spaziale per rimbalzo palla/retina attaccato a palla/canestro. Per SFX sovrapposti (palleggio rapido), riprendere il trucco `cloneNode()` di `thehollowzone` o un piccolo pool di oggetti `THREE.Audio` invece di introdurre Howler.

---

## Author

**Alessandro Carotenuto** — MSc Artificial Intelligence & Robotics, La Sapienza University of Rome

[![Personal Website](https://img.shields.io/badge/Personal%20Website-alessandro--carotenuto.github.io-blue?style=flat-square&logo=github)](https://alessandro-carotenuto.github.io)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Alessandro%20Carotenuto-0077B5?style=flat-square&logo=linkedin)](https://www.linkedin.com/in/alessandro-carotenuto-airo)
