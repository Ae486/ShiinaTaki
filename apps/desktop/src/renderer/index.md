# renderer/
Framework-free PixiJS + Live2D. NO React imports allowed here.
- stage.ts — transparent PixiJS Application lifecycle; governor owns the ticker (autoStart off)
- render-governor.ts — render-throttling governor over a TickerLike (full/idle/blur tiers, pause when hidden/asleep)
- state-machine.ts — pure idle/thinking/working/sleeping FSM + render-activity tiers
- alpha-mask.ts — pure click-through mask sampler (logical point → mask cell alpha; opacity threshold)
- alpha-mask-source.ts — persistent low-res RenderTexture owner; per-frame readback feeding the sampler
- pet-scene.ts — assembles the live scene and exposes a truthful read-only vocabulary/costume snapshot from the model source that actually attached
- live2d/ — Live2D model load, Idle Motion + proximity reflexes, and the avatar behavior surface (vocabulary, commands, click reactions, gaze)
- spike/ — experimental renderer-selection harness (#13); seeds the real renderer module (#14).
