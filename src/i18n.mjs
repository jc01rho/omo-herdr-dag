export const messages = {
  en: {
    pending: 'Pending', blocked: 'Blocked', scheduled: 'Scheduled', running: 'Running', paused: 'Paused',
    completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', skipped: 'Skipped',
    startNode: 'Start node', sameFrontier: 'Same frontier', emptyTitle: 'Your next workflow DAG will appear here.',
    readError: 'Read error: {error}', keepLast: 'Keeping the last valid snapshot.',
    doneCount: 'Done {done}/{total}', failedCount: 'Failed {count}', graphError: 'Graph error: {error}',
    dependencies: 'Dependencies', none: 'None', waiting: 'Waiting for a DAG',
    waitingLine1: 'OmO workflow updates will appear', waitingLine2: 'in this pane automatically.',
    connected: 'Connected', disconnected: 'Disconnected · snapshot saved', controls: '↑↓ Scroll  ←→ Runs  q Close',
    closeHint: 'You can close this pane with q.',
    stateMissing: 'State file is missing.', closeFailed: 'Could not close pane: {error}',
    snapshotFormat: 'Unsupported OmO DAG snapshot format.', cycle: 'A dependency cycle was detected.',
    incompletePane: 'Check and close the incomplete viewer in pane {pane}, then run /dag-pane again.',
    missingPaneId: 'Herdr split response did not include a pane ID.',
    nodeUnavailable: 'The DAG viewer requires Node.js 24 or later. Install node on PATH or set OMO_HERDR_DAG_NODE to a Node executable path, then run /dag-pane again.',
    commandDescription: 'Open or reopen the current session’s DAG pane',
    unavailable: 'The DAG pane is unavailable in this session.',
    existingFile: 'Refusing to overwrite an unrelated user file: {path}',
    unmanagedDirectory: 'This directory is not managed by omo-herdr-dag: {path}',
    activation: 'Start a new OmO session or run /reload',
  },
  ko: {
    pending: '대기', blocked: '의존 대기', scheduled: '배정', running: '실행 중', paused: '일시정지',
    completed: '완료', failed: '실패', cancelled: '취소', skipped: '건너뜀',
    startNode: '시작 노드', sameFrontier: '같은 실행 단계', emptyTitle: 'DAG가 생성되면 여기에 표시합니다.',
    readError: '읽기 오류: {error}', keepLast: '마지막 정상 화면을 유지합니다.',
    doneCount: '완료 {done}/{total}', failedCount: '실패 {count}', graphError: '그래프 오류: {error}',
    dependencies: '의존 관계', none: '없음', waiting: 'DAG 대기 중',
    waitingLine1: 'OmO workflow의 생성·상태 변경을', waitingLine2: '이 pane에서 자동으로 표시합니다.',
    connected: '연결됨', disconnected: '연결 종료 · 기록 보존', controls: '↑↓ 스크롤  ←→ 실행 선택  q 닫기',
    closeHint: 'q를 눌러 닫아도 됩니다.',
    stateMissing: '상태 파일이 없습니다.', closeFailed: 'pane 닫기 실패: {error}',
    snapshotFormat: '지원하지 않는 OmO DAG snapshot 형식입니다.', cycle: '순환 의존 관계를 발견했습니다.',
    incompletePane: '기존 pane {pane}의 실행 상태를 확인한 뒤 닫고 /dag-pane을 다시 실행하세요.',
    missingPaneId: 'Herdr split 응답에 pane ID가 없습니다.',
    nodeUnavailable: 'DAG viewer에는 Node.js 24 이상이 필요합니다. PATH에 node를 설치하거나 OMO_HERDR_DAG_NODE에 Node 실행 파일 경로를 지정한 뒤 /dag-pane을 다시 실행하세요.',
    commandDescription: '현재 세션의 DAG pane 열기 (닫은 pane 다시 열기)',
    unavailable: '현재 세션에서는 DAG pane을 사용할 수 없습니다.',
    existingFile: '기존 사용자 파일을 덮어쓸 수 없습니다: {path}',
    unmanagedDirectory: '관리 대상이 아닌 폴더입니다: {path}',
    activation: '새 OmO 세션 또는 /reload',
  },
};

export const languageOf = value => value === 'ko' ? 'ko' : 'en';
export function t(language, key, values = {}) {
  const template = messages[languageOf(language)][key];
  if (template === undefined) throw new Error(`Unknown translation key: ${key}`);
  return template.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
}
