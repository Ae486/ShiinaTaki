# renderer/
Framework-free PixiJS + Live2D. NO React imports allowed here.
- stage.ts — transparent PixiJS Application lifecycle; governor owns the ticker (autoStart off)
- render-governor.ts — render-throttling governor over a TickerLike (full/idle/blur tiers, pause when hidden/asleep)
- state-machine.ts — pure idle/thinking/working/sleeping FSM + render-activity tiers
- alpha-mask.ts — pure click-through mask sampler (logical point → mask cell alpha; opacity threshold)
- alpha-mask-source.ts — persistent low-res RenderTexture owner; per-frame readback feeding the sampler
- pet-scene.ts — assembles stage + governor + FSM tiers + alpha mask + a best-effort initial model (may boot MODEL-LESS — packaged builds have no dev route; promotion attaches); exposes isOpaqueAt + the avatar surface the React bridge mounts
- live2d/ — Live2D model load, idle blink/breathing, and the avatar behavior surface (vocabulary, commands, click reactions, gaze)
- spike/ — experimental renderer-selection harness (#13); seeds the real renderer module (#14).
