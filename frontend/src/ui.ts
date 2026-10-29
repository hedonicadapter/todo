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
  const form = h("form", { class: "login" }, h("h1", {}, "todo"), email, password, h("button", {}, "[ SIGN IN ]"), error);
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

  const addInput = h("input", { placeholder: "NEW TODO", autocomplete: "off", enterkeyhint: "done" });
  const addForm = h(
    "form",
    { class: "add" },
    h("span", { class: "prompt" }, ">"),
    h("span", { class: "caret" }, "█"),
    addInput,
  );
  const list = h("ul", { class: "list" }); // backlog
  const listFrameLabel = h("span", { class: "frame-label" }, "BACKLOG");
  const listFrame = h("div", { class: "frame" }, listFrameLabel, list);
  const status = h("p", { class: "status", role: "status" });

  const sortBtn = h("button", { class: "ghost sort", type: "button" });
  const sortLabel = () => (sortBtn.textContent = `[ SORT: ${store.sortMode.toUpperCase()} ]`);
  sortLabel();
  sortBtn.addEventListener("click", () => {
    store.cycleSort();
    sortLabel();
  });

  const logoutBtn = h("button", { class: "ghost", type: "button" }, "[ SIGN OUT ]");
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
  // Panel opens upward above the tabs; the add prompt is the bottom-most line.
  const dock = h(
    "section",
    { class: "dock" },
    h("div", { class: "panel-wrap" }, h("div", { class: "panel" }, todayUl, doneGroups)),
    h("div", { class: "tabbar" }, todayTab, doneTab, chev),
    addForm,
  );

  function syncDock(): void {
    dock.classList.toggle("open", dockOpen);
    todayTab.classList.toggle("active", activeTab === "today");
    doneTab.classList.toggle("active", activeTab === "done");
    todayUl.style.display = activeTab === "today" ? "" : "none";
    doneGroups.style.display = activeTab === "done" ? "" : "none";
    chev.textContent = dockOpen ? "▾" : "▴";
    // Widen page bottom padding when expanded so the list can scroll above the dock.
    document.body.classList.toggle("dock-open", dockOpen);
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

  const ptr = h("div", { class: "ptr" }, "↓ PULL TO REFRESH");

  root.append(
    ptr,
    h("header", {}, h("h1", {}, "todo"), h("div", { class: "actions" }, sortBtn, logoutBtn)),
    listFrame,
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
  let dragging = false;
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
    // Select the new row so it scrolls into view (handy when sort drops it far down).
    store
      .add(title)
      .then((id) => {
        if (!id) return;
        select(id);
        const li = rows.get(id);
        if (li) {
          li.classList.add("enter");
          li.addEventListener("animationend", () => li.classList.remove("enter"), { once: true });
        }
      })
      .catch(flash);
  });

  function row(t: Todo): HTMLLIElement {
    const check = h("button", { class: "check", type: "button", "aria-label": "done" });
    check.addEventListener("click", (e) => {
      e.stopPropagation();
      run(store.toggle(t.id));
    });

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

    const handle = h("button", { class: "handle", type: "button", "aria-label": "reorder", tabindex: "-1" }, "⠿");
    handle.addEventListener("pointerdown", (e) => startDrag(e, t.id, li));

    const li = h(
      "li",
      { class: "todo", "data-id": t.id },
      check,
      h("div", { class: "main" }, title, h("div", { class: "meta" }, prio, todayBtn, late, due, repeat)),
      handle,
      del,
    );
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

    const check = li.querySelector<HTMLButtonElement>(".check")!;
    // Repeating todos use round ( ) brackets; one-offs use square [ ].
    const glyph = t.repeat ? (t.done ? "(x)" : "( )") : t.done ? "[x]" : "[ ]";
    if (check.textContent !== glyph) check.textContent = glyph;
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
    if (dragging) return; // don't fight the live DOM reorder mid-drag
    const present = new Set<string>();
    const back = store.backlog();
    listFrameLabel.textContent = `BACKLOG (${back.length})`;
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

  // Pointer drag-reorder from the row handle. Immediate start, touch + mouse.
  // Today is always reorderable; the backlog only in manual sort.
  function startDrag(e: PointerEvent, id: string, li: HTMLLIElement): void {
    const t = store.get(id);
    const ul = li.parentElement;
    if (!t || !ul || t.done) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* best-effort; document listeners below are the real path */
    }
    dragging = true;
    li.classList.add("dragging");

    const onMove = (ev: PointerEvent): void => {
      const y = ev.clientY;
      const sibs = Array.from(ul.querySelectorAll<HTMLLIElement>(":scope > li.todo")).filter((s) => s !== li);
      let before: HTMLLIElement | null = null;
      for (const s of sibs) {
        const r = s.getBoundingClientRect();
        if (y < r.top + r.height / 2) {
          before = s;
          break;
        }
      }
      if (before) ul.insertBefore(li, before);
      else ul.appendChild(li);
    };
    const end = (): void => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
      li.classList.remove("dragging");
      dragging = false;
      if (!t.today && store.sortMode !== "manual") {
        // Dragging the backlog switches it to manual, keeping what's on screen.
        const ids = Array.from(ul.querySelectorAll<HTMLElement>(":scope > li.todo"))
          .map((el) => el.getAttribute("data-id"))
          .filter((x): x is string => !!x);
        const p = store.applyManualOrder(ids);
        sortLabel();
        run(p);
      } else {
        const prevId = (li.previousElementSibling as HTMLElement | null)?.getAttribute("data-id") ?? null;
        const nextId = (li.nextElementSibling as HTMLElement | null)?.getAttribute("data-id") ?? null;
        run(store.placeBetween(id, prevId, nextId));
      }
    };
    // Listen on document so a mouse that leaves the small handle still drives it.
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
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

  // Pull-to-refresh: a standalone PWA has no browser reload. Pull down at the
  // top past a threshold → re-fetch. Not while dragging a row or on a handle.
  const ac = new AbortController();
  const PTR_MAX = 90;
  const PTR_TRIP = 70;
  let ptrY = 0;
  let ptrOn = false;
  let ptrDist = 0;
  document.addEventListener(
    "touchstart",
    (e) => {
      const tgt = e.target as HTMLElement | null;
      ptrOn = !dragging && window.scrollY <= 0 && e.touches.length === 1 && !tgt?.closest(".handle");
      ptrY = e.touches[0]?.clientY ?? 0;
      ptrDist = 0;
      ptr.classList.add("pulling");
    },
    { passive: true, signal: ac.signal },
  );
  document.addEventListener(
    "touchmove",
    (e) => {
      if (!ptrOn || dragging) return;
      const dy = (e.touches[0]?.clientY ?? 0) - ptrY;
      if (dy <= 0 || window.scrollY > 0) {
        ptrDist = 0;
        ptr.style.height = "0";
        ptr.classList.remove("ready");
        return;
      }
      e.preventDefault(); // suppress native overscroll so our indicator shows
      ptrDist = Math.min(dy * 0.5, PTR_MAX);
      ptr.style.height = `${ptrDist}px`;
      const ready = ptrDist >= PTR_TRIP;
      ptr.classList.toggle("ready", ready);
      ptr.textContent = ready ? "↻ RELEASE TO REFRESH" : "↓ PULL TO REFRESH";
    },
    { passive: false, signal: ac.signal },
  );
  document.addEventListener(
    "touchend",
    () => {
      ptr.classList.remove("pulling");
      if (!ptrOn) return;
      ptrOn = false;
      if (ptrDist >= PTR_TRIP) {
        ptr.textContent = "↻ REFRESHING";
        ptr.style.height = "34px";
        run(store.load()).finally(() => {
          ptr.style.height = "0";
          ptr.classList.remove("ready");
        });
      } else {
        ptr.style.height = "0";
        ptr.classList.remove("ready");
      }
    },
    { passive: true, signal: ac.signal },
  );

  document.addEventListener("keydown", onKey);
  const unsub = store.onChange(render);
  render();

  // Late pills depend on the clock; refresh at midnight and on resume.
  const tick = setInterval(render, 60_000);

  return () => {
    document.removeEventListener("keydown", onKey);
    clearInterval(tick);
    unsub();
    ac.abort();
    document.body.classList.remove("dock-open");
  };
}
