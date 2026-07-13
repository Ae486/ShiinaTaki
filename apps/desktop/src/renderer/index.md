# renderer/
Framework-free PixiJS + Live2D. NO React imports allowed here.
- stage.ts — transparent PixiJS Application lifecycle; governor owns the ticker (autoStart off)
- render-governor.ts — render-throttling governor over a TickerLike (full/idle/blur tiers, pause when hidden/asleep)
- state-machine.ts — pure idle/thinking/working/sleeping FSM + render-activity tiers
- pet-scene.ts — assembles stage + model + governor + FSM tiers; the controller the React bridge mounts
- live2d/ — Live2D model load + idle blink/breathing using the locked engine
- spike/ — experimental renderer-selection harness (#13); seeds the real renderer module (#14).
