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
<tr><td>⬜</td><td><b>5 — Basic Basketball</b></td><td>Pallone + palleggio animato</td></tr>
<tr><td>⬜</td><td><b>6 — Primo Polishing & Riallineamento</b></td><td>Rifinitura complessiva, riallineamento al piano</td></tr>
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
<tr><td>⬜</td><td>Pallone + palleggio animato (Step 5)</td></tr>
<tr><td>⬜</td><td>Texture di almeno due tipi diversi (color map + normal/specular) — solo color map finora</td></tr>
<tr><td>⬜</td><td>Selezione robot da schermata iniziale</td></tr>
<tr><td>⬜</td><td>Perf: <code>light.shadow.autoUpdate = false</code> su sole e lampioni — le shadow map di campo/lampioni (statici) vengono ricalcolate ogni frame inutilmente (1 map 4096² + 4×6 map 512²); vanno congelate e aggiornate solo quando la scena statica cambia, ora che il robot mobile aggiunge ombre dinamiche vere</td></tr>
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

## Author

**Alessandro Carotenuto** — MSc Artificial Intelligence & Robotics, La Sapienza University of Rome

[![Personal Website](https://img.shields.io/badge/Personal%20Website-alessandro--carotenuto.github.io-blue?style=flat-square&logo=github)](https://alessandro-carotenuto.github.io)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Alessandro%20Carotenuto-0077B5?style=flat-square&logo=linkedin)](https://www.linkedin.com/in/alessandro-carotenuto-airo)
