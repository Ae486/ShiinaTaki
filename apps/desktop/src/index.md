# desktop/src/
- main.tsx — React entry; mounts App into #root
- app.tsx — status + pairing panel: listens to taki://status, submits the pairing code via submit_pairing_code
- styles.css — Tailwind entry stylesheet
- renderer/ — framework-free PixiJS + Live2D renderer (no React); currently the #13 spike harness
- windows/ — per-window Vite entry points; currently the #13 Live2D spike entry
