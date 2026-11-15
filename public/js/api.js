let csrfToken = "";

export const setCsrfToken = (token) => {
  csrfToken = typeof token === "string" ? token : "";
};

export const api = async (path, { method = "GET", body, idempotencyKey } = {}) => {
  const requestMethod = String(method).toUpperCase();
  const headers = { Accept: "application/json" };
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(requestMethod);

  if (body !== undefined && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  if (mutating && csrfToken) headers["X-CSRF-Token"] = csrfToken;

  if (
    mutating &&
    typeof idempotencyKey === "string" &&
    idempotencyKey.trim()
  ) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  const response = await fetch(path, {
    method: requestMethod,
    headers,
    credentials: "same-origin",
    body: body === undefined
      ? undefined
      : body instanceof FormData
        ? body
        : JSON.stringify(body),
  });

  if (response.status === 204) return null;

  let result;

  try {
    result = await response.json();
  } catch {
    const error = new Error(
      response.ok
        ? `Invalid response (${response.status})`
        : `Request failed (${response.status})`,
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

    if (result && typeof result === "object") {
      for (const [key, value] of Object.entries(result)) {
        if (
          key !== "error" &&
          key !== "message" &&
          key !== "status" &&
          !(key in error)
        ) {
          error[key] = value;
        }
      }
    }

    throw error;
  }

  return result;
};
