import { describe, expect, it } from "vitest";

import { escapeHtmlTextAndAttribute } from "./html-escape.js";

describe("static HTML escaping", () => {
  it("neutralizes hostile text and attribute delimiters", () => {
    expect(escapeHtmlTextAndAttribute(`en"><script>alert('worksheet')</script>&`)).toBe(
      "en&quot;&gt;&lt;script&gt;alert(&#39;worksheet&#39;)&lt;/script&gt;&amp;",
    );
  });
});
