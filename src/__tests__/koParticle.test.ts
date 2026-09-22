import { describe, it, expect } from "vitest";
import { koObjectParticle, validateRequired } from "../utils/validation";

describe("koObjectParticle — 받침에 따라 을/를", () => {
  it("받침 없음 → 를, 받침 있음 → 을", () => {
    expect(koObjectParticle("계좌")).toBe("를");
    expect(koObjectParticle("금액")).toBe("을");
    expect(koObjectParticle("티커")).toBe("를");
  });
  it("한글이 아니면 을(를)로 폴백", () => {
    expect(koObjectParticle("USD")).toBe("을(를)");
    expect(koObjectParticle("")).toBe("을(를)");
  });
  it("validateRequired 메시지에 반영", () => {
    expect(validateRequired("", "계좌").error).toBe("계좌를 입력해주세요");
    expect(validateRequired("", "금액").error).toBe("금액을 입력해주세요");
  });
});
