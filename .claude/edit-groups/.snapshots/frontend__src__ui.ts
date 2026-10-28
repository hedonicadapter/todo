import { errorMessage, login, logout, toPbDate, type Todo } from "./pb";
import { PRESETS, describeRule, lateLabel, today } from "./recur";
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

  const ls = {
    get: (k: string): string | null => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k: string, v: string): void => {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* no localStorage */
      }
    },
  };

  const addInput = h("input", { placeholder: "new todo", autocomplete: "off", enterkeyhint: "done" });
  const addForm = h("form", { class: "add" }, addInput);
  const list = h("ul", { class: "list" }); // backlog
  const status = h("p", { class: "status", role: "status" });

  const sortBtn = h("button", { class: "ghost sort", type: "button" });
  const sortLabel = () => (sortBtn.textContent = `sort: ${store.sortMode}`);
  sortLabel();
  sortBtn.addEventListener("click", () => {
    store.cycleSort();
    sortLabel();
  });

  const logoutBtn = h("button", { class: "ghost", type: "button" }, "sign out");
  logoutBtn.addEventListener("click", logout);

  // --- bottom dock: Today + Done tabs ---
  const DOCK_TAB = "todo.dock.tab";
  const DOCK_OPEN = "todo.dock.open";
  let activeTab: "today" | "done" = ls.get(DOCK_TAB) === "done" ? "done" : "today";
  let dockOpen = ls.get(DOCK_OPEN) === "1";

  const todayUl = h("ul", { class: "list today-list" });
  const doneGroups = h("div", { class: "done-groups" });
  const todayTab = h("button", { class: "tab", type: "button" }, "today");
  const doneTab = h("button", { class: "tab", type: "button" }, "done");
  const chev = h("button", { class: "chev ghost", type: "button", "aria-label": "expand" });
  const dock = h(
    "section",
    { class: "dock" },
    h("div", { class: "tabbar" }, todayTab, doneTab, chev),
    h("div", { class: "panel" }, todayUl, doneGroups),
  );

  function syncDock(): void {
    dock.classList.toggle("open", dockOpen);
    todayTab.classList.toggle("active", activeTab === "today");
    doneTab.classList.toggle("active", activeTab === "done");
    todayUl.style.display = activeTab === "today" ? "" : "none";
    doneGroups.style.display = activeTab === "done" ? "" : "none";
    chev.textContent = dockOpen ? "▾" : "▴";
  }
  function selectTab(tab: "today" | "done"): void {
    if (activeTab === tab) dockOpen = !dockOpen;
    else {
      activeTab = tab;
      dockOpen = true;
    }
    ls.set(DOCK_TAB, activeTab);
    ls.set(DOCK_OPEN, dockOpen ? "1" : "0");
    syncDock();
    render();
  }
  todayTab.addEventListener("click", () => selectTab("today"));
  doneTab.addEventListener("click", () => selectTab("done"));
  chev.addEventListener("click", () => {
    dockOpen = !dockOpen;
    ls.set(DOCK_OPEN, dockOpen ? "1" : "0");
    syncDock();
    render();
  });

  // Drag a row onto the dock → Today; onto the backlog → recall.
  const dropId = (e: DragEvent): string => e.dataTransfer?.getData("text/plain") ?? "";
  const allowDrop = (e: DragEvent): void => e.preventDefault();
  dock.addEventListener("dragover", (e) => {
    e.preventDefault();
    dock.classList.add("drop-target");
  });
  dock.addEventListener("dragleave", () => dock.classList.remove("drop-target"));
  dock.addEventListener("drop", (e) => {
    e.preventDefault();
    dock.classList.remove("drop-target");
    const id = dropId(e);
    if (id) run(store.setToday(id, true));
  });
  list.addEventListener("dragover", allowDrop);
  list.addEventListener("drop", (e) => {
    e.preventDefault();
    const id = dropId(e);
    if (id) run(store.setToday(id, false));
  });

  root.append(
    h("header", {}, h("h1", {}, "todo"), h("div", { class: "actions" }, sortBtn, logoutBtn)),
    addForm,
    list,
    status,
    h(
      "p",
      { class: "hint" },
      "n new · j/k move · space done · g today · e edit · t due · r repeat · p prio · s sort · d delete · J/K reorder",
    ),
    dock,
  );
  syncDock();

  let selected: string | null = null;
  let editing: string | null = null;
  const rows = new Map<string, HTMLLIElement>();

  const flash = (err: unknown) => {
    status.textContent = errorMessage(err);
    setTimeout(() => (status.textContent = ""), 4000);
  };
  const run = (p: Promise<unknown>) => p.catch(flash);
  const note = (msg: string) => {
    status.textContent = msg;
    setTimeout(() => (status.textContent = ""), 2500);
  };

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

    const late = h("span", { class: "late-pill" });

    const due = h("input", { type: "date", class: "due", "aria-label": "due" });
    due.addEventListener("change", () => run(store.patch(t.id, { due: toPbDate(due.value) })));

    const repeat = h("select", { class: "repeat", "aria-label": "repeat" });
    for (const p of PRESETS) repeat.append(h("option", { value: p.value }, p.label));
    repeat.addEventListener("change", () => run(store.setRepeat(t.id, repeat.value)));

    const prio = h("button", { class: "prio", type: "button", "aria-label": "priority" }, "⚑");
    prio.addEventListener("click", (e) => {
      e.stopPropagation();
      run(store.cyclePriority(t.id));
    });

    const todayBtn = h("button", { class: "today-btn", type: "button", "aria-label": "today" }, "»");
    todayBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      run(store.toggleToday(t.id));
    });

    const del = h("button", { class: "del", type: "button", "aria-label": "delete" }, "×");
    del.addEventListener("click", () => run(store.remove(t.id)));

    const li = h(
      "li",
      { class: "todo", "data-id": t.id },
      check,
      h("div", { class: "main" }, title, h("div", { class: "meta" }, prio, todayBtn, late, due, repeat)),
      del,
    );
    li.draggable = true;
    li.addEventListener("dragstart", (e) => e.dataTransfer?.setData("text/plain", t.id));
    li.addEventListener("pointerdown", () => select(t.id));
    return li;
  }

  function update(li: HTMLLIElement, t: Todo): void {
    const d = dateOnly(t.due);
    const lateText = t.done ? "" : lateLabel(d);
    li.classList.toggle("done", t.done);
    li.classList.toggle("selected", t.id === selected);
    li.classList.toggle("pending", t.id.startsWith("tmp-"));
    li.classList.toggle("late", !!lateText);
    li.classList.toggle("repeating", !!t.repeat);

    const p = t.priority ?? 0;
    li.classList.toggle("prio-high", p === 1);
    li.classList.toggle("prio-urgent", p === 2);
    const prio = li.querySelector<HTMLButtonElement>(".prio")!;
    const ptitle = p === 2 ? "urgent" : p === 1 ? "high" : "normal";
    if (prio.title !== ptitle) prio.title = ptitle;

    const inToday = t.today && !t.done;
    li.classList.toggle("in-today", inToday);
    const todayBtn = li.querySelector<HTMLButtonElement>(".today-btn")!;
    const tglyph = inToday ? "«" : "»";
    if (todayBtn.textContent !== tglyph) todayBtn.textContent = tglyph;
    todayBtn.title = inToday ? "return to backlog" : "send to today";

    const check = li.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    if (check.checked !== t.done) check.checked = t.done;
    check.title = t.repeat ? `done for now → next ${describeRule(t.repeat)}` : "";

    if (editing !== t.id) {
      const title = li.querySelector<HTMLSpanElement>(".title")!;
      if (title.textContent !== t.title) title.textContent = t.title;
    }

    const late = li.querySelector<HTMLSpanElement>(".late-pill")!;
    if (late.textContent !== lateText) late.textContent = lateText;

    const due = li.querySelector<HTMLInputElement>(".due")!;
    if (due.value !== d) due.value = d;

    const repeat = li.querySelector<HTMLSelectElement>(".repeat")!;
    if (repeat.value !== t.repeat) {
      // Unknown (custom) rule: add it as an option so it isn't lost.
      if (t.repeat && !PRESETS.some((p) => p.value === t.repeat)) {
        repeat.append(h("option", { value: t.repeat }, describeRule(t.repeat) || t.repeat));
      }
      repeat.value = t.repeat;
    }
  }

  function rowFor(t: Todo): HTMLLIElement {
    let li = rows.get(t.id);
    if (!li) {
      li = row(t);
      rows.set(t.id, li);
    }
    update(li, t);
    return li;
  }

  // Keyed reconcile of `items` into `ul`; records ids in `present`.
  function renderInto(ul: HTMLElement, items: Todo[], present: Set<string>): void {
    let cursor: ChildNode | null = ul.firstChild;
    for (const t of items) {
      present.add(t.id);
      const li = rowFor(t);
      if (li !== cursor) ul.insertBefore(li, cursor);
      else cursor = cursor.nextSibling;
    }
  }

  // Done items grouped under relative-day headers (reuses row elements).
  function renderDone(items: Todo[], present: Set<string>): void {
    doneGroups.replaceChildren();
    let lastDay: string | null = null;
    let groupUl: HTMLUListElement | null = null;
    for (const t of items) {
      present.add(t.id);
      const day = (t.completed || "").slice(0, 10);
      if (day !== lastDay || !groupUl) {
        lastDay = day;
        doneGroups.append(h("div", { class: "done-head" }, relativeDay(day)));
        groupUl = h("ul", { class: "list done-list" });
        doneGroups.append(groupUl);
      }
      groupUl.append(rowFor(t));
    }
  }

  function relativeDay(day: string): string {
    if (!day) return "—";
    const t = today();
    if (day === t) return "today";
    const y = new Date(`${t}T00:00:00`);
    y.setDate(y.getDate() - 1);
    if (day === y.toISOString().slice(0, 10)) return "yesterday";
    return day;
  }

  function render(): void {
    const present = new Set<string>();
    const back = store.backlog();
    renderInto(list, back, present);

    const todayItems = store.todayList();
    const doneItems = store.doneList();
    if (dockOpen) {
      if (activeTab === "today") renderInto(todayUl, todayItems, present);
      else renderDone(doneItems, present);
    }

    for (const [id, li] of rows) {
      if (!present.has(id)) {
        li.remove();
        rows.delete(id);
        if (selected === id) selected = null;
        if (editing === id) editing = null;
      }
    }

    todayTab.textContent = todayItems.length ? `today (${todayItems.length})` : "today";
    doneTab.textContent = doneItems.length ? `done (${doneItems.length})` : "done";
    list.classList.toggle("empty", back.length === 0);
  }

  function select(id: string | null): void {
    selected = id;
    for (const [rid, li] of rows) li.classList.toggle("selected", rid === id);
    rows.get(id ?? "")?.scrollIntoView({ block: "nearest" });
  }

  function moveSelection(dir: -1 | 1): void {
    const ids = store.backlog().map((t) => t.id);
    if (ids.length === 0) return;
    const i = selected ? ids.indexOf(selected) : -1;
    const j = i < 0 ? (dir > 0 ? 0 : ids.length - 1) : Math.min(ids.length - 1, Math.max(0, i + dir));
    select(ids[j]!);
  }

  // Manual reorder only makes sense when the list isn't auto-sorted.
  function reorder(dir: -1 | 1): void {
    if (!selected) return;
    if (store.sortMode !== "manual") {
      note("switch to manual sort (s) to reorder");
      return;
    }
    run(store.move(selected, dir));
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

  function focusField(cls: string): void {
    const el = rows.get(selected ?? "")?.querySelector<HTMLElement>(cls);
    if (!el) return;
    el.focus();
    if (el instanceof HTMLInputElement && "showPicker" in el) {
      try {
        el.showPicker();
      } catch {
        /* needs user gesture in some browsers; focus is enough */
      }
    }
  }

  function onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    const inField =
      !!target &&
      (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target.isContentEditable);
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
          const ids = store.backlog().map((t) => t.id);
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
      case "t":
        focusField(".due");
        break;
      case "r":
        focusField(".repeat");
        break;
      case "p":
        if (selected) run(store.cyclePriority(selected));
        break;
      case "g":
        if (selected) run(store.toggleToday(selected));
        break;
      case "s":
        store.cycleSort();
        sortLabel();
        break;
      case "J":
        if (selected) reorder(1);
        break;
      case "K":
        if (selected) reorder(-1);
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

  // Late pills depend on the clock; refresh at midnight and on resume.
  const tick = setInterval(render, 60_000);

  return () => {
    document.removeEventListener("keydown", onKey);
    clearInterval(tick);
    unsub();
  };
}
