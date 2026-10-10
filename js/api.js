let csrfToken = "";

export function setCsrfToken(token) {
  csrfToken = typeof token === "string" ? token : "";
}

export async function api(path, { method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
  if (body !== undefined && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  if (mutating && csrfToken) headers["X-CSRF-Token"] = csrfToken;
  const response = await fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined :
      body instanceof FormData ? body : JSON.stringify(body),
  });
  if (response.status === 204) return null;
  let result;
  try {
    result = await response.json();
  } catch {
    const error = new Error(
      response.ok ? `Invalid response (${response.status})` : `Request failed (${response.status})`,
    );
    error.status = response.status;
    throw error;
  }
  if (!response.ok) {
    const message = typeof result?.error === "string" && result.error
      ? result.error
      : `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return result;
}
