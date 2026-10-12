// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ExercisePicker } from "../features/workout/ExercisePicker";
import type { WorkoutBodyPart } from "../types";

const recent = { 가슴: [], 등: [], 어깨: [], 팔: [], 하체: [], 코어: [], 유산소: [], 기타: [] } as Record<WorkoutBodyPart, string[]>;
beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe("맨몸운동 찾기", () => {
  it("맨몸 필터에서 바로 종목을 선택하고 기존 부위로 기록", () => {
    const add = vi.fn();
    render(<ExercisePicker customExercises={[]} recentExercises={recent} onAddExercise={add} />);
    fireEvent.click(screen.getByRole("button", { name: "맨몸운동" }));
    expect(screen.queryByRole("button", { name: "벤치프레스" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "맨몸 스쿼트" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "플랭크" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "푸시업(팔굽혀펴기)" }));
    expect(add).toHaveBeenCalledWith("푸시업(팔굽혀펴기)", "가슴");
  });

  it("맨몸 검색과 종목 검색을 지원하고 전체로 돌아갈 수 있다", () => {
    render(<ExercisePicker customExercises={[]} recentExercises={recent} onAddExercise={vi.fn()} />);
    const search = screen.getByPlaceholderText("운동 검색 (모든 부위에서)");
    fireEvent.change(search, { target: { value: "맨몸 운동" } });
    expect(screen.getByRole("button", { name: "버피" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "전체 운동" }));
    expect(search).toHaveValue("");
    fireEvent.change(search, { target: { value: "벤치프레스" } });
    expect(screen.getByRole("button", { name: "벤치프레스" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "검색어 지우기" }));
    fireEvent.click(screen.getByRole("button", { name: "맨몸운동" }));
    fireEvent.change(search, { target: { value: "팔굽혀펴기" } });
    expect(screen.getByRole("button", { name: "푸시업(팔굽혀펴기)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "맨몸 스쿼트" })).not.toBeInTheDocument();
  });
});
