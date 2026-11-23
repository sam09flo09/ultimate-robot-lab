# Robot Lab

A classroom robot simulator for Chromebooks. Students program a virtual robot with blocks or Python,
work through guided activities, and turn in `.robolab` files through Google Classroom.
It runs entirely in the browser, works offline after the first visit, and collects no student data
(see `public/privacy.html`).

## Run it on your computer

```bash
npm install
npm run dev        # development server with live reload
npm test           # all tests
npm run build      # production site in dist/
npm run preview    # serve the production build locally
```

## Hosting

Every push to `main` runs the tests, builds the site and publishes it to GitHub Pages
(`.github/workflows/deploy.yml`). In the repository settings, Pages → Source must be "GitHub Actions".

## Docs

- `docs/API.md`: the student Python API
- `docs/ARCHITECTURE.md`: how the parts fit together
- `src/core/`: the shared contracts (world format, project, level and activity files)

## Third-party software

- [Skulpt](https://skulpt.org) (Python in the browser), MIT License, bundled in `public/vendor/`.
- [Blockly](https://developers.google.com/blockly), Apache License 2.0.
- [CodeMirror 6](https://codemirror.net), MIT License.
- [Three.js](https://threejs.org) (3D view), MIT License.
