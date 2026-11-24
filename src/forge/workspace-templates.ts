import {
  defaultReviewTemplates,
  requireName,
  reviewFields,
  type ReviewField,
  type ReviewTemplate,
} from "../domain/workspace";
import { command, type Actor } from "./workspace-resolver";

export async function getTemplate(
  actor: Actor,
  id: unknown,
): Promise<ReviewTemplate | undefined> {
  if (id === undefined || id === "") return undefined;
  const preset = defaultReviewTemplates.find((item) => item.id === id);
  if (!preset) throw new Error("Choose an available review template.");
  return (
    (await actor.store.get<ReviewTemplate>("review-template", preset.id))
      ?.data ?? preset
  );
}

command("workspace.templates", (actor) =>
  Promise.all(defaultReviewTemplates.map(({ id }) => getTemplate(actor, id))),
);

command("workspace.saveTemplate", async (actor, payload) => {
  if (!actor.canManage)
    throw new Error("A Jira project administrator manages review templates.");
  const template = await getTemplate(actor, payload.id);
  if (!template || template.revision !== payload.revision)
    throw new Error("The template changed. Refresh before saving.");
  const { instructions, evidenceFor, approval } = payload;
  if (
    typeof instructions !== "string" ||
    instructions.length > 2000 ||
    !Array.isArray(evidenceFor) ||
    evidenceFor.some((field) => !reviewFields.includes(field)) ||
    (approval !== "admins" && approval !== "editors")
  )
    throw new Error(
      "Enter valid instructions, evidence fields, and approval permissions.",
    );
  const next: ReviewTemplate = {
    id: template.id,
    revision: template.revision + 1,
    name: requireName(payload.name),
    instructions: instructions.trim(),
    evidenceFor: [...new Set(evidenceFor as ReviewField[])],
    approval,
  };
  const saved =
    template.revision === 0
      ? await actor.store.insert("review-template", template.id, next)
      : await actor.store.replace(
          "review-template",
          template.id,
          template.revision,
          next,
        );
  if (!saved) throw new Error("The template changed. Refresh before saving.");
  return next;
});
