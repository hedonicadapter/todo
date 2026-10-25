/// <reference path="../pb_data/types.d.ts" />
// todos collection. Owner-scoped rules so v2 sharing is a rule change, not a migration.
// API rules run before request hooks, so owner can't be injected server-side;
// clients send owner and the create rule rejects anything but their own id.
const OWN = '@request.auth.id != "" && owner = @request.auth.id';
// owner is immutable in v1 (update rule checks the pre-update record only).
const OWN_KEEP = OWN + ' && (@request.body.owner:isset = false || @request.body.owner = @request.auth.id)';

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");

    // Single user in v1: no public signup. Users are created in admin UI.
    users.createRule = null;
    app.save(users);

    const todos = new Collection({
      name: "todos",
      type: "base",
      listRule: OWN,
      viewRule: OWN,
      createRule: OWN,
      updateRule: OWN_KEEP,
      deleteRule: OWN,
      fields: [
        { name: "title", type: "text", required: true, max: 1000 },
        { name: "done", type: "bool" },
        { name: "due", type: "date" },
        { name: "order", type: "number" },
        {
          name: "owner",
          type: "relation",
          required: true,
          collectionId: users.id,
          maxSelect: 1,
          cascadeDelete: true,
        },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE INDEX idx_todos_owner_done_order ON todos (owner, done, `order`)"],
    });
    app.save(todos);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("todos"));

    const users = app.findCollectionByNameOrId("users");
    users.createRule = "";
    app.save(users);
  },
);
