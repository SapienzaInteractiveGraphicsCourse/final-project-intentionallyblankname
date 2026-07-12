# Mecha-Basketball 3D

**Final Project · Interactive Graphics** · Prof. Marco Schaerf · La Sapienza University of Rome

[![Three.js](https://img.shields.io/badge/Three.js-e8c205?style=flat-square&logo=three.js&logoColor=black)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev/)
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](https://developer.mozilla.org/docs/Web/JavaScript)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live-brightgreen?style=flat-square&logo=github)](https://sapienzainteractivegraphicscourse.github.io/final-project-intentionallyblankname/)

---

## Demo

### [**CLICK HERE TO PLAY**](https://sapienzainteractivegraphicscourse.github.io/final-project-intentionallyblankname/)

Runs entirely in the browser, no installation required.

For a smoother experience (or for development), you can also run it locally:

```bash
git clone https://github.com/SapienzaInteractiveGraphicsCourse/final-project-intentionallyblankname.git
cd final-project-intentionallyblankname
npm install
npm run dev      # → localhost:5173
```

---

## About

A simulated basketball match between selectable procedural robots, set in a GLTF basketball court under a dynamic procedural sky. No external models are used for the robots: they are built in Three.js using primitives and `THREE.Group` hierarchies, animated entirely via code. The user selects a robot class from a selection screen—each with different stats and special moves—and a time of day (Sunrise/Day/Sunset/Night, with an animated transition between lights and skyboxes), then observes or directs the match simulation.

---

## Robot Classes

| Class | Locomotion | Special Move |
|---|---|---|
| **MOBILE MANIPULATOR** | Wheels | Dash |
| **LEGGED MANIPULATOR** | Legs (gait cycle) | Jump |
| **DRONE** | Flight | Flight |

Selectable from the Main Menu for both the player and, in 1v1 mode, the AI-controlled opponent, without requiring a page reload.

---

## Controls

<table width="100%">
<colgroup><col width="30%"><col width="70%"></colgroup>
<thead><tr><th>Input</th><th>Effect</th></tr></thead>
<tbody>
<tr><td><b>P</b></td><td>Debug Panel / Camera</td></tr>
<tr><td><b>M</b></td><td>Spectate (free-fly) / Play (third-person)</td></tr>
<tr><td>Spectate: mouse + WASD + Space/Shift</td><td>Free flight</td></tr>
<tr><td>Play: mouse</td><td>Orbit camera</td></tr>
<tr><td>Play: WASD</td><td>Camera-relative movement</td></tr>
<tr><td>Play: Left Shift</td><td>Special move (Dash / Jump / Flight)</td></tr>
<tr><td>Play: Right click (held)</td><td>Grab ball, free aim</td></tr>
<tr><td>Play: Left click (while holding ball)</td><td>Shoot basket</td></tr>
<tr><td>Play: Approach a loose ball</td><td>Automatic pickup</td></tr>
<tr><td>Play: <b>Q</b> (1v1, without ball)</td><td>STEAL</td></tr>
<tr><td>Play: <b>E</b> (1v1, without ball)</td><td>BLOCK</td></tr>
<tr><td><b>ESC</b> (during Play)</td><td>Pause menu</td></tr>
<tr><td><b>1-8</b></td><td>Collision debug wireframe</td></tr>
</tbody>
</table>

---

## Tech Stack

<table width="100%">
<thead><tr><th width="20%">Category</th><th>Tools</th></tr></thead>
<tbody>
<tr><td><b>Core</b></td><td><img src="https://img.shields.io/badge/Three.js-e8c205?style=flat-square&logo=three.js&logoColor=black"> <img src="https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white"> <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black"></td></tr>
<tr><td><b>Rendering</b></td><td><img src="https://img.shields.io/badge/GLTFLoader-e8c205?style=flat-square"> <img src="https://img.shields.io/badge/EffectComposer-e8c205?style=flat-square"> <img src="https://img.shields.io/badge/SSAO-e8c205?style=flat-square"> <img src="https://img.shields.io/badge/SMAA-e8c205?style=flat-square"> <img src="https://img.shields.io/badge/Procedural%20Sky-e8c205?style=flat-square"></td></tr>
<tr><td><b>Robot</b></td><td><img src="https://img.shields.io/badge/Procedural%20Hierarchy-e8c205?style=flat-square"> <img src="https://img.shields.io/badge/Runtime%20Geometry%20Rebuild-e8c205?style=flat-square"></td></tr>
<tr><td><b>Basketball</b></td><td><img src="https://img.shields.io/badge/Fixed%20Timestep%20Simulation-e8c205?style=flat-square"> <img src="https://img.shields.io/badge/State%20Machine-e8c205?style=flat-square"></td></tr>
<tr><td><b>Deploy</b></td><td><a href="https://sapienzainteractivegraphicscourse.github.io/final-project-intentionallyblankname/"><img src="https://img.shields.io/badge/GitHub%20Pages-222222?style=flat-square&logo=github&logoColor=white"></a></td></tr>
</tbody>
</table>

---

## Author

**Alessandro Carotenuto**, MSc Artificial Intelligence & Robotics, La Sapienza University of Rome

[![Personal Website](https://img.shields.io/badge/Personal%20Website-alessandro--carotenuto.github.io-blue?style=flat-square&logo=github)](https://alessandro-carotenuto.github.io)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Alessandro%20Carotenuto-0077B5?style=flat-square&logo=linkedin)](https://www.linkedin.com/in/alessandro-carotenuto-airo)
```