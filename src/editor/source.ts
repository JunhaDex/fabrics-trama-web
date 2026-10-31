import { applyOps, revert, type Change, type Doc, type Op, type Result } from "@/model";

export interface DocSource {
  getDoc(): Doc;
  subscribe(fn: () => void): () => void;
  apply(ops: Op[]): Result;
  undo(): void;
  redo(): void;
}

export class LocalSource implements DocSource {
  private undos: Change[][] = [];
  private redos: Change[][] = [];
  private subs = new Set<() => void>();

  constructor(
    private doc: Doc,
    private actor = "user:local",
  ) {}

  getDoc = () => this.doc;

  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => void this.subs.delete(fn);
  };

  apply(ops: Op[]): Result {
    const r = applyOps(this.doc, { txId: crypto.randomUUID(), actor: this.actor, ops });
    if (r.ok && r.changes.length) {
      this.undos.push(r.changes);
      this.redos = [];
      this.set(r.doc);
    }
    return r;
  }

  undo() {
    this.step(this.undos, this.redos);
  }

  redo() {
    this.step(this.redos, this.undos);
  }

  /** 문서를 통째로 바꾼다. 가져오기와 저장본 복원에 쓰며 Undo 이력을 비운다. */
  replace(doc: Doc) {
    this.undos = [];
    this.redos = [];
    this.set(doc);
  }

  private step(from: Change[][], to: Change[][]) {
    const changes = from.pop();
    if (!changes) return;
    const r = revert(this.doc, changes);
    to.push(r.changes);
    this.set(r.doc);
  }

  private set(doc: Doc) {
    this.doc = doc;
    for (const fn of this.subs) fn();
  }
}
