# windows/
Per-window Vite entry points (one HTML entry per window).
- pet/ — transparent always-on-top pet overlay window entry (#14); the renderer bridge lives here.
- chat/ — on-demand opaque chat window (#17): continuous timeline (markdown + tool cards + image thumbnails) + composer with image attach.
- spike/ — experimental Live2D renderer-selection harness entry (#13); standalone, no Tauri.
