import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@exercisebook/web-renderer/styles.css";
import "./styles.css";

import { LaunchApp } from "./LaunchApp.js";

const root = document.querySelector<HTMLDivElement>("#root");

if (root === null) {
  throw new Error("Exercise Book could not find its application root.");
}

createRoot(root).render(
  <StrictMode>
    <LaunchApp />
  </StrictMode>,
);
