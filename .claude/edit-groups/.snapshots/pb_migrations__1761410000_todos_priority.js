/// <reference path="../pb_data/types.d.ts" />
// priority: 0 normal (default), 1 high, 2 urgent. Higher sorts first.
migrate(
  (app) => {
    const todos = app.findCollectionByNameOrId("todos");
    todos.fields.add(new NumberField({ name: "priority", onlyInt: true, min: 0, max: 2 }));
    app.save(todos);
  },
  (app) => {
    const todos = app.findCollectionByNameOrId("todos");
    todos.fields.removeByName("priority");
    app.save(todos);
  },
);
