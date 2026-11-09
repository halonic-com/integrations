import { describe, expect, it } from "vitest";
import { FAKE } from "../test/fakes.ts";
import { Fakes } from "./fakes.ts";

describe("Fakes", () => {
  it("numbers each new value and gives a known one the same stand-in", () => {
    const fakes = new Fakes();
    expect(fakes.email(FAKE.email)).toBe("person1@example.com");
    expect(fakes.email(FAKE.otherEmail)).toBe("person2@example.com");
    expect(fakes.email(FAKE.email.toUpperCase())).toBe("person1@example.com");
  });

  it("skips an example address the recording keeps, whatever its case", () => {
    const fakes = new Fakes();
    fakes.keepEmail("Person1@Example.com");
    expect(fakes.email(FAKE.email)).toBe("person2@example.com");
  });

  it("skips a drama number the recording keeps, whatever its spacing", () => {
    const fakes = new Fakes();
    fakes.keepPhone("+44 7700 900001");
    expect(fakes.phone(FAKE.phone)).toBe("+447700900002");
  });

  it("starts with the kept values of an earlier pass", () => {
    const firstPass = new Fakes();
    expect(firstPass.email(FAKE.email)).toBe("person1@example.com");
    firstPass.keepEmail("person1@example.com");
    firstPass.keepPhone("+447700900001");
    const fakes = new Fakes(firstPass.kept());
    expect(fakes.email(FAKE.email)).toBe("person2@example.com");
    expect(fakes.phone(FAKE.phone)).toBe("+447700900002");
  });
});
