/**
 * TEMPORARY (milestone M1): one play/stop button driving a fixed kick pattern.
 * Task T3.6 replaces this with the full store/views wiring; delete this file then.
 */
import type { Transport } from "../audio/transport";

export interface M1Deps {
  /** Must be called synchronously from the click handler (iOS unlock). */
  readonly ensureAudioContext: () => Promise<AudioContext>;
  /** Builds master + transport for a context; called once per context. */
  readonly createTransport: (ctx: AudioContext) => Transport;
}

export function mountM1(root: HTMLElement, deps: M1Deps): void {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "play-button";
  const error = document.createElement("p");
  error.setAttribute("role", "alert");
  error.className = "error-message";
  error.hidden = true;
  root.append(button, error);

  let isPlaying = false;
  let isPending = false;
  let transportContext: AudioContext | undefined;
  let transport: Transport | undefined;

  const render = (): void => {
    button.textContent = isPlaying ? "Stop" : "Play";
    button.setAttribute("aria-pressed", String(isPlaying));
  };

  const showError = (message: string | undefined): void => {
    error.textContent = message ?? "";
    error.hidden = message === undefined;
  };

  const play = async (): Promise<void> => {
    isPending = true;
    try {
      // Called synchronously, before any other await, to stay in the gesture.
      const ctx = await deps.ensureAudioContext();
      if (transport === undefined || transportContext !== ctx) {
        transport?.stop();
        transport = deps.createTransport(ctx);
        transportContext = ctx;
      }
      showError(undefined);
      transport.start();
      isPlaying = true;
    } catch (cause: unknown) {
      showError(
        cause instanceof Error ? cause.message : "Could not start audio.",
      );
    } finally {
      isPending = false;
      render();
    }
  };

  button.addEventListener("click", () => {
    if (isPending) {
      return;
    }
    if (isPlaying) {
      transport?.stop();
      isPlaying = false;
      render();
      return;
    }
    void play();
  });

  render();
}
