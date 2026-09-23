import { config } from "zod";

// The WeChat JavaScript runtime cannot compile functions from source text, so
// schemas validate without zod's compiled fast path. Schemas capture this
// setting when they are created, so this module must load before any schema.
config({ jitless: true });
