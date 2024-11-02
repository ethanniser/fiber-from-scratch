export {};

type IO<T> = SyncOp<T> | AsyncOp<T> | Chain<T> | Gen<T>;

class SyncOp<T> {
  readonly _tag = "SyncOp";
  constructor(public readonly op: () => T) {}
}

function sync<T>(op: () => T): IO<T> {
  return new SyncOp(op);
}

class AsyncOp<T> {
  readonly _tag = "AsyncOp";
  constructor(public readonly op: () => Promise<T>) {}
}

function async<T>(op: () => Promise<T>): IO<T> {
  return new AsyncOp(op);
}

class Chain<T> {
  readonly _tag = "Chain";
  constructor(
    public readonly io: IO<unknown>,
    public readonly f: (a: unknown) => IO<unknown>
  ) {}
}

function chain<A, B>(io: IO<A>, f: (a: A) => IO<B>): IO<B> {
  return new Chain(io, f as any);
}

class Gen<T> {
  readonly _tag = "Gen";
  constructor(public readonly gen: () => Generator<IO<any>, T, any>) {}
}

function gen<T>(gen: () => Generator<IO<any>, T, any>): IO<T> {
  return new Gen(gen);
}

class Fiber<T> {
  private currentOp: IO<any>;
  private opCount = 0;
  private hasExited = false;
  private onDone: (a: T) => void = () => {};
  private continuationStack: Array<any> = [];

  constructor(startingOp: IO<T>) {
    this.currentOp = startingOp;
  }

  public run(): Promise<T> {
    const { promise, resolve } = Promise.withResolvers<T>();
    this.onDone = resolve;
    this.run_();
    return promise;
  }

  private run_(): void {
    while (!this.shouldYield() && !this.hasExited) {
      switch (this.currentOp._tag) {
        case "SyncOp": {
          const syncOp = this.currentOp;
          const result = syncOp.op();
          this.advance(result);
          break;
        }
        case "AsyncOp": {
          const asyncOp = this.currentOp;
          asyncOp.op().then((res) => {
            this.advance(res);
            this.run_();
          });
          return; // Break loop for async operation bc theres nothing to do
        }
        case "Chain": {
          const chainOp = this.currentOp;
          this.currentOp = chainOp.io;
          this.continuationStack.push(chainOp);
          break;
        }
        case "Gen": {
          const genOp = this.currentOp;
          const gen = genOp.gen();
          const next = gen.next();
          if (next.done) {
            this.advance(next.value);
          } else {
            this.continuationStack.push(gen);
            this.currentOp = next.value;
          }
          break;
        }
      }
    }
    if (!this.hasExited) {
      setImmediate(() => this.run_());
    }
  }

  private shouldYield(): boolean {
    if (this.opCount > 10) {
      this.opCount = 0;
      return true;
    } else {
      this.opCount++;
      return false;
    }
  }

  private advance(value: any): void {
    const continuation = this.continuationStack.pop();
    if (continuation) {
      if (continuation instanceof Chain) {
        this.currentOp = continuation.f(value);
      } else {
        // gen
        const next = continuation.next(value);
        if (next.done) {
          this.advance(next.value);
        } else {
          this.continuationStack.push(continuation);
          this.currentOp = next.value;
        }
      }
    } else {
      if (!this.hasExited) {
        this.hasExited = true;
        this.onDone(value);
      }
    }
  }
}

const realProgram = chain(
  async(() => fetch("https://jsonplaceholder.typicode.com/todos/1")),
  (res) =>
    chain(
      async(() => res.text()),
      (text) => sync(() => console.log(text))
    )
);

const asyncInterval = (id: number, ms: number) =>
  /*
    approximately equivalent to:
    while (true) {
      console.log(id);
      await new Promise((resolve) => setTimeout(resolve, ms))
    }
  */
  gen(function* () {
    while (true) {
      yield sync(() => console.log(id));
      yield async(() => new Promise((resolve) => setTimeout(resolve, ms)));
    }
  });

const spinInterval = (id: number, factor = 5) =>
  /*
    approximately equivalent to:
    let i = 0;
    while (i % 10000 === 0) {
      console.log(id);
      i++;
    }
  */
  gen(function* () {
    let i = 0;
    while (true) {
      yield sync(() => i++);
      if (i % 10 ** factor === 0) {
        yield sync(() => console.log(id));
      }
    }
  });

const fiber1 = new Fiber(spinInterval(1, 1));
const fiber2 = new Fiber(spinInterval(2, 2));
const fiber3 = new Fiber(asyncInterval(3, 2000));
fiber1.run();
fiber2.run();
fiber3.run();
