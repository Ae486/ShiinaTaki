# renderer/live2d/
Live2D model loading + idle behavior using untitled-pixi-live2d-engine (locked #13). Framework-free.
- load-taki-model.ts — loads + centers the taki model bound to the governed ticker (eyeBlink + breath on)
- idle-behavior.ts — starts the looping idle motion group; degrades gracefully when none is defined
