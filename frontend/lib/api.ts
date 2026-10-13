export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080/api";

export function postJson(path: string, body: unknown) {
  return fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
