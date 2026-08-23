import { describe, expect, it, vi } from "vitest";

import {
  parseSyntheticArguments,
  runLearningNewSynthetic,
  type SyntheticFetch,
} from "./smoke-learning-new-synthetic.js";

const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

describe("learning.new production synthetic", () => {
  it("accepts only credential-free HTTPS origins", () => {
    expect(
      parseSyntheticArguments([
        "--primary",
        "https://exercisebook.app",
        "--action",
        "https://learning.new",
      ]),
    ).toEqual({
      primary: "https://exercisebook.app",
      action: "https://learning.new",
    });

    expect(() =>
      parseSyntheticArguments([
        "--primary",
        "http://exercisebook.app",
        "--action",
        "https://learning.new",
      ]),
    ).toThrow("primary must be an HTTPS origin");
  });

  it("passes the anonymous unsaved production contract", async () => {
    const fetchImpl = createContractFetch();

    await expect(
      runLearningNewSynthetic(
        {
          primary: "https://exercisebook.app",
          action: "https://learning.new",
        },
        fetchImpl,
      ),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it("fails closed when the preview becomes durable", async () => {
    const fetchImpl = createContractFetch({ saved: true });

    await expect(
      runLearningNewSynthetic(
        {
          primary: "https://exercisebook.app",
          action: "https://learning.new",
        },
        fetchImpl,
      ),
    ).rejects.toThrow("does not match the synthetic contract");
  });
});

function createContractFetch(options: { saved?: boolean } = {}): SyntheticFetch & {
  mock: unknown;
} {
  return vi.fn<SyntheticFetch>(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const method = init?.method ?? "GET";

    if (url.origin === "https://learning.new" && url.pathname === "/") {
      return new Response(null, {
        status: 302,
        headers: {
          ...SECURITY_HEADERS,
          location: "https://exercisebook.app/new",
        },
      });
    }
    if (url.pathname === "/" && method === "GET") {
      return new Response(null, {
        status: 302,
        headers: { location: "/new" },
      });
    }
    if (url.pathname === "/new") {
      return new Response(
        "Build a practice preview — This anonymous preview is not saved — https://exercisebook.app/new",
        { status: 200, headers: SECURITY_HEADERS },
      );
    }
    if (url.pathname === "/api/health") {
      return Response.json(
        {
          service: "exercisebook-web",
          status: "ok",
          version: "learning-new-v1",
        },
        { headers: SECURITY_HEADERS },
      );
    }
    if (url.pathname === "/api/plans/preview" && method === "POST") {
      return Response.json(
        {
          plan: { saved: options.saved ?? false, itemCount: 4 },
          worksheet: {
            items: [{}, {}, {}, {}],
            attributions: [{ license: "CC-BY-4.0" }],
          },
        },
        { headers: SECURITY_HEADERS },
      );
    }
    if (url.pathname === "/worksheet/sample/answers") {
      return new Response(null, { status: 404 });
    }
    return new Response(null, { status: 500 });
  }) as SyntheticFetch & { mock: unknown };
}
