/** QR 모듈 행렬(true=검은 칸)을 단일 SVG path로 변환 — 칸마다 1x1 사각형 */
export function qrPathData(modules: boolean[][]): string {
  let d = "";
  modules.forEach((row, y) => {
    row.forEach((on, x) => {
      if (on) d += `M${x} ${y}h1v1h-1z`;
    });
  });
  return d;
}
