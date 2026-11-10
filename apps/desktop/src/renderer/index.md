# renderer/
Framework-free PixiJS + Live2D. NO React imports allowed here.
- stage.ts — transparent PixiJS Application lifecycle; governor owns the ticker (autoStart off)
- render-governor.ts — content-aware ticker governor; empty scenes always pause, loaded models retain full/idle/blur and hidden/asleep policy
- state-machine.ts — pure idle/thinking/working/sleeping FSM + render-activity tiers
- alpha-mask.ts — pure click-through mask sampler (logical point → mask cell alpha; opacity threshold)
- alpha-mask-source.ts — persistent low-res RenderTexture owner; gated-cadence readback feeding the sampler (bitmap may lag the silhouette ≤4 frames; sampling never touches the GPU)
- frame-gated-refresher.ts — pure every-Nth-frame gate over a refresh callback (tick/force, no timer of its own); unit-tests the mask cadence without Pixi
- pet-scene.ts — live scene with empty-until-attach ticker pause, Live2D-before-Pixi teardown and truthful attached vocabulary; click-through mask follows governed frames plus immediate attach/rebuild/resize refresh
- live2d/ — Live2D model load, Idle Motion + proximity reflexes, and the avatar behavior surface (vocabulary, commands, click reactions, gaze)
- spike/ — experimental renderer-selection harness (#13); seeds the real renderer module (#14).
