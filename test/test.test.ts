import fs from "fs";
import { migrateToNamedExport } from "../src";
// fs.cpSync('example', 'example-untouched', {recursive: true});

beforeAll(async () => {
  await migrateToNamedExport();
})

describe("default-export", () => {

  it("method should be with named export", () => {
    const methodFile = fs.readFileSync("test-project/B-method.ts", "utf-8");
    const expectedMethodFile = fs.readFileSync(
      "test-project-expected/B-method.ts",
      "utf-8"
    );
    expect(methodFile).toEqual(expectedMethodFile);
  });

  it("usage should be with named export", () => {
    const methodFile = fs.readFileSync("test-project/A-usage.ts", "utf-8");
    const expectedMethodFile = fs.readFileSync(
      "test-project-expected/A-usage.ts",
      "utf-8"
    );
    expect(methodFile).toEqual(expectedMethodFile);
  });
});
