export async function workspaceRequest<T>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const { invoke } = await import("@forge/bridge");
  return invoke<T>("workspace." + action, payload) as Promise<T>;
}
