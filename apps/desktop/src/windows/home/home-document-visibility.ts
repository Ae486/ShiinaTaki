/**
 * INPUT:  browser document visibility events and the Home visibility store's narrow writer.
 * OUTPUT: observeHomeDocumentVisibility() — initial/effective visibility publication with owned cleanup.
 * POS:    ui/home — disposable-read gating only; focus/blur cannot hide a visible window or cancel an operation.
 */
interface VisibilitySource {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export function observeHomeDocumentVisibility(source: VisibilitySource, publish: (visible: boolean) => void): () => void {
  const update = () => publish(source.visibilityState !== "hidden");
  update();
  source.addEventListener("visibilitychange", update);
  return () => source.removeEventListener("visibilitychange", update);
}
