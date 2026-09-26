# RIFTLINE

A browser-based tactical shooter prototype, inspired by the attack/defend round format of games like Valorant and CS. It has no dependencies and no build step, and runs in any modern desktop browser.

## Play

- **Locally:** double-click `index.html` (Chrome, Edge or Firefox).
- **Online:** host it on GitHub Pages (steps below) and share the link.

## Features (Stage 1)

- **Attack vs defend rounds.** Attackers plant the *Charge* on site A or B, and defenders stop them or defuse it.
- **First to 7 rounds**, with sides swapping at halftime (after round 6).
- **Buy phase and economy.** Credits come from kills, round wins, loss bonuses and plants.
- **4 weapons:**
  - Sidearm (pistol)
  - Wasp (SMG)
  - Ranger (rifle, one-tap headshots)
  - Longbow (scoped sniper)
- **Light and Heavy shields.**
- **Gunplay:** first-shot accuracy, movement/jump inaccuracy, spray recoil you pull down against, and head/body/leg damage.
- **Bots on both teams**, with A* pathfinding, site takes, retakes, callouts, plant/defuse and reaction times.
- **Modes:** 1v1, 3v3 and 5v5, with Easy, Normal or Hard bots.
- **HUD:** minimap, kill feed, scoreboard (Tab), damage direction indicator, hit markers, death cam and spectating.
- **Rendering:** a custom WebGL2 renderer with real-time sun shadows, fog and a stylized look. All sound is synthesized.

## Controls

| Key | Action |
|---|---|
| W A S D | Move |
| Mouse / LMB / RMB | Aim / Fire / Scope (sniper) |
| Shift | Walk (quiet and accurate) |
| Ctrl or C | Crouch |
| Space | Jump |
| R | Reload |
| 1 / 2 / Wheel | Primary / Sidearm / Swap |
| B | Buy menu (buy phase only) |
| F (hold) | Plant / Defuse |
| Tab | Scoreboard |
| Esc | Pause |

## Put it on GitHub Pages

1. Create a new **public** repository on GitHub, for example `riftline`.
2. Click **Add file → Upload files** and drag in everything from this folder: `index.html`, `style.css`, `README.md` and the `js` folder. Commit.
3. Go to **Settings → Pages**. Under *Build and deployment*, set **Source: Deploy from a branch**, **Branch: `main`**, folder **`/ (root)`**, then **Save**.
4. Wait about a minute. The game will be live at `https://<your-username>.github.io/riftline/`.

## Project structure

```
index.html     page layout: HUD, menus, buy menu
style.css      all UI styling
js/engine.js   tiny WebGL2 renderer (meshes, shadows, sky, fog, textures)
js/game.js     the game: map, movement, weapons, bots, rounds, economy, HUD, audio
```

To edit the map, change the `MAP` grid at the top of `js/game.js`:

- `#` is a wall and `.` is floor.
- `c` and `C` are low and tall crates.
- `A` and `B` are the bomb sites.
- `T` and `D` are the attacker and defender spawns.

## Roadmap

- **Stage 2:** better art (textured props, gun models, lighting polish), sound samples and settings.
- **Stage 3:** agents with abilities (smoke, flash, wall) and animated characters.
- **Stage 4:** online multiplayer using a small WebSocket server.
