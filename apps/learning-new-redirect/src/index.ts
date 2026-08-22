export const PRIMARY_CREATE_URL = "https://exercisebook.app/new";
const WORKERS_DEV_HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+workers\.dev$/u;

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

function jsonError(
  status: 404 | 405,
  code: "not_found" | "method_not_allowed",
  message: string,
  additionalHeaders: HeadersInit = {},
): Response {
  return Response.json(
    { code, message },
    {
      status,
      headers: {
        ...SECURITY_HEADERS,
        ...Object.fromEntries(new Headers(additionalHeaders)),
      },
    },
  );
}

const worker = {
  fetch(request: Request): Response {
    const url = new URL(request.url);
    if (!isApprovedHost(url.hostname) || url.pathname !== "/") {
      return jsonError(404, "not_found", "Route not found.");
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return jsonError(405, "method_not_allowed", "Method not allowed.", {
        Allow: "GET, HEAD",
      });
    }

    return new Response(null, {
      status: 302,
      headers: {
        ...SECURITY_HEADERS,
        Location: PRIMARY_CREATE_URL,
      },
    });
  },
};

function isApprovedHost(hostname: string): boolean {
  return hostname === "learning.new" || WORKERS_DEV_HOST.test(hostname);
}

export default worker;
