/**
 * 임시 마이그레이션 카드 2종 — 1단계: 새 항목 구조 정렬(demoteSchema),
 * 2단계: 유류교통비 분류 통합(transportCategoryMigration). SettingsPage에서 분리.
 * 미리보기 → window.confirm → 적용 흐름·문구는 원본 그대로 유지 (위험 흐름).
 * React.memo로 감싸므로 부모가 넘기는 onChangeData는 참조가 안정적이어야 한다.
 */
import React from "react";
import { toast } from "react-hot-toast";
import type { AppData } from "../../types";
import {
  previewTransportMigration,
  applyTransportMigration,
  NEW_TRANSPORT_SUBS,
} from "../../utils/transportCategoryMigration";
import {
  previewDemoteSchema,
  applyDemoteSchema,
} from "../../utils/demoteSchema";
import { saveSafetySnapshot } from "../../services/backupService";

interface Props {
  data: AppData;
  onChangeData: (next: AppData) => void;
}

export const MigrationToolsCards: React.FC<Props> = React.memo(function MigrationToolsCards({
  data,
  onChangeData
}) {
  return (
    <>
      <div className="card" style={{ borderLeft: "3px solid #2563eb" }}>
        <div className="card-title">⏱ 임시 1단계: 새 항목 구조 정렬 (cat을 지출/수입/이체로 통일)</div>
        <p className="hint" style={{ marginBottom: 8 }}>
          새 폼으로 잘못 입력된 16건 정도의 항목 (예: <code>cat="식비" sub="시장/마트"</code>)을
          표준 3-level 구조 (예: <code>cat="지출" sub="식비" det="시장/마트"</code>)로 끌어내립니다.
          <br />
          <strong>데이터 손실 없음</strong> — 단순히 한 칸씩 내림. <strong>2단계 전에 먼저 실행</strong>하세요.
        </p>
        <button
          type="button"
          onClick={async () => {
            const preview = previewDemoteSchema(data);
            if (preview.affected === 0) {
              toast("이미 모두 표준 구조입니다 (정렬 불필요).");
              return;
            }
            const lines: string[] = [
              `1단계: 새 항목 구조 정렬 미리보기`,
              ``,
              `• 총 가계부 항목: ${preview.totalLedger}건`,
              `• 변경 대상 (잘못 입력된 새 항목): ${preview.affected}건`,
              `• 이미 표준: ${preview.alreadyStandard}건`,
              ``,
              `[kind별 영향]`,
              `  expense: ${preview.byKind.expense}건`,
              `  income: ${preview.byKind.income}건`,
              `  transfer: ${preview.byKind.transfer}건`,
              ``,
              `[현재 cat 값별 (이게 sub로 내려감)]`,
            ];
            for (const [oldCat, n] of Object.entries(preview.byOldCategory).sort((a, b) => b[1] - a[1])) {
              lines.push(`  ${oldCat}: ${n}건`);
            }
            if (preview.samples.length > 0) {
              lines.push(``, `[샘플 변환]`);
              for (const s of preview.samples) {
                lines.push(`  cat="${s.before.cat}" sub="${s.before.sub ?? ""}" det="${s.before.det ?? ""}"`);
                lines.push(`  → cat="${s.after.cat}" sub="${s.after.sub ?? ""}" det="${s.after.det ?? ""}"`);
              }
            }
            lines.push(``, `이대로 적용하시겠습니까?`);
            if (!window.confirm(lines.join("\n"))) return;

            await saveSafetySnapshot(data, "구조 정렬 직전 자동 스냅샷");
            const next = applyDemoteSchema(data);
            onChangeData(next);
            toast.success(`1단계 완료: ${preview.affected}건 정렬 — 이제 2단계(유류교통비 통합) 가능`);
          }}
          style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600, background: "#2563eb", color: "white", border: "none" }}
        >
          🔧 1단계: 구조 정렬 실행 (먼저 클릭)
        </button>
      </div>
      <div className="card" style={{ borderLeft: "3px solid #f59e0b" }}>
        <div className="card-title">⏱ 임시 2단계: 유류교통비 분류 6개로 통합 (구조 보존)</div>
        <p className="hint" style={{ marginBottom: 8 }}>
          14개 → <strong>6개</strong> ({NEW_TRANSPORT_SUBS.join(" / ")})로 압축합니다.
          <br />
          • 옛 구조(<code>cat=지출 / sub=유류교통비 / det=하이패스</code>)와 새 구조(<code>cat=유류교통비 / sub=하이패스</code>) <strong>둘 다 처리</strong>합니다.
          <br />
          • 데이터 구조는 <strong>변경하지 않음</strong> (대분류/중분류는 그대로).
          <br />
          • 원래 분류명(예: 하이패스, 주차비)은 <strong>상세내역에 자동 보존</strong> — <code>[원래소분류:하이패스]</code> 형식.
          <br />
          <strong>실행 전에 반드시 백업</strong>하세요.
        </p>
        <button
          type="button"
          onClick={async () => {
            const preview = previewTransportMigration(data);
            if (
              !preview.presetsNeedUpdate &&
              preview.ledgerAffected === 0 &&
              preview.byStructure.oldStructure === 0 &&
              preview.byStructure.newStructure === 0
            ) {
              toast("이미 통합된 상태입니다.");
              return;
            }
            const lines: string[] = [
              `유류교통비 통합 미리보기`,
              ``,
              `• 영향 받을 가계부 항목: ${preview.ledgerAffected}건`,
              `• 옛 구조 항목: ${preview.byStructure.oldStructure}건 (det 변경)`,
              `• 새 구조 항목: ${preview.byStructure.newStructure}건 (sub 변경)`,
            ];
            if (Object.keys(preview.countByOldName).length > 0) {
              lines.push(``, `[옛 분류 → 새 분류 매핑]`);
              const sorted = Object.entries(preview.countByOldName).sort((a, b) => b[1] - a[1]);
              for (const [oldName, count] of sorted) {
                lines.push(`  ${oldName}: ${count}건`);
              }
            }
            if (Object.keys(preview.countByNewName).length > 0) {
              lines.push(``, `[통합 후 새 분류별 합계]`);
              const sorted = Object.entries(preview.countByNewName).sort((a, b) => b[1] - a[1]);
              for (const [newName, count] of sorted) {
                lines.push(`  ${newName}: ${count}건`);
              }
            }
            if (preview.unmappedNotices.length > 0) {
              lines.push(``, `⚠ 매핑 정의에 없는 값 (변경 안 됨):`);
              lines.push(`  ${preview.unmappedNotices.join(", ")}`);
            }
            lines.push(``, `원래 분류명은 상세내역에 [원래소분류:...] 로 보존됩니다.`);
            lines.push(``, `이대로 적용하시겠습니까?`);
            if (!window.confirm(lines.join("\n"))) return;

            await saveSafetySnapshot(data, "유류교통비 통합 직전 자동 스냅샷");
            const next = applyTransportMigration(data);
            onChangeData(next);
            toast.success(
              `유류교통비 통합 완료: 가계부 ${preview.ledgerAffected}건 변환 (원래값은 상세내역에 보존)`
            );
          }}
          style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600 }}
        >
          🔀 유류교통비 통합 실행 (미리보기 후 확인)
        </button>
      </div>
    </>
  );
});
