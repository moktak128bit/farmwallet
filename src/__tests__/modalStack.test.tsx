// @vitest-environment jsdom
/**
 * React 18 StrictMode는 개발 모드에서 신규 마운트 시 effect를 "설정→해제→재설정"으로
 * 한 번 더 검증 실행한다. useModalStackEntry가 이 사이클마다 pushModal/popModal을 그대로
 * 호출하면 구독자(historyNav 등)가 0→1→0→1로 깜빡이는 중간값(0)을 실제 변화로 오인해
 * history.back()까지 호출하는 버그로 이어졌다(가계부 일괄편집·반복지출 팝오버·계좌 조정 모달이
 * 열리자마자 저절로 닫힘). notify()의 microtask 코얼레싱이 이 중간값을 구독자에게 숨기는지 검증.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import { useModalStackEntry, getModalDepth, subscribeModalStack } from "../utils/modalStack";

function FakeModal({ open }: { open: boolean }) {
  useModalStackEntry(open);
  return null;
}

describe("modalStack — StrictMode 이중 마운트 내성", () => {
  afterEach(() => cleanup());

  it("StrictMode 신규 마운트 중 구독자는 중간값(0)을 보지 않고 최종 깊이만 본다", async () => {
    const observed: number[] = [];
    const unsub = subscribeModalStack(() => observed.push(getModalDepth()));

    render(
      <React.StrictMode>
        <FakeModal open={true} />
      </React.StrictMode>
    );

    // notify()는 microtask로 한 틱 모아 보낸다 — 플러시될 때까지 대기.
    await Promise.resolve();
    await Promise.resolve();

    unsub();
    // StrictMode의 설정→해제→재설정이 순효과 0(깊이 그대로 1)이므로, 관찰된 값 중
    // 0이 있으면 안 되고(중간값 노출 = 버그 재현), 최종적으로 깊이는 1이어야 한다.
    expect(observed).not.toContain(0);
    expect(getModalDepth()).toBe(1);
  });
});
