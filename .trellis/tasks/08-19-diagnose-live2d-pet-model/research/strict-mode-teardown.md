# StrictMode renderer teardown diagnosis

## Real Tauri reproduction

The Pet WebView was attached through WebView2 CDP and reloaded from a clean T4 Desktop process tree. The navigation TDZ
was gone, both Cubism runtimes returned HTTP 200, and the fallback model manifest, moc, textures, physics, and idle
motion all loaded successfully. The DOM nevertheless contained two 720x960 canvases and the screenshot was blank.

The console captured:

```text
TypeError: Cannot read properties of null (reading 'next')
  at Ticker.remove
  at set Automator.autoUpdate
  at Automator.destroy
  at Live2DModel.destroy
  at Container.destroy
  at Application.destroy
  at PetScene.dispose
```

## Confirmed ordering defect

Pixi `Application.destroy()` destroys application plugins in reverse order before it destroys stage children. Its
Ticker plugin therefore nulls the ticker listener head first. The Live2D model is then destroyed as a stage child; its
Automator disables `autoUpdate` by calling `ticker.remove()`, which dereferences the already-null listener head.

React StrictMode intentionally mounts, cleans up, and mounts the Pet effect again in development. The first cleanup
throws before Pixi removes its canvas, so the dead canvas remains first in normal document flow while the second live
canvas is laid out below the clipped Pet window. This directly explains the invisible character despite successful
model resource loads.

## Required boundary

PetScene owns both the model and the Pixi Application. Its disposer must remove and destroy the attached Live2D model
while the application ticker is live, then destroy the now-empty application. The disposer must be idempotent because
StrictMode, HMR, and normal React cleanup can exercise the same lifecycle boundary.
