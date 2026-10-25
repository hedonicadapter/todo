import { authId, isAuthError, logout, pb, toPbDate, todosCollection, type Todo } from "./pb";
import { nextOccurrence, parseRule, today } from "./recur";

type Listener = () => void;
type Patch = Partial<Pick<Todo, "title" | "done" | "due" | "order" | "repeat">>;

const SORT = "done,order,due";

// Mirrors server sort. Empty due sorts last.
function compare(a: Todo, b: Todo): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (a.order !== b.order) return a.order - b.order;
  return (a.due || "￿").localeCompare(b.due || "￿");
}

export class Store {
  items: Todo[] = [];
  private listeners = new Set<Listener>();
  private unsubscribe: (() => Promise<void>) | null = null;
  private unsubscribeConnect: (() => Promise<void>) | null = null;
  private everConnected = false;
  private pendingCreates = new Map<string, string>(); // tmp id → title
  private abort = new AbortController();

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get(id: string): Todo | undefined {
    return this.items.find((t) => t.id === id);
  }

  async load(): Promise<void> {
    try {
      const fresh = await todosCollection().getFullList({ sort: SORT });
      // Keep optimistic (unsaved) rows on top of server state.
      const tmp = this.items.filter((t) => this.pendingCreates.has(t.id));
      this.items = [...fresh, ...tmp];
      this.emit();
    } catch (err) {
      this.handleError(err);
      throw err;
    }
  }

  async start(): Promise<void> {
    this.abort = new AbortController();
    await this.load();

    this.unsubscribe = await todosCollection().subscribe("*", (e) => {
      if (e.action === "delete") this.drop(e.record.id);
      else this.upsert(e.record);
      this.emit();
    });

    // PB_CONNECT fires on every (re)connect. Full refetch on reconnect
    // covers events missed while disconnected (iOS background, network blips).
    this.unsubscribeConnect = await pb.realtime.subscribe("PB_CONNECT", () => {
      if (this.everConnected) void this.load().catch(() => {});
      this.everConnected = true;
    });

    const { signal } = this.abort;
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "visible") void this.load().catch(() => {});
      },
      { signal },
    );
    window.addEventListener("online", () => void this.load().catch(() => {}), { signal });
  }

  async stop(): Promise<void> {
    this.abort.abort();
    await this.unsubscribe?.().catch(() => {});
    await this.unsubscribeConnect?.().catch(() => {});
    this.unsubscribe = null;
    this.unsubscribeConnect = null;
    this.everConnected = false;
    this.items = [];
    this.pendingCreates.clear();
  }

  // --- optimistic writes; any failure → full reload to resync ---

  async add(title: string): Promise<void> {
    title = title.trim();
    if (!title) return;
    const first = this.items.find((t) => !t.done);
    const order = (first?.order ?? 0) - 1;
    const tmpId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.pendingCreates.set(tmpId, title);
    this.items.push({
      id: tmpId,
      collectionId: "",
      collectionName: "todos",
      title,
      done: false,
      due: "",
      order,
      owner: authId(),
      repeat: "",
    } as Todo);
    this.emit();
    try {
      const created = await todosCollection().create({ title, done: false, order, owner: authId() });
      this.pendingCreates.delete(tmpId);
      this.drop(tmpId);
      this.upsert(created);
      this.emit();
    } catch (err) {
      this.pendingCreates.delete(tmpId);
      this.drop(tmpId);
      this.emit();
      this.handleError(err);
      await this.load().catch(() => {});
      throw err;
    }
  }

  async patch(id: string, data: Patch): Promise<void> {
    const t = this.get(id);
    if (!t || this.pendingCreates.has(id)) return;
    Object.assign(t, data);
    this.emit();
    try {
      const updated = await todosCollection().update(id, data);
      this.upsert(updated);
      this.emit();
    } catch (err) {
      this.handleError(err);
      await this.load().catch(() => {});
      throw err;
    }
  }

  // Completing a repeating todo advances `due` to the next occurrence after
  // today (completion date, not due date) and leaves it open. A late task
  // therefore catches up in one tick. Unchecking is a no-op for them.
  toggle(id: string): Promise<void> {
    const t = this.get(id);
    if (!t) return Promise.resolve();
    const rule = parseRule(t.repeat);
    if (rule && !t.done) {
      return this.patch(id, { due: toPbDate(nextOccurrence(today(), rule)) });
    }
    return this.patch(id, { done: !t.done });
  }

  // Setting a repeat on a todo without a due date anchors it to today.
  setRepeat(id: string, repeat: string): Promise<void> {
    const t = this.get(id);
    if (!t) return Promise.resolve();
    const data: Patch = { repeat };
    if (repeat && !t.due) data.due = toPbDate(today());
    return this.patch(id, data);
  }

  async remove(id: string): Promise<void> {
    if (!this.get(id) || this.pendingCreates.has(id)) return;
    this.drop(id);
    this.emit();
    try {
      await todosCollection().delete(id);
    } catch (err) {
      this.handleError(err);
      await this.load().catch(() => {});
      throw err;
    }
  }

  // Move one step within same done-group; order = midpoint between neighbours.
  async move(id: string, dir: -1 | 1): Promise<void> {
    const cur = this.get(id);
    if (!cur) return;
    const group = this.items.filter((t) => t.done === cur.done);
    const i = group.indexOf(cur);
    const j = i + dir;
    if (j < 0 || j >= group.length) return;
    const neighbour = group[j]!;
    const beyond = group[j + dir];
    const order = beyond ? (neighbour.order + beyond.order) / 2 : neighbour.order + dir;
    if (order === neighbour.order || (beyond && order === beyond.order)) {
      // Orders collided (float exhausted or duplicates). Renumber group, retry once.
      await Promise.all(group.map((t, k) => this.patch(t.id, { order: k })));
      return this.move(id, dir);
    }
    await this.patch(id, { order });
  }

  private upsert(r: Todo): void {
    const i = this.items.findIndex((t) => t.id === r.id);
    if (i >= 0) {
      this.items[i] = r;
      return;
    }
    // SSE echo of our own create may arrive before create() resolves:
    // replace matching optimistic row instead of duplicating.
    for (const [tmpId, title] of this.pendingCreates) {
      if (title === r.title) {
        this.pendingCreates.delete(tmpId);
        this.drop(tmpId);
        break;
      }
    }
    this.items.push(r);
  }

  private drop(id: string): void {
    this.items = this.items.filter((t) => t.id !== id);
  }

  private emit(): void {
    this.items.sort(compare);
    for (const l of this.listeners) l();
  }

  private handleError(err: unknown): void {
    if (isAuthError(err)) logout();
  }
}

export const store = new Store();
