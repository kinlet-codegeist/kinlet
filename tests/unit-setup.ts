import { randomUUID } from "node:crypto";
import { vi } from "vitest";
// Node 18 test workers do not expose the browser's Crypto global.
vi.stubGlobal("crypto", { randomUUID });
