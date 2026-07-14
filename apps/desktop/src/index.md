# desktop/src/
- main.tsx — React entry; mounts App into #root
- app.tsx — status + pairing panel: listens to taki://status, submits the pairing code via submit_pairing_code
- styles.css — Tailwind entry stylesheet
- lib/ — Pet UI clients + seams: operator WS client, device identity, presentation gate, active character
- features/ — feature folders (components + hooks colocated): chat-bubble (#16)
- stores/ — per-window Zustand stores (avatar FSM mirror, interaction flags, connection)
- renderer/ — framework-free PixiJS + Live2D renderer (no React): pet overlay scene + avatar behavior
- windows/ — per-window Vite entry points: the pet overlay (#14–#16) and the #13 spike
