/// <reference path="../pb_data/types.d.ts" />
// today: manual focus-queue flag. completed: datetime set when marked done (Done grouping).
migrate(
  (app) => {
    const todos = app.findCollectionByNameOrId("todos");
    todos.fields.add(new BoolField({ name: "today" }));
    todos.fields.add(new DateField({ name: "completed" }));
    app.save(todos);
  },
  (app) => {
    const todos = app.findCollectionByNameOrId("todos");
    todos.fields.removeByName("today");
    todos.fields.removeByName("completed");
    app.save(todos);
  },
);
