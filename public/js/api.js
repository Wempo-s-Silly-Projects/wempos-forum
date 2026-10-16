let csrfToken = "";

export const setCsrfToken = (token) => {
  csrfToken = typeof token === "string" ? token : "";
};

export const api = async (path, { method = "GET", body, idempotencyKey } = {}) => {
  const headers = { Accept: "application/json" };
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
  if (body !== undefined && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  if (mutating && csrfToken) headers["X-CSRF-Token"] = csrfToken;
  if (mutating && typeof idempotencyKey === "string" && idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
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
    // Copy the JSON body's extra fields onto the error (banned/reason/expiresAt
    // for the login ban screen, but additive for every response). "error" is
    // already the message, "message" would overwrite Error.message, and
    // "status" stays the HTTP status — all three are skipped.
    if (result && typeof result === "object") {
      for (const [key, value] of Object.entries(result)) {
        if (key !== "error" && key !== "message" && key !== "status") error[key] = value;
      }
    }
    throw error;
  }
  return result;
}
