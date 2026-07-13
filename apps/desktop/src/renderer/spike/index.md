# renderer/spike/
Experimental Live2D renderer-selection harness (#13). Not in production path.
- spike-status.ts — SpikeStatus/ModelProbeResult types + window.__spikeStatus writer
- create-stage.ts — PixiJS v8 Application init + Live2DPlugin registration
- param-probe.ts — generation-aware raw parameter write->read round-trip
- probe-model.ts — loads one model, exercises motion/expression/hit-test/param/lip-sync/framing
- run-spike.ts — orchestrator: probes both moc + moc3, derives the decision, publishes status
