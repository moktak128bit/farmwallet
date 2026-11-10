/**
 * 시작 골격 화면 — index.html #boot-splash와 같은 모양(스타일은 styles.css .boot-*).
 * 앱이 기기 저장소에서 장부를 펼치는 동안(useAppData isLoading) 흰 화면 대신 그대로 이어 보여 준다.
 */
export function BootSkeleton() {
  return (
    <div className="boot" data-step="3" aria-busy="true">
      <div className="boot-head">
        <span className="boot-brand">FarmWallet</span>
        <i />
      </div>
      <div className="boot-tabs" aria-hidden="true">
        <i /><i /><i /><i /><i /><i />
      </div>
      <div className="boot-main">
        <div className="boot-status" role="status">
          <ol className="boot-steps">
            <li data-s="1">앱 열기</li>
            <li data-s="2">시트에서 장부 받기</li>
            <li data-s="3">화면 그리기</li>
          </ol>
        </div>
        <SkeletonCards labels={["이번 달 지출", "내 자산", "투자·배당"]} />
      </div>
    </div>
  );
}

/** 탭 화면을 처음 여는 동안(Suspense) 보이는 자리 표시 — 골격 카드만 */
export function PageSkeleton() {
  return (
    <div className="boot-page" aria-busy="true" role="status" aria-label="화면 준비 중">
      <SkeletonCards />
    </div>
  );
}

function SkeletonCards({ labels }: { labels?: [string, string, string] }) {
  return (
    <>
      <div className="boot-grid" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="boot-card">
            {labels && <p>{labels[i]}</p>}
            <b /><i /><i /><i />
          </div>
        ))}
      </div>
      <div className="boot-card" aria-hidden="true"><i /><i /><i /></div>
    </>
  );
}
