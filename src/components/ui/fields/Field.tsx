import React from "react";

interface Props {
  /** 필드 라벨 */
  label: React.ReactNode;
  /** 라벨이 가리키는 입력의 id */
  htmlFor?: string;
  /** 필수 표시(*) */
  required?: boolean;
  /** 에러 메시지 — 있으면 빨간 테두리 + 문구 */
  error?: string;
  /** 라벨 오른쪽에 붙는 보조 조작(통화 전환·오늘 버튼 등) */
  action?: React.ReactNode;
  /** 입력 아래 설명 — 에러가 있으면 에러가 우선 */
  hint?: React.ReactNode;
  /**
   * 에러 자리를 항상 비워 두어 입력 중 레이아웃이 튀지 않게 한다.
   * 여러 필드가 한 줄에 있는 폼에서 특히 중요.
   */
  reserveErrorSpace?: boolean;
  children: React.ReactNode;
}

/**
 * 입력 필드 한 칸의 공통 껍데기 — 라벨·필수표시·에러·힌트.
 *
 * 기존에는 폼마다 label/span/에러 span을 손으로 짜서 글자 크기·색·간격이 화면마다 달랐다.
 * 여기 하나만 고치면 앱 전체 입력 모양이 같이 바뀐다.
 *
 * 바깥을 <label>로 감싸지 않는다 — 라벨 안에 버튼(오늘·통화 전환)이 들어가면
 * 그 버튼을 눌러도 입력이 포커스되고, 버튼의 접근성 이름이 라벨 텍스트로 덮인다.
 */
export const Field: React.FC<Props> = ({
  label,
  htmlFor,
  required,
  error,
  action,
  hint,
  reserveErrorSpace,
  children
}) => (
  <div className={`field${error ? " has-error" : ""}`}>
    <div className="field-label">
      <label className="field-label-text" htmlFor={htmlFor}>
        {label}
        {required && <span className="field-required" aria-hidden> *</span>}
      </label>
      {action && <span className="field-action">{action}</span>}
    </div>
    {children}
    {error ? (
      <span className="field-error" role="alert">
        {error}
      </span>
    ) : hint ? (
      <span className="field-hint">{hint}</span>
    ) : reserveErrorSpace ? (
      <span className="field-error" aria-hidden>
        &nbsp;
      </span>
    ) : null}
  </div>
);
