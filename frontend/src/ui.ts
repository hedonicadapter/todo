import { errorMessage, login, logout, type Todo } from "./pb";
import type { Store } from "./store";

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

const dateOnly = (due: string) => (due ? due.slice(0, 10) : "");
const toPbDate = (ymd: string) => (ymd ? `${ymd} 00:00:00.000Z` : "");

export function renderLogin(root: HTMLElement): void {
  root.replaceChildren();
  const email = h("input", { type: "email", placeholder: "email", autocomplete: "username", required: "" });
  const password = h("input", {
    type: "password",
    placeholder: "password",
    autocomplete: "current-password",
    required: "",
  });
  const error = h("p", { class: "error", role: "alert" });
  const form = h("form", { class: "login" }, h("h1", {}, "todo"), email, password, h("button", {}, "sign in"), error);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.textContent = "";
    try {
      await login(email.value, password.value);
    } catch (err) {
      error.textContent = errorMessage(err);
    }
  });
  root.append(form);
  email.focus();
}

export function renderApp(root: HTMLElement, store: Store): () => void {
  root.replaceChildren();

  const addInput = h("input", { placeholder: "new todo", autocomplete: "off", enterkeyhint: "done" });
  const addForm = h("form", { class: "add" }, addInput);
  const list = h("ul", { class: "list" });
  const status = h("p", { class: "status", role: "status" });
  const logoutBtn = h("button", { class: "ghost", type: "button" }, "sign out");
  logoutBtn.addEventListener("click", logout);

  root.append(
    h("header", {}, h("h1", {}, "todo"), logoutBtn),
    addForm,
    list,
    status,
    h("p", { class: "hint" }, "n new · j/k move · space done · e edit · d delete · J/K reorder"),
  );

  let selected: string | null = null;
  let editing: string | null = null;
  const rows = new Map<string, HTMLLIElement>();

  const flash = (err: unknown) => {
    status.textContent = errorMessage(err);
    setTimeout(() => (status.textContent = ""), 4000);
  };
  const run = (p: Promise<unknown>) => p.catch(flash);

  addForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = addInput.value;
    addInput.value = "";
    run(store.add(title));
  });

  function row(t: Todo): HTMLLIElement {
    const check = h("input", { type: "checkbox", "aria-label": "done" });
    check.addEventListener("change", () => run(store.toggle(t.id)));

    const title = h("span", { class: "title" });
    title.addEventListener("click", () => startEdit(t.id));

    const due = h("input", { type: "date", class: "due", "aria-label": "due" });
    due.addEventListener("change", () => run(store.patch(t.id, { due: toPbDate(due.value) })));

    const del = h("button", { class: "del", type: "button", "aria-label": "delete" }, "×");
    del.addEventListener("click", () => run(store.remove(t.id)));

    const li = h("li", { class: "todo", "data-id": t.id }, check, title, due, del);
    li.addEventListener("pointerdown", () => select(t.id));
    attachSwipe(li, () => run(store.remove(t.id)));
    return li;
  }

  function update(li: HTMLLIElement, t: Todo): void {
    li.classList.toggle("done", t.done);
    li.classList.toggle("selected", t.id === selected);
    li.classList.toggle("pending", t.id.startsWith("tmp-"));
    const check = li.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    if (check.checked !== t.done) check.checked = t.done;
    if (editing !== t.id) {
      const title = li.querySelector<HTMLSpanElement>(".title")!;
      if (title.textContent !== t.title) title.textContent = t.title;
    }
    const due = li.querySelector<HTMLInputElement>(".due")!;
    const d = dateOnly(t.due);
    if (due.value !== d) due.value = d;
    due.classList.toggle("overdue", !!d && !t.done && d < new Date().toISOString().slice(0, 10));
  }

  function render(): void {
    const seen = new Set<string>();
    let cursor: ChildNode | null = list.firstChild;
    for (const t of store.items) {
      seen.add(t.id);
      let li = rows.get(t.id);
      if (!li) {
        li = row(t);
        rows.set(t.id, li);
      }
      update(li, t);
      if (li !== cursor) list.insertBefore(li, cursor);
      else cursor = cursor.nextSibling;
    }
    for (const [id, li] of rows) {
      if (!seen.has(id)) {
        li.remove();
        rows.delete(id);
        if (selected === id) selected = null;
        if (editing === id) editing = null;
      }
    }
    list.classList.toggle("empty", store.items.length === 0);
  }

  function select(id: string | null): void {
    selected = id;
    for (const [rid, li] of rows) li.classList.toggle("selected", rid === id);
    rows.get(id ?? "")?.scrollIntoView({ block: "nearest" });
  }

  function moveSelection(dir: -1 | 1): void {
    const ids = store.items.map((t) => t.id);
    if (ids.length === 0) return;
    const i = selected ? ids.indexOf(selected) : -1;
    const j = i < 0 ? (dir > 0 ? 0 : ids.length - 1) : Math.min(ids.length - 1, Math.max(0, i + dir));
    select(ids[j]!);
  }

  function startEdit(id: string): void {
    const li = rows.get(id);
    const t = store.get(id);
    if (!li || !t || editing) return;
    editing = id;
    select(id);
    const span = li.querySelector<HTMLSpanElement>(".title")!;
    const input = h("input", { class: "title-edit", value: t.title });
    const finish = (save: boolean) => {
      if (editing !== id) return;
      editing = null;
      const v = input.value.trim();
      input.replaceWith(span);
      if (save && v && v !== t.title) run(store.patch(id, { title: v }));
      else if (save && !v) run(store.remove(id));
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
      e.stopPropagation();
    });
    input.addEventListener("blur", () => finish(true));
    span.replaceWith(input);
    input.focus();
    input.select();
  }

  function onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    const inField = !!target && (target instanceof HTMLInputElement || target.isContentEditable);
    if (inField) {
      if (e.key === "Escape") target.blur();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case "n":
        addInput.focus();
        break;
      case "j":
      case "ArrowDown":
        moveSelection(1);
        break;
      case "k":
      case "ArrowUp":
        moveSelection(-1);
        break;
      case " ":
      case "x":
        if (selected) run(store.toggle(selected));
        break;
      case "d":
      case "Backspace":
      case "Delete":
        if (selected) {
          const ids = store.items.map((t) => t.id);
          const i = ids.indexOf(selected);
          const next = ids[i + 1] ?? ids[i - 1] ?? null;
          run(store.remove(selected));
          select(next);
        }
        break;
      case "e":
      case "Enter":
        if (selected) startEdit(selected);
        break;
      case "J":
        if (selected) run(store.move(selected, 1));
        break;
      case "K":
        if (selected) run(store.move(selected, -1));
        break;
      case "Escape":
        select(null);
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  document.addEventListener("keydown", onKey);
  const unsub = store.onChange(render);
  render();

  return () => {
    document.removeEventListener("keydown", onKey);
    unsub();
  };
}

// Swipe left ≥ 80px → delete. Pointer events only on touch to leave mouse alone.
function attachSwipe(li: HTMLElement, onDelete: () => void): void {
  let startX = 0;
  let dx = 0;
  let active = false;
  li.addEventListener(
    "touchstart",
    (e) => {
      const t = e.touches[0];
      if (!t) return;
      startX = t.clientX;
      dx = 0;
      active = true;
    },
    { passive: true },
  );
  li.addEventListener(
    "touchmove",
    (e) => {
      const t = e.touches[0];
      if (!active || !t) return;
      dx = Math.min(0, t.clientX - startX);
      li.style.transform = `translateX(${dx}px)`;
    },
    { passive: true },
  );
  const end = () => {
    if (!active) return;
    active = false;
    li.style.transform = "";
    if (dx <= -80) onDelete();
  };
  li.addEventListener("touchend", end);
  li.addEventListener("touchcancel", end);
}
