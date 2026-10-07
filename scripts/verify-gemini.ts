import { transcribe, friendlyError } from "../src/lib/gemini";
const path = process.argv[2];
if (!path) throw new Error("Usage: npx tsx scripts/verify-gemini.ts AUDIO_FILE [PROJECT] [MODEL]");
transcribe(path, { project: process.argv[3], model: process.argv[4], style: "verbatim" })
  .then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(error => { console.error(friendlyError(error)); process.exitCode = 1; });
