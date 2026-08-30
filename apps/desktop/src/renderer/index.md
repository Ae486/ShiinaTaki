# renderer/
Framework-free PixiJS + Live2D. NO React imports allowed here.
- stage.ts — transparent PixiJS Application lifecycle; governor owns the ticker (autoStart off)
- render-governor.ts — render-throttling governor over a TickerLike (full/idle/blur tiers, pause when hidden/asleep)
- state-machine.ts — pure idle/thinking/working/sleeping FSM + render-activity tiers
- alpha-mask.ts — pure click-through mask sampler (logical point → mask cell alpha; opacity threshold)
- alpha-mask-source.ts — persistent low-res RenderTexture owner; gated-cadence readback feeding the sampler (bitmap may lag the silhouette ≤4 frames; sampling never touches the GPU)
- frame-gated-refresher.ts — pure every-Nth-frame gate over a refresh callback (tick/force, no timer of its own); unit-tests the mask cadence without Pixi
- pet-scene.ts — assembles the live scene, owns Live2D-before-Pixi teardown, and exposes a truthful read-only vocabulary/costume snapshot from the model source that actually attached; refreshes the click-through mask every 4th governed frame (rides the governor's pause) and forces it at silhouette jumps (attach/switch, rebuild, canvas resize)
- live2d/ — Live2D model load, Idle Motion + proximity reflexes, and the avatar behavior surface (vocabulary, commands, click reactions, gaze)
- spike/ — experimental renderer-selection harness (#13); seeds the real renderer module (#14).
