/// <reference path="../pb_data/types.d.ts" />
// repeat: RRULE subset, e.g. "FREQ=DAILY;INTERVAL=2", "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR".
// Empty = one-off. Completing a repeating todo advances `due` instead of setting `done`.
migrate(
  (app) => {
    const todos = app.findCollectionByNameOrId("todos");
    todos.fields.add(new TextField({ name: "repeat", max: 200 }));
    app.save(todos);
  },
  (app) => {
    const todos = app.findCollectionByNameOrId("todos");
    todos.fields.removeByName("repeat");
    app.save(todos);
  },
);
