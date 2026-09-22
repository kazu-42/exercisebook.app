import catalog from "../.release/catalog.json";
import { createStudioWorker } from "./app";

export default createStudioWorker(catalog, { generated: true });
