/**
 * INPUT:  a replaceable read scope, explicit demand/invalidation and accepted push/write updates.
 * OUTPUT: createReadCoordinator() — one owned flight with one trailing dirty obligation and retired-result guards.
 * POS:    ui/lib — framework-free disposable read mechanics; callers retain data, authority and mutation ownership.
 */

export interface ReadSink<T> {
  started(): void;
  loaded(value: T): void;
  failed(cause: unknown): void;
  retired(): void;
}

export interface ReadCoordinator<T> {
  /** A stable loader identifies its physical client and complete query scope. Binding alone performs no read. */
  replace(load: (() => Promise<T>) | null): void;
  setActive(active: boolean): void;
  demand(): Promise<void>;
  invalidate(): Promise<void>;
  /** A complete push/echo supersedes older reads but needs no extra request when no read is running. */
  acceptUpdate(): void;
  retire(): void;
}

export function createReadCoordinator<T>(sink: ReadSink<T>): ReadCoordinator<T> {
  return new DisposableRead(sink);
}

class DisposableRead<T> implements ReadCoordinator<T> {
  private readonly sink: ReadSink<T>;
  private load: (() => Promise<T>) | null = null;
  private active = true;
  private epoch = 0;
  private revision = 0;
  private updateRevision = 0;
  private running: Promise<void> | null = null;

  constructor(sink: ReadSink<T>) {
    this.sink = sink;
  }

  replace(load: (() => Promise<T>) | null): void {
    if (this.load === load) return;
    this.retire();
    this.load = load;
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (!active) this.retire();
  }

  retire(): void {
    this.epoch += 1;
    const hadFlight = this.running !== null;
    this.running = null;
    if (hadFlight) this.sink.retired();
  }

  demand(): Promise<void> {
    if (!this.load || !this.active) return Promise.resolve();
    if (this.running) return this.running;
    const epoch = this.epoch;
    let finish: () => void = () => undefined;
    let fail: (cause: unknown) => void = () => undefined;
    const owned = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    // Own the flight before either callback can synchronously expose an invalidation.
    this.running = owned;
    void this.run(this.load, epoch).then(finish, fail);
    return owned;
  }

  invalidate(): Promise<void> {
    this.revision += 1;
    return this.demand();
  }

  acceptUpdate(): void {
    this.revision += 1;
    this.updateRevision += 1;
  }

  private async run(load: () => Promise<T>, epoch: number): Promise<void> {
    try {
      while (this.current(load, epoch)) {
        // Publication may have ended the visible busy phase before synchronously invalidating again.
        // Every actual attempt, including that trailing read, restores truthful in-flight presentation.
        this.sink.started();
        if (!this.current(load, epoch)) return;
        const attempt = await this.read(load, epoch);
        if (!attempt.succeeded || this.revision === attempt.revision) return;
      }
    } finally {
      // Checking dirty work and releasing the owner happen together after publication callbacks have finished.
      // Otherwise an invalidation in the promise-settlement microtask could join a flight that has already ended.
      if (this.epoch === epoch) this.running = null;
    }
  }

  private async read(load: () => Promise<T>, epoch: number): Promise<{ succeeded: boolean; revision: number }> {
    const revision = this.revision;
    const updateRevision = this.updateRevision;
    try {
      const value = await load();
      if (!this.current(load, epoch)) return { succeeded: false, revision };
      // A bare response carries no producer revision. Only the trailing read can cover intervening changes.
      if (this.revision === revision) this.sink.loaded(value);
      return { succeeded: true, revision };
    } catch (cause) {
      if (this.current(load, epoch)) {
        if (this.updateRevision === updateRevision) this.sink.failed(cause);
        else this.sink.retired();
      }
      // Dirty state is deliberately retained; failure alone never authorizes another request.
      return { succeeded: false, revision };
    }
  }

  private current(load: () => Promise<T>, epoch: number): boolean {
    return this.active && this.load === load && this.epoch === epoch;
  }
}
