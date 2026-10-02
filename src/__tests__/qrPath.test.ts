import { describe, it, expect } from "vitest";
import { qrPathData } from "../utils/qrPath";

describe("qrPathData", () => {
  it("검은 칸마다 1x1 사각형 path를 만든다", () => {
    expect(qrPathData([[true, false], [false, true]])).toBe("M0 0h1v1h-1zM1 1h1v1h-1z");
  });
  it("검은 칸이 없으면 빈 문자열", () => {
    expect(qrPathData([[false]])).toBe("");
  });
});
