import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../views/workbench/page_memory.js", import.meta.url), "utf8");
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
let memory = await import(moduleUrl);
const favourite = memory.pageKey("images", {state: "favourite", rating: "SFW"});
assert.equal(favourite, memory.pageKey("images", {rating: "SFW", state: "favourite"}));
memory.savePage(favourite, 3);
assert.equal(memory.readPage(favourite), 3);
assert.equal(memory.readPage(memory.pageKey("images", {state:"hd", rating:"SFW"})), 1);
assert.equal(memory.readPage(memory.pageKey("resources/images", {state:"favourite", rating:"SFW"})), 1);
memory = await import(`${moduleUrl}#reload`);
assert.equal(memory.readPage(favourite), 3, "browser storage survives a new view instance");
for (const invalid of ["NaN", "-1", "0", "99999999999999999", "2.5", "{broken}"]) {
  const badKey = `invalid-${invalid}`;
  storage.set(badKey, invalid);
  assert.equal(memory.readPage(badKey), 1);
}
globalThis.localStorage = {getItem() {throw Error("storage disabled");}, setItem() {throw Error("storage disabled");}};
memory.savePage(favourite, 4);
assert.equal(memory.readPage(favourite), 4, "embedded views retain in-memory navigation when storage is prohibited");
memory.savePage(favourite, -2);
assert.equal(memory.readPage(favourite), 4);
const posted = [];
await memory.initializePageMemory({apiGet: async () => ({pages:{[favourite]:7}}), apiPost: async (route, data) => posted.push(data)});
assert.equal(memory.readPage(favourite), 7, "server memory restores embedded views without local storage");
memory.savePage(favourite, 2);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(posted.at(-1).page, 2);
const options = ["images/favourite", "images/hd", "controls/pass"].map(value => ({
  value, closest: () => ({disabled: value.startsWith("controls/") && !allowControls}),
}));
let allowControls = true;
const select = {options};
memory.saveGallerySelection("reference", "controls/pass");
await new Promise(resolve => setTimeout(resolve, 0));
const selection = posted.at(-1);
assert.deepEqual(selection, {key: "comfy-gallery-selection:reference", selection: "controls/pass"});
memory = await import(`${moduleUrl}#selection`);
await memory.initializePageMemory({
  apiGet: async () => ({pages: {}, selections: {[selection.key]: selection.selection}}),
});
for (const scope of ["reference", "lora-preview"]) {
  memory.restoreGallerySelection(scope, select, "images/favourite");
  assert.equal(select.value, scope === "reference" ? "controls/pass" : "images/favourite");
}
allowControls = false;
memory.restoreGallerySelection("reference", select, "images/favourite");
assert.equal(select.value, "images/favourite");
allowControls = true;
memory.restoreGallerySelection("reference", select, "images/favourite");
assert.equal(select.value, "controls/pass", "temporary fallback keeps the remembered selection");
console.log("PASS: page memory and per-entry gallery selection, including unavailable options and disabled storage");
