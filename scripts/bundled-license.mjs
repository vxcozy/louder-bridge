import fs from "node:fs";

export function assertBundledLicense(
  filename,
  { expectedContents, label, minimumBytes = 1 },
) {
  let contents;
  try {
    contents = fs.readFileSync(filename, "utf8");
  } catch {
    throw new Error(`The release archive does not contain the ${label}.`);
  }
  if (Buffer.byteLength(contents) < minimumBytes) {
    throw new Error(`The bundled ${label} is incomplete.`);
  }
  if (expectedContents !== undefined && contents !== expectedContents) {
    throw new Error(`The bundled ${label} does not match the reviewed source.`);
  }
  return contents;
}
